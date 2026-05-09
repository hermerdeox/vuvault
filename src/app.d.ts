// See https://kit.svelte.dev/docs/types#app for information about these interfaces.
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: {
				PUBLIC_BUNDLE_HASH: string;
				PUBLIC_VAULT_VERSION: string;
				// Future: AUTH_DB: D1Database;
				// Future: VAULT_BLOBS: R2Bucket;
			};
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
