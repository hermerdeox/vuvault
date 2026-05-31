import type { D1Database } from './d1-storage';
import { getRateLimitMode, type Env } from './env';

export type RateLimitConfig = {
	name: string;
	limit: number;
	windowSecs: number;
};

export type RateLimitDecision =
	| { ok: true }
	| { ok: false; status: 429 | 503; message: string };

export const RATE_LIMITS = {
	OPAQUE_REGISTER: { name: 'opaque-register', limit: 10, windowSecs: 60 },
	OPAQUE_LOGIN: { name: 'opaque-login', limit: 30, windowSecs: 60 },
	BLOB: { name: 'blob', limit: 30, windowSecs: 60 }
} as const satisfies Record<string, RateLimitConfig>;

/**
 * Apply a single rate-limit decision against D1.
 *
 * Accepts the full `Env` (not just the D1 handle) so the limiter
 * can consult `OPAQUE_RATE_LIMIT_MODE` to decide what to do when
 * D1 itself is unreachable:
 *
 *   - `fail-closed` (production default): return 503. A broken
 *     limiter must NOT silently disable rate limiting; the request
 *     fails until D1 recovers.
 *   - `fail-open` (preview / local-dev): return 200-equivalent
 *     `{ ok: true }`. Lets a developer with a wiped
 *     `.wrangler/state` keep iterating without first re-running
 *     migrations.
 *
 * Anything that's not the exact string `"fail-open"` resolves to
 * fail-closed via `getRateLimitMode()`.
 */
export async function applyRateLimit(
	env: Env,
	cfg: RateLimitConfig,
	key: string
): Promise<RateLimitDecision> {
	return applyRateLimitWithDb(env.AUTH_DB, cfg, key, getRateLimitMode(env));
}

/**
 * Lower-level variant that takes the D1 handle + mode directly.
 * Used by tests and by call sites that have already resolved the
 * mode for the request. Production routes should prefer
 * `applyRateLimit(env, ...)`.
 */
export async function applyRateLimitWithDb(
	db: D1Database,
	cfg: RateLimitConfig,
	key: string,
	mode: 'fail-open' | 'fail-closed'
): Promise<RateLimitDecision> {
	const now = Math.floor(Date.now() / 1000);
	const windowStart = now - (now % cfg.windowSecs);
	const bucket = `${cfg.name}:${key}`;

	try {
		await db
			.prepare(
				`INSERT INTO rate_limits (bucket, window_start, count)
				 VALUES (?, ?, 1)
				 ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1`
			)
			.bind(bucket, windowStart)
			.run();

		const row = await db
			.prepare('SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?')
			.bind(bucket, windowStart)
			.first<{ count: number }>();

		return Number(row?.count ?? 0) <= cfg.limit
			? { ok: true }
			: { ok: false, status: 429, message: 'rate limit exceeded' };
	} catch {
		// Infrastructure error path. Mode dictates what we tell the
		// client. Production always uses fail-closed; preview can opt
		// in to fail-open via `OPAQUE_RATE_LIMIT_MODE`.
		if (mode === 'fail-open') {
			return { ok: true };
		}
		return { ok: false, status: 503, message: 'rate limiter unavailable' };
	}
}
