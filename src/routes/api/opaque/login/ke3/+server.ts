/**
 * POST /api/opaque/login/ke3
 *
 * Body: `{ clientId, requestId, ke3 }` where `ke3` is the
 *       base64-encoded RFC 9807 KE3 bytes.
 * Returns: `{ accountId, token, expiresAt, sequenceClock }`.
 *
 * Mints a fresh session token on success. Wrong-password rejection
 * (MAC mismatch) returns 401 with no information about whether the
 * clientId existed.
 *
 * Vu1 / V1-C2 contract (post `migrations/0004_metadata_minimization.sql`):
 *
 *   - This endpoint MUST NOT bind a `device_id` value into the
 *     `sessions` row. The schema no longer carries that column.
 *   - This endpoint MUST NOT update `accounts.last_login_at`. The
 *     schema no longer carries that column either.
 *   - The legacy `deviceId` body field, if any client still sends
 *     it, is silently ignored. Tolerant ignore (not 400) so older
 *     v0.1.x clients do not break during the v1 rollout window.
 *
 * See `docs/VU-LEVEL-MIGRATION-MAP.md` V1-C2 and
 * `docs/TIER2-ARCHITECTURE.md` §L08 session-mint redesign.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { getServerId } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { OpaqueServerEngine } from '$lib/server/api/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '$lib/server/api/d1-storage';
import { maybeSweep } from '$lib/server/api/cleanup';
import { SESSION_TTL_MS } from '$lib/server/api/auth-token';
import { b64decode, jsonError, jsonOk, readJson } from '$lib/server/api/http';

// `deviceId` is accepted but silently discarded — see "tolerant ignore"
// above. We do NOT validate it because nothing downstream reads it.
type Body = { clientId?: string; requestId?: string; ke3?: string; deviceId?: unknown };

function newToken(): string {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.OPAQUE_LOGIN, `ip:${ip}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const body = await readJson<Body>(request);
	if (
		!body ||
		typeof body.clientId !== 'string' ||
		typeof body.requestId !== 'string' ||
		typeof body.ke3 !== 'string'
	) {
		return jsonError(400, 'invalid request body');
	}
	let ke3Bytes: Uint8Array;
	try {
		ke3Bytes = b64decode(body.ke3);
	} catch {
		return jsonError(400, 'invalid ke3 encoding');
	}
	if (body.clientId.length === 0 || body.clientId.length > 256) {
		return jsonError(400, 'invalid clientId');
	}
	if (!/^[0-9a-f]{32}$/.test(body.requestId)) {
		return jsonError(400, 'invalid requestId');
	}
	// V1-C2: body.deviceId is intentionally NOT read. See header doc.

	try {
		const storage = new D1OpaqueStorage(env.AUTH_DB);
		const serverId = getServerId(env);
		const identity = await loadServerIdentity(env.AUTH_DB, serverId);
		const engine = new OpaqueServerEngine(identity, storage);
		const { accountId } = await engine.loginKE3(body.clientId, body.requestId, ke3Bytes);

		const token = newToken();
		const expiresAt = Date.now() + SESSION_TTL_MS;
		const lastClock = await env.AUTH_DB
			.prepare(
				`SELECT
					MAX(
						COALESCE(accounts.sequence_clock, 0),
						COALESCE((SELECT MAX(sequence_clock) FROM sessions WHERE account_id = accounts.account_id), 0)
					) AS clock
				 FROM accounts
				 WHERE account_id = ?`
			)
			.bind(accountId)
			.first<{ clock: number }>();
		// New sessions inherit the durable account high-water mark. The
		// sessions fallback keeps local/dev databases created before the
		// additive migration safe during rollout.
		const sequenceClock = lastClock?.clock ?? 0;

		await env.AUTH_DB
			.prepare(
				`INSERT INTO sessions (token, account_id, expires_at, sequence_clock, created_at)
				 VALUES (?, ?, ?, ?, unixepoch())`
			)
			.bind(token, accountId, Math.floor(expiresAt / 1000), sequenceClock)
			.run();

		// V1-C2: no `UPDATE accounts SET last_login_at` — the column
		// is gone post-0004 and we deliberately avoid maintaining
		// per-account login timestamps. Equivalent observability is
		// available from log-free request counters at the rate-limit
		// table, scoped to IP rather than identity.

		void maybeSweep(env.AUTH_DB).catch(() => undefined);
		return jsonOk({
			accountId,
			token,
			expiresAt,
			sequenceClock
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : '';
		if (msg.includes('unknown login request')) {
			return jsonError(400, 'login request expired or unknown');
		}
		if (msg.includes('clientId mismatch')) {
			return jsonError(400, 'clientId mismatch');
		}
		// `serverAkeFinish` throws on MAC mismatch — wrong password.
		return jsonError(401, 'authentication failed');
	}
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
