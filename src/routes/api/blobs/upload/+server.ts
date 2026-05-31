/**
 * POST /api/blobs/upload
 *
 * Headers: `Authorization: Bearer <token>` from a prior OPAQUE KE3.
 * Body: `{ header, nonce, ciphertext, sequenceClock }` — opaque
 *       AES-GCM blob fragments. Server stores ciphertext only.
 * Returns: `{ updatedAt, sequenceClock }`.
 *
 * Migrated from `functions/api/blobs/upload.ts`.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { maybeSweep } from '$lib/server/api/cleanup';
import { maybeGcAccount } from '$lib/server/api/r2-gc';
import { jsonError, jsonOk, readJson, b64decode } from '$lib/server/api/http';
import { authenticate, advanceSequenceClock } from '$lib/server/api/auth-token';

type Body = {
	header?: string;
	nonce?: string;
	ciphertext?: string;
	sequenceClock?: number;
};

const MAX_HEADER_BYTES = 4096;
const MAX_NONCE_BYTES = 64;
const MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const BASE64_OVERHEAD = 4 / 3;
const BASE64_SLACK_BYTES = 8;

function exceedsEncodedCap(value: string, maxDecodedBytes: number): boolean {
	return value.length > Math.ceil(maxDecodedBytes * BASE64_OVERHEAD) + BASE64_SLACK_BYTES;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, `account:${session.accountId}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const body = await readJson<Body>(request);
	if (
		!body ||
		typeof body.header !== 'string' ||
		typeof body.nonce !== 'string' ||
		typeof body.ciphertext !== 'string' ||
		typeof body.sequenceClock !== 'number' ||
		!Number.isInteger(body.sequenceClock) ||
		body.sequenceClock < 0
	) {
		return jsonError(400, 'invalid request body');
	}

	if (body.sequenceClock <= session.sequenceClock) {
		return jsonError(409, 'sequence clock not monotonic');
	}
	if (
		exceedsEncodedCap(body.header, MAX_HEADER_BYTES) ||
		exceedsEncodedCap(body.nonce, MAX_NONCE_BYTES) ||
		exceedsEncodedCap(body.ciphertext, MAX_CIPHERTEXT_BYTES)
	) {
		return jsonError(400, 'encoded blob size out of range');
	}

	let header: Uint8Array;
	let nonce: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		header = b64decode(body.header);
		nonce = b64decode(body.nonce);
		ciphertext = b64decode(body.ciphertext);
	} catch {
		return jsonError(400, 'invalid blob encoding');
	}
	if (header.length === 0 || header.length > MAX_HEADER_BYTES) {
		return jsonError(400, 'header size out of range');
	}
	if (nonce.length === 0 || nonce.length > MAX_NONCE_BYTES) {
		return jsonError(400, 'nonce size out of range');
	}
	if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
		return jsonError(400, 'ciphertext size out of range');
	}

	const objectKey = `vaults/${session.accountId}/${body.sequenceClock}.bin`;

	const totalLen = 4 + header.length + 4 + nonce.length + ciphertext.length;
	const buf = new Uint8Array(totalLen);
	const view = new DataView(buf.buffer);
	let off = 0;
	view.setUint32(off, header.length, false);
	off += 4;
	buf.set(header, off);
	off += header.length;
	view.setUint32(off, nonce.length, false);
	off += 4;
	buf.set(nonce, off);
	off += nonce.length;
	buf.set(ciphertext, off);

	try {
		// V1-C2: `deviceId` removed from R2 customMetadata. The
		// `accountId` field remains here for the v1 routes only; v2
		// routes (Phase 4) drop it. See
		// `docs/VU-LEVEL-MIGRATION-MAP.md` V1-C1 / V1-C2.
		await env.VAULT_BLOBS.put(objectKey, buf, {
			customMetadata: {
				accountId: session.accountId,
				sequenceClock: String(body.sequenceClock)
			}
		});
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	const advanced = await advanceSequenceClock(env.AUTH_DB, session.token, body.sequenceClock);
	if (!advanced) {
		return jsonError(409, 'sequence clock not monotonic');
	}

	void maybeSweep(env.AUTH_DB).catch(() => undefined);
	// Opportunistic R2 garbage collection. `body.sequenceClock` is
	// the freshly-advanced high-water mark for this account, so any
	// earlier vault blob (and any dormant document blob) is eligible
	// for cleanup. Fire-and-forget: never blocks or fails the upload.
	void maybeGcAccount(env, session.accountId, body.sequenceClock).catch(() => undefined);
	return jsonOk({
		updatedAt: Date.now(),
		sequenceClock: body.sequenceClock
	});
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
