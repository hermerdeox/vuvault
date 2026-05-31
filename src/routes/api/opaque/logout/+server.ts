/**
 * POST /api/opaque/logout
 *
 * Headers: `Authorization: Bearer <token>` from a prior OPAQUE KE3.
 * Returns: `{ revoked: true }` on success, even when the token row
 *          was already absent (idempotent revocation).
 *
 * Explicit server-side revocation for OPAQUE session tokens. Without
 * this route, locking the vault only clears the in-memory bearer
 * token; an intercepted token remains valid for the full 1h session
 * TTL. Deleting the row mid-session bounds the exposure window to
 * "until the client honestly notifies the server", which is the
 * strongest guarantee a stateless OAuth-style bearer scheme allows.
 *
 * Idempotent by design: an unknown or expired token still returns
 * 200 with `revoked: true`. This avoids leaking session-existence
 * information to a passive observer of the response code, and keeps
 * fire-and-forget client behavior simple (a single DELETE attempt
 * always succeeds from the client's perspective).
 *
 * Rate-limited under the OPAQUE_LOGIN bucket so a flood of logout
 * calls cannot be used to mask a brute-force login attempt or to
 * exhaust D1 write capacity. Keying by IP is consistent with the
 * other OPAQUE routes; an authenticated logout cannot leak the
 * account-id to the IP-based bucket.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { jsonError, jsonOk } from '$lib/server/api/http';

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.OPAQUE_LOGIN, `ip:${ip}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const auth = request.headers.get('authorization');
	const match = auth?.match(/^Bearer\s+([0-9a-fA-F]{64})$/);
	if (!match) {
		// Treat malformed Authorization as a no-op so client lock
		// flows that fire even before a token is minted stay quiet.
		return jsonOk({ revoked: true });
	}
	const token = match[1]!;

	try {
		await env.AUTH_DB
			.prepare('DELETE FROM sessions WHERE token = ?')
			.bind(token)
			.run();
	} catch {
		return jsonError(503, 'session storage unavailable');
	}

	return jsonOk({ revoked: true });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
