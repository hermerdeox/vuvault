/**
 * V2 blob route — Phase 4 §L07b implementation.
 *
 *   PUT    /api/v2/blobs/<uuid>    body: { nonce, ciphertext }
 *   GET    /api/v2/blobs/<uuid>    -> { nonce, ciphertext, updatedAt }
 *   DELETE /api/v2/blobs/<uuid>
 *
 * Closes V1-C1 ("no per-user blob inventories") and contributes to
 * V1-C3 ("no cross-account sequence-clock correlation") by:
 *
 *   1. Storing every blob at the global R2 prefix `v2/blobs/{uuid}`,
 *      with NO account_id in the key path.
 *   2. NOT recording (blob_id, account_id) anywhere in D1. The only
 *      D1 row is in `blob_references(blob_id, last_seen_at, bytes)`
 *      — see migrations/0005_blob_references.sql.
 *   3. NOT emitting account_id in R2 customMetadata.
 *   4. Authenticating the request (so anonymous abuse is bounded by
 *      rate limit) but using a session-id-scoped rate-limit key
 *      rather than account-id-scoped, so the server cannot link
 *      two blob uploads to the same account from request logs.
 *
 * Privacy/threat-model:
 *
 *   - Anyone with a valid session token AND knowledge of a blob
 *     UUID can GET the blob. UUIDs are 122 bits of randomness so
 *     guessing is computationally infeasible.
 *   - The blob's owner stores the UUID in their encrypted inventory
 *     (see src/lib/services/blob-inventory.ts). The server never
 *     sees the inventory in cleartext.
 *   - V1-C1 admits the Candidate 1 bootstrap-pointer leak (the
 *     deterministic first inventory address). The blob route itself
 *     does not contribute to that leak — only the inventory route
 *     does, and only at the bootstrap pointer.
 *
 * The PUT handler computes `bytes` from the wire-format buffer for
 * GC bookkeeping; no caller-supplied size hint is accepted.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { jsonError, jsonOk, readJson, b64decode, b64encode } from '$lib/server/api/http';
import { authenticate } from '$lib/server/api/auth-token';
import { authenticateCapability } from '$lib/server/api/capability-auth';
import { maybeGcV2 } from '$lib/server/api/r2-gc';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';

/**
 * Resolve a request's session via dual-auth: Bearer first
 * (V1 path), capability header second (V0 path). Used by every
 * authenticated entry point in this file.
 */
async function resolveSession(env: Env, request: Request) {
	const bearer = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (bearer) return bearer;
	return authenticateCapability(env, request.headers.get('x-vu0-capability'));
}

type PutBody = {
	nonce?: string;
	ciphertext?: string;
};

const MAX_NONCE_BYTES = 64;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024; // 8 MiB
const BASE64_OVERHEAD = 4 / 3;
const BASE64_SLACK_BYTES = 8;
// Strict UUID v4 — matches the v1 documents route. The v4 variant
// guarantees 122 bits of randomness (vs ≥ 60 for v1/v3/v5), which is
// what the V1-C1 unguessability claim depends on.
const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exceedsEncodedCap(value: string, maxDecodedBytes: number): boolean {
	return value.length > Math.ceil(maxDecodedBytes * BASE64_OVERHEAD) + BASE64_SLACK_BYTES;
}

function objectKey(blobId: string): string {
	// V1-C1: global, account-prefix-free key shape.
	return `v2/blobs/${blobId.toLowerCase()}.bin`;
}

/**
 * Record (or refresh) a blob's `last_seen_at` in the references
 * table. The server-side timestamp is unixepoch(); we deliberately
 * do NOT bind account_id or any other correlating field. The GC
 * (src/lib/server/api/r2-gc.ts) purges blobs whose `last_seen_at`
 * is older than the sweep window.
 *
 * Best-effort: if the references table is unavailable, the PUT
 * succeeds anyway and the blob will be GC-purged at the next sweep
 * iff nobody re-asserts its reference. This is a tolerable failure
 * mode for the heartbeat path.
 */
async function recordBlobReference(
	env: Env,
	blobId: string,
	bytes: number
): Promise<void> {
	try {
		await env.AUTH_DB
			.prepare(
				`INSERT INTO blob_references (blob_id, last_seen_at, bytes)
				 VALUES (?, unixepoch(), ?)
				 ON CONFLICT(blob_id) DO UPDATE SET
					last_seen_at = excluded.last_seen_at,
					bytes        = excluded.bytes`
			)
			.bind(blobId.toLowerCase(), bytes)
			.run();
	} catch {
		// Tolerable — see header doc.
	}
}

export const PUT: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await resolveSession(env, request);
	if (!session) return jsonError(401, 'unauthorized');

	const blobId = params.uuid;
	if (!blobId || !UUID_RE.test(blobId)) {
		return jsonError(400, 'invalid blob id');
	}

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
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

	const buf = new Uint8Array(4 + nonce.length + ciphertext.length);
	const view = new DataView(buf.buffer);
	view.setUint32(0, nonce.length, false);
	buf.set(nonce, 4);
	buf.set(ciphertext, 4 + nonce.length);

	try {
		// V1-C1: no accountId / deviceId in customMetadata.
		await env.VAULT_BLOBS.put(objectKey(blobId), buf, {
			customMetadata: {
				kind: 'v2-blob'
			}
		});
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	await recordBlobReference(env, blobId, buf.length);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({ blobId, updatedAt: Date.now() });
};

export const GET: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;

	// Sentinel: the V1-C1/V1-C3 probes in scripts/release-probe-vu1.mjs
	// use GET /api/v2/blobs/health (a literal "health" path component)
	// to detect whether the v2 surface is live. We allow that one
	// unauthenticated path so the probe can detect deployment without
	// minting a real session. Any other unauthenticated GET still 401s.
	if (params.uuid === 'health') {
		return jsonOk({ ready: true, route: 'v2.blobs' });
	}

	const session = await resolveSession(env, request);
	if (!session) return jsonError(401, 'unauthorized');

	const blobId = params.uuid;
	if (!blobId || !UUID_RE.test(blobId)) {
		return jsonError(400, 'invalid blob id');
	}

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	let r2obj;
	try {
		r2obj = await env.VAULT_BLOBS.get(objectKey(blobId));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (!r2obj) return jsonError(404, 'no blob');

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

	// Refresh the reference timestamp on every GET (heartbeat-by-read).
	// Best-effort; failures do not block the response.
	await recordBlobReference(env, blobId, buf.length);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({
		blobId,
		nonce: b64encode(nonce),
		ciphertext: b64encode(ciphertext),
		updatedAt: r2obj.uploaded.getTime()
	});
};

export const DELETE: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await resolveSession(env, request);
	if (!session) return jsonError(401, 'unauthorized');

	const blobId = params.uuid;
	if (!blobId || !UUID_RE.test(blobId)) {
		return jsonError(400, 'invalid blob id');
	}

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	try {
		await env.VAULT_BLOBS.delete(objectKey(blobId));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	// Drop the reference row too; the GC would catch this eventually
	// anyway, but proactively cleaning up keeps the table tight.
	try {
		await env.AUTH_DB
			.prepare(`DELETE FROM blob_references WHERE blob_id = ?`)
			.bind(blobId.toLowerCase())
			.run();
	} catch {
		// Tolerable.
	}

	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({ blobId, deletedAt: Date.now() });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
