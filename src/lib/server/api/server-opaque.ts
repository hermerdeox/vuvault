/**
 * OPAQUE server engine — runtime-agnostic.
 *
 * Implements the server side of RFC 9807 OPAQUE on top of the
 * `@structured-id/opaque` library primitives. Storage is abstracted
 * behind the `OpaqueStorage` interface so the same engine drives:
 *
 *   - The in-process MockOpaqueServer (Map-backed) used by Vitest
 *     unit tests + dev provisioning.
 *   - The Cloudflare Worker (D1-backed) that ships in M3.
 *
 * Factoring rule: anything that touches Web Crypto / OPAQUE primitives
 * lives here. Anything that touches D1 / fetch / Worker runtime APIs
 * lives in `d1-storage.ts` or the Pages Function handlers under
 * `functions/api/opaque/*`. Keeping that separation honest is what
 * makes the integration tests under `tests/integration/worker.spec.ts`
 * exercise the same code path as production.
 *
 * SECURITY: this engine NEVER stores or sees a plaintext password.
 * The `clientId` passed in is the server-facing identifier; it is
 * deterministic from the device but is NOT password-derived. Server
 * never can retrieve a user's password from any of the persisted
 * fields here — that's the point of OPAQUE.
 *
 * Threat-model note: rate limiting is the caller's responsibility
 * (the Worker uses Cloudflare WAF; the mock server has no rate
 * limiting and is for tests only).
 */

import {
	getSuite,
	getGroup,
	oprfBlindEvaluate,
	oprfGenerateKeyPair,
	maskResponse,
	serializeKE2,
	serverAkeRespond,
	serverAkeFinish,
	deserializeEnvelope,
	envelopeSize,
	DEFAULT_SUITE,
	type CipherSuiteId,
	type ServerAkeState
} from '@structured-id/opaque';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';

// Type-level imports only; this module deliberately has no $lib alias
// so the Worker bundles it cleanly. The wire types live under src/
// because both client and server reference them.
type AccountId = string;
type ClientIdentifier = string;
type ServerIdentifier = string;

const te = new TextEncoder();
const SUITE_ID: CipherSuiteId = DEFAULT_SUITE;
const FAKE_RECORD_SALT = te.encode('vuvault-opaque-fake-record-v1');

function concat(...arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((n, a) => n + a.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) {
		out.set(a, off);
		off += a.length;
	}
	return out;
}

function randomId(): string {
	const buf = new Uint8Array(16);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Persisted registration record. Server retains ONLY this — never
 * the password, never anything from which the password is recoverable.
 */
export type StoredAccount = {
	accountId: AccountId;
	clientPublicKey: Uint8Array;
	maskingKey: Uint8Array;
	envelopeBytes: Uint8Array;
	oprfSecretKey: Uint8Array;
};

/**
 * In-flight registration state. Server holds the OPRF secret it just
 * generated until the client finishes by sending the registration
 * record. Should expire ~30s after creation.
 */
export type PendingRegistration = {
	clientId: ClientIdentifier;
	oprfSecretKey: Uint8Array;
	createdAt: number;
};

/**
 * In-flight login state. Server holds the AKE state from KE2 until
 * the client sends KE3. Should expire ~30s after creation.
 */
export type PendingLogin = {
	clientId: ClientIdentifier;
	state: ServerAkeState;
	createdAt: number;
};

/**
 * Storage adapter — implemented by:
 *   - InMemoryStorage (in mock-opaque-server.ts)
 *   - D1Storage (in d1-storage.ts), the production Worker variant
 */
export interface OpaqueStorage {
	getAccount(clientId: ClientIdentifier): Promise<StoredAccount | null>;
	putAccount(clientId: ClientIdentifier, account: StoredAccount): Promise<void>;
	deleteAccount(clientId: ClientIdentifier): Promise<void>;

	getPendingRegistration(requestId: string): Promise<PendingRegistration | null>;
	putPendingRegistration(requestId: string, p: PendingRegistration): Promise<void>;
	deletePendingRegistration(requestId: string): Promise<void>;

	getPendingLogin(requestId: string): Promise<PendingLogin | null>;
	putPendingLogin(requestId: string, p: PendingLogin): Promise<void>;
	deletePendingLogin(requestId: string): Promise<void>;
}

/**
 * Server identity material. Loaded once per request from D1's
 * `server_identity` table (or hardcoded at construction for the mock).
 */
export type ServerIdentity = {
	serverId: ServerIdentifier;
	serverSecretKey: Uint8Array;
	serverPublicKey: Uint8Array;
};

/**
 * The runtime-agnostic engine. Construct once per request (Worker)
 * or once per test (mock). Each method maps 1:1 to an OPAQUE wire
 * step from the client.
 */
export class OpaqueServerEngine {
	readonly serverId: ServerIdentifier;
	private readonly suite = getSuite(SUITE_ID);
	private readonly serverSecretKey: Uint8Array;
	private readonly serverPublicKey: Uint8Array;
	private readonly storage: OpaqueStorage;

	constructor(identity: ServerIdentity, storage: OpaqueStorage) {
		this.serverId = identity.serverId;
		this.serverSecretKey = identity.serverSecretKey;
		this.serverPublicKey = identity.serverPublicKey;
		this.storage = storage;
	}

	/** Helper for callers that need the long-lived public key. */
	getServerPublicKey(): Uint8Array {
		return this.serverPublicKey;
	}

	/**
	 * Generate a fresh long-lived server keypair for first deploy.
	 * Run once; persist `secretKey` to D1's `server_identity` table.
	 * Re-running rotates and invalidates every existing registration.
	 */
	static generateServerKeypair(): {
		serverSecretKey: Uint8Array;
		serverPublicKey: Uint8Array;
	} {
		const suite = getSuite(SUITE_ID);
		const group = getGroup(suite.curve);
		const kp = group.generateKeypair();
		return { serverSecretKey: kp.secretKey, serverPublicKey: kp.publicKey };
	}

	/**
	 * Derive the long-lived server public key from the persisted secret key.
	 *
	 * Cloudflare D1 stores only `server_identity.oprf_seed` / server secret
	 * entropy. Production request handlers must reconstruct the matching
	 * public key deterministically on every request; generating a fresh
	 * keypair here would make OPAQUE registration/login transcripts
	 * inconsistent across requests.
	 */
	static publicKeyFromServerSecretKey(serverSecretKey: Uint8Array): Uint8Array {
		const suite = getSuite(SUITE_ID);
		const group = getGroup(suite.curve);
		if (serverSecretKey.length !== group.scalarSize) {
			throw new Error(
				`opaque: server secret key must be ${group.scalarSize} bytes`
			);
		}
		const publicPoint = group.scalarBaseMult(serverSecretKey);
		return group.serializeElement(publicPoint);
	}

	async registerRequest(
		clientId: ClientIdentifier,
		request: Uint8Array
	): Promise<{ response: Uint8Array; requestId: string }> {
		const oprf = oprfGenerateKeyPair(this.suite.curve);
		const evaluated = oprfBlindEvaluate(this.suite.curve, oprf.secretKey, request);
		const response = concat(evaluated, this.serverPublicKey);
		const requestId = randomId();
		await this.storage.putPendingRegistration(requestId, {
			clientId,
			oprfSecretKey: oprf.secretKey,
			createdAt: Date.now()
		});
		return { response, requestId };
	}

	async registerRecord(
		clientId: ClientIdentifier,
		requestId: string,
		record: Uint8Array
	): Promise<{ accountId: AccountId }> {
		const pending = await this.storage.getPendingRegistration(requestId);
		if (!pending) throw new Error('opaque: unknown registration request');
		await this.storage.deletePendingRegistration(requestId);
		if (pending.clientId !== clientId) {
			throw new Error('opaque: clientId mismatch on register-record');
		}

		// Record layout from @structured-id/opaque (jsBackend.registrationFinish):
		//   record = clientPublicKey || maskingKey || serializedEnvelope
		const elementSize = this.suite.elementSize;
		const oprfOutputSize = this.suite.oprfOutputSize;
		const envSize = envelopeSize(this.suite);
		if (record.length !== elementSize + oprfOutputSize + envSize) {
			throw new Error('opaque: registration record length mismatch');
		}
		const clientPublicKey = record.slice(0, elementSize);
		const maskingKey = record.slice(elementSize, elementSize + oprfOutputSize);
		const envelopeBytes = record.slice(elementSize + oprfOutputSize);

		// Validate the envelope deserializes — fails fast on tampering.
		deserializeEnvelope(envelopeBytes, this.suite);

		const accountId = randomId();
		await this.storage.putAccount(clientId, {
			accountId,
			clientPublicKey,
			maskingKey,
			envelopeBytes,
			oprfSecretKey: pending.oprfSecretKey
		});
		return { accountId };
	}

	/**
	 * V0-C3 — RFC 9807 §10.9 client-enumeration defense. An unknown
	 * clientId gets a fake registration record and then the exact same
	 * OPRF evaluation, envelope masking and AKE as a real account, so KE1
	 * answers 200 with a well-formed KE2 either way: status, shape and
	 * length no longer reveal whether the account exists.
	 *
	 * The record is derived deterministically from the server secret and
	 * the clientId, so repeated probes of one unknown id see the same
	 * fake OPRF key / client key like they would for a real account. The
	 * fake client public key's secret is unknown to anyone but this
	 * derivation, so the KE3 MAC can never verify for it.
	 */
	private fakeAccount(clientId: ClientIdentifier): StoredAccount {
		const group = getGroup(this.suite.curve);
		const maskingSize = this.suite.oprfOutputSize;
		const envSize = envelopeSize(this.suite);
		const okm = hkdf(
			sha512,
			this.serverSecretKey,
			FAKE_RECORD_SALT,
			te.encode(clientId),
			64 + 64 + maskingSize + envSize
		);
		let off = 0;
		const take = (n: number) => okm.slice(off, (off += n));
		// `GroupOps.scalarReduce` emits a big-endian scalar, but the OPRF
		// functions take the little-endian encoding `oprfGenerateKeyPair`
		// produces (verified against @structured-id/opaque 1.0.5: the BE
		// form is rejected as "outside of range 0..ORDER"). Reversing the
		// bytes is the LE encoding of the same in-range scalar.
		const oprfSecretKey = group.scalarReduce(take(64)).reverse();
		// Only ever used through GroupOps.scalarBaseMult, which takes the
		// GroupOps (big-endian) form as-is.
		const clientSecret = group.scalarReduce(take(64));
		return {
			accountId: '',
			clientPublicKey: group.serializeElement(group.scalarBaseMult(clientSecret)),
			maskingKey: take(maskingSize),
			envelopeBytes: take(envSize),
			oprfSecretKey
		};
	}

	async loginKE1(
		clientId: ClientIdentifier,
		ke1Bytes: Uint8Array
	): Promise<{ ke2: Uint8Array; requestId: string }> {
		// Shape check first so a malformed KE1 is rejected identically
		// whether or not the account exists.
		const { elementSize, nonceSize } = this.suite;
		const expected = elementSize + nonceSize + elementSize;
		if (ke1Bytes.length !== expected) {
			throw new Error('opaque: KE1 length mismatch');
		}
		const account =
			(await this.storage.getAccount(clientId)) ?? this.fakeAccount(clientId);
		const credentialRequest = ke1Bytes.slice(0, elementSize);
		const clientNonce = ke1Bytes.slice(elementSize, elementSize + nonceSize);
		const clientPublicKeyshare = ke1Bytes.slice(elementSize + nonceSize);

		const evaluated = oprfBlindEvaluate(
			this.suite.curve,
			account.oprfSecretKey,
			credentialRequest
		);

		const envelope = deserializeEnvelope(account.envelopeBytes, this.suite);
		const { maskingNonce, maskedResponse } = maskResponse(
			account.maskingKey,
			this.serverPublicKey,
			envelope,
			this.suite
		);
		const credentialResponse = concat(evaluated, maskingNonce, maskedResponse);

		const ke1Struct = {
			credentialRequest,
			clientNonce,
			clientPublicKeyshare
		};

		const { ke2, state } = serverAkeRespond(
			this.serverSecretKey,
			this.serverPublicKey,
			account.clientPublicKey,
			credentialResponse,
			ke1Struct,
			te.encode(clientId),
			te.encode(this.serverId),
			this.suite
		);
		const ke2Bytes = serializeKE2(ke2);
		const requestId = randomId();
		await this.storage.putPendingLogin(requestId, {
			clientId,
			state,
			createdAt: Date.now()
		});
		return { ke2: ke2Bytes, requestId };
	}

	async loginKE3(
		clientId: ClientIdentifier,
		requestId: string,
		ke3: Uint8Array
	): Promise<{ accountId: AccountId }> {
		const pending = await this.storage.getPendingLogin(requestId);
		if (!pending) throw new Error('opaque: unknown login request');
		await this.storage.deletePendingLogin(requestId);
		if (pending.clientId !== clientId) {
			throw new Error('opaque: clientId mismatch on login-KE3');
		}
		// `serverAkeFinish` throws on MAC mismatch — that's our "wrong
		// password" detection. It runs BEFORE the account lookup so a fake
		// (unknown-clientId) login fails here, with the same error as a
		// wrong password, instead of on a distinguishable missing-account
		// branch.
		serverAkeFinish(ke3, pending.state);
		const account = await this.storage.getAccount(clientId);
		if (!account) throw new Error('opaque: authentication failed');
		return { accountId: account.accountId };
	}
}
