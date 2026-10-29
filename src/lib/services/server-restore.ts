/**
 * New-device restore — record discovery.
 *
 * A device with nothing but the Secret Key + Recovery Password derives
 * the restore root (`deriveRecoveryMaterialFor`), then scans the
 * day-bucketed addresses the previous device wrote to
 * (`restoreAddress(root, day, slot)`) from today backwards through the
 * server's GC window. The first day with any record wins; among that
 * day's slots the newest `writtenAt` is adopted. A record that does not
 * open under the root (wrong password, tampering) is skipped, so a
 * wrong Recovery Password simply finds nothing.
 *
 * The reads are unauthenticated by design — there is no session yet —
 * and rate-limited per IP server-side. See
 * `src/lib/crypto/restore-record.ts` for the privacy argument.
 */

import {
	openRestoreRecord,
	restoreAddress,
	restoreDay,
	RESTORE_SCAN_DAYS,
	RESTORE_SCAN_SLOTS,
	zeroizeRestoreRecord,
	type RestoreRecordPayload
} from '$lib/crypto/restore-record';
import { encodeAddress } from './blob-inventory';
import { fetchV2Restore, isSyncWired } from './sync-client';

export type DiscoveredRestoreRecord = {
	record: RestoreRecordPayload;
	day: number;
	slot: number;
};

export type DiscoverProgress = (info: { daysScanned: number; requests: number }) => void;

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Find the newest restore record reachable from `root`, or null when
 * none exists (never published, older than the GC window, or a
 * different Recovery Password). Throws only on a transport/server
 * failure that makes the answer unknowable.
 */
export async function discoverRestoreRecord(
	root: Uint8Array,
	opts: { nowMs?: number; onProgress?: DiscoverProgress } = {}
): Promise<DiscoveredRestoreRecord | null> {
	if (!isSyncWired()) return null;
	const today = restoreDay(opts.nowMs ?? Date.now());
	let requests = 0;
	let transientFailures = 0;
	// Start one day ahead to tolerate clock skew on the writing device.
	for (let back = -1; back <= RESTORE_SCAN_DAYS; back++) {
		const day = today - back;
		if (day < 0) break;
		let best: DiscoveredRestoreRecord | null = null;
		for (let slot = 0; slot < RESTORE_SCAN_SLOTS; slot++) {
			const addr = restoreAddress(root, day, slot);
			const res = await fetchV2Restore(encodeAddress(addr));
			requests += 1;
			if (!res.ok) {
				if (res.reason === 'server' && res.message === 'no restore record') break;
				transientFailures += 1;
				if (transientFailures >= 3) {
					throw new Error(`Sync server unavailable while searching for a restore record (${res.message}).`);
				}
				break;
			}
			let record: RestoreRecordPayload;
			try {
				record = openRestoreRecord(
					root,
					addr,
					base64ToBytes(res.value.nonce),
					base64ToBytes(res.value.ciphertext)
				);
			} catch {
				continue; // not ours / tampered — keep probing this day
			}
			if (!best || record.writtenAt > best.record.writtenAt) {
				if (best) zeroizeRestoreRecord(best.record);
				best = { record, day, slot };
			} else {
				zeroizeRestoreRecord(record);
			}
		}
		opts.onProgress?.({ daysScanned: back + 2, requests });
		if (best) return best;
	}
	return null;
}
