// See https://kit.svelte.dev/docs/types#app for information about these interfaces.
//
// `Platform.env` mirrors `src/lib/server/api/env.ts::Env` (the
// shape every /api/* SvelteKit `+server.ts` route consumes via
// `platform.env`). Keep these in sync.

import type { D1Database, R2Bucket } from '$lib/server/api/env';

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: {
				// Public env vars surfaced as Pages [vars] (preview) or
				// `[env.production.vars]` (production), plus injected
				// at deploy time by .github/workflows/release.yml.
				PUBLIC_BUNDLE_HASH?: string;
				PUBLIC_VAULT_VERSION?: string;
				PUBLIC_ENABLE_DEMO_AUTH?: string;
				PUBLIC_SYNC_ORIGIN?: string;
				PUBLIC_M3_E2E_AUTH?: string;

				// Cloudflare bindings — see `wrangler.toml`. AUTH_DB
				// + VAULT_BLOBS are required for /api/* to function.
				// Rate limits are enforced through AUTH_DB by the D1
				// sliding-window limiter in src/lib/server/api/rate-limit-d1.ts.
				// OPAQUE_RATE_LIMIT_MODE controls the limiter's behavior
				// on infrastructure failure (fail-open in preview,
				// fail-closed in production).
				AUTH_DB: D1Database;
				VAULT_BLOBS: R2Bucket;
				OPAQUE_SERVER_ID?: string;
				OPAQUE_RATE_LIMIT_MODE?: 'fail-open' | 'fail-closed';

				// AKD (Vu0 §L09 groundwork) — see env.ts for full docs.
				AKD_SIGNING_KEY_HEX?: string;
				AKD_ADMIN_TOKEN?: string;
				AKD_EPOCH_CADENCE_MS?: string;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
