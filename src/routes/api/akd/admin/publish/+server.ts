/**
 * POST /api/akd/admin/publish — internal route to mint a fresh AKD
 * epoch.
 *
 * Auth: requires `Authorization: Bearer <AKD_ADMIN_TOKEN>` with
 * constant-time comparison. The token is set as a secret via
 * `wrangler pages secret put AKD_ADMIN_TOKEN`. When the token is
 * unset, the route returns 503 (route effectively disabled).
 *
 * Rate guard: refuses to mint a new epoch faster than
 * `AKD_EPOCH_CADENCE_MS` milliseconds since the previous one.
 * Production cadence is 24h; preview is 1h; both are configurable
 * via wrangler.toml.
 *
 * Intended callers:
 *   1. Cloudflare Cron Worker (hourly in preview, daily in prod).
 *   2. Manual `curl -H "Authorization: Bearer ..." …` triggers for
 *      tests, recovery, or audit demos.
 *
 * Response body (success):
 *
 *   {
 *     "ok": true,
 *     "data": {
 *       "epoch_id": <number>,
 *       "root_hex": "<96 hex>",
 *       "leaf_count": <number>,
 *       "signed_at": <unix seconds>
 *     }
 *   }
 *
 * Response body (rate-limited):
 *   { "ok": false, "error": "too soon since previous epoch", "code": 429 }
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { mintEpoch, currentEpoch, verifyAdminToken } from '$lib/server/api/akd-server';
import { jsonError, jsonOk } from '$lib/server/api/http';

function getCadenceMs(env: Env): number {
	const raw = env.AKD_EPOCH_CADENCE_MS;
	if (!raw) return 3_600_000; // default: 1h
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return 3_600_000;
	return parsed;
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;

	if (!verifyAdminToken(env, request.headers.get('authorization'))) {
		// Generic 401 regardless of whether the token is missing,
		// malformed, or wrong — avoids an account-existence-style
		// oracle for the admin token.
		return jsonError(401, 'unauthorized');
	}

	// Rate guard: cadence enforced even for admin triggers, to keep
	// epoch sequencing tame in test loops.
	try {
		const latest = await currentEpoch(env);
		if (latest) {
			const nowMs = Date.now();
			const lastMs = latest.signedAt * 1000;
			const cadence = getCadenceMs(env);
			if (nowMs - lastMs < cadence) {
				return jsonError(429, 'too soon since previous epoch');
			}
		}
	} catch {
		return jsonError(503, 'akd unavailable');
	}

	try {
		const epoch = await mintEpoch(env);
		return jsonOk({
			epoch_id: epoch.epochId,
			root_hex: epoch.rootHex,
			leaf_count: epoch.leafCount,
			signed_at: epoch.signedAt
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'unknown';
		if (msg.includes('AKD_SIGNING_KEY_HEX')) {
			return jsonError(503, 'akd signing key not configured');
		}
		return jsonError(503, 'mint epoch failed');
	}
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
