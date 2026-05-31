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
	list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
		objects: { key: string; uploaded: Date; size: number }[];
		truncated: boolean;
		cursor?: string;
	}>;
};

export interface Env {
	AUTH_DB: D1Database;
	VAULT_BLOBS: R2Bucket;

	PUBLIC_BUNDLE_HASH?: string;
	PUBLIC_VAULT_VERSION?: string;
	PUBLIC_ENABLE_DEMO_AUTH?: string;
	PUBLIC_SYNC_ORIGIN?: string;

	/**
	 * Production-only deterministic-auth shim for the M3 sync e2e
	 * suite. Must be `'false'` in real production deploys; CI
	 * preflight refuses to ship a build with this enabled. Wired in
	 * `wrangler.toml` `[vars]` / `[env.production.vars]` so a stray
	 * preview deploy can't pick it up by accident.
	 */
	PUBLIC_M3_E2E_AUTH?: string;

	/**
	 * Server-facing identity string used as the OPAQUE `serverIdentity`
	 * during AKE. Defaults to `'vuvault.app'` in production, but every
	 * preview / staging deploy must set its own to keep transcripts
	 * isolated. Configured via [vars] in wrangler.toml.
	 */
	OPAQUE_SERVER_ID?: string;

	/**
	 * Behavior when the D1-backed rate limiter cannot complete a write
	 * (D1 unavailable, missing table, etc.). Two modes:
	 *
	 *   - `"fail-open"`  — allow the request through. Used in preview
	 *     / local-dev where the SQLite under `.wrangler/state` can be
	 *     wiped or missing and a CI smoke test would otherwise stall.
	 *   - `"fail-closed"` — reject the request with 503. The
	 *     production default; any rate-limit infrastructure issue is
	 *     treated as a DoS-class event, not silently bypassed.
	 *
	 * The value is read at request time so a config change does not
	 * require redeploy. Anything other than `"fail-open"` is treated
	 * as fail-closed (the safe default).
	 */
	OPAQUE_RATE_LIMIT_MODE?: 'fail-open' | 'fail-closed';

	/**
	 * AKD (Auditable Key Directory) — Vu0 / §L09 groundwork.
	 *
	 * `AKD_SIGNING_KEY_HEX` is the Ed25519 secret key the server uses
	 * to sign each published epoch root + VRF pubkey. Set via
	 * `wrangler pages secret put AKD_SIGNING_KEY_HEX` in production
	 * and via `.dev.vars` for local dev. Format: 64 hex characters
	 * (32 raw bytes) which `@noble/curves` ed25519 accepts as the
	 * secret seed.
	 *
	 * `AKD_ADMIN_TOKEN` gates `/api/akd/admin/publish` (the
	 * epoch-mint trigger). Constant-time compared against the
	 * incoming `Authorization: Bearer <token>` header on that
	 * endpoint. 64+ chars recommended.
	 *
	 * `AKD_EPOCH_CADENCE_MS` is the minimum number of milliseconds
	 * between consecutive epoch publications. The admin/publish
	 * route refuses to mint a new epoch faster than this. Default
	 * production: 86_400_000 (24h); preview / tests: 3_600_000 (1h).
	 *
	 * All three are optional at the type level so local dev without
	 * `.dev.vars` keeps the rest of the app working — the AKD
	 * routes themselves refuse to mint when keys are missing.
	 */
	AKD_SIGNING_KEY_HEX?: string;
	AKD_ADMIN_TOKEN?: string;
	AKD_EPOCH_CADENCE_MS?: string;
}

/** Read the configured OPAQUE server identity, defaulting safely. */
export function getServerId(env: Env): string {
	return env.OPAQUE_SERVER_ID && env.OPAQUE_SERVER_ID.trim()
		? env.OPAQUE_SERVER_ID.trim()
		: 'vuvault.app';
}

/**
 * Resolve `OPAQUE_RATE_LIMIT_MODE` with a fail-closed default.
 * Anything other than the literal string `"fail-open"` is treated as
 * fail-closed: a typo, missing var, or accidentally truthy value
 * MUST NOT silently disable the rate limiter in production.
 */
export function getRateLimitMode(env: Env): 'fail-open' | 'fail-closed' {
	return env.OPAQUE_RATE_LIMIT_MODE === 'fail-open' ? 'fail-open' : 'fail-closed';
}
