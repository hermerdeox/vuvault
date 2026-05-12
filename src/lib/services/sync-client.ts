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
 * Caller stashes it (sessionStorage in the SPA, never localStorage)
 * and threads it through every blob op via `setSessionToken`.
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
