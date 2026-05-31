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
	SyncBlobUpload,
	SyncBlobFetch,
	SyncBlobResponse,
	SyncCapabilities
} from '$lib/types/sync';
import { getSyncOrigin, isSyncOriginConfigured } from '$lib/utils/env';

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
		(value.expiresAt === undefined || isNumber(value.expiresAt)) &&
		(value.sequenceClock === undefined || isNumber(value.sequenceClock))
	);
}

function isBlobUploadResponse(
	value: unknown
): value is { updatedAt: number; sequenceClock: number } {
	return isRecord(value) && hasNumber(value, 'updatedAt') && hasNumber(value, 'sequenceClock');
}

function isBlobLatestResponse(value: unknown): value is {
	header: string;
	nonce: string;
	ciphertext: string;
	sequenceClock: number;
	updatedAt: number;
} {
	return (
		isRecord(value) &&
		hasString(value, 'header') &&
		hasString(value, 'nonce') &&
		hasString(value, 'ciphertext') &&
		hasNumber(value, 'sequenceClock') &&
		hasNumber(value, 'updatedAt')
	);
}

function isDocumentBlobResponse(value: unknown): value is DocumentBlobResponse {
	return (
		isRecord(value) &&
		hasString(value, 'blobId') &&
		hasString(value, 'nonce') &&
		hasString(value, 'ciphertext') &&
		hasNumber(value, 'updatedAt')
	);
}

function isDocumentUploadResponse(value: unknown): value is { blobId: string; updatedAt: number } {
	return isRecord(value) && hasString(value, 'blobId') && hasNumber(value, 'updatedAt');
}

function isDocumentDeleteResponse(value: unknown): value is { blobId: string; deletedAt: number } {
	return isRecord(value) && hasString(value, 'blobId') && hasNumber(value, 'deletedAt');
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
}

export function hasSession(): boolean {
	return sessionToken !== null;
}

function origin(): string {
	return getSyncOrigin();
}

async function call<T>(
	path: string,
	init: RequestInit,
	expectedShape?: (data: unknown) => data is T
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
				...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
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
	// Rotation runs only for routes that opt in (today: /api/v2/*).
	// v1 routes still operate against a single durable token.
	const nextToken = res.headers.get('next-token');
	if (nextToken && /^[0-9a-fA-F]{64}$/.test(nextToken) && sessionToken) {
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

// --- Blob upload / fetch -------------------------------------------

export async function uploadBlob(
	req: SyncBlobUpload
): Promise<SyncResult<{ updatedAt: number; sequenceClock: number }>> {
	return call<{ updatedAt: number; sequenceClock: number }>(
		'/api/blobs/upload',
		{
			method: 'POST',
			body: JSON.stringify({
				header: req.header,
				nonce: req.nonce,
				ciphertext: req.ciphertext,
				sequenceClock: req.sequenceClock
			})
		},
		isBlobUploadResponse
	);
}

export async function fetchBlob(
	_req: SyncBlobFetch
): Promise<SyncResult<SyncBlobResponse>> {
	const inner = await call<{
		header: string;
		nonce: string;
		ciphertext: string;
		sequenceClock: number;
		updatedAt: number;
	}>('/api/blobs/latest', { method: 'GET' }, isBlobLatestResponse);
	if (!inner.ok) return inner;
	return {
		ok: true,
		value: {
			header: inner.value.header,
			nonce: inner.value.nonce,
			ciphertext: inner.value.ciphertext,
			updatedAt: inner.value.updatedAt,
			formatVersion: 2,
			deviceId: 'server',
			sequenceClock: inner.value.sequenceClock
		}
	};
}

// --- Document blob upload / fetch / delete --------------------------
//
// Per-document opaque blob endpoints. The server stores ciphertext
// only; AES-GCM happens client-side in `vault-session.ts` with a
// document-scoped AAD. These wrappers are no-ops when sync isn't
// wired so the local-only build still functions.

export type DocumentBlobResponse = {
	blobId: string;
	nonce: string;
	ciphertext: string;
	updatedAt: number;
};

export type DocumentBlobUpload = {
	blobId: string;
	nonce: string;
	ciphertext: string;
};

export async function uploadDocumentBlob(
	req: DocumentBlobUpload
): Promise<SyncResult<{ blobId: string; updatedAt: number }>> {
	return call<{ blobId: string; updatedAt: number }>(
		`/api/documents/${encodeURIComponent(req.blobId)}`,
		{
			method: 'PUT',
			body: JSON.stringify({ nonce: req.nonce, ciphertext: req.ciphertext })
		},
		isDocumentUploadResponse
	);
}

export async function fetchDocumentBlob(
	blobId: string
): Promise<SyncResult<DocumentBlobResponse>> {
	return call<DocumentBlobResponse>(
		`/api/documents/${encodeURIComponent(blobId)}`,
		{ method: 'GET' },
		isDocumentBlobResponse
	);
}

export async function deleteDocumentBlob(
	blobId: string
): Promise<SyncResult<{ blobId: string; deletedAt: number }>> {
	return call<{ blobId: string; deletedAt: number }>(
		`/api/documents/${encodeURIComponent(blobId)}`,
		{ method: 'DELETE' },
		isDocumentDeleteResponse
	);
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
// Phase 4 / §L07b — V2 blob + inventory client helpers.
//
// The v1 routes above (`/api/blobs/upload`, `/api/blobs/latest`,
// `/api/documents/*`) keep working untouched during the migration
// window per the dual-read discipline in the plan: "legacy v1 reads
// via /api/blobs/* continue working during migration; new writes go
// to v2." The helpers below are the v2 writers/readers; sync-client
// callers (notably vault-session.ts) opt in by calling these
// instead of the v1 routes.
//
// The privacy invariant: v2 endpoints carry no account binding in
// the URL, the body, or the response. The server's rate-limit key
// is derived from the session token (hashed) so even the rate-limit
// table cannot reveal account identity from request logs.
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
	return call<{ blobId: string; updatedAt: number }>(
		`/api/v2/blobs/${encodeURIComponent(req.blobId)}`,
		{
			method: 'PUT',
			body: JSON.stringify({ nonce: req.nonce, ciphertext: req.ciphertext })
		},
		isV2BlobUploadResponse
	);
}

export async function fetchV2Blob(blobId: string): Promise<SyncResult<V2BlobResponse>> {
	return call<V2BlobResponse>(
		`/api/v2/blobs/${encodeURIComponent(blobId)}`,
		{ method: 'GET' },
		isV2BlobResponse
	);
}

export async function deleteV2Blob(
	blobId: string
): Promise<SyncResult<{ blobId: string; deletedAt: number }>> {
	return call<{ blobId: string; deletedAt: number }>(
		`/api/v2/blobs/${encodeURIComponent(blobId)}`,
		{ method: 'DELETE' },
		isDocumentDeleteResponse
	);
}

export async function uploadV2Inventory(req: {
	addr: string;
	nonce: string;
	ciphertext: string;
}): Promise<SyncResult<{ addr: string; updatedAt: number }>> {
	return call<{ addr: string; updatedAt: number }>(
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
	return call<{ addr: string; nonce: string; ciphertext: string; updatedAt: number }>(
		`/api/v2/inv/${encodeURIComponent(addr)}`,
		{ method: 'GET' },
		isV2InvResponse
	);
}

/**
 * Dual-read shim for blob fetching.
 *
 * The migration to §L07b runs over a window measured in days, not
 * seconds: existing accounts have data at the v1 path
 * (`vaults/{accountId}/{seq}.bin`) and at the v1 document path
 * (`vaults/{accountId}/documents/{uuid}.bin`); brand-new accounts
 * write straight to v2. During the window any client may need to
 * read either layout transparently.
 *
 * Strategy: try v2 first; on 404 fall back to v1. Both reads share
 * the same auth path (the call() helper attaches the bearer token).
 * Writes go to v2 only (vault-session.ts is the caller that decides
 * which write path to use; this shim does not write).
 *
 * The legacy v1 `/api/blobs/latest` shape is whole-vault and
 * fundamentally different from the v2 per-blob shape, so this
 * helper is for DOCUMENT blob reads only. The whole-vault sync
 * stays on the v1 path until the CRDT migration in a future phase.
 */
export async function fetchDocumentBlobDualRead(
	blobId: string
): Promise<SyncResult<DocumentBlobResponse>> {
	const v2 = await fetchV2Blob(blobId);
	if (v2.ok) {
		return {
			ok: true,
			value: {
				blobId: v2.value.blobId,
				nonce: v2.value.nonce,
				ciphertext: v2.value.ciphertext,
				updatedAt: v2.value.updatedAt
			}
		};
	}
	// Only fall through to v1 on a genuine "not found" (server
	// class). Any other failure (network, auth, 4xx validation, 5xx
	// storage) is propagated as-is. We match the literal error
	// strings the v2 GET handler emits — see
	// `src/routes/api/v2/blobs/[uuid]/+server.ts`. A broad substring
	// match would also catch unrelated messages (e.g., a future
	// 'no <something>' validation error) and silently fall through
	// to v1, masking real failures.
	const NOT_FOUND_MESSAGES = new Set(['no blob']);
	if (v2.reason !== 'server' || !NOT_FOUND_MESSAGES.has(v2.message)) {
		return v2;
	}
	return fetchDocumentBlob(blobId);
}
