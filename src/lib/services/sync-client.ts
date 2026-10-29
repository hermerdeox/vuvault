/**
 * Sync client — typed surface for the OPAQUE/blob-sync Worker.
 *
 * Milestone 3 implementation. Every method is gated on
 * `isSyncOriginConfigured()` (driven by `PUBLIC_SYNC_ORIGIN`):
 *
 *   - When the env var is empty → returns `NOT_WIRED` (local-only),
 *     identical surface to the M2 stub. This is the path local
 *     developers and offline production users hit.
 *   - When the env var resolves to a same-origin base URL → makes
 *     a same-origin fetch against the Pages Function under
 *     `functions/api/`.
 *
 * The CI network-call guard whitelists this file as the only place
 * that may issue `fetch()` calls beyond the build-integrity manifest
 * (env.ts), the OPAQUE transport (opaque-client.ts), and the
 * Argon2id WASM loader (argon2.ts).
 *
 * Every function signature is unchanged from the M2 stub so existing
 * call sites and test fixtures keep working. The only behavior
 * change is: when `PUBLIC_SYNC_ORIGIN` is set, methods may return
 * `{ ok: true, value }` instead of `NOT_WIRED`.
 */

import type {
	OpaqueRegistrationRequest,
	OpaqueRegistrationResponse,
	OpaqueRegistrationRecord,
	OpaqueLoginKE1,
	OpaqueLoginKE2,
	OpaqueLoginKE3,
	OpaqueLoginResult,
	SyncCapabilities
} from '$lib/types/sync';
import { getSyncOrigin, isSyncOriginConfigured } from '$lib/utils/env';
import { blind as voprfBlind, finalize as voprfFinalize } from '$lib/crypto/voprf';

export type SyncResult<T> =
	| { ok: true; value: T }
	| { ok: false; reason: 'local-only' | 'network' | 'server'; message: string };

const NOT_WIRED: SyncResult<never> = {
	ok: false,
	reason: 'local-only',
	message: 'Sync server not configured (local-only mode).'
};

const REQUEST_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function hasString(value: Record<string, unknown>, key: string): boolean {
	return isString(value[key]);
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
	return isNumber(value[key]);
}

function isCapabilities(value: unknown): value is SyncCapabilities {
	return (
		isRecord(value) &&
		isBoolean(value.opaque) &&
		isBoolean(value.blobSync) &&
		isBoolean(value.deviceEnrollment) &&
		isBoolean(value.transparencyLog)
	);
}

function isOpaqueRegisterResponse(value: unknown): value is { requestId: string; response: string } {
	return isRecord(value) && hasString(value, 'requestId') && hasString(value, 'response');
}

function isOpaqueRegisterRecordResponse(value: unknown): value is { accountId: string } {
	return isRecord(value) && hasString(value, 'accountId');
}

function isOpaqueLoginKE2Response(value: unknown): value is { requestId: string; ke2: string } {
	return isRecord(value) && hasString(value, 'requestId') && hasString(value, 'ke2');
}

function isOpaqueLoginResult(value: unknown): value is OpaqueLoginResult {
	return (
		isRecord(value) &&
		hasString(value, 'accountId') &&
		(value.token === undefined || isString(value.token)) &&
		(value.expiresAt === undefined || isNumber(value.expiresAt))
	);
}

/**
 * Session bearer token issued by the Worker on successful KE3.
 *
 * STORAGE: in-memory module closure ONLY. NOT sessionStorage, NOT
 * localStorage, NOT IndexedDB. Lifetime is bounded to the JS
 * execution context of this module — a hard reload drops it and
 * forces the next OPAQUE login round-trip to re-mint. `lockSession`
 * in vault-session.ts clears it via `setSessionToken(null)` and
 * also fire-and-forgets `POST /api/opaque/logout` to invalidate the
 * row server-side. The token never appears in DOM-accessible
 * storage and never crosses a tab boundary.
 *
 * Threading it through every blob op happens implicitly via the
 * `call()` helper below, which appends `Authorization: Bearer
 * <token>` whenever `sessionToken !== null`.
 */
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
	sessionToken = token;
	if (token === null) clearAnonTokens();
}

export function hasSession(): boolean {
	return sessionToken !== null;
}

function origin(): string {
	return getSyncOrigin();
}

/**
 * Which credential a request carries. `bearer` (the default) attaches
 * the session token; `none` attaches nothing — used for the public token
 * key and for the v2 blob / inventory routes, which carry an anonymous
 * token in their own header instead (see `tokenCall`).
 */
type CallAuth = 'bearer' | 'none';

async function call<T>(
	path: string,
	init: RequestInit,
	expectedShape?: (data: unknown) => data is T,
	auth: CallAuth = 'bearer'
): Promise<SyncResult<T>> {
	if (!isSyncOriginConfigured()) {
		return NOT_WIRED;
	}
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(`${origin()}${path}`, {
			...init,
			signal: ctrl.signal,
			credentials: 'omit',
			cache: 'no-store',
			headers: {
				'content-type': 'application/json',
				...(auth === 'bearer' && sessionToken
					? { authorization: `Bearer ${sessionToken}` }
					: {}),
				...(init.headers ?? {})
			}
		});
	} catch (err) {
		clearTimeout(t);
		return {
			ok: false,
			reason: 'network',
			message: err instanceof Error ? err.message : 'fetch failed'
		};
	}
	clearTimeout(t);

	// Vu1 / L08 Option (ii) groundwork: if the server emits a
	// `Next-Token` response header, the previous session token has
	// just been atomically retired in D1 and the client must switch
	// to the new one BEFORE the next authenticated request. The
	// header is 64-char hex (32 bytes) matching `newToken()` on the
	// server. If the format is wrong, we ignore it — better to keep
	// the existing token than break authentication on a malformed
	// header.
	//
	// Rotation runs only for Bearer calls to routes that opt in (today:
	// /api/v2/sessions/self). The token-only v2 blob / inventory routes
	// never see the session token, so they never rotate it.
	const nextToken = res.headers.get('next-token');
	if (auth === 'bearer' && nextToken && /^[0-9a-fA-F]{64}$/.test(nextToken) && sessionToken) {
		sessionToken = nextToken;
	}

	let parsed: unknown;
	try {
		parsed = await res.json();
	} catch {
		return {
			ok: false,
			reason: 'server',
			message: `invalid response body (status ${res.status})`
		};
	}
	const obj = parsed as { ok?: boolean; data?: unknown; error?: string };
	if (!res.ok || obj?.ok !== true) {
		return {
			ok: false,
			reason: 'server',
			message: obj?.error ?? `request failed (status ${res.status})`
		};
	}
	if (expectedShape && !expectedShape(obj.data)) {
		return {
			ok: false,
			reason: 'server',
			message: 'response shape mismatch'
		};
	}
	return { ok: true, value: obj.data as T };
}

// --- Capability discovery ------------------------------------------

export async function getCapabilities(): Promise<SyncResult<SyncCapabilities>> {
	return call<SyncCapabilities>('/api/capabilities', { method: 'GET' }, isCapabilities);
}

// --- OPAQUE wire-format wrappers -----------------------------------
//
// These accept the wire-shape `OpaqueRegistrationRequest` etc. types
// rather than the raw bytes used by `opaque-client.ts`. The Pages
// Functions speak base64 already; we just unwrap the protocol op.

export async function opaqueRegisterRequest(
	req: OpaqueRegistrationRequest
): Promise<SyncResult<OpaqueRegistrationResponse>> {
	const inner = await call<{ requestId: string; response: string }>(
		'/api/opaque/register/request',
		{
			method: 'POST',
			body: JSON.stringify({ clientId: req.clientId, request: req.request })
		},
		isOpaqueRegisterResponse
	);
	if (!inner.ok) return inner;
	return {
		ok: true,
		value: {
			op: 'opaque-register-response',
			requestId: inner.value.requestId,
			response: inner.value.response
		}
	};
}

export async function opaqueRegisterRecord(
	req: OpaqueRegistrationRecord
): Promise<SyncResult<{ accountId: string }>> {
	return call<{ accountId: string }>(
		'/api/opaque/register/record',
		{
			method: 'POST',
			body: JSON.stringify({
				clientId: req.clientId,
				requestId: req.requestId,
				record: req.record
			})
		},
		isOpaqueRegisterRecordResponse
	);
}

export async function opaqueLoginKE1(
	req: OpaqueLoginKE1
): Promise<SyncResult<OpaqueLoginKE2>> {
	const inner = await call<{ requestId: string; ke2: string }>(
		'/api/opaque/login/ke1',
		{
			method: 'POST',
			body: JSON.stringify({ clientId: req.clientId, ke1: req.ke1 })
		},
		isOpaqueLoginKE2Response
	);
	if (!inner.ok) return inner;
	return {
		ok: true,
		value: {
			op: 'opaque-login-ke2',
			requestId: inner.value.requestId,
			ke2: inner.value.ke2
		}
	};
}

export async function opaqueLoginKE3(
	req: OpaqueLoginKE3
): Promise<SyncResult<OpaqueLoginResult>> {
	return call<OpaqueLoginResult>(
		'/api/opaque/login/ke3',
		{
			method: 'POST',
			body: JSON.stringify({
				clientId: req.clientId,
				requestId: req.requestId,
				ke3: req.ke3
			})
		},
		isOpaqueLoginResult
	);
}

/**
 * Server-side revocation of the current session token. The Worker
 * deletes the matching `sessions` row so an intercepted token stops
 * working before its 1-hour TTL expires. Fire-and-forget: callers
 * (notably `lockSession()`) must not block lock on a network round
 * trip, and the response shape is intentionally trivial so a slow
 * or failed call never leaves the UI hanging.
 */
export async function opaqueLogout(): Promise<SyncResult<{ revoked: boolean }>> {
	if (!sessionToken) {
		return { ok: true, value: { revoked: true } };
	}
	const result = await call<{ revoked: boolean }>(
		'/api/opaque/logout',
		{ method: 'POST', body: '{}' },
		isLogoutResponse
	);
	return result;
}

function isLogoutResponse(value: unknown): value is { revoked: boolean } {
	return isRecord(value) && isBoolean(value.revoked);
}

/**
 * Whether sync is wired in this build. Driven by
 * `PUBLIC_SYNC_ORIGIN` — empty → false → callers stay on the
 * local-only path; non-empty → true → callers may issue real
 * sync calls.
 */
export function isSyncWired(): boolean {
	return isSyncOriginConfigured();
}

// ---------------------------------------------------------------------
// V0-C1 — anonymous request tokens.
//
// The v2 blob and inventory routes never see the session token. Each
// request instead spends one single-use token from a pool minted by a
// blind VOPRF issuance (`POST /api/v0/tokens/issue`, Bearer-
// authenticated): the server signs blinded inputs it cannot recognize
// later, so a redeemed token tells it nothing about which account it
// came from. Server half: src/lib/server/api/anon-tokens.ts.
//
// The pool lives in module memory only (like `sessionToken`) and is
// dropped whenever the session token is cleared. `prefetchAnonTokens`
// fills it at unlock and `takeToken` tops it up in the background when
// it runs low, so issuance is not back-to-back with the requests that
// spend the tokens.
// ---------------------------------------------------------------------

const TOKEN_BATCH = 16;
const TOKEN_LOW_WATER = 4;
const TOKEN_INPUT_LEN = 32;
const TOKEN_HEADER = 'x-vu0-token';

let tokenPool: string[] = [];
let tokenRefill: Promise<boolean> | null = null;
/** Bumped on every clear so an in-flight issuance cannot refill a locked pool. */
let tokenGeneration = 0;
/** Key the public endpoint served for the current window; issuance must match it. */
let pinnedTokenKey: { keyId: number; publicKey: string } | null = null;

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function isTokenKey(value: unknown): value is { keyId: number; publicKey: string } {
	return isRecord(value) && hasNumber(value, 'keyId') && hasString(value, 'publicKey');
}

function isTokenIssue(value: unknown): value is {
	keyId: number;
	publicKey: string;
	evaluated: string[];
	proofs: string[];
} {
	return (
		isTokenKey(value) &&
		Array.isArray((value as Record<string, unknown>).evaluated) &&
		Array.isArray((value as Record<string, unknown>).proofs) &&
		((value as Record<string, unknown>).evaluated as unknown[]).every(isString) &&
		((value as Record<string, unknown>).proofs as unknown[]).every(isString)
	);
}

function clearAnonTokens(): void {
	tokenPool = [];
	pinnedTokenKey = null;
	tokenGeneration++;
}

async function pinTokenKey(): Promise<{ keyId: number; publicKey: string } | null> {
	const res = await call('/api/v0/tokens/key', { method: 'GET' }, isTokenKey, 'none');
	if (!res.ok) return null;
	pinnedTokenKey = res.value;
	return res.value;
}

/**
 * Mint one batch. Refuses the whole batch if the issuing key differs from
 * the publicly served one (the server could otherwise tag this client
 * with a key of its own) or if any DLEQ proof fails.
 */
async function issueTokenBatch(): Promise<boolean> {
	if (!sessionToken) return false;
	const generation = tokenGeneration;
	const inputs: Uint8Array[] = [];
	const blinds: Uint8Array[] = [];
	const blinded: string[] = [];
	for (let i = 0; i < TOKEN_BATCH; i++) {
		const input = crypto.getRandomValues(new Uint8Array(TOKEN_INPUT_LEN));
		const b = voprfBlind(input);
		inputs.push(input);
		blinds.push(b.blind);
		blinded.push(bytesToBase64(b.blindedElement));
	}
	const issued = await call(
		'/api/v0/tokens/issue',
		{ method: 'POST', body: JSON.stringify({ blinded }) },
		isTokenIssue
	);
	if (
		!issued.ok ||
		issued.value.evaluated.length !== TOKEN_BATCH ||
		issued.value.proofs.length !== TOKEN_BATCH
	) {
		return false;
	}
	let pinned = pinnedTokenKey;
	if (!pinned || pinned.keyId !== issued.value.keyId) pinned = await pinTokenKey();
	if (
		!pinned ||
		pinned.keyId !== issued.value.keyId ||
		pinned.publicKey !== issued.value.publicKey
	) {
		return false;
	}
	const publicKey = base64ToBytes(pinned.publicKey);
	const minted: string[] = [];
	for (let i = 0; i < TOKEN_BATCH; i++) {
		const output = voprfFinalize(
			inputs[i]!,
			blinds[i]!,
			base64ToBytes(issued.value.evaluated[i]!),
			base64ToBytes(issued.value.proofs[i]!),
			publicKey
		);
		if (!output) return false;
		minted.push(
			`v1.${issued.value.keyId}.${bytesToBase64(inputs[i]!)}.${bytesToBase64(output)}`
		);
	}
	if (generation !== tokenGeneration) return false;
	tokenPool.push(...minted);
	return true;
}

function refillTokens(): Promise<boolean> {
	if (!tokenRefill) {
		tokenRefill = issueTokenBatch()
			.catch(() => false)
			.finally(() => {
				tokenRefill = null;
			});
	}
	return tokenRefill;
}

async function takeToken(): Promise<string | null> {
	if (tokenPool.length === 0) await refillTokens();
	const token = tokenPool.shift() ?? null;
	if (tokenPool.length < TOKEN_LOW_WATER) void refillTokens();
	return token;
}

/** Warm the token pool (call once a session token exists, e.g. at unlock). */
export function prefetchAnonTokens(): void {
	if (isSyncOriginConfigured() && sessionToken && tokenPool.length < TOKEN_LOW_WATER) {
		void refillTokens();
	}
}

/**
 * `call` for the token-only v2 routes: attaches one anonymous token and
 * no session token. A token from a key window that has since closed is
 * refused with 'invalid token'; drop the stale pool once and retry.
 */
async function tokenCall<T>(
	path: string,
	init: RequestInit,
	expectedShape: (data: unknown) => data is T
): Promise<SyncResult<T>> {
	if (!isSyncOriginConfigured()) return NOT_WIRED;
	for (let attempt = 0; ; attempt++) {
		const token = await takeToken();
		if (!token) {
			return { ok: false, reason: 'server', message: 'no anonymous token available' };
		}
		const result = await call(
			path,
			{ ...init, headers: { ...(init.headers ?? {}), [TOKEN_HEADER]: token } },
			expectedShape,
			'none'
		);
		if (attempt === 0 && !result.ok && result.message === 'invalid token') {
			tokenPool = [];
			continue;
		}
		return result;
	}
}

// ---------------------------------------------------------------------
// §L07b — V2 blob + inventory client helpers (the only blob transport).
//
// The legacy per-account routes (`/api/blobs/*`, `/api/documents/*`)
// have been removed under the hard cutover: whole-vault saves and
// document blobs are random-UUID v2 objects, and the only mapping
// from "which blobs belong to this vault" is the client-side encrypted
// inventory (see inventory-session.ts). These helpers are the sole
// writers/readers of the blob surface.
//
// The privacy invariant: v2 endpoints carry no account binding in
// the URL, the body, the response, or the credential — each request
// spends an anonymous token (`tokenCall`), never the session token.
// ---------------------------------------------------------------------

type V2BlobUpload = {
	blobId: string; // UUID v4
	nonce: string; // base64
	ciphertext: string; // base64
};

type V2BlobResponse = {
	blobId: string;
	nonce: string;
	ciphertext: string;
	updatedAt: number;
};

function isV2BlobUploadResponse(
	value: unknown
): value is { blobId: string; updatedAt: number } {
	return (
		isRecord(value) &&
		hasString(value, 'blobId') &&
		hasNumber(value, 'updatedAt')
	);
}

function isV2BlobResponse(value: unknown): value is V2BlobResponse {
	return (
		isRecord(value) &&
		hasString(value, 'blobId') &&
		hasString(value, 'nonce') &&
		hasString(value, 'ciphertext') &&
		hasNumber(value, 'updatedAt')
	);
}

function isV2InvUploadResponse(
	value: unknown
): value is { addr: string; updatedAt: number } {
	return (
		isRecord(value) && hasString(value, 'addr') && hasNumber(value, 'updatedAt')
	);
}

function isV2InvResponse(
	value: unknown
): value is { addr: string; nonce: string; ciphertext: string; updatedAt: number } {
	return (
		isRecord(value) &&
		hasString(value, 'addr') &&
		hasString(value, 'nonce') &&
		hasString(value, 'ciphertext') &&
		hasNumber(value, 'updatedAt')
	);
}

export async function uploadV2Blob(
	req: V2BlobUpload
): Promise<SyncResult<{ blobId: string; updatedAt: number }>> {
	return tokenCall<{ blobId: string; updatedAt: number }>(
		`/api/v2/blobs/${encodeURIComponent(req.blobId)}`,
		{
			method: 'PUT',
			body: JSON.stringify({ nonce: req.nonce, ciphertext: req.ciphertext })
		},
		isV2BlobUploadResponse
	);
}

export async function fetchV2Blob(blobId: string): Promise<SyncResult<V2BlobResponse>> {
	return tokenCall<V2BlobResponse>(
		`/api/v2/blobs/${encodeURIComponent(blobId)}`,
		{ method: 'GET' },
		isV2BlobResponse
	);
}

export async function uploadV2Inventory(req: {
	addr: string;
	nonce: string;
	ciphertext: string;
}): Promise<SyncResult<{ addr: string; updatedAt: number }>> {
	return tokenCall<{ addr: string; updatedAt: number }>(
		`/api/v2/inv/${encodeURIComponent(req.addr)}`,
		{
			method: 'PUT',
			body: JSON.stringify({ nonce: req.nonce, ciphertext: req.ciphertext })
		},
		isV2InvUploadResponse
	);
}

export async function fetchV2Inventory(
	addr: string
): Promise<SyncResult<{ addr: string; nonce: string; ciphertext: string; updatedAt: number }>> {
	return tokenCall<{ addr: string; nonce: string; ciphertext: string; updatedAt: number }>(
		`/api/v2/inv/${encodeURIComponent(addr)}`,
		{ method: 'GET' },
		isV2InvResponse
	);
}

// ---------------------------------------------------------------------
// New-device restore records (`/api/v2/restore/<addr>`).
//
// Writes and deletes spend anonymous tokens like every other v2 object.
// The READ carries no credential at all: a restoring device has no
// session yet (it has not even learned its OPAQUE client id — that is
// inside the record). The address is the capability; see
// src/lib/crypto/restore-record.ts for the derivation and the privacy
// argument.
// ---------------------------------------------------------------------

type V2RestoreResponse = { addr: string; nonce: string; ciphertext: string; updatedAt: number };

export async function uploadV2Restore(req: {
	addr: string;
	nonce: string;
	ciphertext: string;
}): Promise<SyncResult<{ addr: string; updatedAt: number }>> {
	return tokenCall<{ addr: string; updatedAt: number }>(
		`/api/v2/restore/${encodeURIComponent(req.addr)}`,
		{
			method: 'PUT',
			body: JSON.stringify({ nonce: req.nonce, ciphertext: req.ciphertext })
		},
		isV2InvUploadResponse
	);
}

/** Unauthenticated by design — usable before any session exists. */
export async function fetchV2Restore(addr: string): Promise<SyncResult<V2RestoreResponse>> {
	return call<V2RestoreResponse>(
		`/api/v2/restore/${encodeURIComponent(addr)}`,
		{ method: 'GET' },
		isV2InvResponse,
		'none'
	);
}

export async function deleteV2Restore(
	addr: string
): Promise<SyncResult<{ addr: string; deletedAt: number }>> {
	return tokenCall<{ addr: string; deletedAt: number }>(
		`/api/v2/restore/${encodeURIComponent(addr)}`,
		{ method: 'DELETE' },
		(value): value is { addr: string; deletedAt: number } =>
			isRecord(value) && hasString(value, 'addr') && hasNumber(value, 'deletedAt')
	);
}
