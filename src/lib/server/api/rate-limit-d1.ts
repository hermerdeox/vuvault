import type { D1Database } from './d1-storage';

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

export async function applyRateLimit(
	db: D1Database,
	cfg: RateLimitConfig,
	key: string
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
		return { ok: false, status: 503, message: 'rate limiter unavailable' };
	}
}
