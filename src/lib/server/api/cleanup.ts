/**
 * Opportunistic D1 cleanup for ephemeral / time-bounded rows.
 *
 * The M3 schema has four tables that grow without bound unless
 * explicitly pruned:
 *
 *   - `pending_registrations` — 30-second TTL OPAQUE state. The
 *     read path filters by `created_at`, but the rows themselves
 *     never go away.
 *   - `pending_logins`       — same 30-second TTL story.
 *   - `sessions`             — 1-hour TTL bearer tokens. Expired
 *     rows are rejected by `authenticate()` but stay on disk.
 *   - `rate_limits`          — sliding-window counters keyed by
 *     `(bucket, window_start)`. The window_start that's not the
 *     current one is dead the moment the window rolls over.
 *
 * Cloudflare Pages Functions don't expose a scheduled-event hook
 * (that's a Worker / cron-trigger feature). The pragmatic
 * alternative is *opportunistic* cleanup: every request that's
 * already doing a D1 write takes a small probabilistic detour to
 * delete a bounded number of expired rows. This keeps growth
 * proportional to traffic, has zero infrastructure surface, and
 * never blocks the request path.
 *
 * Bound: `MAX_DELETES_PER_SWEEP` caps the rows removed per call so
 * a single request never amplifies into a long-running DELETE
 * against a degenerate table. Combined with the sampling rate
 * (`SWEEP_PROBABILITY`), expected steady-state work is constant.
 *
 * Failure: every cleanup call is fire-and-forget. A failed DELETE
 * MUST NOT propagate into the originating request — the route
 * already succeeded against the user-facing operation, and
 * cleanup is a maintenance concern, not a correctness one.
 */

import type { D1Database } from './d1-storage';

/** Bound on how many rows a single sweep is allowed to delete. */
const MAX_DELETES_PER_SWEEP = 64;

/**
 * Probability (0..1) that any one call to `maybeSweep` actually
 * runs. At ~1-in-25 we expect one sweep every 25 mutations on the
 * hot routes (register, login, blob upload), which empirically keeps
 * the pending/session/rate-limit tables under a few hundred rows
 * at the maximum sustained throughput the rate limits allow.
 */
const SWEEP_PROBABILITY = 0.04;

/**
 * `pending_registrations` and `pending_logins` rows are valid for
 * 30 seconds (see `PENDING_TTL_MS` in `d1-storage.ts`). After that
 * they're never consulted again, so we can drop them aggressively.
 */
const PENDING_TTL_SECS = 30;

/**
 * `rate_limits` rows are dead the instant the window rolls over.
 * We keep one extra window-width of grace to avoid racing with
 * in-flight increments at the rollover boundary.
 */
const RATE_LIMIT_WINDOW_GRACE_SECS = 60;

/**
 * Opportunistically prune expired rows from any of the time-bounded
 * tables. Sampled by `SWEEP_PROBABILITY` so the steady-state cost
 * is constant in the limit even under heavy traffic.
 *
 * Always resolves successfully even when D1 errors mid-sweep.
 */
export async function maybeSweep(db: D1Database): Promise<void> {
	if (Math.random() >= SWEEP_PROBABILITY) return;
	await sweepNow(db);
}

/**
 * Force a sweep regardless of sampling. Used by tests and by the
 * post-deploy smoke path to verify the cleanup contract works end
 * to end on a real D1 instance.
 *
 * Returns a count summary for tests / observability. NEVER throws —
 * partial cleanup is still a win, and the caller is always a
 * fire-and-forget maintenance path.
 */
export async function sweepNow(db: D1Database): Promise<{
	pendingRegistrations: number;
	pendingLogins: number;
	sessions: number;
	rateLimits: number;
}> {
	const now = Math.floor(Date.now() / 1000);
	const pendingCutoff = now - PENDING_TTL_SECS;
	const rateLimitCutoff = now - RATE_LIMIT_WINDOW_GRACE_SECS;
	// Sessions store `expires_at` directly, so the cutoff is the
	// current wall-clock seconds. Anything strictly less than now is
	// already past TTL.
	const sessionCutoff = now;

	const results = await Promise.allSettled([
		deleteWithLimit(
			db,
			'DELETE FROM pending_registrations WHERE rowid IN (SELECT rowid FROM pending_registrations WHERE created_at < ? LIMIT ?)',
			pendingCutoff
		),
		deleteWithLimit(
			db,
			'DELETE FROM pending_logins WHERE rowid IN (SELECT rowid FROM pending_logins WHERE created_at < ? LIMIT ?)',
			pendingCutoff
		),
		deleteWithLimit(
			db,
			'DELETE FROM sessions WHERE rowid IN (SELECT rowid FROM sessions WHERE expires_at < ? LIMIT ?)',
			sessionCutoff
		),
		deleteWithLimit(
			db,
			'DELETE FROM rate_limits WHERE rowid IN (SELECT rowid FROM rate_limits WHERE window_start < ? LIMIT ?)',
			rateLimitCutoff
		)
	]);

	return {
		pendingRegistrations: settledCount(results[0]),
		pendingLogins: settledCount(results[1]),
		sessions: settledCount(results[2]),
		rateLimits: settledCount(results[3])
	};
}

async function deleteWithLimit(
	db: D1Database,
	sql: string,
	cutoff: number
): Promise<number> {
	try {
		const result = await db.prepare(sql).bind(cutoff, MAX_DELETES_PER_SWEEP).run();
		return result.meta?.changes ?? 0;
	} catch {
		return 0;
	}
}

function settledCount(result: PromiseSettledResult<number>): number {
	return result.status === 'fulfilled' ? result.value : 0;
}
