/**
 * Pages Function `Env` type — shared by every handler under
 * `functions/api/`. Lists every binding the Worker expects to find
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
 * Bindings declared in wrangler.toml under `[[unsafe.bindings]]` with
 * `type = "ratelimit"`. The unsafe wrapping is documented; the
 * dashboard-side rate-limit rules are the production safety net if
 * this shape changes.
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

	/**
	 * Server-facing identity string used as the OPAQUE `serverIdentity`
	 * during AKE. Defaults to `'vault.vu'` in production, but every
	 * preview / staging deploy must set its own to keep transcripts
	 * isolated. Configured via [vars] in wrangler.toml.
	 */
	OPAQUE_SERVER_ID?: string;
}

/**
 * Apply a rate-limiter binding if it's wired. If the binding isn't
 * present (e.g. local Wrangler dev without the unsafe binding
 * configured), the call is a no-op. Production deploys MUST have
 * the binding wired — verified by the deploy step.
 */
export async function checkRateLimit(
	limiter: RateLimit | undefined,
	key: string
): Promise<boolean> {
	if (!limiter) return true;
	try {
		const { success } = await limiter.limit({ key });
		return success;
	} catch {
		// Fail open on rate-limiter errors — we'd rather serve a
		// burst of legitimate traffic than refuse everything when
		// the limiter binding hiccups. Cloudflare WAF dashboard
		// rules are the layered defense.
		return true;
	}
}

/** Read the configured OPAQUE server identity, defaulting safely. */
export function getServerId(env: Env): string {
	return env.OPAQUE_SERVER_ID && env.OPAQUE_SERVER_ID.trim()
		? env.OPAQUE_SERVER_ID.trim()
		: 'vault.vu';
}
