/**
 * R2 blob garbage collection — V1-C1/§L07b reference-counted sweep.
 *
 * After the hard cutover to the v2 surface there is no per-account R2
 * prefix to walk: every object lives at a global, account-free key
 * (`v2/blobs/{uuid}.bin` or `v2/inv/{addr}.bin`). The only signal for
 * "is this object still live?" is the `last_seen_at` timestamp the
 * v2 routes refresh on every PUT/GET, recorded in the global D1 tables
 * `blob_references` and `inv_references`. Neither table carries an
 * account identifier, so the sweep cannot — and must not — correlate
 * objects back to accounts. This is what keeps GC itself V1-C1-clean.
 *
 * GC is opportunistic and bounded. Every v2 route that already touches
 * R2 gets a small probabilistic chance to sweep a batch of aged-out
 * references. Steady-state cost is constant; a single sweep deletes at
 * most `V2_VICTIM_BATCH` objects per table.
 *
 * Failure: every GC call is fire-and-forget. A failed list / delete
 * MUST NOT propagate into the originating request — GC is a background
 * concern; the originating request already succeeded.
 */

import type { Env } from './env';

/**
 * Probability (0..1) that any one sampled call actually runs a sweep.
 * Kept low because each victim is a D1 query plus an R2 delete, not a
 * single statement.
 */
const GC_PROBABILITY = 0.02;

/**
 * Age, in milliseconds, past which a reference whose `last_seen_at`
 * has not been refreshed is eligible for collection.
 *
 * A live object is re-asserted only by being written or read. The client
 * no longer deletes superseded blobs/inventories or sends keep-alive
 * batches — both would tie an old object to a new one in a single
 * session and undo the per-save address rotation (V0-C1). Instead every
 * superseded object simply ages out here, and the client re-uploads its
 * current vault as a fresh save once its last push is older than half
 * this window (`STALE_PUSH_MS` in vault-session.ts), so a live vault is
 * never collected while the owner keeps unlocking at least every 30 days.
 */
const V2_REF_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

/** Max objects a single sweep deletes per reference table. */
const V2_VICTIM_BATCH = 50;

/**
 * Opportunistically GC aged-out v2 objects. Sampled by
 * `GC_PROBABILITY` so steady-state cost is constant under load.
 * Always resolves successfully.
 */
export async function maybeGcV2(env: Env): Promise<void> {
	if (Math.random() >= GC_PROBABILITY) return;
	await gcV2Now(env).catch(() => undefined);
}

/**
 * Force a v2 GC pass regardless of sampling. Used by tests and the
 * post-deploy smoke path. Returns a count summary so observability
 * paths can assert the contract works.
 */
export async function gcV2Now(
	env: Env
): Promise<{ v2BlobsDeleted: number; v2InvsDeleted: number; v2RestoreDeleted: number }> {
	const cutoffSec = Math.floor((Date.now() - V2_REF_MAX_AGE_MS) / 1000);
	const v2BlobsDeleted = await gcV2BlobReferences(env, cutoffSec);
	const v2InvsDeleted = await gcV2InvReferences(env, cutoffSec);
	const v2RestoreDeleted = await gcV2RestoreReferences(env, cutoffSec);
	return { v2BlobsDeleted, v2InvsDeleted, v2RestoreDeleted };
}

async function gcV2BlobReferences(env: Env, cutoffSec: number): Promise<number> {
	let victims: { blob_id: string }[];
	try {
		const result = await env.AUTH_DB
			.prepare(
				`SELECT blob_id FROM blob_references
				 WHERE last_seen_at < ?
				 ORDER BY last_seen_at ASC
				 LIMIT ?`
			)
			.bind(cutoffSec, V2_VICTIM_BATCH)
			.all<{ blob_id: string }>();
		victims = result?.results ?? [];
	} catch {
		return 0;
	}
	if (victims.length === 0) return 0;

	let deleted = 0;
	for (const row of victims) {
		const key = `v2/blobs/${row.blob_id}.bin`;
		try {
			await env.VAULT_BLOBS.delete(key);
		} catch {
			// Tolerable — we still drop the D1 row so the next sweep
			// won't keep trying the same stale R2 key forever.
		}
		try {
			await env.AUTH_DB
				.prepare(`DELETE FROM blob_references WHERE blob_id = ?`)
				.bind(row.blob_id)
				.run();
			deleted += 1;
		} catch {
			// If we can't drop the D1 row, the next sweep retries.
		}
	}
	return deleted;
}

async function gcV2InvReferences(env: Env, cutoffSec: number): Promise<number> {
	let victims: { addr: string }[];
	try {
		const result = await env.AUTH_DB
			.prepare(
				`SELECT addr FROM inv_references
				 WHERE last_seen_at < ?
				 ORDER BY last_seen_at ASC
				 LIMIT ?`
			)
			.bind(cutoffSec, V2_VICTIM_BATCH)
			.all<{ addr: string }>();
		victims = result?.results ?? [];
	} catch {
		return 0;
	}
	if (victims.length === 0) return 0;

	let deleted = 0;
	for (const row of victims) {
		const key = `v2/inv/${row.addr}.bin`;
		try {
			await env.VAULT_BLOBS.delete(key);
		} catch {
			// Tolerable.
		}
		try {
			await env.AUTH_DB
				.prepare(`DELETE FROM inv_references WHERE addr = ?`)
				.bind(row.addr)
				.run();
			deleted += 1;
		} catch {
			// Tolerable.
		}
	}
	return deleted;
}

/**
 * Restore records (`v2/restore/<addr>.bin`, migration 0011) age out on
 * the same window: a device re-asserts its current record by writing a
 * fresh one at least every 30 days (the stale-push refresh at unlock),
 * and a restore read refreshes whichever record it found.
 */
async function gcV2RestoreReferences(env: Env, cutoffSec: number): Promise<number> {
	let victims: { addr: string }[];
	try {
		const result = await env.AUTH_DB
			.prepare(
				`SELECT addr FROM restore_references
				 WHERE last_seen_at < ?
				 ORDER BY last_seen_at ASC
				 LIMIT ?`
			)
			.bind(cutoffSec, V2_VICTIM_BATCH)
			.all<{ addr: string }>();
		victims = result?.results ?? [];
	} catch {
		return 0;
	}
	if (victims.length === 0) return 0;

	let deleted = 0;
	for (const row of victims) {
		const key = `v2/restore/${row.addr}.bin`;
		try {
			await env.VAULT_BLOBS.delete(key);
		} catch {
			// Tolerable.
		}
		try {
			await env.AUTH_DB
				.prepare(`DELETE FROM restore_references WHERE addr = ?`)
				.bind(row.addr)
				.run();
			deleted += 1;
		} catch {
			// Tolerable.
		}
	}
	return deleted;
}
