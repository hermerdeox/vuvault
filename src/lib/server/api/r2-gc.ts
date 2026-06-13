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
 * A live object is re-asserted whenever it is saved, read, OR named in a
 * keep-alive batch (see `touchV2BlobReferences` + the client's
 * `inventoryKeepAlive`), so under normal use every CURRENT blob — vault
 * and document alike — keeps a fresh timestamp on each sync. The window
 * therefore only ever collects genuinely orphaned blobs (superseded
 * versions no longer in any inventory) plus the blobs of a user who has
 * not synced at all for the whole window. 60 days gives a wide safety
 * margin over a multi-week absence; the prior 14-day window could reap a
 * still-live document blob the owner simply hadn't opened in two weeks.
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
): Promise<{ v2BlobsDeleted: number; v2InvsDeleted: number }> {
	const cutoffSec = Math.floor((Date.now() - V2_REF_MAX_AGE_MS) / 1000);
	const v2BlobsDeleted = await gcV2BlobReferences(env, cutoffSec);
	const v2InvsDeleted = await gcV2InvReferences(env, cutoffSec);
	return { v2BlobsDeleted, v2InvsDeleted };
}

/**
 * Refresh `last_seen_at` to now for each existing blob reference in the
 * batch — the server side of the keep-alive heartbeat. UPDATE-only by
 * design: it never INSERTs, so a keep-alive for an unknown / already-
 * collected UUID is a silent no-op and can't create a phantom reference
 * to a blob R2 doesn't hold. Returns how many references were refreshed.
 *
 * Carries no account binding (the IDs are global account-free UUIDs) and
 * is best-effort per row, so a single failing UPDATE never aborts the
 * batch or the originating request.
 */
export async function touchV2BlobReferences(env: Env, blobIds: string[]): Promise<number> {
	let touched = 0;
	for (const raw of blobIds) {
		const blobId = raw.toLowerCase();
		try {
			const res = await env.AUTH_DB
				.prepare(
					`UPDATE blob_references SET last_seen_at = unixepoch() WHERE blob_id = ?`
				)
				.bind(blobId)
				.run();
			const changes = res?.meta?.changes ?? 0;
			if (changes > 0) touched += changes;
		} catch {
			// Tolerable — keep-alive is a best-effort heartbeat.
		}
	}
	return touched;
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
