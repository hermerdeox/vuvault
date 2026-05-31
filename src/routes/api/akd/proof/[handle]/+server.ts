/**
 * GET /api/akd/proof/<handle>?epoch=<id> — inclusion proof for an
 * account handle at the given (or latest) AKD epoch.
 *
 * Auth: requires a valid Bearer token (today's session auth). The
 * requesting account MUST match the handle being proven, OR be an
 * authorized auditor. Today we enforce the self-match guard; an
 * auditor role can be added later.
 *
 * Response body (success):
 *
 *   {
 *     "ok": true,
 *     "data": {
 *       "epoch_id": <number>,
 *       "root_hex": "<96 hex>",
 *       "vrf_pubkey_hex": "<64 hex>",
 *       "leaf_pos_hex": "<96 hex>",
 *       "leaf_hash_hex": "<96 hex>",
 *       "siblings": ["<96 hex>", ... 384 entries ...]
 *     }
 *   }
 *
 * The siblings array carries the full 384-bit Merkle path. The
 * client verifies via `verifyInclusionProof` in
 * `src/lib/crypto/akd-merkle.ts`.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { proofFor } from '$lib/server/api/akd-server';
import { authenticate } from '$lib/server/api/auth-token';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';
import { jsonError, jsonOk } from '$lib/server/api/http';

const HANDLE_RE = /^[a-z0-9_-]{1,128}$/i;

export const GET: RequestHandler = async ({ request, platform, params, url }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const handle = params.handle;
	if (!handle || !HANDLE_RE.test(handle)) {
		return jsonError(400, 'invalid handle');
	}

	// Self-match guard: the requesting account's id must equal the
	// requested handle. Phase D will broaden this to support an
	// authorized auditor role.
	if (handle !== session.accountId) {
		return jsonError(403, 'forbidden');
	}

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const epochParam = url.searchParams.get('epoch');
	const epochId = epochParam ? Number.parseInt(epochParam, 10) : undefined;
	if (epochParam && (!Number.isInteger(epochId) || epochId! <= 0)) {
		return jsonError(400, 'invalid epoch');
	}

	try {
		const proof = await proofFor(env, handle, epochId);
		if (!proof) {
			return jsonError(404, 'no proof for handle/epoch');
		}
		return jsonOk({
			epoch_id: proof.epoch.epochId,
			root_hex: proof.epoch.rootHex,
			vrf_pubkey_hex: proof.epoch.vrfPubkeyHex,
			leaf_pos_hex: proof.leafPosHex,
			leaf_hash_hex: proof.leafHashHex,
			siblings: proof.siblings
		});
	} catch {
		return jsonError(503, 'akd unavailable');
	}
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
