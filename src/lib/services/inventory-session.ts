/**
 * Inventory session — the live glue that wires the client inventory
 * primitives (`blob-inventory.ts`) to the v2 sync transport
 * (`sync-client.ts`).
 *
 * Every save uploads the whole-vault blob to a random UUID and then
 * writes a small encrypted inventory naming that UUID. The inventory
 * for save number `i` lives at `inventoryAddress(chainKey, deviceSalt,
 * i)`, with `chainKey` derived from the vault data key + device salt
 * (`deriveChainKey`): a fresh address per save, never written twice
 * (V0-C1). A device restoring from the server re-derives the same
 * chain from the sealed restore record and walks it forward
 * (`inventoryPullNewer` with a larger probe bound). Together
 * with the anonymous request tokens, that leaves the server no stable
 * per-account identifier that recurs from one save to the next — the
 * fixed Candidate-1 bootstrap address this replaces was overwritten in
 * place by every save and so tied all of an account's sessions together.
 *
 * The device remembers its position in the address chain locally
 * (`AccountRecord.inventoryIndex`, persisted by vault-session.ts) instead
 * of reading it back from the server. Reading is what lets a logging
 * server link sessions — the session that wrote an object to any session
 * that later reads it — so the only read path is the explicit manual
 * pull (`inventoryPullNewer`), never unlock.
 *
 * Superseded inventories and vault blobs are never deleted by the
 * client (a delete next to the write that replaces it would link the old
 * object to the new one); the server's reference GC ages them out.
 */

import {
	inventoryAddress,
	encodeAddress,
	deserializeInventory,
	serializeInventory,
	sealInventory,
	openInventory,
	rotateAddress,
	type InventoryPlaintext
} from './blob-inventory';
import { uploadV2Inventory, fetchV2Inventory, isSyncWired, hasSession } from './sync-client';

/**
 * Upper bound on forward probes per manual pull. The only writer of this
 * address chain is a holder of the same (chainKey, deviceSalt), so more
 * than a handful of unseen saves means something is wrong; stop rather
 * than walk an unbounded number of addresses.
 */
const MAX_PULL_PROBES = 16;

type InventorySession = {
	vaultKey: Uint8Array;
	deviceSalt: Uint8Array;
	vaultBlobId: string | null;
	/** Highest save index this device has used (reserved) or adopted. */
	latestIndex: bigint;
	/** Inventory generation; bumped on every write. */
	version: bigint;
};

let active: InventorySession | null = null;

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Begin (or rebind) the inventory session for the active vault. Copies
 * `vaultKey` / `deviceSalt` so a later `zeroize` of the caller's
 * buffers (on lock / auth-rotation) cannot blank the key this module
 * needs to seal and open the inventory. `latestIndex` is the device's
 * persisted position in the address chain (0 for a fresh chain). Must
 * be re-called whenever `vaultKey` changes — the chain derives from it,
 * so a new key starts a new chain at 0.
 */
export function initInventorySession(
	vaultKey: Uint8Array,
	deviceSalt: Uint8Array,
	latestIndex: bigint = 0n
): void {
	active = {
		vaultKey: vaultKey.slice(),
		deviceSalt: deviceSalt.slice(),
		vaultBlobId: null,
		latestIndex,
		version: latestIndex
	};
}

/** Tear down the inventory session and zeroize the copied key. */
export function clearInventorySession(): void {
	if (active) active.vaultKey.fill(0);
	active = null;
}

export function hasInventorySession(): boolean {
	return active !== null;
}

/** The whole-vault blob UUID last written or adopted this session, if any. */
export function inventoryVaultBlobId(): string | null {
	return active ? active.vaultBlobId : null;
}

/** The device's current save index (the `sequenceClock` replacement). */
export function inventoryLatestIndex(): bigint {
	return active ? active.latestIndex : 0n;
}

type FetchOutcome =
	| { kind: 'present'; inv: InventoryPlaintext }
	| { kind: 'absent' }
	| { kind: 'error' };

/**
 * Fetch and decrypt the inventory for save `index`. `absent` means the
 * server holds nothing at that address (404); `error` means a transient
 * failure or an undecryptable payload.
 */
async function fetchInventoryAt(session: InventorySession, index: bigint): Promise<FetchOutcome> {
	const addr = inventoryAddress(session.vaultKey, session.deviceSalt, index);
	const result = await fetchV2Inventory(encodeAddress(addr));
	if (!result.ok) {
		// The inv GET route emits the literal error 'no inventory' on a
		// 404. Anything else (network, auth, 5xx) is a transient error
		// we should not mistake for "nothing there".
		if (result.reason === 'server' && result.message === 'no inventory') {
			return { kind: 'absent' };
		}
		return { kind: 'error' };
	}
	let plaintext: Uint8Array;
	try {
		plaintext = openInventory(
			session.vaultKey,
			addr,
			base64ToBytes(result.value.nonce),
			base64ToBytes(result.value.ciphertext)
		);
	} catch {
		return { kind: 'error' };
	}
	try {
		return { kind: 'present', inv: deserializeInventory(plaintext) };
	} catch {
		return { kind: 'error' };
	} finally {
		plaintext.fill(0);
	}
}

/**
 * Record a freshly-uploaded whole-vault blob as the current one by
 * writing the inventory for the next save index.
 *
 * The index is reserved synchronously, before the upload, so two
 * concurrent saves never share an address and a failed or ambiguous
 * upload is never retried at the same address (re-writing an address
 * would link the two sessions). The reserved index is returned whether
 * or not the upload succeeded; the caller persists it as the device's
 * position in the chain. Returns `index: 0n` without reserving when
 * sync is not available.
 */
export async function inventoryRecordVaultBlob(
	blobId: string
): Promise<{ ok: boolean; index: bigint }> {
	if (!active || !isSyncWired() || !hasSession()) return { ok: false, index: 0n };
	const session = active;
	session.latestIndex += 1n;
	session.version += 1n;
	const index = session.latestIndex;
	const addr = inventoryAddress(session.vaultKey, session.deviceSalt, index);
	const plaintext = serializeInventory({
		blobIds: [blobId],
		latestCrdtIndex: index,
		nextAddr: rotateAddress(),
		version: session.version
	});
	const { nonce, ciphertext } = sealInventory(session.vaultKey, addr, plaintext);
	plaintext.fill(0);
	const result = await uploadV2Inventory({
		addr: encodeAddress(addr),
		nonce: bytesToBase64(nonce),
		ciphertext: bytesToBase64(ciphertext)
	});
	if (result.ok) session.vaultBlobId = blobId;
	return { ok: result.ok, index };
}

/**
 * Manual pull: probe forward from the device's current index for saves
 * it has not seen and adopt the newest one found. Returns that save's
 * vault blob pointer, or null when nothing newer exists (or a probe hit
 * a transient error — the local copy stays authoritative either way).
 *
 * This is the only read path. Each probe of a not-yet-written address
 * lets a logging server link this session to whichever session later
 * writes there, which is why unlock never calls it.
 */
export async function inventoryPullNewer(
	maxProbes: number = MAX_PULL_PROBES
): Promise<{ blobId: string; index: bigint } | null> {
	if (!active || !isSyncWired() || !hasSession()) return null;
	const session = active;
	let newest: { inv: InventoryPlaintext; index: bigint } | null = null;
	for (let step = 1n; step <= BigInt(maxProbes); step++) {
		const index = session.latestIndex + step;
		const outcome = await fetchInventoryAt(session, index);
		if (outcome.kind !== 'present') break;
		newest = { inv: outcome.inv, index };
	}
	if (!newest) return null;
	const blobId = newest.inv.blobIds[0];
	session.latestIndex = newest.index;
	if (newest.inv.version > session.version) session.version = newest.inv.version;
	if (!blobId) return null;
	session.vaultBlobId = blobId;
	return { blobId, index: newest.index };
}
