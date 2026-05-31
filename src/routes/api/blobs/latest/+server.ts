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
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { jsonError, jsonOk, b64encode } from '$lib/server/api/http';
import { authenticate } from '$lib/server/api/auth-token';

type ListedObject = { key: string; uploaded: Date; size: number };
type R2Listing = { objects: ListedObject[]; truncated: boolean; cursor?: string };

const LIST_LIMIT = 1000;

export const GET: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, `account:${session.accountId}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const prefix = `vaults/${session.accountId}/`;
	let bestKey: string | null = null;
	let bestClock = -1;
	let cursor: string | undefined;
	try {
		do {
			const listing: R2Listing = await env.VAULT_BLOBS.list({
				prefix,
				limit: LIST_LIMIT,
				...(cursor ? { cursor } : {})
			});
			for (const obj of listing.objects) {
				const c = parseClock(prefix, obj.key);
				if (c !== null && c > bestClock) {
					bestClock = c;
					bestKey = obj.key;
				}
			}
			cursor = listing.truncated ? listing.cursor : undefined;
			if (listing.truncated && !cursor) {
				return jsonError(503, 'blob listing unavailable');
			}
		} while (cursor);
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (!bestKey) {
		return jsonError(404, 'no blob');
	}

	if (bestClock <= session.sequenceClock) {
		// Keep fetch idempotent for current clients: still return the latest
		// object when present, but never let document objects or malformed keys
		// influence the selected sequence clock.
		bestClock = Math.max(bestClock, 0);
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

function parseClock(prefix: string, key: string): number | null {
	if (!key.startsWith(prefix)) return null;
	const suffix = key.slice(prefix.length);
	if (!/^\d+\.bin$/.test(suffix)) return null;
	const clock = Number.parseInt(suffix.slice(0, -4), 10);
	return Number.isSafeInteger(clock) ? clock : null;
}
