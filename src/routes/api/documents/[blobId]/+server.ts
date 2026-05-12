/**
 * Document blob storage — PUT/GET/DELETE for an encrypted file blob
 * keyed by the client-provided `blobId`.
 *
 *   PUT    /api/documents/<blobId>   body: { nonce, ciphertext }
 *   GET    /api/documents/<blobId>   -> { nonce, ciphertext }
 *   DELETE /api/documents/<blobId>
 *
 * The server stores ciphertext only. AES-GCM happens client-side in
 * `vault-session.ts`'s `sealDocument()` with a document-scoped AAD
 * domain bound to the account's device salt and credential id. A
 * server compromise reveals opaque bytes; it cannot recover the
 * underlying file because the unwrap key never leaves the device.
 *
 * Auth: requires a valid Bearer token from a prior OPAQUE KE3, same
 * as the whole-vault blob routes. The blob is namespaced by the
 * authenticated `accountId` to prevent cross-account access.
 *
 * Size cap matches `MAX_CIPHERTEXT_BYTES` in
 * `src/routes/api/blobs/upload/+server.ts` so the same R2 bucket can
 * host both whole-vault and document blobs without surprise quota.
 */

import type { RequestHandler } from './$types';
import type { Env, R2Object } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { jsonError, jsonOk, readJson, b64decode, b64encode } from '$lib/server/api/http';
import { authenticate } from '$lib/server/api/auth-token';

type PutBody = {
	nonce?: string;
	ciphertext?: string;
};

const MAX_NONCE_BYTES = 64;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const BASE64_OVERHEAD = 4 / 3;
const BASE64_SLACK_BYTES = 8;
const BLOB_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exceedsEncodedCap(value: string, maxDecodedBytes: number): boolean {
	return value.length > Math.ceil(maxDecodedBytes * BASE64_OVERHEAD) + BASE64_SLACK_BYTES;
}

function objectKey(accountId: string, blobId: string): string {
	return `vaults/${accountId}/documents/${blobId}.bin`;
}

export const PUT: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const blobId = params.blobId;
	if (!blobId || !BLOB_ID_RE.test(blobId)) {
		return jsonError(400, 'invalid blob id');
	}

	const rateLimit = await applyRateLimit(env.AUTH_DB, RATE_LIMITS.BLOB, `account:${session.accountId}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const body = await readJson<PutBody>(request);
	if (!body || typeof body.nonce !== 'string' || typeof body.ciphertext !== 'string') {
		return jsonError(400, 'invalid request body');
	}
	if (
		exceedsEncodedCap(body.nonce, MAX_NONCE_BYTES) ||
		exceedsEncodedCap(body.ciphertext, MAX_CIPHERTEXT_BYTES)
	) {
		return jsonError(400, 'encoded blob size out of range');
	}

	let nonce: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		nonce = b64decode(body.nonce);
		ciphertext = b64decode(body.ciphertext);
	} catch {
		return jsonError(400, 'invalid blob encoding');
	}
	if (nonce.length === 0 || nonce.length > MAX_NONCE_BYTES) {
		return jsonError(400, 'nonce size out of range');
	}
	if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
		return jsonError(400, 'ciphertext size out of range');
	}

	// Wire format: 4-byte big-endian nonce length, then nonce, then
	// ciphertext. Symmetric with the whole-vault blob layout in
	// `/api/blobs/upload`.
	const buf = new Uint8Array(4 + nonce.length + ciphertext.length);
	const view = new DataView(buf.buffer);
	view.setUint32(0, nonce.length, false);
	buf.set(nonce, 4);
	buf.set(ciphertext, 4 + nonce.length);

	try {
		await env.VAULT_BLOBS.put(objectKey(session.accountId, blobId), buf, {
			customMetadata: {
				accountId: session.accountId,
				deviceId: session.deviceId,
				docBlobId: blobId
			}
		});
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	return jsonOk({ blobId, updatedAt: Date.now() });
};

export const GET: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const blobId = params.blobId;
	if (!blobId || !BLOB_ID_RE.test(blobId)) {
		return jsonError(400, 'invalid blob id');
	}

	const rateLimit = await applyRateLimit(env.AUTH_DB, RATE_LIMITS.BLOB, `account:${session.accountId}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	let r2obj: R2Object | null;
	try {
		r2obj = await env.VAULT_BLOBS.get(objectKey(session.accountId, blobId));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (!r2obj) return jsonError(404, 'no document');

	let buf: Uint8Array;
	try {
		const ab = await r2obj.arrayBuffer();
		buf = new Uint8Array(ab);
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (buf.length < 4) return jsonError(500, 'malformed blob');
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const nonceLen = view.getUint32(0, false);
	if (4 + nonceLen > buf.length) return jsonError(500, 'malformed blob');
	const nonce = buf.slice(4, 4 + nonceLen);
	const ciphertext = buf.slice(4 + nonceLen);

	return jsonOk({
		blobId,
		nonce: b64encode(nonce),
		ciphertext: b64encode(ciphertext),
		updatedAt: r2obj.uploaded.getTime()
	});
};

export const DELETE: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const blobId = params.blobId;
	if (!blobId || !BLOB_ID_RE.test(blobId)) {
		return jsonError(400, 'invalid blob id');
	}

	const rateLimit = await applyRateLimit(env.AUTH_DB, RATE_LIMITS.BLOB, `account:${session.accountId}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	try {
		await env.VAULT_BLOBS.delete(objectKey(session.accountId, blobId));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	return jsonOk({ blobId, deletedAt: Date.now() });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
