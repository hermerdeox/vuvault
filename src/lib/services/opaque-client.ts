/**
 * OPAQUE client facade (RFC 9807).
 *
 * Wraps `@structured-id/opaque` behind a minimal swappable surface so
 * the rest of the app talks to a stable contract regardless of which
 * underlying library we use. If we ever need to switch (e.g. once an
 * audited Rust opaque-ke compiles to WASM, or once the Cloudflare lib
 * catches up to RFC 9807) only this file changes.
 *
 * REVIEW: new runtime dep `@structured-id/opaque@1.0.4` (pre-approved
 * for M2 per the plan). Pin is exact; CI guards against silent
 * upgrades.
 *
 * The facade exposes ONLY high-level operations:
 *
 *   register(...)  -> { record, exportKey, accountId }
 *   login(...)     -> { sessionKey, exportKey, accountId }
 *
 * The wire-shape OPAQUE messages (request/response, KE1/KE2/KE3) are
 * passed through a `transport` interface so tests inject a mock and
 * production injects the real `sync-client.ts` against the M3 Worker.
 */

// REVIEW: new runtime dep — see header comment.
import {
	DEFAULT_SUITE,
	OpaqueClient,
	clientAkeFinish,
	clientAkeStart,
	deserializeKE2,
	deriveRandomizedPassword,
	getGroup,
	getSuite,
	oprfBlind,
	oprfFinalize,
	recover,
	serializeEnvelope,
	serializeKE1,
	setBackend,
	store,
	unmaskResponse
} from '@structured-id/opaque';
import { expand } from '@noble/hashes/hkdf';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2';
import type { AccountId, ServerIdentifier, ClientIdentifier } from '$lib/types/sync';

/**
 * Transport surface — abstracts whether we're talking to the M3 Worker
 * over `fetch()`, the in-process mock server (M2 dev/tests), or a
 * future paired-device channel.
 */
export interface OpaqueTransport {
	/**
	 * Submit a registration request (OPRF blinded element); receive the
	 * server's response bytes (evaluated element || server public key).
	 */
	registerRequest(
		clientId: ClientIdentifier,
		request: Uint8Array
	): Promise<{ response: Uint8Array; requestId: string }>;
	/**
	 * Submit the final registration record and receive the server-
	 * assigned accountId.
	 */
	registerRecord(
		clientId: ClientIdentifier,
		requestId: string,
		record: Uint8Array
	): Promise<{ accountId: AccountId }>;
	/**
	 * Submit KE1; receive KE2.
	 */
	loginKE1(
		clientId: ClientIdentifier,
		ke1: Uint8Array
	): Promise<{ ke2: Uint8Array; requestId: string }>;
	/**
	 * Submit KE3; receive accountId on success. Throws on MAC failure.
	 */
	loginKE3(
		clientId: ClientIdentifier,
		requestId: string,
		ke3: Uint8Array
	): Promise<{
		accountId: AccountId;
		token?: string;
		expiresAt?: number;
	}>;
}

export interface OpaqueRegisterResult {
	accountId: AccountId;
	exportKey: Uint8Array;
}

export interface OpaqueLoginResult {
	accountId: AccountId;
	sessionKey: Uint8Array;
	exportKey: Uint8Array;
	token?: string;
	expiresAt?: number;
}

export interface OpaqueRegisterInput {
	serverId: ServerIdentifier;
	clientId: ClientIdentifier;
	password: string;
	transport: OpaqueTransport;
}

export interface OpaqueLoginInput {
	serverId: ServerIdentifier;
	clientId: ClientIdentifier;
	password: string;
	transport: OpaqueTransport;
}

type OpaqueState = {
	readonly suite: typeof DEFAULT_SUITE;
	readonly blind: Uint8Array;
	readonly clientEphemeralSecret?: Uint8Array;
	readonly clientEphemeralPublic?: Uint8Array;
	readonly ke1?: Uint8Array;
};

type OpaqueIdentifiers = {
	server: string;
	client: string;
};

type OpaqueSuite = ReturnType<typeof getSuite>;

const te = new TextEncoder();
let jsBackendForced = false;

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const arr of arrays) {
		out.set(arr, offset);
		offset += arr.length;
	}
	return out;
}

function deriveKeyPairFromSeed(group: ReturnType<typeof getGroup>, seed: Uint8Array) {
	const secretKey = group.scalarReduce(seed);
	const publicElement = group.scalarBaseMult(secretKey);
	return { secretKey, publicKey: group.serializeElement(publicElement) };
}

function hashFnForSuite(suite: OpaqueSuite) {
	switch (suite.hash) {
		case 'SHA-256':
			return sha256;
		case 'SHA-384':
			return sha384;
		case 'SHA-512':
			return sha512;
		default:
			throw new Error(`Unsupported OPAQUE hash suite ${suite.hash}`);
	}
}

/**
 * @structured-id/opaque@1.0.4 ships a WASM backend that handles password
 * policy/breach helpers but deliberately throws for the OPAQUE protocol
 * methods. In browsers that WASM backend loads first, so force a protocol
 * backend built from the package's public JS primitives before creating
 * any clients. Node usually falls back naturally, but using the same path
 * everywhere keeps registration/login behavior identical.
 */
function forceJsOpaqueBackend(): void {
	if (jsBackendForced) return;
	setBackend({
		name: 'js',
		async registrationStart(password: string, suiteId = DEFAULT_SUITE) {
			const suite = getSuite(suiteId);
			const input = te.encode(password);
			const { blind, blindedElement } = oprfBlind(suite.curve, input);
			return { request: blindedElement, state: { suite: suiteId, blind } };
		},
		async registrationFinish(
			password: string,
			response: Uint8Array,
			state: OpaqueState,
			identifiers: OpaqueIdentifiers
		) {
			const suite = getSuite(state.suite);
			const group = getGroup(suite.curve);
			const input = te.encode(password);
			const evaluatedMessage = response.slice(0, suite.elementSize);
			const serverPublicKey = response.slice(suite.elementSize, suite.elementSize * 2);
			const oprfOutput = oprfFinalize(
				suite.curve,
				input,
				state.blind,
				evaluatedMessage
			);
			const randomizedPassword = deriveRandomizedPassword(oprfOutput, suite);
			const deriveKP = (seed: Uint8Array) => deriveKeyPairFromSeed(group, seed);
			const storeResult = store(
				randomizedPassword,
				serverPublicKey,
				deriveKP,
				suite,
				te.encode(identifiers.server),
				te.encode(identifiers.client)
			);
			return {
				record: concatBytes(
					storeResult.clientPublicKey,
					storeResult.maskingKey,
					serializeEnvelope(storeResult.envelope)
				),
				exportKey: storeResult.exportKey
			};
		},
		async loginStart(password: string, suiteId = DEFAULT_SUITE) {
			const suite = getSuite(suiteId);
			const input = te.encode(password);
			const { blind, blindedElement } = oprfBlind(suite.curve, input);
			const { ke1, state: akeState } = clientAkeStart(blindedElement, suite);
			const ke1Bytes = serializeKE1(ke1);
			return {
				ke1: ke1Bytes,
				state: {
					suite: suiteId,
					blind,
					clientEphemeralSecret: akeState.clientSecretKeyshare,
					clientEphemeralPublic: ke1.clientPublicKeyshare,
					ke1: ke1Bytes
				}
			};
		},
		async loginFinish(
			password: string,
			ke2Bytes: Uint8Array,
			state: OpaqueState,
			identifiers: OpaqueIdentifiers
		) {
			const suite = getSuite(state.suite);
			const group = getGroup(suite.curve);
			const input = te.encode(password);
			const ke2 = deserializeKE2(ke2Bytes, suite);
			const credResp = ke2.credentialResponse;
			const evaluatedMessage = credResp.slice(0, suite.elementSize);
			const maskingNonce = credResp.slice(
				suite.elementSize,
				suite.elementSize + suite.nonceSize
			);
			const maskedResponse = credResp.slice(suite.elementSize + suite.nonceSize);
			const oprfOutput = oprfFinalize(
				suite.curve,
				input,
				state.blind,
				evaluatedMessage
			);
			const randomizedPassword = deriveRandomizedPassword(oprfOutput, suite);
			const maskingKey = expand(
				hashFnForSuite(suite),
				randomizedPassword,
				te.encode('MaskingKey'),
				suite.oprfOutputSize
			);
			const { serverPublicKey, envelope } = unmaskResponse(
				maskingKey,
				maskingNonce,
				maskedResponse,
				suite
			);
			const deriveKP = (seed: Uint8Array) => deriveKeyPairFromSeed(group, seed);
			const clientIdBytes = te.encode(identifiers.client);
			const serverIdBytes = te.encode(identifiers.server);
			const recoverResult = recover(
				randomizedPassword,
				serverPublicKey,
				envelope,
				deriveKP,
				suite,
				serverIdBytes,
				clientIdBytes
			);
			const { ke1 } = state;
			if (!ke1 || !state.clientEphemeralSecret) {
				throw new Error('OPAQUE login state is incomplete');
			}
			const akeState = {
				clientSecretKeyshare: state.clientEphemeralSecret,
				clientNonce: ke1.slice(suite.elementSize, suite.elementSize + suite.nonceSize),
				ke1Serialized: ke1
			};
			const { ke3, sessionKey } = clientAkeFinish(
				recoverResult.clientSecretKey,
				serverPublicKey,
				ke2,
				akeState,
				clientIdBytes,
				serverIdBytes,
				suite
			);
			return { ke3, sessionKey, exportKey: recoverResult.exportKey };
		}
	});
	jsBackendForced = true;
}

/**
 * OPAQUE registration: end-to-end. Returns the export key (32 bytes
 * for the default Ristretto255+SHA-512 suite) — this is the value
 * the rest of VuVault folds into the HKDF derivation chain.
 */
export async function register(
	opts: OpaqueRegisterInput
): Promise<OpaqueRegisterResult> {
	forceJsOpaqueBackend();
	const client = new OpaqueClient({
		serverId: opts.serverId,
		clientId: opts.clientId
	});
	const { request, state } = await client.registrationStart(opts.password);
	const { response, requestId } = await opts.transport.registerRequest(
		opts.clientId,
		request
	);
	const { record, exportKey } = await client.registrationFinish(
		opts.password,
		response,
		state
	);
	const { accountId } = await opts.transport.registerRecord(
		opts.clientId,
		requestId,
		record
	);
	return { accountId, exportKey };
}

/**
 * OPAQUE login: end-to-end. Throws if the password is wrong (the
 * underlying library throws on MAC failure during `loginFinish`) or
 * if the server rejects KE3.
 */
export async function login(opts: OpaqueLoginInput): Promise<OpaqueLoginResult> {
	forceJsOpaqueBackend();
	const client = new OpaqueClient({
		serverId: opts.serverId,
		clientId: opts.clientId
	});
	const { ke1, state } = await client.loginStart(opts.password);
	const { ke2, requestId } = await opts.transport.loginKE1(opts.clientId, ke1);
	// `loginFinish` throws if the recovered envelope's auth tag is
	// invalid — i.e. wrong password.
	const finish = await client.loginFinish(opts.password, ke2, state);
	const session = await opts.transport.loginKE3(
		opts.clientId,
		requestId,
		finish.ke3
	);
	return {
		accountId: session.accountId,
		sessionKey: finish.sessionKey,
		exportKey: finish.exportKey,
		token: session.token,
		expiresAt: session.expiresAt
	};
}

// --- Fetch-backed transport (production) ----------------------------

const TRANSPORT_TIMEOUT_MS = 30_000;

/**
 * Cosmetic class. Lets call sites narrow `instanceof` to detect a
 * server-shaped failure separately from an unwrapping/library bug.
 */
export class OpaqueServerError extends Error {
	constructor(
		public readonly code: number,
		public readonly serverMessage: string
	) {
		super(`opaque server error (${code}): ${serverMessage}`);
		this.name = 'OpaqueServerError';
	}
}

/**
 * Coarse failure taxonomy for an OPAQUE login. The unlock UI uses this to
 * decide what to tell the user and whether to count a failed attempt.
 *
 *   wrong-credential — the Secret Key is wrong for this enrolment, or an
 *                      AKE MAC failed (client- or server-side). The ONLY
 *                      kind that should burn an unlock attempt.
 *   rate-limited     — the sync server is throttling (HTTP 429). Transient,
 *                      but retrying immediately makes it worse — wait.
 *   unavailable      — a network failure (our code-0 sentinel) or a
 *                      server-side fault (HTTP 5xx, e.g. a Cloudflare
 *                      outage). Transient and safe to auto-retry.
 *   unknown          — anything else, notably 4xx handshake errors like an
 *                      expired pending-login. Not a wrong key; surface a
 *                      generic "try again".
 */
export type OpaqueFailureKind =
	| 'wrong-credential'
	| 'rate-limited'
	| 'unavailable'
	| 'unknown';

export function classifyOpaqueError(err: unknown): OpaqueFailureKind {
	if (err instanceof OpaqueServerError) {
		if (err.code === 401) return 'wrong-credential';
		if (err.code === 429) return 'rate-limited';
		// code 0 is our sentinel for a fetch/network failure; 5xx is a
		// server-side fault. Both are transient and worth retrying.
		if (err.code === 0 || err.code >= 500) return 'unavailable';
		return 'unknown';
	}
	// The OPAQUE library throws a plain Error on a bad envelope/MAC during
	// loginFinish — i.e. the wrong password — before the server ever sees
	// KE3. Its messages contain "auth"/"wrong"/"MAC".
	if (err instanceof Error && /MAC|auth|wrong/i.test(err.message)) {
		return 'wrong-credential';
	}
	return 'unknown';
}

export interface LoginRetryConfig {
	/** Extra attempts after the first (default 2 → up to 3 total). */
	retries?: number;
	/** Base linear backoff between attempts, in ms (default 400). */
	backoffMs?: number;
	/** Injectable delay so tests don't actually wait. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * `login` with bounded auto-retry for TRANSIENT failures only. A
 * Cloudflare/Worker blip (network or 5xx) self-heals across a couple of
 * attempts instead of presenting as a hard "sync server unreachable"
 * lockout. Wrong-credential, rate-limit, and handshake errors are NOT
 * retried — retrying cannot help and (for rate limits) hurts. Each
 * attempt is a fresh OPAQUE handshake (new ephemerals + requestId), so
 * replaying the whole exchange is safe.
 */
export async function loginWithRetry(
	opts: OpaqueLoginInput,
	config: LoginRetryConfig = {}
): Promise<OpaqueLoginResult> {
	const retries = config.retries ?? 2;
	const backoffMs = config.backoffMs ?? 400;
	const sleep =
		config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	let lastErr: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await login(opts);
		} catch (err) {
			lastErr = err;
			if (attempt === retries || classifyOpaqueError(err) !== 'unavailable') {
				throw err;
			}
			await sleep(backoffMs * (attempt + 1));
		}
	}
	// Unreachable — the loop always returns or throws — but satisfies TS.
	throw lastErr;
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	// `btoa` is browser+worker; Node tests run via the platform shim
	// in vitest's happy-dom environment, which polyfills it.
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), TRANSPORT_TIMEOUT_MS);
	let res: Response;
	try {
		// fetch() is whitelisted in this file by the CI Network-call
		// guard (.github/workflows/ci.yml). Same-origin only — caller
		// passes a path, not a host.
		res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			signal: ctrl.signal,
			credentials: 'omit',
			cache: 'no-store'
		});
	} catch (err) {
		throw new OpaqueServerError(0, err instanceof Error ? err.message : 'network');
	} finally {
		clearTimeout(t);
	}
	let parsed: unknown;
	try {
		parsed = await res.json();
	} catch {
		throw new OpaqueServerError(res.status, 'invalid response body');
	}
	const obj = parsed as { ok?: boolean; data?: unknown; error?: string };
	if (!res.ok || obj?.ok !== true) {
		throw new OpaqueServerError(res.status, obj?.error ?? 'request failed');
	}
	return obj.data as T;
}

/**
 * Production fetch-backed transport. Talks to the four
 * `/api/opaque/...` endpoints declared in `functions/api/opaque/`.
 *
 * `origin` is a base URL (for example, the current app origin). We pass paths
 * relative to it so the implementation is same-origin in production
 * and configurable in dev/tests.
 */
export function createFetchTransport(origin: string): OpaqueTransport {
	const base = origin.replace(/\/+$/, '');
	return {
		async registerRequest(clientId, request) {
			const data = await postJson<{ requestId: string; response: string }>(
				`${base}/api/opaque/register/request`,
				{ clientId, request: bytesToBase64(request) }
			);
			return {
				response: base64ToBytes(data.response),
				requestId: data.requestId
			};
		},
		async registerRecord(clientId, requestId, record) {
			const data = await postJson<{ accountId: string }>(
				`${base}/api/opaque/register/record`,
				{ clientId, requestId, record: bytesToBase64(record) }
			);
			return { accountId: data.accountId };
		},
		async loginKE1(clientId, ke1) {
			const data = await postJson<{ requestId: string; ke2: string }>(
				`${base}/api/opaque/login/ke1`,
				{ clientId, ke1: bytesToBase64(ke1) }
			);
			return {
				ke2: base64ToBytes(data.ke2),
				requestId: data.requestId
			};
		},
		async loginKE3(clientId, requestId, ke3) {
			const data = await postJson<{
				accountId: string;
				token?: string;
				expiresAt?: number;
			}>(
				`${base}/api/opaque/login/ke3`,
				{ clientId, requestId, ke3: bytesToBase64(ke3) }
			);
			return {
				accountId: data.accountId,
				token: data.token,
				expiresAt: data.expiresAt
			};
		}
	};
}
