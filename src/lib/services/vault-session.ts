/**
 * Vault session — orchestrates seal / open against Dexie + AES-GCM.
 *
 * Two on-disk formats coexist:
 *
 *   formatVersion 1 (Milestone 1):
 *     vaultKey = HKDF-SHA512(prfOutput ‖ secretKey [‖ mpk?], deviceSalt, "vuvault-vault-key-v1")
 *     blob     = AES-256-GCM(vaultKey, nonce, plaintext, aad=70 bytes)
 *     header   = empty
 *
 *   formatVersion 2 (Milestone 2):
 *     vaultKey = HKDF-SHA512(prfOutput ‖ secretKey [‖ mpk?] [‖ opaqueExp?],
 *                            deviceSalt, "vuvault-vault-key-v1")
 *     aesKey   = crypto.getRandomValues(32)
 *     wrapped  = wrapAesKey(vaultKey, deviceSalt, aesKey)  -> hybrid envelope
 *     blob     = AES-256-GCM(aesKey, nonce, plaintext, aad)
 *     header   = serializeWrappedKey(wrapped)              -> 1660 bytes
 *
 * The HKDF info string is intentionally `vuvault-vault-key-v1` for both
 * versions — see `src/lib/crypto/derive.ts`. The `formatVersion` byte is
 * bound in AAD instead, which keeps the v1→v2 in-place upgrade path
 * decryptable while still authenticating the format choice.
 *
 * The v2 AAD layout adds the SHA-384 of `header` so the wrapped key
 * cannot be swapped between accounts without breaking decrypt.
 *
 * Format dispatch happens at unlock time off `account.formatVersion`.
 * On the first `saveItems` call after a v1 unlock, we transparently
 * upgrade the on-disk blob to v2 (re-derive the v2 vaultKey from the
 * same factors, generate a fresh AES key, re-encrypt, and bump
 * `account.formatVersion` to 2 in the same atomic transaction).
 *
 * `prfOutput` comes from one of two sources, decided at provisioning
 * time and persisted as `account.authMode`:
 *
 *   production: WebAuthn PRF eval against the user's passkey (32 bytes
 *               returned by the authenticator). Cannot be reproduced
 *               without the original platform authenticator.
 *
 *   demo:       deterministic stand-in derived from the persisted
 *               credentialId + deviceSalt via HMAC-SHA512. Lets the
 *               scaffold demo run on browsers without WebAuthn PRF.
 *               Clearly weaker — security falls to the Secret Key alone
 *               + same-device assumption. Surfaced in UI as such.
 *
 * `vaultKey` and `aesKey` live in module-local closures (not in any
 * Svelte store) so they don't appear in reactive snapshots or DevTools
 * state inspectors. `lockSession()` zeroizes both.
 */

import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha384, sha512 } from '@noble/hashes/sha2';
import { deriveVaultKey, generateDeviceSalt, type DeriveVersion } from '$lib/crypto/derive';
import { evaluatePRF } from '$lib/crypto/webauthn-prf';
import { serializeItems, deserializeItems } from '$lib/crypto/vault-codec';
import { padPlaintext, unpadPlaintext } from '$lib/crypto/padding';
import {
	wrapAesKey,
	unwrapAesKey,
	serializeWrappedKey,
	deserializeWrappedKey
} from './vault-envelope';
import {
	getAccount,
	getVault,
	saveAccountAndVault,
	saveVault,
	saveExistingAccountAndVault,
	updateAccountSyncState,
	setAccountRestoreRoot,
	reserveRestorePointer,
	markRestorePointerWritten,
	type AccountRecord,
	type AuthMode,
	type RestorePointerCoord
} from '$lib/utils/storage';
import { isDemoAuthEnabled } from '$lib/utils/env';
import {
	openRecoveryEnvelope,
	sealRecoveryEnvelope,
	type RecoveryEnvelopeSealed,
	type RecoveryMaterial
} from '$lib/crypto/recovery-envelope';
import {
	restoreAddress,
	restoreDay,
	sealRestoreRecord,
	wrapRestoreRoot,
	unwrapRestoreRoot,
	RESTORE_POINTER_EVERY,
	RESTORE_MAX_WALK,
	type RestoreRecordPayload
} from '$lib/crypto/restore-record';
import {
	uploadV2Blob,
	fetchV2Blob,
	uploadV2Restore,
	deleteV2Restore,
	hasSession,
	isSyncWired,
	setSessionToken,
	opaqueLogout,
	prefetchAnonTokens
} from './sync-client';
import { newBlobId, deriveChainKey, encodeAddress } from './blob-inventory';
import {
	initInventorySession,
	clearInventorySession,
	inventoryRecordVaultBlob,
	inventoryPullNewer,
	inventoryLatestIndex
} from './inventory-session';
import type { VaultItem } from '$lib/stores/vault.svelte';

/** The format version we emit for newly-provisioned vaults. */
// Format version 3 introduces V0-C2 bucketed padding: every vault
// blob's plaintext is padded up to the next power-of-two ≥ 256 bytes
// (per `src/lib/crypto/padding.ts`) before AES-GCM seal. The original
// length is recovered from a 4-byte BE prefix inside the padded
// plaintext. The format version itself is in the AAD via `makeAad`,
// so a v2-formatted envelope opened with v3 padding logic fails at
// the AAD verification step — never at the unpad step.
export const PROVISION_FORMAT_VERSION = 3;
/** All format versions this build can decrypt. */
// Supported formats:
//   v1 — legacy vaultKey-direct AES-GCM (read-only; upgrade-on-save).
//   v2 — AES-key wrap under vaultKey + raw plaintext seal.
//   v3 — AES-key wrap + V0-C2 bucketed-padding seal (this build provisions v3).
export const SUPPORTED_FORMAT_VERSIONS = new Set([1, 2, 3]);

const PRF_OUTPUT_LEN = 32;
const SECRET_KEY_LEN = 32;
const DEVICE_SALT_LEN = 16;
const AES_NONCE_LEN = 12;
const AES_KEY_LEN = 32;

/**
 * V0-C2 fixed-size floor for whole-vault blobs. Every v3 vault pads to
 * at least this bucket, so every account whose vault fits under it
 * uploads byte-identical ciphertext sizes — the server learns nothing
 * from size until a vault outgrows the floor (then it grows by powers
 * of two). 64 KiB holds a few hundred typical items; raising it buys a
 * larger anonymity set at the cost of upload bytes on every save.
 * Opening needs no knowledge of the floor (`unpadPlaintext` accepts any
 * power-of-two bucket), so changing it never breaks stored vaults.
 */
export const VAULT_PAD_FLOOR_BYTES = 64 * 1024;

/**
 * Re-upload the vault as a fresh save on unlock once the last push is
 * older than this — half the server's 60-day reference-GC window — so
 * the server copy is never collected while the owner keeps using it.
 */
const STALE_PUSH_MS = 30 * 24 * 60 * 60 * 1000;

let vaultKey: Uint8Array | null = null;
let aesKey: Uint8Array | null = null; // v2 only; null for v1 sessions
let activeAuthMode: AuthMode | null = null;
let activeFormatVersion: number | null = null;
/**
 * New-device restore root (see `src/lib/crypto/restore-record.ts`).
 * Unwrapped from the account row with the data key at unlock; null when
 * the account never enabled server restore. Lives only in memory.
 */
let restoreRoot: Uint8Array | null = null;

/**
 * `BlobBytes` is the on-the-wire shape of a v2 vault upload. The
 * three components match `vault.header / .nonce / .ciphertext` from
 * `storage.ts`. Helpers to convert to/from the base64 wire format
 * the sync client expects.
 */
type BlobBytes = {
	header: Uint8Array;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
};

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
 * Sync observer — caller-provided callbacks invoked when sync
 * push/pull operations complete or fail. The vault store wires
 * these to `audit.push(...)` calls; tests leave them as no-ops.
 *
 * Decoupling is deliberate: vault-session has no direct dependency
 * on the audit store. That keeps `vault-session.test.ts`'s
 * fake-indexeddb harness from needing Svelte runes context.
 */
export type SyncObserver = {
	onPushSuccess?(info: { sequenceClock: number; bytes: number }): void;
	onPushFailure?(info: { reason: string; message: string }): void;
	onPullPromoted?(info: { sequenceClock: number }): void;
	onPullSkipped?(info: { reason: string }): void;
	onRestoreRecord?(info: { ok: boolean; message: string }): void;
};

export type SyncNowResult =
	| { status: 'not-wired'; message: string }
	| { status: 'no-session'; message: string }
	| { status: 'locked'; message: string }
	| { status: 'local-newer'; message: string }
	| { status: 'promoted'; message: string; sequenceClock: number; items: VaultItem[] }
	| { status: 'failed'; message: string };

let syncObserver: SyncObserver = {};

export function setSyncObserver(observer: SyncObserver): void {
	syncObserver = observer ?? {};
}

function blobBytesSize(blob: BlobBytes): number {
	return blob.header.length + blob.nonce.length + blob.ciphertext.length;
}

/**
 * Pack a whole-vault blob's `header` (the wrapped-key envelope) and
 * `ciphertext` into a single self-describing body for the v2 blob
 * route, which only models `{ nonce, ciphertext }`. Layout:
 *   u32BE headerLen ‖ header ‖ ciphertext
 * The AES nonce travels in the route's separate `nonce` field. The
 * inverse `unpackVaultBody` splits it back so the existing
 * open/decrypt path sees an unchanged `BlobBytes`.
 */
function packVaultBody(header: Uint8Array, ciphertext: Uint8Array): Uint8Array {
	const out = new Uint8Array(4 + header.length + ciphertext.length);
	new DataView(out.buffer).setUint32(0, header.length, false);
	out.set(header, 4);
	out.set(ciphertext, 4 + header.length);
	return out;
}

function unpackVaultBody(body: Uint8Array): { header: Uint8Array; ciphertext: Uint8Array } {
	if (body.length < 4) throw new Error('unpackVaultBody: truncated body');
	const headerLen = new DataView(
		body.buffer,
		body.byteOffset,
		body.byteLength
	).getUint32(0, false);
	if (4 + headerLen > body.length) {
		throw new Error('unpackVaultBody: header length out of range');
	}
	return {
		header: body.slice(4, 4 + headerLen),
		ciphertext: body.slice(4 + headerLen)
	};
}

/**
 * Push the just-saved blob to the sync server. Fire-and-forget at
 * the call site (caller does not await this); failures are logged
 * to the observer and never propagate.
 *
 * V1-C1/C3: the blob is written to a random `/api/v2/blobs/{uuid}`
 * with no account prefix, and the inventory for the next save index
 * records it (see inventory-session.ts). The superseded blob is NOT
 * deleted: a delete in the same session as the upload that replaces it
 * would link the two, so the server's reference GC ages it out instead.
 */
async function pushBlobToServer(
	blob: BlobBytes,
	opts: { forceRestoreRecord?: boolean } = {}
): Promise<void> {
	if (!isSyncWired() || !hasSession()) return;
	const blobId = newBlobId();
	const result = await uploadV2Blob({
		blobId,
		nonce: bytesToBase64(blob.nonce),
		ciphertext: bytesToBase64(packVaultBody(blob.header, blob.ciphertext))
	});
	if (!result.ok) {
		syncObserver.onPushFailure?.({ reason: result.reason, message: result.message });
		return;
	}
	const { ok, index } = await inventoryRecordVaultBlob(blobId);
	if (index > 0n) {
		// Persist the reserved index even on failure: the address may or
		// may not have been written, and it must never be written again.
		await updateAccountSyncState({
			inventoryIndex: Number(index),
			inventoryPushedAt: ok ? Date.now() : undefined
		}).catch(() => undefined);
	}
	if (!ok) {
		syncObserver.onPushFailure?.({ reason: 'server', message: 'inventory update failed' });
		return;
	}
	syncObserver.onPushSuccess?.({
		sequenceClock: Number(index),
		bytes: blobBytesSize(blob)
	});
	await writeRestoreRecord(index, blobId, opts.forceRestoreRecord === true).catch((err) => {
		syncObserver.onRestoreRecord?.({
			ok: false,
			message: err instanceof Error ? err.message : 'restore record crashed'
		});
	});
}

/**
 * Publish a sealed restore record alongside this push when one is due:
 * on the first push of each UTC day, every RESTORE_POINTER_EVERY saves
 * within a day (so a restoring device's forward walk stays short), when
 * the previous record failed to land, or when forced (rebind, root
 * install). Each record goes to a fresh (day, slot) address reserved
 * before the upload, so no address is ever written twice (V0-C1).
 *
 * Requires an OPAQUE identity on the account row: the restoring device
 * must be able to log in, and it learns the client id from the record.
 */
async function writeRestoreRecord(index: bigint, blobId: string, force: boolean): Promise<void> {
	if (!restoreRoot || !aesKey || !isSyncWired() || !hasSession()) return;
	const account = await getAccount();
	if (!account) return;
	if (
		account.opaqueState !== 'enrolled' ||
		!account.opaqueClientId ||
		!account.opaqueServerId ||
		!account.opaqueAccountId
	) {
		return;
	}
	const day = restoreDay();
	const last = account.restorePointerIndex;
	const due =
		force ||
		account.restorePointerDay !== day ||
		last === undefined ||
		index - BigInt(last) >= RESTORE_POINTER_EVERY;
	if (!due) return;
	const slot = account.restorePointerDay === day ? (account.restorePointerSlot ?? -1) + 1 : 0;
	await reserveRestorePointer({ day, slot });

	const addr = restoreAddress(restoreRoot, day, slot);
	const payload: RestoreRecordPayload = {
		formatVersion: account.formatVersion,
		authMode: account.authMode,
		deviceSalt: account.deviceSalt.slice(),
		credentialId: new Uint8Array(account.credentialId).slice(),
		aesKey: aesKey.slice(),
		accountSeed: account.accountSeed ? account.accountSeed.slice() : null,
		inventoryIndex: index,
		vaultBlobId: blobId,
		writtenAt: Date.now(),
		opaqueClientId: account.opaqueClientId,
		opaqueServerId: account.opaqueServerId,
		opaqueAccountId: account.opaqueAccountId,
		deviceLabel: account.deviceLabel
	};
	let sealed: { nonce: Uint8Array; ciphertext: Uint8Array };
	try {
		sealed = sealRestoreRecord(restoreRoot, addr, payload);
	} finally {
		payload.aesKey.fill(0);
		payload.accountSeed?.fill(0);
	}
	const result = await uploadV2Restore({
		addr: encodeAddress(addr),
		nonce: bytesToBase64(sealed.nonce),
		ciphertext: bytesToBase64(sealed.ciphertext)
	});
	if (result.ok) {
		await markRestorePointerWritten(Number(index)).catch(() => undefined);
		syncObserver.onRestoreRecord?.({ ok: true, message: 'Restore record published.' });
	} else {
		syncObserver.onRestoreRecord?.({ ok: false, message: result.message });
	}
}

/**
 * Best-effort deletion of the records this device wrote under `root`.
 * Used when the root rotates (new Recovery Password) or restore is
 * disabled, so the superseded records stop being openable with the old
 * password before the server GC would reap them.
 */
async function purgeRestoreRecords(root: Uint8Array, coords: RestorePointerCoord[]): Promise<void> {
	if (!isSyncWired() || !hasSession()) return;
	for (const c of coords) {
		const addr = restoreAddress(root, c.day, c.slot);
		await deleteV2Restore(encodeAddress(addr)).catch(() => undefined);
	}
}

/**
 * Re-upload the current vault as a fresh save and force a restore
 * record with it. A no-op when sync is unwired or there is no session —
 * the next ordinary push then carries the record instead.
 */
export async function publishRestoreRecord(): Promise<void> {
	if (!isSyncWired() || !hasSession()) return;
	const row = await getVault();
	if (!row) return;
	await pushBlobToServer(
		{ header: row.header, nonce: row.nonce, ciphertext: row.ciphertext },
		{ forceRestoreRecord: true }
	);
}

/**
 * Enable (or re-affirm / rotate) new-device restore for the unlocked
 * vault. `root` comes from `deriveRecoveryMaterial` — the caller has
 * just stretched the Recovery Password. The root is persisted wrapped
 * under the data key and kept in memory for this session; a record is
 * published immediately so a restore works from this moment on.
 *
 * Returns what happened: a first install, an identical re-install
 * (same password — the existing records stay valid), or a rotation
 * (new password — this device's old records are deleted first).
 */
export async function installRestoreRoot(
	root: Uint8Array
): Promise<'installed' | 'unchanged' | 'rotated'> {
	if (!aesKey) {
		throw new Error('installRestoreRoot: vault must be unlocked first');
	}
	const account = await getAccount();
	if (!account) throw new Error('installRestoreRoot: account row missing');
	let outcome: 'installed' | 'unchanged' | 'rotated' = 'installed';
	if (restoreRoot) {
		if (constantTimeEqual(restoreRoot, root)) {
			outcome = 'unchanged';
		} else {
			await purgeRestoreRecords(restoreRoot, account.restorePointers ?? []);
			await setAccountRestoreRoot(null);
			outcome = 'rotated';
		}
	}
	await setAccountRestoreRoot(wrapRestoreRoot(aesKey, root));
	zeroize(restoreRoot);
	restoreRoot = root.slice();
	await publishRestoreRecord();
	return outcome;
}

/** Delete this device's records (best effort), then forget the root. */
export async function disableServerRestore(): Promise<void> {
	const account = await getAccount();
	if (restoreRoot && account) {
		await purgeRestoreRecords(restoreRoot, account.restorePointers ?? []);
	}
	await setAccountRestoreRoot(null);
	zeroize(restoreRoot);
	restoreRoot = null;
}

/** Whether this session holds a restore root (i.e. records get published). */
export function hasRestoreRootInMemory(): boolean {
	return restoreRoot !== null;
}

/**
 * Start (or restart) the inventory address chain for the active vault.
 * The chain derives from the DATA key + device salt (not the
 * passkey-bound wrapping key) — see `deriveChainKey` — so auth
 * rotations keep the chain and a restoring device can re-derive it from
 * the restore record. Must be re-called whenever either input changes.
 */
function startInventoryChain(dataKey: Uint8Array, deviceSalt: Uint8Array, latestIndex = 0n): void {
	const chainKey = deriveChainKey(dataKey, deviceSalt);
	initInventorySession(chainKey, deviceSalt, latestIndex);
	zeroize(chainKey); // initInventorySession keeps its own copy
}

function adoptRestoreRootFromAccount(account: AccountRecord, dataKey: Uint8Array): void {
	zeroize(restoreRoot);
	restoreRoot = null;
	if (!account.restoreRootNonce || !account.restoreRootCiphertext) return;
	try {
		restoreRoot = unwrapRestoreRoot(dataKey, account.restoreRootNonce, account.restoreRootCiphertext);
	} catch {
		// A root that does not open under this data key is stale (should
		// not happen — the data key never rotates); leave restore off
		// until the user re-enters the Recovery Password.
		restoreRoot = null;
	}
}

/**
 * Pull the latest blob from the server and, if its sequence clock
 * exceeds our local one, return it for the caller to decrypt and
 * promote. Returns `null` when there's no remote progress to
 * adopt — the local copy stays authoritative.
 */
async function pullBlobFromServer(): Promise<BlobBytes | null> {
	if (!isSyncWired() || !hasSession()) {
		syncObserver.onPullSkipped?.({ reason: 'not-wired' });
		return null;
	}
	// Probe forward from this device's save index for inventories it has
	// not seen. Returns null when the server has no newer save than the
	// local copy (the save index plays the role the per-account sequence
	// clock used to).
	const pointer = await inventoryPullNewer();
	if (!pointer) {
		syncObserver.onPullSkipped?.({ reason: 'local-newer' });
		return null;
	}
	const result = await fetchV2Blob(pointer.blobId);
	if (!result.ok) {
		// 404 (blob GC'd or never landed) is the common "nothing to
		// promote" path — treat as skipped, not error.
		syncObserver.onPullSkipped?.({ reason: result.reason });
		return null;
	}
	let body: { header: Uint8Array; ciphertext: Uint8Array };
	try {
		body = unpackVaultBody(base64ToBytes(result.value.ciphertext));
	} catch {
		syncObserver.onPullSkipped?.({ reason: 'malformed-blob' });
		return null;
	}
	await updateAccountSyncState({ inventoryIndex: Number(pointer.index) }).catch(
		() => undefined
	);
	syncObserver.onPullPromoted?.({ sequenceClock: Number(pointer.index) });
	return {
		header: body.header,
		nonce: base64ToBytes(result.value.nonce),
		ciphertext: body.ciphertext
	};
}

/**
 * Decrypt a pulled remote whole-vault blob with the active vaultKey,
 * persist it locally as the authoritative vault, and swap the in-memory
 * DEK to the one wrapped in the remote header. The pull paths guarantee
 * the remote is strictly newer than what this session holds, so adopting
 * it is the correct last-writer-wins resolution.
 *
 * The remote blob carries its OWN wrapped-key header; we unwrap it with
 * our vaultKey rather than assuming the remote was sealed under our
 * current DEK. After a successful open we point `aesKey` at the remote's
 * DEK and zeroize the previous one, so the next `saveItems` re-seals
 * against the header we just persisted — never a stale key that would
 * brick the round-trip.
 *
 * Throws if the remote cannot be opened with our keys (a blob from a
 * different account, or a tampered AAD); callers treat that as "keep
 * local" and never destroy the local copy.
 */
async function promoteRemoteBlob(
	account: AccountRecord,
	remote: BlobBytes
): Promise<VaultItem[]> {
	if (!vaultKey) throw new Error('promoteRemoteBlob: no active vault key');
	const remoteAad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		remote.header
	);
	const remoteWrapped = deserializeWrappedKey(remote.header);
	const remoteAesKey = unwrapAesKey(vaultKey, account.deviceSalt, remoteWrapped);
	try {
		const remotePlaintext = openBlob(
			remoteAesKey,
			remote.nonce,
			remote.ciphertext,
			remoteAad,
			account.formatVersion
		);
		const remoteItems = deserializeItems(remotePlaintext);
		await saveVault({
			header: remote.header,
			nonce: remote.nonce,
			ciphertext: remote.ciphertext,
			updatedAt: Date.now()
		});
		const previousAesKey = aesKey;
		aesKey = remoteAesKey;
		if (previousAesKey && previousAesKey !== remoteAesKey) zeroize(previousAesKey);
		return remoteItems;
	} catch (err) {
		zeroize(remoteAesKey);
		throw err;
	}
}

export async function syncNow(): Promise<SyncNowResult> {
	if (!isSyncWired()) {
		return { status: 'not-wired', message: 'Sync server not configured.' };
	}
	if (!hasSession()) {
		return { status: 'no-session', message: 'No active sync session. Unlock with OPAQUE to sync.' };
	}
	if (!vaultKey || !aesKey) {
		return { status: 'locked', message: 'Vault must be unlocked before syncing.' };
	}
	const account = await getAccount();
	if (!account) return { status: 'failed', message: 'Account row missing.' };
	if (account.formatVersion < 2) {
		return {
			status: 'failed',
			message: 'Sync requires a v2 or newer vault. Save once to upgrade.'
		};
	}
	try {
		// PULL BEFORE PUSH. The previous order pushed the local vault
		// first, which let a stale device overwrite — and then DELETE
		// (via the superseded-blob cleanup) — a newer vault another
		// device had pushed. Reconcile first: if the server is strictly
		// ahead, adopt and promote its vault instead of clobbering it.
		// Only when we are at-or-ahead of the server do we push, so a
		// push can never destroy newer remote data. (Pushes never
		// delete now either — superseded objects age out server-side.)
		const remote = await pullBlobFromServer();
		if (remote) {
			const remoteItems = await promoteRemoteBlob(account, remote);
			return {
				status: 'promoted',
				message: 'Pulled newer vault from sync server.',
				sequenceClock: Number(inventoryLatestIndex()),
				items: remoteItems
			};
		}

		// No newer remote → we are at-or-ahead. Safe to push the local
		// vault (covers a prior save whose fire-and-forget push failed).
		const localVault = await getVault();
		if (localVault) {
			await pushBlobToServer({
				header: localVault.header,
				nonce: localVault.nonce,
				ciphertext: localVault.ciphertext
			});
		}
		return { status: 'local-newer', message: 'Local vault is up to date with the sync server.' };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed.';
		syncObserver.onPullSkipped?.({ reason: 'sync-now-failed' });
		return { status: 'failed', message };
	}
}

function zeroize(buf: Uint8Array | null): void {
	if (buf) buf.fill(0);
}

/**
 * Constant-time byte-equality. Returns true only when both arrays
 * have the same length AND every corresponding byte is equal. Runs
 * in time proportional to the longer input regardless of mismatch
 * position so it cannot be used as a timing oracle on either
 * length or first-mismatch.
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let acc = 0;
	for (let i = 0; i < a.length; i++) {
		acc |= a[i]! ^ b[i]!;
	}
	return acc === 0;
}

/**
 * Thrown by `rotateAuth` when the caller supplies a
 * `currentMasterPasswordKey` whose derived vault key does NOT match
 * the active in-memory vault key. UI code should catch this
 * specifically and surface a "current password incorrect" message
 * distinct from a generic rotation failure.
 *
 * The check is constant-time over the derived key, so no length /
 * first-mismatch timing oracle leaks.
 */
export class CurrentMasterPasswordIncorrect extends Error {
	constructor(message = 'Current master password is incorrect.') {
		super(message);
		this.name = 'CurrentMasterPasswordIncorrect';
	}
}

const AAD_DOMAIN = new TextEncoder().encode('vuvault-vault-aad-v1');
const AUTH_MODE_TAG: Record<AuthMode, number> = {
	production: 0x01,
	demo: 0x02
};

/**
 * Build associated-data bytes that MUST be present at both seal and
 * open time. v1 binds:
 *   domain ‖ versionByte ‖ authModeByte ‖ deviceSalt(16) ‖ SHA-384(credentialId)[0..32]
 *
 * v2 additionally appends SHA-384(header)[0..32] so the wrapped AES
 * key cannot be silently swapped between accounts.
 */
function makeAad(
	formatVersion: number,
	authMode: AuthMode,
	deviceSalt: Uint8Array,
	credentialId: ArrayBuffer,
	header: Uint8Array
): Uint8Array {
	const credBytes = new Uint8Array(credentialId);
	const credDigest = sha384(credBytes).slice(0, 32);
	const v2HeaderDigest = formatVersion >= 2 ? sha384(header).slice(0, 32) : null;

	const len =
		AAD_DOMAIN.length +
		1 +
		1 +
		deviceSalt.length +
		credDigest.length +
		(v2HeaderDigest ? v2HeaderDigest.length : 0);
	const out = new Uint8Array(len);
	let off = 0;
	out.set(AAD_DOMAIN, off);
	off += AAD_DOMAIN.length;
	out[off++] = formatVersion & 0xff;
	out[off++] = AUTH_MODE_TAG[authMode];
	out.set(deviceSalt, off);
	off += deviceSalt.length;
	out.set(credDigest, off);
	off += credDigest.length;
	if (v2HeaderDigest) {
		out.set(v2HeaderDigest, off);
	}
	return out;
}

function sealBlob(
	key: Uint8Array,
	plaintext: Uint8Array,
	aad: Uint8Array,
	formatVersion: number
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN));
	// V0-C2 padding. Format-version v3+ pads the plaintext to the next
	// power of two ≥ VAULT_PAD_FLOOR_BYTES before sealing, so vaults
	// under the floor are all the same size on the wire. Older formats
	// (v1/v2) seal raw plaintext for backward compat.
	const payload =
		formatVersion >= 3
			? padPlaintext(plaintext, { minBucket: VAULT_PAD_FLOOR_BYTES })
			: plaintext;
	const ciphertext = gcm(key, nonce, aad).encrypt(payload);
	if (payload !== plaintext) {
		// padPlaintext returned a fresh buffer; zeroize it before
		// dropping the reference so the padded form does not linger
		// in memory.
		payload.fill(0);
	}
	return { nonce, ciphertext };
}

function openBlob(
	key: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array,
	aad: Uint8Array,
	formatVersion: number
): Uint8Array {
	const decrypted = gcm(key, nonce, aad).decrypt(ciphertext);
	if (formatVersion < 3) return decrypted;
	// V0-C2 padding inversion: recover the original plaintext from
	// the padded buffer. unpadPlaintext returns an INDEPENDENTLY
	// OWNED copy, so we can zeroize the padded buffer before
	// returning.
	try {
		const out = unpadPlaintext(decrypted);
		decrypted.fill(0);
		return out;
	} catch (err) {
		decrypted.fill(0);
		throw err;
	}
}

/**
 * Derive a stable per-account "demo PRF" stand-in from data already
 * on this device. NOT zero-knowledge — present for scaffold demos
 * only. Clearly tagged via account.authMode = 'demo'.
 */
function deriveDemoPrfOutput(
	credentialId: ArrayBuffer,
	deviceSalt: Uint8Array
): Uint8Array {
	const credBytes = new Uint8Array(credentialId);
	return hmac(sha512, deviceSalt, credBytes).slice(0, PRF_OUTPUT_LEN);
}

/**
 * Resolve the PRF output for the current account at unlock time.
 * Production: real WebAuthn PRF (fail-closed if unavailable).
 * Demo: deterministic re-derivation.
 */
async function resolvePrfOutput(account: AccountRecord): Promise<Uint8Array> {
	if (account.authMode === 'demo') {
		return deriveDemoPrfOutput(account.credentialId, account.deviceSalt);
	}
	const out = await evaluatePRF({
		credentialId: account.credentialId,
		salt: account.deviceSalt
	});
	if (!out) {
		throw new Error(
			'Authenticator did not return a PRF output. ' +
				'Use the same device that registered this vault, or recover via your Emergency Kit.'
		);
	}
	if (out.length !== PRF_OUTPUT_LEN) {
		throw new Error(`PRF output has unexpected length ${out.length}`);
	}
	return out;
}

export type ProvisionInput = {
	deviceLabel: string;
	secretKey: Uint8Array;
	credentialId: ArrayBuffer;
	credentialPublicKey: ArrayBuffer;
	authMode: AuthMode;
	prfOutput: Uint8Array | null; // ignored when authMode = 'demo'
	deviceSalt: Uint8Array; // shared between PRF eval and HKDF
	plan?: 'free' | 'paid';
	/**
	 * Optional OPAQUE export key from a successful registration. When
	 * present, the v2 vaultKey is derived with this third factor; the
	 * caller is responsible for re-running OPAQUE login on every
	 * unlock to re-derive the same export key.
	 */
	opaqueExportKey?: Uint8Array;
	/**
	 * Optional Argon2id-derived master-password key (32 bytes). When
	 * present, the v2 vaultKey includes this in the HKDF IKM and the
	 * persisted account row records `masterPasswordEnabled = true`.
	 */
	masterPasswordKey?: Uint8Array;
};

export type ProvisionResult = {
	deviceSalt: Uint8Array;
	accountCreatedAt: number;
	formatVersion: number;
};

export { generateDeviceSalt };

/**
 * Provision a fresh vault. Always emits format v2: derives the v2
 * vaultKey, generates a fresh AES key, wraps it under the hybrid
 * envelope, AES-GCM-encrypts an empty items array, and persists
 * account + vault rows atomically.
 */
export async function provisionVault(opts: ProvisionInput): Promise<ProvisionResult> {
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`Secret Key must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}
	if (opts.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(`Device salt must be ${DEVICE_SALT_LEN} bytes`);
	}
	if (opts.authMode === 'demo' && !isDemoAuthEnabled()) {
		throw new Error(
			'Demo auth mode is disabled in this build. Re-register on a device with WebAuthn PRF support.'
		);
	}

	let prf: Uint8Array;
	if (opts.authMode === 'demo') {
		prf = deriveDemoPrfOutput(opts.credentialId, opts.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			throw new Error(
				`Production provisioning requires a real ${PRF_OUTPUT_LEN}-byte PRF output`
			);
		}
		prf = opts.prfOutput;
	}

	const newVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: opts.deviceSalt,
		masterPasswordKey: opts.masterPasswordKey,
		opaqueExportKey: opts.opaqueExportKey,
		version: PROVISION_FORMAT_VERSION
	});

	const newAesKey = crypto.getRandomValues(new Uint8Array(AES_KEY_LEN));
	let header: Uint8Array;
	let nonce: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		const wrapped = wrapAesKey(newVaultKey, opts.deviceSalt, newAesKey);
		header = serializeWrappedKey(wrapped);
		const plaintext = serializeItems([]);
		const aad = makeAad(
			PROVISION_FORMAT_VERSION,
			opts.authMode,
			opts.deviceSalt,
			opts.credentialId,
			header
		);
		const sealed = sealBlob(newAesKey, plaintext, aad, PROVISION_FORMAT_VERSION);
		nonce = sealed.nonce;
		ciphertext = sealed.ciphertext;
	} catch (err) {
		// Always zero the key material we derived if the seal pipeline
		// blows up part-way through.
		zeroize(newVaultKey);
		zeroize(newAesKey);
		zeroize(prf);
		throw err;
	}

	// V0-C1 / §L09cap groundwork: mint a fresh 32-byte accountSeed
	// at vault provisioning. Persists as part of the account row;
	// the Recovery Envelope path naturally restores it because the
	// vault AES key opens the encrypted vault, which contains the
	// account row.
	const accountSeed = crypto.getRandomValues(new Uint8Array(32));

	const now = Date.now();
	try {
		await saveAccountAndVault(
			{
				deviceLabel: opts.deviceLabel,
				deviceSalt: opts.deviceSalt,
				credentialId: opts.credentialId,
				credentialPublicKey: opts.credentialPublicKey,
				authMode: opts.authMode,
				formatVersion: PROVISION_FORMAT_VERSION,
				createdAt: now,
				plan: opts.plan ?? 'free',
				accountSeed
			},
			{ header, nonce, ciphertext, updatedAt: now }
		);
	} catch (err) {
		zeroize(newVaultKey);
		zeroize(newAesKey);
		zeroize(prf);
		zeroize(accountSeed);
		throw err;
	}

	if (opts.authMode === 'demo') {
		zeroize(prf);
	}

	vaultKey = newVaultKey;
	aesKey = newAesKey;
	activeAuthMode = opts.authMode;
	activeFormatVersion = PROVISION_FORMAT_VERSION;
	zeroize(restoreRoot);
	restoreRoot = null;
	startInventoryChain(newAesKey, opts.deviceSalt);
	return {
		deviceSalt: opts.deviceSalt,
		accountCreatedAt: now,
		formatVersion: PROVISION_FORMAT_VERSION
	};
}

export type OpenInput = {
	secretKey: Uint8Array;
	/**
	 * Optional already-evaluated PRF output. Used by trusted-device quick
	 * unlock so a single Touch ID ceremony can both unseal the cached
	 * Secret Key and open the vault.
	 */
	prfOutput?: Uint8Array;
	/**
	 * Optional OPAQUE export key. Required when re-opening a v2 vault
	 * that was provisioned with one. Callers without an OPAQUE export
	 * key for an OPAQUE-enrolled account will get an authenticated
	 * decrypt failure.
	 */
	opaqueExportKey?: Uint8Array;
	/**
	 * Optional Argon2id-derived master-password key. Required when
	 * `account.masterPasswordEnabled === true`. Same fail-closed
	 * behavior as `opaqueExportKey` — wrong / missing key yields an
	 * AES-GCM authentication failure, never a misleading silent
	 * success.
	 */
	masterPasswordKey?: Uint8Array;
};

export type RecoveryOpenInput = {
	secretKey: Uint8Array;
	recoveryPassword: string;
	envelope: RecoveryEnvelopeSealed;
};

export type RecoveryRebindInput = {
	secretKey: Uint8Array;
	credentialId: ArrayBuffer;
	credentialPublicKey: ArrayBuffer;
	authMode: AuthMode;
	prfOutput: Uint8Array | null;
	deviceSalt: Uint8Array;
};

/**
 * Open the persisted vault. Dispatches on `account.formatVersion`:
 *
 *   v1 → derive v1 vaultKey, decrypt blob with AES-GCM(vaultKey).
 *   v2 → derive v2 vaultKey, unwrap header → aesKey, decrypt blob.
 */
export async function openVault(opts: OpenInput): Promise<VaultItem[]> {
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`Secret Key must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}

	const account = await getAccount();
	if (!account) throw new Error('No account found');
	if (!SUPPORTED_FORMAT_VERSIONS.has(account.formatVersion)) {
		throw new Error(
			`Unsupported vault formatVersion ${account.formatVersion}. ` +
				'Update the app or reinstall to the version that wrote this vault.'
		);
	}
	const vaultRow = await getVault();
	if (!vaultRow) throw new Error('No vault found');

	const prfOutput = opts.prfOutput ?? (await resolvePrfOutput(account));
	if (prfOutput.length !== PRF_OUTPUT_LEN) {
		throw new Error(`PRF output has unexpected length ${prfOutput.length}`);
	}

	const v = account.formatVersion as DeriveVersion;
	if (account.masterPasswordEnabled && !opts.masterPasswordKey) {
		if (!opts.prfOutput) zeroize(prfOutput);
		throw new Error(
			'This vault has a master password — provide it before unlocking.'
		);
	}
	const newVaultKey = deriveVaultKey({
		prfOutput,
		secretKey: opts.secretKey,
		deviceSalt: account.deviceSalt,
		masterPasswordKey: opts.masterPasswordKey,
		opaqueExportKey: v >= 2 ? opts.opaqueExportKey : undefined,
		version: v
	});

	const aad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		vaultRow.header
	);

	let plaintext: Uint8Array;
	let newAesKey: Uint8Array | null = null;
	try {
		if (v === 1) {
			plaintext = openBlob(newVaultKey, vaultRow.nonce, vaultRow.ciphertext, aad, 1);
		} else {
			const wrapped = deserializeWrappedKey(vaultRow.header);
			newAesKey = unwrapAesKey(newVaultKey, account.deviceSalt, wrapped);
			plaintext = openBlob(newAesKey, vaultRow.nonce, vaultRow.ciphertext, aad, v);
		}
	} catch (err) {
		zeroize(newVaultKey);
		if (newAesKey) zeroize(newAesKey);
		if (!opts.prfOutput) zeroize(prfOutput);
		throw new Error(
			'Vault decryption failed. Check your Secret Key and that you are on the registered device.',
			{ cause: err }
		);
	}

	if (!opts.prfOutput) zeroize(prfOutput);
	vaultKey = newVaultKey;
	aesKey = newAesKey;
	activeAuthMode = account.authMode;
	activeFormatVersion = account.formatVersion;
	if (newAesKey) {
		startInventoryChain(newAesKey, account.deviceSalt, BigInt(account.inventoryIndex ?? 0));
		adoptRestoreRootFromAccount(account, newAesKey);
	} else {
		// v1: no data key yet; the chain starts on the upgrade-on-save.
		clearInventorySession();
		zeroize(restoreRoot);
		restoreRoot = null;
	}

	// Unlock never READS the sync server. The inventory address chain is
	// bound to this device's (dataKey, deviceSalt), so the only writer is
	// this device and the local vault is already the newest copy. A read
	// would only hand a logging server a link between this session and
	// the one that wrote the object (V0-C1) — and the old unlock-pull
	// compared against an in-memory index that restarted at 0 every
	// unlock, so after a save whose push had failed it could overwrite
	// the newer local vault with the older server copy. Manual "Sync now"
	// still pulls.
	//
	// Instead, keep the server copy from ageing out: the reference GC
	// collects objects not written for 60 days, so once the last push is
	// STALE_PUSH_MS old, re-upload the vault as a fresh save (new UUID,
	// new inventory address — write-only, nothing ties it to the
	// previous push).
	const items = deserializeItems(plaintext);
	if (v >= 2 && isSyncWired() && hasSession()) {
		// Mint the anonymous-token pool now, so the first save spends
		// tokens issued earlier rather than issuing and spending them
		// back-to-back.
		prefetchAnonTokens();
		const pushedAt = account.inventoryPushedAt ?? 0;
		if (Date.now() - pushedAt > STALE_PUSH_MS) {
			void pushBlobToServer({
				header: vaultRow.header,
				nonce: vaultRow.nonce,
				ciphertext: vaultRow.ciphertext
			}).catch(() => undefined);
		}
	}

	return items;
}

export async function sealActiveRecoveryEnvelope(opts: {
	secretKey: Uint8Array;
	recoveryPassword: string;
	material?: RecoveryMaterial;
}): Promise<RecoveryEnvelopeSealed> {
	if (!aesKey) {
		throw new Error('sealActiveRecoveryEnvelope: vault must be unlocked first');
	}
	const account = await getAccount();
	if (!account) throw new Error('sealActiveRecoveryEnvelope: account row missing');
	return sealRecoveryEnvelope({
		aesKey,
		secretKey: opts.secretKey,
		recoveryPassword: opts.recoveryPassword,
		material: opts.material,
		context: {
			deviceSalt: account.deviceSalt,
			credentialId: account.credentialId,
			authMode: account.authMode
		}
	});
}

export async function openVaultWithRecoveryEnvelope(
	opts: RecoveryOpenInput
): Promise<VaultItem[]> {
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`Secret Key must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}
	const account = await getAccount();
	if (!account) throw new Error('No account found');
	// Recovery Envelope is supported for v2 and v3 vault formats. A
	// v1 vault has no AES-key wrap (it used the raw vaultKey for
	// AES-GCM) and therefore can never be recovered with this path.
	if (account.formatVersion < 2) {
		throw new Error('Recovery Envelope requires a formatVersion ≥ 2 vault.');
	}
	const vaultRow = await getVault();
	if (!vaultRow) throw new Error('No vault found');

	const recoveredAesKey = await openRecoveryEnvelope({
		envelope: opts.envelope,
		secretKey: opts.secretKey,
		recoveryPassword: opts.recoveryPassword,
		context: {
			deviceSalt: account.deviceSalt,
			credentialId: account.credentialId,
			authMode: account.authMode
		}
	});

	const aad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		vaultRow.header
	);
	try {
		const plaintext = openBlob(
			recoveredAesKey,
			vaultRow.nonce,
			vaultRow.ciphertext,
			aad,
			account.formatVersion
		);
		const items = deserializeItems(plaintext);
		zeroize(vaultKey);
		zeroize(aesKey);
		vaultKey = null;
		aesKey = recoveredAesKey;
		activeAuthMode = account.authMode;
		activeFormatVersion = account.formatVersion;
		// The chain and the restore root both hang off the data key, which
		// the envelope just recovered — so both are available in the
		// recovery-open window. rebindRecoveredVault restarts the chain on
		// the new device salt.
		startInventoryChain(recoveredAesKey, account.deviceSalt, BigInt(account.inventoryIndex ?? 0));
		adoptRestoreRootFromAccount(account, recoveredAesKey);
		return items;
	} catch (err) {
		zeroize(recoveredAesKey);
		throw new Error('Recovery Envelope opened, but vault decryption failed.', {
			cause: err
		});
	}
}

export async function rebindRecoveredVault(opts: RecoveryRebindInput): Promise<void> {
	if (!aesKey) {
		throw new Error('rebindRecoveredVault: recovery session must be open first');
	}
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(`rebindRecoveredVault: secretKey must be ${SECRET_KEY_LEN} bytes`);
	}
	if (opts.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(`rebindRecoveredVault: deviceSalt must be ${DEVICE_SALT_LEN} bytes`);
	}
	const previousAccount = await getAccount();
	if (!previousAccount) throw new Error('rebindRecoveredVault: account row missing');
	const vaultRow = await getVault();
	if (!vaultRow) throw new Error('rebindRecoveredVault: vault row missing');
	const oldAesKey = aesKey;

	let prf: Uint8Array;
	if (opts.authMode === 'demo') {
		prf = deriveDemoPrfOutput(opts.credentialId, opts.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			throw new Error('rebindRecoveredVault: production rebind requires PRF output');
		}
		prf = opts.prfOutput;
	}

	const nextVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: opts.deviceSalt,
		version: PROVISION_FORMAT_VERSION
	});
	const wrapped = wrapAesKey(nextVaultKey, opts.deviceSalt, oldAesKey);
	const header = serializeWrappedKey(wrapped);
	const aad = makeAad(
		PROVISION_FORMAT_VERSION,
		opts.authMode,
		opts.deviceSalt,
		opts.credentialId,
		header
	);
	const plaintext = openBlob(
		oldAesKey,
		vaultRow.nonce,
		vaultRow.ciphertext,
		makeAad(
			previousAccount.formatVersion,
			previousAccount.authMode,
			previousAccount.deviceSalt,
			previousAccount.credentialId,
			vaultRow.header
		),
		previousAccount.formatVersion
	);
	const sealed = sealBlob(oldAesKey, plaintext, aad, PROVISION_FORMAT_VERSION);
	const now = Date.now();
	const nextAccount: Omit<AccountRecord, 'id'> = {
		deviceLabel: previousAccount.deviceLabel,
		deviceSalt: opts.deviceSalt,
		credentialId: opts.credentialId,
		credentialPublicKey: opts.credentialPublicKey,
		authMode: opts.authMode,
		formatVersion: PROVISION_FORMAT_VERSION,
		createdAt: previousAccount.createdAt,
		plan: previousAccount.plan,
		masterPasswordEnabled: false,
		opaqueState: 'none',
		// Vu0 / §L09cap: preserve the long-term accountSeed across
		// the recovery-rebind. The Recovery Envelope path opens the
		// vault under the OLD aesKey, re-seals under the NEW vaultKey,
		// but the accountSeed itself is an account-row field; we
		// carry it forward verbatim.
		accountSeed: previousAccount.accountSeed,
		// The restore root is wrapped under the data key, which the rebind
		// keeps, so it stays valid. The day/slot reservation carries over
		// so the forced record below takes the next free slot rather than
		// rewriting today's address.
		restoreRootNonce: previousAccount.restoreRootNonce,
		restoreRootCiphertext: previousAccount.restoreRootCiphertext,
		restorePointerDay: previousAccount.restorePointerDay,
		restorePointerSlot: previousAccount.restorePointerSlot,
		restorePointers: previousAccount.restorePointers
	};

	// Recovery rebind legitimately replaces the existing account row
	// (new passkey/device bound to the recovered vault), so it opts into
	// overwriting — unlike the fresh-provision path.
	await saveAccountAndVault(
		nextAccount,
		{
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt: now
		},
		{ allowOverwrite: true }
	);

	// The rebind changes the device salt, which starts a new inventory
	// address chain at index 0. Re-init the chain on the kept data key and
	// push the re-sealed whole-vault blob as the first save of that chain,
	// forcing a restore record so a later restore finds THIS chain and
	// the new AAD inputs. Best-effort and a no-op when sync is unwired or
	// there is no session.
	zeroize(vaultKey);
	vaultKey = nextVaultKey;
	aesKey = oldAesKey;
	activeAuthMode = opts.authMode;
	activeFormatVersion = PROVISION_FORMAT_VERSION;
	startInventoryChain(oldAesKey, opts.deviceSalt);
	await pushBlobToServer(
		{ header, nonce: sealed.nonce, ciphertext: sealed.ciphertext },
		{ forceRestoreRecord: true }
	);
	if (opts.authMode === 'demo') zeroize(prf);
}

/**
 * Re-seal the items list and persist it. Called by the vault store
 * after every mutation (debounced). Transparent v1 → v2 upgrade
 * happens here on the first save after a v1 unlock.
 */
export async function saveItems(items: VaultItem[]): Promise<void> {
	if (!vaultKey) {
		throw new Error('saveItems: no active vault session');
	}
	const account = await getAccount();
	if (!account) throw new Error('saveItems: account row missing');

	const targetVersion = PROVISION_FORMAT_VERSION; // upgrade-on-write to the current format
	const upgrading = account.formatVersion !== targetVersion;
	const plaintext = serializeItems(items);

	// Choose the AES data key. The KEY must change ONLY when the vault
	// has no wrapped data key yet — i.e. the very first save after a v1
	// unlock, or a freshly-opened recovery session (`aesKey === null`).
	//
	// A v2→v3 upgrade is padding-ONLY (same vaultKey derivation, same
	// data key, the blob layer just adds bucketed padding). Minting a
	// fresh AES key on that upgrade would silently orphan the Recovery
	// Envelope — it wraps this same `aesKey` and is NOT re-sealed here —
	// permanently bricking it on the first item edit after the build
	// update. So reuse the existing key across the upgrade and re-wrap it
	// under the (already derived) vaultKey below.
	let activeAesKey = aesKey;
	const mintedDataKey = !activeAesKey;
	if (!activeAesKey) {
		activeAesKey = crypto.getRandomValues(new Uint8Array(AES_KEY_LEN));
	}
	const wrapped = wrapAesKey(vaultKey, account.deviceSalt, activeAesKey);
	const header = serializeWrappedKey(wrapped);
	const aad = makeAad(
		targetVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		header
	);
	const sealed = sealBlob(activeAesKey, plaintext, aad, PROVISION_FORMAT_VERSION);
	zeroize(plaintext);
	const writtenBlob: BlobBytes = {
		header,
		nonce: sealed.nonce,
		ciphertext: sealed.ciphertext
	};
	// V0-C1 §L09cap backfill: existing accounts that pre-date the
	// accountSeed introduction (Phase C) get one minted on first
	// save after the new build is installed. The mint is one-shot;
	// subsequent saves keep the existing seed.
	const seedBackfill =
		!account.accountSeed || account.accountSeed.length !== 32
			? crypto.getRandomValues(new Uint8Array(32))
			: null;

	const updatedAt = Date.now();
	if (upgrading || seedBackfill) {
		const nextAccount: AccountRecord = {
			...account,
			formatVersion: targetVersion,
			accountSeed: seedBackfill ?? account.accountSeed
		};
		await saveExistingAccountAndVault(nextAccount, {
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt
		});
		activeFormatVersion = targetVersion;
	} else {
		await saveVault({
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt
		});
	}
	// A freshly minted data key (first save after a v1 unlock) starts
	// the inventory chain, which hangs off that key.
	if (mintedDataKey) {
		startInventoryChain(activeAesKey, account.deviceSalt, BigInt(account.inventoryIndex ?? 0));
	}
	aesKey = activeAesKey;
	// Fire-and-forget upload to the sync server. The local Dexie
	// write is the source of truth; if upload fails (network down,
	// rate-limited, etc.) the observer logs and we move on. The
	// next saveItems call retries with a higher sequence clock.
	void pushBlobToServer(writtenBlob).catch((err) => {
		syncObserver.onPushFailure?.({
			reason: 'unhandled',
			message: err instanceof Error ? err.message : 'sync push crashed'
		});
	});
}

export type RotateAuthInput = {
	/** Re-evaluated PRF output (or demo stand-in) for the active account. */
	prfOutput: Uint8Array | null;
	/** The user's Secret Key, freshly decoded for this rotation. */
	secretKey: Uint8Array;
	/**
	 * New master-password key, or `undefined` to leave unchanged, or
	 * `null` to explicitly disable a previously-enabled master
	 * password.
	 */
	masterPasswordKey?: Uint8Array | null;
	/**
	 * If `masterPasswordKey` is being set, the salt + Argon2id params
	 * to persist on the account row. Required when enabling.
	 */
	masterPasswordSalt?: Uint8Array;
	masterPasswordParams?: import('$lib/utils/storage').Argon2idStoredParams;
	/**
	 * New OPAQUE export key, or `undefined` to leave unchanged, or
	 * `null` to disable a previous OPAQUE enrolment.
	 */
	opaqueExportKey?: Uint8Array | null;
	opaqueAccountId?: string;
	opaqueServerId?: string;
	opaqueClientId?: string;

	/**
	 * Argon2id-derived key from the CURRENT master password. REQUIRED
	 * when the account currently has a master password enabled AND
	 * the rotation changes the MP factor (`masterPasswordKey` is
	 * `null` to disable, or a Uint8Array to replace).
	 *
	 * `rotateAuth` verifies it by re-deriving the current vault key
	 * with all current factors and constant-time comparing against
	 * the live in-memory vault key. On mismatch it throws
	 * `CurrentMasterPasswordIncorrect`. This prevents a co-located
	 * attacker — who has the user's Secret Key and a satisfied PRF
	 * but does NOT know the master password — from stripping the MP
	 * factor off an already-unlocked session.
	 */
	currentMasterPasswordKey?: Uint8Array;
	/**
	 * OPAQUE export key from a CURRENT successful OPAQUE login.
	 * REQUIRED when the account currently has OPAQUE enrolled AND
	 * the rotation changes the OPAQUE factor. Same constant-time
	 * comparison semantics as `currentMasterPasswordKey`.
	 */
	currentOpaqueExportKey?: Uint8Array;
};

/**
 * Rotate the authentication factors on an unlocked vault. Re-derives
 * the v2 vaultKey under the new factor set, generates a fresh AES key,
 * re-encrypts the entire item list, and updates `account` + `vault`
 * atomically. The module-scope `vaultKey` / `aesKey` are swapped so
 * subsequent `saveItems` calls use the new factors.
 *
 * The CALLER must provide:
 *   - a fresh `prfOutput` (production: re-evaluate WebAuthn PRF;
 *     demo: re-derive deterministically)
 *   - the user's `secretKey` (decoded freshly from input)
 *
 * Without those two we can't re-derive vaultKey at all, so this
 * function refuses to proceed if either is missing.
 */
export async function rotateAuth(opts: RotateAuthInput): Promise<void> {
	if (!isSessionActive() || !vaultKey) {
		throw new Error('rotateAuth: vault must be unlocked first');
	}
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(`rotateAuth: secretKey must be ${SECRET_KEY_LEN} bytes`);
	}

	const account = await getAccount();
	if (!account) throw new Error('rotateAuth: account row missing');

	let prf: Uint8Array;
	if (account.authMode === 'demo') {
		prf = deriveDemoPrfOutput(account.credentialId, account.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			throw new Error('rotateAuth: production rotation requires fresh PRF output');
		}
		prf = opts.prfOutput;
	}

	// Decide the next factor configuration:
	//   undefined → keep current value
	//   null      → disable (clear from account row)
	//   Uint8Array → enable / replace
	const nextMasterPasswordKey =
		opts.masterPasswordKey === undefined
			? undefined // unchanged — re-derive WITHOUT MPK input means "current"
			: opts.masterPasswordKey;
	const nextOpaqueExportKey =
		opts.opaqueExportKey === undefined ? undefined : opts.opaqueExportKey;

	if (nextMasterPasswordKey instanceof Uint8Array) {
		if (!opts.masterPasswordSalt || opts.masterPasswordSalt.length === 0) {
			throw new Error(
				'rotateAuth: enabling master password requires a fresh salt'
			);
		}
		if (
			!opts.masterPasswordParams ||
			opts.masterPasswordParams.tagLength !== 32
		) {
			throw new Error('rotateAuth: masterPasswordParams.tagLength must be 32');
		}
	}

	// To preserve the current MPK (when unchanged), we'd need it cached.
	// Today we don't cache it. Be explicit: rotateAuth requires the
	// caller to pass null/undefined/Uint8Array intentionally, and
	// `undefined` means "the rotation does not involve MPK at all"
	// (current state is preserved). The same applies to
	// opaqueExportKey. If the account currently has MPK enabled and
	// the caller passes `undefined` for the MPK, we refuse — the
	// caller would otherwise silently produce a vault that can't be
	// unlocked.
	if (
		account.masterPasswordEnabled &&
		nextMasterPasswordKey === undefined
	) {
		throw new Error(
			'rotateAuth: account has a master password — supply it (or pass null to disable)'
		);
	}
	if (
		account.opaqueState === 'enrolled' &&
		nextOpaqueExportKey === undefined
	) {
		throw new Error(
			'rotateAuth: account has OPAQUE enrolment — supply export key (or pass null to disable)'
		);
	}

	// Current-factor verification.
	//
	// When the rotation removes or replaces an already-enabled factor
	// (master password and/or OPAQUE), the caller must prove they
	// know the CURRENT value of that factor. We verify by deriving
	// the current vault key with the supplied current factors and
	// constant-time comparing it against the live in-memory vaultKey.
	//
	// The threat this closes: an attacker holding the user's Secret
	// Key (paper backup, separate exfil) and able to approve one
	// passkey prompt against an already-unlocked vault could
	// otherwise pass `masterPasswordKey: null` and permanently strip
	// MP without ever knowing it — exactly the MP factor's purpose
	// is to defend against PRF + Secret Key both leaking.
	const mpFactorChanging =
		account.masterPasswordEnabled === true && nextMasterPasswordKey !== undefined;
	const opaqueFactorChanging =
		account.opaqueState === 'enrolled' && nextOpaqueExportKey !== undefined;

	if (mpFactorChanging && !opts.currentMasterPasswordKey) {
		throw new CurrentMasterPasswordIncorrect(
			'rotateAuth: changing master password requires currentMasterPasswordKey'
		);
	}
	if (opaqueFactorChanging && !opts.currentOpaqueExportKey) {
		throw new Error(
			'rotateAuth: changing OPAQUE requires currentOpaqueExportKey'
		);
	}

	if (mpFactorChanging || opaqueFactorChanging) {
		// Re-derive the CURRENT vault key with the factors the caller
		// claims they hold. `account.formatVersion` is used so a v1
		// account verifies under the v1 derivation rules (no OPAQUE
		// mix-in even if currentOpaqueExportKey is provided). vaultKey
		// is non-null here because rotateAuth's first guard rejected
		// !isSessionActive() and TS would have narrowed `vaultKey` at
		// `isSessionActive()`, but TS can't see through the function
		// boundary — assert via the explicit `vaultKey!` below.
		const candidateCurrentVaultKey = deriveVaultKey({
			prfOutput: prf,
			secretKey: opts.secretKey,
			deviceSalt: account.deviceSalt,
			masterPasswordKey: account.masterPasswordEnabled
				? opts.currentMasterPasswordKey
				: undefined,
			opaqueExportKey:
				account.opaqueState === 'enrolled' && account.formatVersion >= 2
					? opts.currentOpaqueExportKey
					: undefined,
			version: account.formatVersion as DeriveVersion
		});
		const matches = constantTimeEqual(candidateCurrentVaultKey, vaultKey!);
		zeroize(candidateCurrentVaultKey);
		if (!matches) {
			// Order matters: MP mismatch is more user-actionable than
			// OPAQUE mismatch, so report MP first when both could be
			// the cause. A non-MP mismatch falls back to a generic
			// Error to keep the typed surface small and the audit
			// log unambiguous.
			if (mpFactorChanging) {
				throw new CurrentMasterPasswordIncorrect();
			}
			throw new Error('rotateAuth: currentOpaqueExportKey did not verify');
		}
	}

	const newVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: account.deviceSalt,
		masterPasswordKey:
			nextMasterPasswordKey instanceof Uint8Array
				? nextMasterPasswordKey
				: undefined,
		opaqueExportKey:
			nextOpaqueExportKey instanceof Uint8Array
				? nextOpaqueExportKey
				: undefined,
		version: PROVISION_FORMAT_VERSION
	});

	// Re-wrap the EXISTING AES data key under the new vaultKey. We do
	// NOT mint a fresh data key.
	//
	// rotateAuth changes the WRAPPING factors (master password / OPAQUE
	// / passkey-derived vaultKey) — it does not change deviceSalt or
	// credentialId (carried over verbatim in `nextAccount` below). The
	// Recovery Envelope wraps this same `aesKey` directly, so rotating
	// the data key here would silently break it. Keeping the data key
	// and re-wrapping it is the correct KEK rotation — an attacker who
	// couldn't derive the old vaultKey could never unwrap the data key,
	// so it never needs to rotate for a factor change. This mirrors
	// rebindRecoveredVault, which also keeps the data key.
	const currentRow = await getVault();
	if (!currentRow) throw new Error('rotateAuth: vault row missing');
	if (!aesKey) {
		throw new Error('rotateAuth: in-memory AES key missing — re-unlock first');
	}
	const oldAad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		currentRow.header
	);
	const plaintext = openBlob(
		aesKey,
		currentRow.nonce,
		currentRow.ciphertext,
		oldAad,
		account.formatVersion
	);

	const wrapped = wrapAesKey(newVaultKey, account.deviceSalt, aesKey);
	const newHeader = serializeWrappedKey(wrapped);
	const newAad = makeAad(
		PROVISION_FORMAT_VERSION,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		newHeader
	);
	const sealed = sealBlob(aesKey, plaintext, newAad, PROVISION_FORMAT_VERSION);
	zeroize(plaintext);

	const now = Date.now();
	void now;
	const nextAccount: Omit<AccountRecord, 'id'> = {
		deviceLabel: account.deviceLabel,
		deviceSalt: account.deviceSalt,
		credentialId: account.credentialId,
		credentialPublicKey: account.credentialPublicKey,
		authMode: account.authMode,
		formatVersion: PROVISION_FORMAT_VERSION,
		createdAt: account.createdAt,
		plan: account.plan,

		// Vu0 / §L09cap: preserve the long-term accountSeed across
		// rotateAuth. The vaultKey changes (new MP / passkey / OPAQUE
		// factors) but the per-account long-term identity does not.
		accountSeed: account.accountSeed,
		// The inventory chain and the restore root hang off the data key,
		// which this rotation keeps — so the device's chain position and
		// its restore state carry over untouched.
		inventoryIndex: account.inventoryIndex,
		inventoryPushedAt: account.inventoryPushedAt,
		restoreRootNonce: account.restoreRootNonce,
		restoreRootCiphertext: account.restoreRootCiphertext,
		restorePointerDay: account.restorePointerDay,
		restorePointerSlot: account.restorePointerSlot,
		restorePointerIndex: account.restorePointerIndex,
		restorePointers: account.restorePointers,

		// Carry-over OR override based on the rotation request.
		masterPasswordEnabled:
			nextMasterPasswordKey === null
				? false
				: nextMasterPasswordKey instanceof Uint8Array
					? true
					: account.masterPasswordEnabled,
		masterPasswordSalt:
			nextMasterPasswordKey === null
				? undefined
				: nextMasterPasswordKey instanceof Uint8Array
					? opts.masterPasswordSalt
					: account.masterPasswordSalt,
		masterPasswordParams:
			nextMasterPasswordKey === null
				? undefined
				: nextMasterPasswordKey instanceof Uint8Array
					? opts.masterPasswordParams
					: account.masterPasswordParams,

		opaqueState:
			nextOpaqueExportKey === null
				? 'none'
				: nextOpaqueExportKey instanceof Uint8Array
					? 'enrolled'
					: account.opaqueState ?? 'none',
		opaqueAccountId:
			nextOpaqueExportKey === null
				? undefined
				: nextOpaqueExportKey instanceof Uint8Array
					? opts.opaqueAccountId
					: account.opaqueAccountId,
		opaqueServerId:
			nextOpaqueExportKey === null
				? undefined
				: nextOpaqueExportKey instanceof Uint8Array
					? opts.opaqueServerId
					: account.opaqueServerId,
		opaqueClientId:
			nextOpaqueExportKey === null
				? undefined
				: nextOpaqueExportKey instanceof Uint8Array
					? opts.opaqueClientId
					: account.opaqueClientId
	};

	// Auth rotation re-seals the existing account in place, so it opts
	// into overwriting — the fresh-provision path never does.
	await saveAccountAndVault(
		nextAccount,
		{
			header: newHeader,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt: Date.now()
		},
		{ allowOverwrite: true }
	);

	// Only the vaultKey (the wrapping key) rotates. `aesKey` is the
	// unchanged data key — it stays live and MUST NOT be zeroized; the
	// re-sealed vault blob and the Recovery Envelope remain valid under it.
	zeroize(vaultKey);
	vaultKey = newVaultKey;
	// The inventory chain derives from the unchanged data key + device
	// salt, so it continues: no restart, no orphaned server copy, and a
	// restore record written before the rotation still points at a live
	// chain.
	if (account.authMode === 'demo') zeroize(prf);
}

export type RestoreAdoptInput = {
	/** The sealed record a fresh device found and opened (see server-restore.ts). */
	record: RestoreRecordPayload;
	/** Where the record was found, so this device's next record takes the next slot. */
	foundAt: RestorePointerCoord;
	secretKey: Uint8Array;
	/** Export key from the OPAQUE login this device just completed with the record's client id. */
	opaqueExportKey: Uint8Array;
	opaque: { accountId: string; serverId: string; clientId: string };
	deviceLabel: string;
	credentialId: ArrayBuffer;
	credentialPublicKey: ArrayBuffer;
	authMode: AuthMode;
	prfOutput: Uint8Array | null;
	deviceSalt: Uint8Array;
};

/**
 * New-device restore. Given an opened restore record and a freshly
 * registered passkey, walk the old device's inventory chain to its
 * newest save, fetch and decrypt that vault blob, and re-seal it as
 * this device's own vault (new device salt, new credential, new
 * passkey-bound wrapping key; same data key). The OPAQUE identity is
 * carried over so this device syncs as the same account.
 *
 * Refuses to run over an existing local vault. Like a passkey rebind,
 * a master password on the old device does not carry over.
 */
export async function adoptRestoredVault(opts: RestoreAdoptInput): Promise<VaultItem[]> {
	if (await getAccount()) {
		throw new Error('adoptRestoredVault: this device already has a vault');
	}
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(`adoptRestoredVault: secretKey must be ${SECRET_KEY_LEN} bytes`);
	}
	if (opts.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(`adoptRestoredVault: deviceSalt must be ${DEVICE_SALT_LEN} bytes`);
	}
	if (!isSyncWired() || !hasSession()) {
		throw new Error('adoptRestoredVault: a sync session is required');
	}
	const record = opts.record;
	if (!SUPPORTED_FORMAT_VERSIONS.has(record.formatVersion) || record.formatVersion < 2) {
		throw new Error(`adoptRestoredVault: unsupported vault formatVersion ${record.formatVersion}`);
	}

	// 1. Walk the old chain forward from the record's index to the newest save.
	startInventoryChain(record.aesKey, record.deviceSalt, record.inventoryIndex);
	let blobId = record.vaultBlobId;
	try {
		const newer = await inventoryPullNewer(RESTORE_MAX_WALK);
		if (newer) blobId = newer.blobId;
	} finally {
		clearInventorySession();
	}

	// 2. Fetch and decrypt it under the record's data key + AAD inputs.
	const fetched = await fetchV2Blob(blobId);
	if (!fetched.ok) {
		throw new Error(
			'The vault copy on the sync server could not be fetched. It may have expired — a vault is kept for 60 days after its last use.'
		);
	}
	let remote: { header: Uint8Array; ciphertext: Uint8Array };
	try {
		remote = unpackVaultBody(base64ToBytes(fetched.value.ciphertext));
	} catch {
		throw new Error('The vault copy on the sync server is malformed.');
	}
	const oldCredential = record.credentialId.buffer.slice(
		record.credentialId.byteOffset,
		record.credentialId.byteOffset + record.credentialId.byteLength
	) as ArrayBuffer;
	const oldAad = makeAad(
		record.formatVersion,
		record.authMode,
		record.deviceSalt,
		oldCredential,
		remote.header
	);
	let plaintext: Uint8Array;
	try {
		plaintext = openBlob(
			record.aesKey,
			base64ToBytes(fetched.value.nonce),
			remote.ciphertext,
			oldAad,
			record.formatVersion
		);
	} catch (err) {
		throw new Error('The restore record opened, but the vault copy did not decrypt under it.', {
			cause: err
		});
	}

	// 3. Re-seal as this device's vault.
	let prf: Uint8Array;
	if (opts.authMode === 'demo') {
		if (!isDemoAuthEnabled()) {
			plaintext.fill(0);
			throw new Error('Demo auth mode is disabled in this build.');
		}
		prf = deriveDemoPrfOutput(opts.credentialId, opts.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			plaintext.fill(0);
			throw new Error('adoptRestoredVault: production restore requires PRF output');
		}
		prf = opts.prfOutput;
	}
	const dataKey = record.aesKey.slice();
	const newVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: opts.deviceSalt,
		opaqueExportKey: opts.opaqueExportKey,
		version: PROVISION_FORMAT_VERSION
	});
	let items: VaultItem[];
	let header: Uint8Array;
	let sealed: { nonce: Uint8Array; ciphertext: Uint8Array };
	try {
		items = deserializeItems(plaintext);
		header = serializeWrappedKey(wrapAesKey(newVaultKey, opts.deviceSalt, dataKey));
		const aad = makeAad(
			PROVISION_FORMAT_VERSION,
			opts.authMode,
			opts.deviceSalt,
			opts.credentialId,
			header
		);
		sealed = sealBlob(dataKey, plaintext, aad, PROVISION_FORMAT_VERSION);
	} catch (err) {
		zeroize(newVaultKey);
		zeroize(dataKey);
		throw err;
	} finally {
		plaintext.fill(0);
		if (opts.authMode === 'demo') zeroize(prf);
	}

	const now = Date.now();
	try {
		await saveAccountAndVault(
			{
				deviceLabel: opts.deviceLabel,
				deviceSalt: opts.deviceSalt,
				credentialId: opts.credentialId,
				credentialPublicKey: opts.credentialPublicKey,
				authMode: opts.authMode,
				formatVersion: PROVISION_FORMAT_VERSION,
				createdAt: now,
				plan: 'free',
				accountSeed: record.accountSeed
					? record.accountSeed.slice()
					: crypto.getRandomValues(new Uint8Array(32)),
				opaqueState: 'enrolled',
				opaqueAccountId: opts.opaque.accountId,
				opaqueServerId: opts.opaque.serverId,
				opaqueClientId: opts.opaque.clientId,
				masterPasswordEnabled: false,
				// Seed the record reservation from where we found the record so
				// this device's first record takes the next slot of that day,
				// never rewriting the old device's address.
				restorePointerDay: opts.foundAt.day,
				restorePointerSlot: opts.foundAt.slot
			},
			{ header, nonce: sealed.nonce, ciphertext: sealed.ciphertext, updatedAt: now }
		);
	} catch (err) {
		zeroize(newVaultKey);
		zeroize(dataKey);
		throw err;
	}

	zeroize(vaultKey);
	zeroize(aesKey);
	zeroize(restoreRoot);
	vaultKey = newVaultKey;
	aesKey = dataKey;
	restoreRoot = null; // installed by the caller via installRestoreRoot
	activeAuthMode = opts.authMode;
	activeFormatVersion = PROVISION_FORMAT_VERSION;
	startInventoryChain(dataKey, opts.deviceSalt);
	prefetchAnonTokens();
	return items;
}

export function lockSession(): void {
	// Fire-and-forget server-side revocation BEFORE we drop the
	// token reference: opaqueLogout reads sessionToken from
	// sync-client's module scope, so once setSessionToken(null)
	// runs the network call would have no auth header to revoke
	// with. We deliberately do not await — lock must be synchronous
	// from the user's perspective, and an offline / slow logout
	// must never block UI lock. The token also has a 1h server-side
	// TTL backstop so a dropped request degrades to the pre-logout
	// behavior, not a permanent leak.
	void opaqueLogout().catch(() => undefined);
	zeroize(vaultKey);
	zeroize(aesKey);
	zeroize(restoreRoot);
	setSessionToken(null);
	clearInventorySession();
	vaultKey = null;
	aesKey = null;
	restoreRoot = null;
	activeAuthMode = null;
	activeFormatVersion = null;
}

export function isSessionActive(): boolean {
	return vaultKey !== null;
}

export function currentAuthMode(): AuthMode | null {
	return activeAuthMode;
}

export function currentFormatVersion(): number | null {
	return activeFormatVersion;
}

export async function loadAccount(): Promise<AccountRecord | undefined> {
	return getAccount();
}

/**
 * Approximate ciphertext size for the audit footer. Never exposes
 * plaintext bytes — just the encrypted blob length.
 */
export async function getVaultByteSize(): Promise<number> {
	const row = await getVault();
	return row ? row.header.length + row.nonce.length + row.ciphertext.length : 0;
}
