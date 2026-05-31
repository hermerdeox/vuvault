/**
 * V2 inventory route — Phase 4 §L07b implementation.
 *
 *   PUT /api/v2/inv/<addr>   body: { nonce, ciphertext }
 *   GET /api/v2/inv/<addr>   -> { nonce, ciphertext, updatedAt }
 *
 * The inventory blob is a small (typically 1-4 KiB) encrypted
 * payload describing which `blob_id`s a client owns. The matching
 * client-side primitives are in `src/lib/services/blob-inventory.ts`.
 *
 * Privacy properties (V1-C1):
 *   - The `addr` path parameter is a 26-char Crockford base32
 *     string (16 random bytes). For the BOOTSTRAP address (the very
 *     first one for an account), the value is HKDF-derived from
 *     (vaultKey, deviceSalt) and is therefore deterministic — this
 *     is the Candidate 1 accepted trade-off. For all subsequent
 *     addresses, the value is fresh randomness from `rotateAddress`.
 *   - The server stores no (addr, account_id) tuple. Anyone with a
 *     valid session AND knowledge of `addr` can PUT/GET the
 *     inventory blob. As with blobs, the 130-bit address space
 *     makes guessing infeasible.
 *   - The rate-limit key is derived from the session token, not
 *     the account id (same scheme as `/api/v2/blobs/[uuid]`).
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { jsonError, jsonOk, readJson, b64decode, b64encode } from '$lib/server/api/http';
import { authenticate } from '$lib/server/api/auth-token';
import { authenticateCapability } from '$lib/server/api/capability-auth';
import { maybeGcV2 } from '$lib/server/api/r2-gc';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';

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
const MAX_CIPHERTEXT_BYTES = 1 * 1024 * 1024; // 1 MiB — inventories are small
const BASE64_OVERHEAD = 4 / 3;
const BASE64_SLACK_BYTES = 8;
const ADDR_RE = /^[a-z0-9]{26}$/i;

function exceedsEncodedCap(value: string, maxDecodedBytes: number): boolean {
	return value.length > Math.ceil(maxDecodedBytes * BASE64_OVERHEAD) + BASE64_SLACK_BYTES;
}

function objectKey(addr: string): string {
	return `v2/inv/${addr.toLowerCase()}.bin`;
}

async function recordInvReference(
	env: Env,
	addr: string,
	bytes: number
): Promise<void> {
	try {
		await env.AUTH_DB
			.prepare(
				`INSERT INTO inv_references (addr, last_seen_at, bytes)
				 VALUES (?, unixepoch(), ?)
				 ON CONFLICT(addr) DO UPDATE SET
					last_seen_at = excluded.last_seen_at,
					bytes        = excluded.bytes`
			)
			.bind(addr.toLowerCase(), bytes)
			.run();
	} catch {
		// Tolerable.
	}
}

export const PUT: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await resolveSession(env, request);
	if (!session) return jsonError(401, 'unauthorized');

	const addr = params.addr;
	if (!addr || !ADDR_RE.test(addr)) {
		return jsonError(400, 'invalid inventory address');
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
		return jsonError(400, 'encoded inventory size out of range');
	}

	let nonce: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		nonce = b64decode(body.nonce);
		ciphertext = b64decode(body.ciphertext);
	} catch {
		return jsonError(400, 'invalid inventory encoding');
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
			customMetadata: {
				kind: 'v2-inv'
			}
		});
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}

	await recordInvReference(env, addr, buf.length);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({ addr: addr.toLowerCase(), updatedAt: Date.now() });
};

export const GET: RequestHandler = async ({ request, platform, params }) => {
	const env = platform!.env as Env;
	const session = await resolveSession(env, request);
	if (!session) return jsonError(401, 'unauthorized');

	const addr = params.addr;
	if (!addr || !ADDR_RE.test(addr)) {
		return jsonError(400, 'invalid inventory address');
	}

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	let r2obj;
	try {
		r2obj = await env.VAULT_BLOBS.get(objectKey(addr));
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (!r2obj) return jsonError(404, 'no inventory');

	let buf: Uint8Array;
	try {
		const ab = await r2obj.arrayBuffer();
		buf = new Uint8Array(ab);
	} catch {
		return jsonError(503, 'blob storage unavailable');
	}
	if (buf.length < 4) return jsonError(500, 'malformed inventory');
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const nonceLen = view.getUint32(0, false);
	if (4 + nonceLen > buf.length) return jsonError(500, 'malformed inventory');
	const nonce = buf.slice(4, 4 + nonceLen);
	const ciphertext = buf.slice(4 + nonceLen);

	await recordInvReference(env, addr, buf.length);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({
		addr: addr.toLowerCase(),
		nonce: b64encode(nonce),
		ciphertext: b64encode(ciphertext),
		updatedAt: r2obj.uploaded.getTime()
	});
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
