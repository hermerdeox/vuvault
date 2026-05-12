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
import { OpaqueClient } from '@structured-id/opaque';
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
		sequenceClock?: number;
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
	sequenceClock?: number;
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

/**
 * OPAQUE registration: end-to-end. Returns the export key (32 bytes
 * for the default Ristretto255+SHA-512 suite) — this is the value
 * the rest of VuVault folds into the HKDF derivation chain.
 */
export async function register(
	opts: OpaqueRegisterInput
): Promise<OpaqueRegisterResult> {
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
		expiresAt: session.expiresAt,
		sequenceClock: session.sequenceClock
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
				sequenceClock?: number;
			}>(
				`${base}/api/opaque/login/ke3`,
				{ clientId, requestId, ke3: bytesToBase64(ke3) }
			);
			return {
				accountId: data.accountId,
				token: data.token,
				expiresAt: data.expiresAt,
				sequenceClock: data.sequenceClock
			};
		}
	};
}
