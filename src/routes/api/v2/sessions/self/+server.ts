/**
 * GET /api/v2/sessions/self — session introspection (V1-C2 probe target).
 *
 * Returns the MINIMAL set of fields about the authenticated session:
 * `{ expiresAt, sequenceClock }`. By construction, this endpoint MUST
 * NOT return any of:
 *   - account_id
 *   - device_id
 *   - last_login_at
 *   - any fingerprint / IP / user-agent string
 *
 * The V1-C2 probe in `scripts/release-probe-vu1.mjs` fetches this
 * endpoint and refuses to flip `CURRENT_LEVEL` if the response shape
 * contains any disallowed field. See `docs/VU-LEVEL-MIGRATION-MAP.md`
 * V1-C2 and `docs/TIER2-ARCHITECTURE.md` §L08 session-mint redesign.
 *
 * This endpoint is path-versioned `/api/v2/` so it coexists with the
 * v1 surface (`/api/blobs/*`, `/api/documents/[blobId]`, etc.) during
 * the Phase 2-4 migration window. v1 routes continue to work
 * unchanged.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { authenticate, rotateToken } from '$lib/server/api/auth-token';
import { authenticateCapability } from '$lib/server/api/capability-auth';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';
import { jsonError } from '$lib/server/api/http';

export const GET: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	// Dual-auth: Bearer first, capability second. The auth result
	// carries a `token` field that is either the Bearer token (Vu1)
	// or the capability hex (Vu0). Bearer-token rotation only fires
	// in the Bearer branch — capabilities are rotated by the client
	// via `mintCapability` after the AKD epoch rolls.
	const bearer = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	const session = bearer ?? (await authenticateCapability(env, request.headers.get('x-vu0-capability')));
	if (!session) return jsonError(401, 'unauthorized');
	const isBearerSession = bearer !== null;

	// V1-C1: rate-limit on a session-scoped key (NOT account-scoped)
	// so the rate_limits.bucket column does not reveal account
	// identity. See `src/lib/server/api/v2-rate-limit-key.ts`.
	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	// L08 Option (ii) groundwork: rotate the session token on every
	// call to this endpoint. The new token is emitted via the
	// `Next-Token` response header; the old token is atomically
	// retired in D1. If rotation fails for any reason, we still
	// return a successful introspection — the existing token remains
	// valid for the rest of its TTL and the client can retry rotation
	// on the next call.
	//
	// Rotation only applies to BEARER sessions. Capability sessions
	// rotate per AKD epoch via the client's `mintCapability` flow;
	// there is no in-route capability rotation.
	const rotated = isBearerSession
		? await rotateToken(env.AUTH_DB, session.token).catch(() => null)
		: null;

	// Construct the response by hand so we can control headers. The
	// V1-C2 probe inspects this exact shape; adding any new field
	// requires updating both the probe and
	// `docs/VU-LEVEL-MIGRATION-MAP.md`.
	const body = JSON.stringify({
		ok: true,
		data: {
			expiresAt: rotated?.expiresAt ?? session.expiresAt,
			sequenceClock: rotated?.sequenceClock ?? session.sequenceClock
		}
	});
	const headers: Record<string, string> = {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store'
	};
	if (rotated) {
		headers['next-token'] = rotated.newToken;
	}
	return new Response(body, { status: 200, headers });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
