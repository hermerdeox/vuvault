/**
 * GET /api/blobs/latest
 *
 * Headers: `Authorization: Bearer <token>`.
 * Returns the highest-sequence-clock R2 blob for the authenticated
 * account, decomposed into `{ header, nonce, ciphertext, sequenceClock,
 * updatedAt }` (header/nonce/ciphertext base64-encoded).
 *
 * Migrated from `functions/api/blobs/latest.ts`.
 */

import type { RequestHandler } from './$types';
import type { Env, R2Object } from '$lib/server/api/env';
import { checkRateLimit } from '$lib/server/api/env';
import { jsonError, jsonOk, b64encode } from '$lib/server/api/http';
import { authenticate } from '$lib/server/api/auth-token';

export const GET: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const rateLimit = await checkRateLimit(env.BLOB_LIMITER, `account:${session.accountId}`, env);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const prefix = `vaults/${session.accountId}/`;
	let listing: { objects: { key: string; uploaded: Date; size: number }[]; truncated: boolean };
	try {
		listing = await env.VAULT_BLOBS.list({ prefix });
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (listing.objects.length === 0) {
		return jsonError(404, 'no blob');
	}

	let bestKey = listing.objects[0]!.key;
	let bestClock = parseClock(bestKey);
	for (const obj of listing.objects) {
		const c = parseClock(obj.key);
		if (c > bestClock) {
			bestClock = c;
			bestKey = obj.key;
		}
	}

	let r2obj: R2Object | null;
	try {
		r2obj = await env.VAULT_BLOBS.get(bestKey);
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
	if (buf.length < 8) return jsonError(500, 'malformed blob');
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const headerLen = view.getUint32(0, false);
	if (4 + headerLen + 4 > buf.length) return jsonError(500, 'malformed blob');
	const header = buf.slice(4, 4 + headerLen);
	const nonceLen = view.getUint32(4 + headerLen, false);
	const nonceStart = 4 + headerLen + 4;
	if (nonceStart + nonceLen > buf.length) return jsonError(500, 'malformed blob');
	const nonce = buf.slice(nonceStart, nonceStart + nonceLen);
	const ciphertext = buf.slice(nonceStart + nonceLen);

	return jsonOk({
		header: b64encode(header),
		nonce: b64encode(nonce),
		ciphertext: b64encode(ciphertext),
		sequenceClock: bestClock,
		updatedAt: r2obj.uploaded.getTime()
	});
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');

function parseClock(key: string): number {
	const m = key.match(/\/(\d+)\.bin$/);
	return m ? Number.parseInt(m[1]!, 10) : 0;
}
