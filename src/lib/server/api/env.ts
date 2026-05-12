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
	 * Server-facing identity string used as the OPAQUE `serverIdentity`
	 * during AKE. Defaults to `'vuvault.app'` in production, but every
	 * preview / staging deploy must set its own to keep transcripts
	 * isolated. Configured via [vars] in wrangler.toml.
	 */
	OPAQUE_SERVER_ID?: string;
}

/** Read the configured OPAQUE server identity, defaulting safely. */
export function getServerId(env: Env): string {
	return env.OPAQUE_SERVER_ID && env.OPAQUE_SERVER_ID.trim()
		? env.OPAQUE_SERVER_ID.trim()
		: 'vuvault.app';
}
