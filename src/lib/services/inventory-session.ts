/**
 * Inventory session — the live glue that wires the §L07b client
 * inventory primitives (`blob-inventory.ts`) to the v2 sync transport
 * (`sync-client.ts`). This module is what actually closes V1-C1
 * ("no per-user blob inventories") and V1-C3 ("no cross-account
 * sequence-clock correlation") for the running app: instead of the
 * legacy per-account R2 prefix (`vaults/{accountId}/...`), every blob
 * is a random UUID and the only thing that maps "which blobs belong to
 * this vault" is the client-side encrypted inventory stored at the
 * deterministic bootstrap address.
 *
 * Single active vault session at a time. The in-memory state IS the
 * authoritative working copy for the session — every mutation
 * (`setVaultBlob` / `addDocumentBlob` / `removeDocumentBlob`) edits it
 * in place and then persists the whole inventory. Two concurrent
 * mutators (e.g. a debounced vault save racing a document attach) edit
 * the same shared object, so neither clobbers the other's field; the
 * persist just re-serializes the merged state.
 *
 * State → wire mapping (positional `blobIds` convention, no
 * serialize-format change):
 *
 *   blobIds[0]   = current whole-vault blob UUID, or the SLOT_EMPTY
 *                  sentinel when no vault blob has been pushed yet but
 *                  documents already exist.
 *   blobIds[1..] = attached document blob UUIDs.
 *
 * `latestCrdtIndex` is a monotonic save counter that replaces the old
 * per-account `sequenceClock` for the "is the remote vault newer than
 * mine?" decision on pull. `version` is the inventory generation,
 * bumped on every persist (including document-only changes).
 *
 * Bootstrap address: per the approved Candidate-1 trade-off, the
 * inventory lives at `bootstrapAddress(vaultKey, deviceSalt)`,
 * overwritten in place on every save. A passive server cannot compute
 * this address (it is keyed on the secret `vaultKey`, which never
 * leaves the device), so it sees only writes to one opaque
 * `/api/v2/inv/{addr}` with no account linkage. Footprint: a party who
 * already holds `vaultKey` can confirm the inventory exists — moot,
 * since they already hold the vault. Because the address derives from
 * `vaultKey`, an auth rotation (new master password / OPAQUE enrolment)
 * moves the inventory to a fresh address; the local Dexie vault stays
 * authoritative across that, and the next save re-establishes the
 * server inventory. Cross-device restore after such a rotation is a
 * known limitation of the single-device V1 target.
 */

import {
	bootstrapAddress,
	encodeAddress,
	deserializeInventory,
	serializeInventory,
	sealInventory,
	openInventory,
	rotateAddress,
	type InventoryPlaintext
} from './blob-inventory';
import {
	uploadV2Inventory,
	fetchV2Inventory,
	isSyncWired,
	hasSession
} from './sync-client';

/**
 * Reserved slot-0 sentinel: a syntactically valid UUID v4 that we
 * never upload a blob to. It marks "the vault slot is not yet
 * populated" in the rare window where a document is attached before
 * the first whole-vault push. On load, a slot-0 value equal to this
 * sentinel decodes back to `vaultBlobId = null`. Fetching it always
 * 404s (we never PUT it), which the pull path already treats as
 * "no remote vault yet".
 */
const SLOT_EMPTY = '00000000-0000-4000-8000-000000000000';

type InventorySession = {
	vaultKey: Uint8Array;
	deviceSalt: Uint8Array;
	bootstrapAddr: Uint8Array;
	vaultBlobId: string | null;
	docBlobIds: string[];
	latestIndex: bigint;
	version: bigint;
	nextAddr: Uint8Array;
	/**
	 * Whether the in-memory state has been reconciled with the server
	 * inventory yet. Mutators reconcile once (first op of the session)
	 * so they never overwrite un-persisted in-memory edits mid-session;
	 * `inventoryPullVault` re-fetches deliberately at the explicit pull
	 * points (unlock / manual sync).
	 */
	loaded: boolean;
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
 * needs to seal and open the inventory. Must be re-called whenever
 * `vaultKey` changes (the bootstrap address derives from it).
 */
export function initInventorySession(vaultKey: Uint8Array, deviceSalt: Uint8Array): void {
	const bootstrapAddr = bootstrapAddress(vaultKey, deviceSalt);
	active = {
		vaultKey: vaultKey.slice(),
		deviceSalt: deviceSalt.slice(),
		bootstrapAddr,
		vaultBlobId: null,
		docBlobIds: [],
		latestIndex: 0n,
		version: 0n,
		nextAddr: rotateAddress(),
		loaded: false
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

/** The current whole-vault blob UUID, or null before the first push. */
export function inventoryVaultBlobId(): string | null {
	return active ? active.vaultBlobId : null;
}

/** The local monotonic save counter (the `sequenceClock` replacement). */
export function inventoryLatestIndex(): bigint {
	return active ? active.latestIndex : 0n;
}

function splitBlobIds(blobIds: string[]): { vaultBlobId: string | null; docBlobIds: string[] } {
	if (blobIds.length === 0) return { vaultBlobId: null, docBlobIds: [] };
	const head = blobIds[0]!;
	return {
		vaultBlobId: head === SLOT_EMPTY ? null : head,
		docBlobIds: blobIds.slice(1)
	};
}

function buildBlobIds(session: InventorySession): string[] {
	if (session.vaultBlobId === null && session.docBlobIds.length === 0) return [];
	return [session.vaultBlobId ?? SLOT_EMPTY, ...session.docBlobIds];
}

function adopt(session: InventorySession, inv: InventoryPlaintext): void {
	const { vaultBlobId, docBlobIds } = splitBlobIds(inv.blobIds);
	session.vaultBlobId = vaultBlobId;
	session.docBlobIds = docBlobIds;
	session.latestIndex = inv.latestCrdtIndex;
	session.version = inv.version;
	session.nextAddr = inv.nextAddr;
	session.loaded = true;
}

type FetchOutcome =
	| { kind: 'present'; inv: InventoryPlaintext }
	| { kind: 'absent' }
	| { kind: 'error' };

/**
 * Fetch and decrypt the server-side inventory at the bootstrap
 * address. `absent` means the server has no inventory yet (404);
 * `error` means a transient failure or undecryptable payload, in which
 * case the caller keeps the local in-memory state authoritative.
 */
async function fetchInventory(session: InventorySession): Promise<FetchOutcome> {
	const result = await fetchV2Inventory(encodeAddress(session.bootstrapAddr));
	if (!result.ok) {
		// The inv GET route emits the literal error 'no inventory' on a
		// 404. Anything else (network, auth, 5xx) is a transient error
		// we should not mistake for "the inventory is empty".
		if (result.reason === 'server' && result.message === 'no inventory') {
			return { kind: 'absent' };
		}
		return { kind: 'error' };
	}
	let plaintext: Uint8Array;
	try {
		plaintext = openInventory(
			session.vaultKey,
			session.bootstrapAddr,
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
 * Reconcile the in-memory state with the server exactly once per
 * session. After the first successful reconcile (`loaded = true`) this
 * is a no-op, so a mid-session mutator never re-fetches and overwrites
 * un-persisted edits.
 */
async function ensureLoaded(session: InventorySession): Promise<void> {
	if (session.loaded || !isSyncWired() || !hasSession()) return;
	const outcome = await fetchInventory(session);
	if (outcome.kind === 'present') {
		adopt(session, outcome.inv);
	} else if (outcome.kind === 'absent') {
		session.loaded = true;
	}
	// 'error' → leave loaded=false so the next op retries.
}

/** Seal and upload the current in-memory inventory. Best-effort. */
async function persist(session: InventorySession): Promise<boolean> {
	if (!isSyncWired() || !hasSession()) return false;
	const plaintext = serializeInventory({
		blobIds: buildBlobIds(session),
		latestCrdtIndex: session.latestIndex,
		nextAddr: session.nextAddr,
		version: session.version
	});
	const { nonce, ciphertext } = sealInventory(
		session.vaultKey,
		session.bootstrapAddr,
		plaintext
	);
	plaintext.fill(0);
	const result = await uploadV2Inventory({
		addr: encodeAddress(session.bootstrapAddr),
		nonce: bytesToBase64(nonce),
		ciphertext: bytesToBase64(ciphertext)
	});
	return result.ok;
}

/**
 * Record a freshly-uploaded whole-vault blob as the current one,
 * advance the save counter, and persist the inventory. Returns the
 * previous vault blob UUID (when different) so the caller can
 * best-effort delete the superseded object; the reference-counted GC
 * would reap it eventually regardless.
 */
export async function inventorySetVaultBlob(
	blobId: string
): Promise<{ ok: boolean; previousBlobId: string | null }> {
	if (!active) return { ok: false, previousBlobId: null };
	await ensureLoaded(active);
	const previousBlobId = active.vaultBlobId;
	active.vaultBlobId = blobId;
	active.latestIndex += 1n;
	active.version += 1n;
	const ok = await persist(active);
	return { ok, previousBlobId: previousBlobId === blobId ? null : previousBlobId };
}

/** Add a document blob UUID to the inventory and persist. */
export async function inventoryAddDocumentBlob(blobId: string): Promise<boolean> {
	if (!active) return false;
	await ensureLoaded(active);
	if (!active.docBlobIds.includes(blobId)) {
		active.docBlobIds.push(blobId);
		active.version += 1n;
	}
	return persist(active);
}

/** Remove a document blob UUID from the inventory and persist. */
export async function inventoryRemoveDocumentBlob(blobId: string): Promise<boolean> {
	if (!active) return false;
	await ensureLoaded(active);
	const before = active.docBlobIds.length;
	active.docBlobIds = active.docBlobIds.filter((id) => id !== blobId);
	if (active.docBlobIds.length !== before) active.version += 1n;
	return persist(active);
}

/**
 * Pull point: re-fetch the server inventory and adopt it as the
 * working copy. Returns the current whole-vault blob pointer when the
 * server's save counter is strictly higher than what this session last
 * held (i.e. a newer vault to promote); otherwise null. Called at
 * unlock and manual-sync, not on the hot mutate path.
 */
export async function inventoryPullVault(): Promise<{ blobId: string; index: bigint } | null> {
	if (!active || !isSyncWired() || !hasSession()) return null;
	const priorIndex = active.latestIndex;
	const outcome = await fetchInventory(active);
	if (outcome.kind === 'error') return null;
	if (outcome.kind === 'absent') {
		active.loaded = true;
		return null;
	}
	adopt(active, outcome.inv);
	if (active.vaultBlobId !== null && active.latestIndex > priorIndex) {
		return { blobId: active.vaultBlobId, index: active.latestIndex };
	}
	return null;
}
