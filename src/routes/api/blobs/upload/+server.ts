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
import { checkRateLimit } from '$lib/server/api/env';
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

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	if (!(await checkRateLimit(env.BLOB_LIMITER, `account:${session.accountId}`))) {
		return jsonError(429, 'rate limit exceeded');
	}

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
		await env.VAULT_BLOBS.put(objectKey, buf, {
			customMetadata: {
				accountId: session.accountId,
				deviceId: session.deviceId,
				sequenceClock: String(body.sequenceClock)
			}
		});
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	await advanceSequenceClock(env.AUTH_DB, session.token, body.sequenceClock);

	return jsonOk({
		updatedAt: Date.now(),
		sequenceClock: body.sequenceClock
	});
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
