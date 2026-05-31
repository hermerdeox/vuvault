/**
 * R2 blob garbage collection.
 *
 * Two categories of orphaned R2 objects accumulate over time:
 *
 *   1. **Superseded whole-vault blobs.** Every successful
 *      `/api/blobs/upload` writes a new `vaults/{accountId}/{N}.bin`
 *      under a monotonically increasing sequence-clock `N`. Only the
 *      highest-`N` object is ever read by `/api/blobs/latest`; every
 *      object below `account.sequence_clock - KEEP_SUPERSEDED` is
 *      dead weight that R2 still charges egress + storage on.
 *
 *   2. **Orphaned document blobs.** When a user deletes a document
 *      item the client calls `DELETE /api/documents/<blobId>` to
 *      remove it from R2. If that call fails (offline, network drop,
 *      tab closed mid-flight) the R2 object lingers indefinitely
 *      with no reference. The vault item itself is gone, so there's
 *      no way to retroactively know which doc blobs belong to a
 *      live item — but we can age them out: any document blob older
 *      than `DOC_BLOB_MAX_AGE_MS` and not touched since is safe to
 *      purge, because every live reference would have either
 *      re-uploaded (refreshing R2's `uploaded`) or been deleted.
 *
 * Like `cleanup.ts`, R2 GC is opportunistic and bounded. Every
 * authenticated route that's already touching R2 for this account
 * gets a small probabilistic chance to sweep a few objects. Steady-
 * state cost is constant; worst-case latency per request is bounded
 * by `MAX_DELETES_PER_SWEEP`.
 *
 * Failure: every GC call is fire-and-forget. A failed list / delete
 * MUST NOT propagate into the originating request — GC is a
 * background concern; the originating request already succeeded.
 */

import type { Env } from './env';

/** Bound on the number of R2 objects a single sweep is allowed to
 *  delete. Keep small so a heavily-degraded account never amplifies
 *  one request into a multi-second cleanup pass. */
const MAX_DELETES_PER_SWEEP = 32;

/**
 * Probability (0..1) that any one call to `maybeGcAccount` actually
 * runs. Lower than the D1 cleanup probability because each R2 list +
 * delete batch is a few network round-trips, not a single DELETE
 * statement.
 */
const GC_PROBABILITY = 0.02;

/**
 * Number of recent whole-vault blobs to keep around as fallback for
 * any client that's slightly behind on its sequence clock. Anything
 * older than `latestClock - KEEP_SUPERSEDED` is unambiguously dead.
 */
const KEEP_SUPERSEDED = 2;

/**
 * Maximum age, in milliseconds, of a document blob before it becomes
 * eligible for GC if nothing has touched it. Set conservatively so
 * a user who attaches a doc and only re-syncs once a week isn't
 * surprised by missing bytes. 14 days matches the dormant-account
 * convention used elsewhere in the codebase.
 */
const DOC_BLOB_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const VAULT_KEY_RE = /^vaults\/[^/]+\/(\d+)\.bin$/;

/**
 * Listing chunk size. Cloudflare R2 caps `list({ limit })` at 1000
 * per page; we pick a smaller value to keep request memory small and
 * to make the bounded-delete budget meaningful even for accounts
 * with thousands of orphaned blobs.
 */
const LIST_PAGE = 200;

/**
 * Opportunistically GC R2 objects for a single account. Sampled by
 * `GC_PROBABILITY` so the steady-state cost is constant in the
 * limit even under heavy traffic. Always resolves successfully.
 */
export async function maybeGcAccount(
	env: Env,
	accountId: string,
	currentSequenceClock: number
): Promise<void> {
	if (Math.random() >= GC_PROBABILITY) return;
	await gcAccountNow(env, accountId, currentSequenceClock).catch(() => undefined);
}

/**
 * Force a single-account GC pass regardless of sampling. Used by
 * tests and by the post-deploy smoke path. Returns a count summary
 * so observability paths can assert the contract works.
 */
export async function gcAccountNow(
	env: Env,
	accountId: string,
	currentSequenceClock: number
): Promise<{ vaultBlobsDeleted: number; documentBlobsDeleted: number }> {
	const vaultPrefix = `vaults/${accountId}/`;
	const docPrefix = `vaults/${accountId}/documents/`;

	const vaultBlobsDeleted = await gcSupersededVaultBlobs(
		env,
		vaultPrefix,
		currentSequenceClock
	);
	const documentBlobsDeleted = await gcStaleDocumentBlobs(env, docPrefix);

	return { vaultBlobsDeleted, documentBlobsDeleted };
}

/**
 * Walk the account's `vaults/{accountId}/` prefix, skipping anything
 * under `documents/`, parse the trailing `{N}.bin` sequence-clock,
 * and delete every object with `N <= currentSequenceClock - KEEP_SUPERSEDED`.
 * Bounded by `MAX_DELETES_PER_SWEEP`.
 */
async function gcSupersededVaultBlobs(
	env: Env,
	prefix: string,
	currentSequenceClock: number
): Promise<number> {
	const cutoff = currentSequenceClock - KEEP_SUPERSEDED;
	if (cutoff < 0) return 0;

	const victims: string[] = [];
	let cursor: string | undefined;
	try {
		do {
			const listing = await env.VAULT_BLOBS.list({
				prefix,
				limit: LIST_PAGE,
				...(cursor ? { cursor } : {})
			});
			for (const obj of listing.objects) {
				// Skip the documents/ subprefix — it has its own GC pass.
				if (obj.key.startsWith(`${prefix}documents/`)) continue;
				const match = obj.key.match(VAULT_KEY_RE);
				if (!match) continue;
				const seq = Number.parseInt(match[1]!, 10);
				if (!Number.isSafeInteger(seq)) continue;
				if (seq <= cutoff) {
					victims.push(obj.key);
					if (victims.length >= MAX_DELETES_PER_SWEEP) break;
				}
			}
			cursor = listing.truncated ? listing.cursor : undefined;
		} while (cursor && victims.length < MAX_DELETES_PER_SWEEP);
	} catch {
		return 0;
	}

	let deleted = 0;
	for (const key of victims) {
		try {
			await env.VAULT_BLOBS.delete(key);
			deleted += 1;
		} catch {
			// Best-effort. Skip the failed one and move on; the next
			// sampled sweep will retry.
		}
	}
	return deleted;
}

/**
 * Phase 4 §L07b — V2 reference-counted garbage collection.
 *
 * V1-C1/V1-C3 invariant: this function MUST NOT walk per-account
 * prefixes (those are v1 layout). It uses the global D1 tables
 * `blob_references` and `inv_references` to identify victims based
 * solely on `last_seen_at`. The corresponding R2 object lives at
 * `v2/blobs/{uuid}.bin` or `v2/inv/{addr}.bin` — neither path
 * contains any account identifier.
 *
 * Caller is responsible for calling this from a non-per-account
 * trigger point (e.g., a Cron Worker, or a probabilistic call from
 * any v2 route).
 */
const V2_REF_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const V2_VICTIM_BATCH = 50;

export async function maybeGcV2(env: Env): Promise<void> {
	if (Math.random() >= GC_PROBABILITY) return;
	await gcV2Now(env).catch(() => undefined);
}

export async function gcV2Now(
	env: Env
): Promise<{ v2BlobsDeleted: number; v2InvsDeleted: number }> {
	const cutoffSec = Math.floor((Date.now() - V2_REF_MAX_AGE_MS) / 1000);
	const v2BlobsDeleted = await gcV2BlobReferences(env, cutoffSec);
	const v2InvsDeleted = await gcV2InvReferences(env, cutoffSec);
	return { v2BlobsDeleted, v2InvsDeleted };
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
 * Walk the account's `vaults/{accountId}/documents/` prefix and
 * delete any document blob whose R2 `uploaded` timestamp is older
 * than `DOC_BLOB_MAX_AGE_MS`. Bounded by `MAX_DELETES_PER_SWEEP`.
 *
 * Why age-out instead of reference-tracking? The vault items live in
 * the encrypted blob the server can't read; we have no way to
 * enumerate which doc blobs are alive. Age is the only signal
 * available, and it's correct in steady state: a live document
 * triggers a fresh PUT on every save, which resets `uploaded`.
 */
async function gcStaleDocumentBlobs(env: Env, prefix: string): Promise<number> {
	const ageCutoff = Date.now() - DOC_BLOB_MAX_AGE_MS;

	const victims: string[] = [];
	let cursor: string | undefined;
	try {
		do {
			const listing = await env.VAULT_BLOBS.list({
				prefix,
				limit: LIST_PAGE,
				...(cursor ? { cursor } : {})
			});
			for (const obj of listing.objects) {
				if (obj.uploaded.getTime() < ageCutoff) {
					victims.push(obj.key);
					if (victims.length >= MAX_DELETES_PER_SWEEP) break;
				}
			}
			cursor = listing.truncated ? listing.cursor : undefined;
		} while (cursor && victims.length < MAX_DELETES_PER_SWEEP);
	} catch {
		return 0;
	}

	let deleted = 0;
	for (const key of victims) {
		try {
			await env.VAULT_BLOBS.delete(key);
			deleted += 1;
		} catch {
			// Same best-effort behavior as the vault-blob GC.
		}
	}
	return deleted;
}
