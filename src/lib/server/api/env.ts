/**
 * SvelteKit API `Env` type — shared by every handler under
 * `src/routes/api/`. Lists every binding the Worker expects to find
 * at request time. Bindings come from `wrangler.toml`'s `[[d1_databases]]`,
 * `[[r2_buckets]]`, and `[vars]` blocks.
 */

import type { D1Database } from './d1-storage';

export type R2Object = {
	body?: ReadableStream<Uint8Array> | null;
	arrayBuffer(): Promise<ArrayBuffer>;
	httpEtag: string;
	customMetadata?: Record<string, string>;
	uploaded: Date;
};

export type R2Bucket = {
	get(key: string): Promise<R2Object | null>;
	put(
		key: string,
		value: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
		options?: { customMetadata?: Record<string, string> }
	): Promise<R2Object>;
	delete(key: string): Promise<void>;
	list(options?: { prefix?: string }): Promise<{
		objects: { key: string; uploaded: Date; size: number }[];
		truncated: boolean;
	}>;
};

/**
 * Cloudflare Rate Limiting binding shape. The `limit({ key })` call
 * returns `{ success: boolean }` and the binding stores a sliding-
 * window counter against the opaque key.
 *
 * Pages projects currently wire these through the Cloudflare dashboard,
 * not wrangler.toml. Production runs with `OPAQUE_RATE_LIMIT_MODE =
 * "fail-closed"` so a missing binding disables the protected endpoint
 * instead of silently accepting unlimited traffic.
 */
export type RateLimit = {
	limit(input: { key: string }): Promise<{ success: boolean }>;
};

export interface Env {
	AUTH_DB: D1Database;
	VAULT_BLOBS: R2Bucket;

	OPAQUE_REGISTER_LIMITER?: RateLimit;
	OPAQUE_LOGIN_LIMITER?: RateLimit;
	BLOB_LIMITER?: RateLimit;

	PUBLIC_BUNDLE_HASH?: string;
	PUBLIC_VAULT_VERSION?: string;
	PUBLIC_ENABLE_DEMO_AUTH?: string;
	PUBLIC_SYNC_ORIGIN?: string;
	OPAQUE_RATE_LIMIT_MODE?: string;

	/**
	 * Server-facing identity string used as the OPAQUE `serverIdentity`
	 * during AKE. Defaults to `'vault.vu'` in production, but every
	 * preview / staging deploy must set its own to keep transcripts
	 * isolated. Configured via [vars] in wrangler.toml.
	 */
	OPAQUE_SERVER_ID?: string;
}

/**
 * Apply a rate-limiter binding if it's wired. Preview/dev intentionally
 * fail open so local work does not require dashboard-only bindings.
 * Production sets `OPAQUE_RATE_LIMIT_MODE=fail-closed`, which turns a
 * missing or failing limiter into a 503 instead of a silent bypass.
 */
export type RateLimitDecision =
	| { ok: true }
	| { ok: false; status: 429 | 503; message: string };

export async function checkRateLimit(
	limiter: RateLimit | undefined,
	key: string,
	env: Pick<Env, 'OPAQUE_RATE_LIMIT_MODE'>
): Promise<RateLimitDecision> {
	const mode = (env.OPAQUE_RATE_LIMIT_MODE ?? 'fail-open').trim().toLowerCase();
	const failClosed = mode === 'fail-closed';
	if (!limiter) {
		return failClosed
			? { ok: false, status: 503, message: 'rate limiter binding not configured' }
			: { ok: true };
	}
	try {
		const { success } = await limiter.limit({ key });
		return success ? { ok: true } : { ok: false, status: 429, message: 'rate limit exceeded' };
	} catch {
		return failClosed
			? { ok: false, status: 503, message: 'rate limiter unavailable' }
			: { ok: true };
	}
}

/** Read the configured OPAQUE server identity, defaulting safely. */
export function getServerId(env: Env): string {
	return env.OPAQUE_SERVER_ID && env.OPAQUE_SERVER_ID.trim()
		? env.OPAQUE_SERVER_ID.trim()
		: 'vault.vu';
}
