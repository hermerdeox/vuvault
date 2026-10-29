/**
 * V2 restore-record route — new-device restore.
 *
 *   PUT    /api/v2/restore/<addr>   body: { nonce, ciphertext }   (anonymous token)
 *   GET    /api/v2/restore/<addr>   -> { nonce, ciphertext, updatedAt }   (no credential)
 *   DELETE /api/v2/restore/<addr>                                  (anonymous token)
 *
 * A restore record is a fixed-size (2 KiB bucket) ciphertext the
 * client writes at an address derived from its Secret Key + Recovery
 * Password (`src/lib/crypto/restore-record.ts`). A device that has
 * nothing but those two secrets recomputes the address, fetches the
 * record, and from it learns how to find and decrypt the vault copy on
 * this server.
 *
 * Why GET is unauthenticated: the restoring device has no vault yet, so
 * it has no OPAQUE session and no anonymous tokens — it cannot even
 * learn its OPAQUE client id until it has opened the record. The
 * 128-bit address is the capability, exactly as the random UUID is for
 * `/api/v2/blobs/*`; the token on the other v2 routes bounds abuse, not
 * confidentiality. Here abuse is bounded by a per-IP rate limit, and
 * confidentiality by the record's own AES-256-GCM seal under a key the
 * server cannot derive.
 *
 * Privacy properties (V1-C1 / V0-C1): the server stores no
 * (addr, account_id) tuple, the address is fresh per (UTC day, slot)
 * and never rewritten, and writes spend anonymous tokens like every
 * other v2 object.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { jsonError, jsonOk, readJson, b64decode, b64encode } from '$lib/server/api/http';
import { requireV2Access } from '$lib/server/api/anon-tokens';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { maybeGcV2 } from '$lib/server/api/r2-gc';

type PutBody = {
	nonce?: string;
	ciphertext?: string;
};

const MAX_NONCE_BYTES = 64;
// Records pad to a 2 KiB bucket client-side; 16 KiB leaves room for a
// larger bucket without admitting arbitrary blobs on this route.
const MAX_CIPHERTEXT_BYTES = 16 * 1024;
const BASE64_OVERHEAD = 4 / 3;
const BASE64_SLACK_BYTES = 8;
const ADDR_RE = /^[a-z0-9]{26}$/i;

function exceedsEncodedCap(value: string, maxDecodedBytes: number): boolean {
	return value.length > Math.ceil(maxDecodedBytes * BASE64_OVERHEAD) + BASE64_SLACK_BYTES;
}

function objectKey(addr: string): string {
	return `v2/restore/${addr.toLowerCase()}.bin`;
}

async function recordRestoreReference(env: Env, addr: string, bytes: number): Promise<void> {
	try {
		await env.AUTH_DB
			.prepare(
				`INSERT INTO restore_references (addr, last_seen_at, bytes)
				 VALUES (?, unixepoch(), ?)
				 ON CONFLICT(addr) DO UPDATE SET
					last_seen_at = excluded.last_seen_at,
					bytes        = excluded.bytes`
			)
			.bind(addr.toLowerCase(), bytes)
			.run();
	} catch {
		// Tolerable — the record is still stored; GC simply never sees it.
	}
}

export const PUT: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const denied = await requireV2Access(env, request);
	if (denied) return denied;

	const addr = params.addr;
	if (!addr || !ADDR_RE.test(addr)) {
		return jsonError(400, 'invalid restore address');
	}

	const body = await readJson<PutBody>(request);
	if (!body || typeof body.nonce !== 'string' || typeof body.ciphertext !== 'string') {
		return jsonError(400, 'invalid request body');
	}
	if (
		exceedsEncodedCap(body.nonce, MAX_NONCE_BYTES) ||
		exceedsEncodedCap(body.ciphertext, MAX_CIPHERTEXT_BYTES)
	) {
		return jsonError(400, 'encoded record size out of range');
	}

	let nonce: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		nonce = b64decode(body.nonce);
		ciphertext = b64decode(body.ciphertext);
	} catch {
		return jsonError(400, 'invalid record encoding');
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
		await env.VAULT_BLOBS.put(objectKey(addr), buf, {
			customMetadata: { kind: 'v2-restore' }
		});
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	await recordRestoreReference(env, addr, buf.length);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({ addr: addr.toLowerCase(), updatedAt: Date.now() });
};

export const GET: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;

	// Unauthenticated by design (see header). Per-IP limit only.
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.RESTORE_READ, `ip:${ip}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const addr = params.addr;
	if (!addr || !ADDR_RE.test(addr)) {
		return jsonError(400, 'invalid restore address');
	}

	let r2obj;
	try {
		r2obj = await env.VAULT_BLOBS.get(objectKey(addr));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (!r2obj) return jsonError(404, 'no restore record');

	let buf: Uint8Array;
	try {
		buf = new Uint8Array(await r2obj.arrayBuffer());
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (buf.length < 4) return jsonError(500, 'malformed restore record');
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const nonceLen = view.getUint32(0, false);
	if (4 + nonceLen > buf.length) return jsonError(500, 'malformed restore record');
	const nonce = buf.slice(4, 4 + nonceLen);
	const ciphertext = buf.slice(4 + nonceLen);

	// Heartbeat-by-read, like blobs and inventories.
	await recordRestoreReference(env, addr, buf.length);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({
		addr: addr.toLowerCase(),
		nonce: b64encode(nonce),
		ciphertext: b64encode(ciphertext),
		updatedAt: r2obj.uploaded.getTime()
	});
};

export const DELETE: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const denied = await requireV2Access(env, request);
	if (denied) return denied;

	const addr = params.addr;
	if (!addr || !ADDR_RE.test(addr)) {
		return jsonError(400, 'invalid restore address');
	}

	try {
		await env.VAULT_BLOBS.delete(objectKey(addr));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	try {
		await env.AUTH_DB
			.prepare(`DELETE FROM restore_references WHERE addr = ?`)
			.bind(addr.toLowerCase())
			.run();
	} catch {
		// Tolerable.
	}
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({ addr: addr.toLowerCase(), deletedAt: Date.now() });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
