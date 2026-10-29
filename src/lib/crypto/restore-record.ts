/**
 * Server-side restore record — new-device restore without a stable
 * server address.
 *
 * Problem: everything a fresh device needs to read its own vault back
 * from the sync server is device-bound. The inventory address chain is
 * derived from the vault data key and the device salt, the blob AAD
 * binds the device salt and the passkey credential id, and the OPAQUE
 * client id is derived from that credential. A device that has only
 * the Secret Key and the Recovery Password therefore cannot locate,
 * authenticate for, or decrypt the server copy.
 *
 * Solution: the device periodically writes a small sealed *restore
 * record* that carries exactly that material (device salt, credential
 * id, data key, inventory position, OPAQUE identity) to an address the
 * restoring device can recompute from the Secret Key + Recovery
 * Password alone — and nothing else can.
 *
 * Privacy shape (V0-C1 — no stable per-account address):
 *
 *   - The address is `HKDF(root, "…address…" ‖ day ‖ slot)`, where
 *     `root` derives from Argon2id(Recovery Password) ‖ Secret Key.
 *     Each UTC day gets fresh addresses; a slot counter lets a device
 *     write more than once per day (rebind, rotation, pointer
 *     refresh) without ever rewriting an address. Without `root`,
 *     consecutive records are unrelated-looking random strings, so the
 *     server sees no address recur across days.
 *   - A record is written at most once per day in the steady state
 *     (plus one every RESTORE_POINTER_EVERY saves so the restoring
 *     device's forward walk stays short). Writes spend an anonymous
 *     token like every other v2 request.
 *   - The record is AES-256-GCM under a key derived from `root`, padded
 *     to a fixed 2 KiB bucket, so records are indistinguishable from
 *     each other on the wire. The server holds ciphertext it cannot
 *     open: `root` needs the 256-bit Secret Key, which OPAQUE keeps off
 *     the server, AND the Recovery Password.
 *   - Reads happen only during a restore. The read route is
 *     unauthenticated (the restoring device has no session yet) and
 *     rate-limited per IP; the address is the capability, exactly as
 *     the random blob UUID is for `/api/v2/blobs/*`.
 *
 * Residuals (documented in docs/PRIVACY-LEVEL.md): a restore read
 * links the restoring session to whichever session wrote that record
 * (the same linkage the manual "Sync now" read already has); and a
 * holder of Secret Key + Recovery Password can restore the vault
 * without the passkey — the same threat model as the local Recovery
 * Envelope, which this record is the server-held twin of.
 */

import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';
import { padPlaintext, unpadPlaintext } from './padding';
import type { Argon2idParams } from './argon2';
import type { AuthMode } from '$lib/utils/storage';

export const RESTORE_RECORD_VERSION = 1;
export const RESTORE_ADDRESS_BYTES = 16;
export const RESTORE_ROOT_BYTES = 32;
export const RESTORE_NONCE_BYTES = 12;
/** Every record pads to this bucket so records are the same size on the wire. */
export const RESTORE_RECORD_BUCKET_BYTES = 2048;
/** UTC-day bucketing for record addresses. */
export const RESTORE_DAY_MS = 24 * 60 * 60 * 1000;
/** How far back a restoring device scans: the server's 60-day reference GC plus slack. */
export const RESTORE_SCAN_DAYS = 62;
/** Slots probed per day before concluding the day has no further records. */
export const RESTORE_SCAN_SLOTS = 8;
/** Steady-state cadence: a fresh record every this-many saves within a day. */
export const RESTORE_POINTER_EVERY = 64n;
/** Upper bound on the restoring device's forward walk from the record's inventory index. */
export const RESTORE_MAX_WALK = 1024;

/**
 * Argon2id parameters for the restore root. Pinned separately from
 * `VAULT_HIGH_PARAMS` so a future preset bump can never move the root
 * away from the records already on the server; the restoring device
 * has nothing else to learn the parameters from.
 */
export const RESTORE_ROOT_PARAMS: Argon2idParams = Object.freeze({
	memoryKiB: 262144,
	iterations: 4,
	parallelism: 1,
	tagLength: 32
});

const ADDRESS_INFO = 'vuvault-restore-address-v1';
const RECORD_KEY_INFO = 'vuvault-restore-record-key-v1';
const RECORD_AAD_DOMAIN = new TextEncoder().encode('vuvault-restore-record-aad-v1');
const ROOT_WRAP_INFO = 'vuvault-restore-root-wrap-v1';
const ROOT_WRAP_AAD = new TextEncoder().encode('vuvault-restore-root-wrap-aad-v1');

const AUTH_MODE_TAG: Record<AuthMode, number> = { production: 0x01, demo: 0x02 };
const MAX_CREDENTIAL_ID_BYTES = 1023; // WebAuthn credential id ceiling
const MAX_STRING_BYTES = 256;
const VAULT_BLOB_ID_LEN = 36;

export type RestoreRecordPayload = {
	formatVersion: number;
	authMode: AuthMode;
	deviceSalt: Uint8Array; // 16 bytes
	credentialId: Uint8Array; // 1..1023 bytes
	aesKey: Uint8Array; // 32-byte vault data key
	accountSeed: Uint8Array | null; // 32 bytes or absent
	/** Inventory chain index this record was written alongside. */
	inventoryIndex: bigint;
	/** The whole-vault blob that chain index names (fallback if the walk finds nothing newer). */
	vaultBlobId: string;
	writtenAt: number; // wall-clock ms on the writing device
	opaqueClientId: string;
	opaqueServerId: string;
	opaqueAccountId: string;
	deviceLabel: string;
};

export function restoreDay(nowMs: number = Date.now()): number {
	return Math.floor(nowMs / RESTORE_DAY_MS);
}

/**
 * Address for the record written on `day` at `slot`. Fresh per (day,
 * slot); unrelated-looking without `root`.
 */
export function restoreAddress(root: Uint8Array, day: number, slot: number): Uint8Array {
	if (root.length !== RESTORE_ROOT_BYTES) {
		throw new Error(`restoreAddress: root must be ${RESTORE_ROOT_BYTES} bytes`);
	}
	if (!Number.isSafeInteger(day) || day < 0 || day > 0xffffffff) {
		throw new Error('restoreAddress: day out of range');
	}
	if (!Number.isSafeInteger(slot) || slot < 0 || slot > 0xffff) {
		throw new Error('restoreAddress: slot out of range');
	}
	const label = new TextEncoder().encode(ADDRESS_INFO);
	const info = new Uint8Array(label.length + 4 + 2);
	info.set(label, 0);
	const view = new DataView(info.buffer);
	view.setUint32(label.length, day, false);
	view.setUint16(label.length + 4, slot, false);
	return hkdf(sha512, root, undefined, info, RESTORE_ADDRESS_BYTES);
}

function recordKey(root: Uint8Array, address: Uint8Array): Uint8Array {
	return hkdf(sha512, root, address, RECORD_KEY_INFO, 32);
}

function recordAad(address: Uint8Array): Uint8Array {
	const out = new Uint8Array(RECORD_AAD_DOMAIN.length + address.length);
	out.set(RECORD_AAD_DOMAIN, 0);
	out.set(address, RECORD_AAD_DOMAIN.length);
	return out;
}

function putString(out: Uint8Array, view: DataView, off: number, s: string): number {
	const bytes = new TextEncoder().encode(s);
	if (bytes.length > MAX_STRING_BYTES) {
		throw new Error('serializeRestoreRecord: string field too long');
	}
	view.setUint16(off, bytes.length, false);
	out.set(bytes, off + 2);
	return off + 2 + bytes.length;
}

function getString(buf: Uint8Array, view: DataView, off: number): { value: string; next: number } {
	if (off + 2 > buf.length) throw new Error('deserializeRestoreRecord: truncated');
	const len = view.getUint16(off, false);
	if (len > MAX_STRING_BYTES || off + 2 + len > buf.length) {
		throw new Error('deserializeRestoreRecord: bad string length');
	}
	return {
		value: new TextDecoder().decode(buf.subarray(off + 2, off + 2 + len)),
		next: off + 2 + len
	};
}

/**
 * Deterministic binary layout (all integers big-endian):
 *
 *   u8  'V'  u8 'R'  u8 version  u8 reserved(0)
 *   u8  formatVersion
 *   u8  authMode tag (1 production, 2 demo)
 *   16B deviceSalt
 *   u16 credLen ‖ credentialId
 *   32B aesKey
 *   u8  hasAccountSeed ‖ 32B accountSeed (zero-filled when absent)
 *   u64 inventoryIndex
 *   36B vaultBlobId (ASCII UUID)
 *   u64 writtenAt
 *   u16 len ‖ opaqueClientId
 *   u16 len ‖ opaqueServerId
 *   u16 len ‖ opaqueAccountId
 *   u16 len ‖ deviceLabel
 */
export function serializeRestoreRecord(p: RestoreRecordPayload): Uint8Array {
	if (p.deviceSalt.length !== 16) throw new Error('serializeRestoreRecord: deviceSalt must be 16 bytes');
	if (p.credentialId.length === 0 || p.credentialId.length > MAX_CREDENTIAL_ID_BYTES) {
		throw new Error('serializeRestoreRecord: credentialId length out of range');
	}
	if (p.aesKey.length !== 32) throw new Error('serializeRestoreRecord: aesKey must be 32 bytes');
	if (p.accountSeed && p.accountSeed.length !== 32) {
		throw new Error('serializeRestoreRecord: accountSeed must be 32 bytes');
	}
	if (!/^[0-9a-f-]{36}$/i.test(p.vaultBlobId)) {
		throw new Error('serializeRestoreRecord: vaultBlobId must be a UUID string');
	}
	if (p.inventoryIndex < 0n || p.inventoryIndex > 0xffffffffffffffffn) {
		throw new Error('serializeRestoreRecord: inventoryIndex out of range');
	}
	if (!Number.isSafeInteger(p.writtenAt) || p.writtenAt < 0) {
		throw new Error('serializeRestoreRecord: writtenAt must be a non-negative integer');
	}
	if (!(p.authMode in AUTH_MODE_TAG)) throw new Error('serializeRestoreRecord: bad authMode');

	const te = new TextEncoder();
	const strings = [p.opaqueClientId, p.opaqueServerId, p.opaqueAccountId, p.deviceLabel];
	const stringBytes = strings.reduce((n, s) => n + 2 + te.encode(s).length, 0);
	const total = 4 + 1 + 1 + 16 + 2 + p.credentialId.length + 32 + 1 + 32 + 8 + VAULT_BLOB_ID_LEN + 8 + stringBytes;
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	let off = 0;
	out[off++] = 0x56; // 'V'
	out[off++] = 0x52; // 'R'
	out[off++] = RESTORE_RECORD_VERSION;
	out[off++] = 0x00;
	out[off++] = p.formatVersion & 0xff;
	out[off++] = AUTH_MODE_TAG[p.authMode];
	out.set(p.deviceSalt, off);
	off += 16;
	view.setUint16(off, p.credentialId.length, false);
	off += 2;
	out.set(p.credentialId, off);
	off += p.credentialId.length;
	out.set(p.aesKey, off);
	off += 32;
	out[off++] = p.accountSeed ? 1 : 0;
	if (p.accountSeed) out.set(p.accountSeed, off);
	off += 32;
	view.setBigUint64(off, p.inventoryIndex, false);
	off += 8;
	out.set(te.encode(p.vaultBlobId), off);
	off += VAULT_BLOB_ID_LEN;
	view.setBigUint64(off, BigInt(p.writtenAt), false);
	off += 8;
	for (const s of strings) off = putString(out, view, off, s);
	if (off !== total) throw new Error('serializeRestoreRecord: length mismatch');
	return out;
}

export function deserializeRestoreRecord(buf: Uint8Array): RestoreRecordPayload {
	const fixedHead = 4 + 1 + 1 + 16 + 2;
	if (buf.length < fixedHead) throw new Error('deserializeRestoreRecord: too short');
	if (buf[0] !== 0x56 || buf[1] !== 0x52) throw new Error('deserializeRestoreRecord: missing VR magic');
	if (buf[2] !== RESTORE_RECORD_VERSION) {
		throw new Error(`deserializeRestoreRecord: unknown version ${buf[2]}`);
	}
	if (buf[3] !== 0x00) throw new Error('deserializeRestoreRecord: non-zero reserved byte');
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	let off = 4;
	const formatVersion = buf[off++]!;
	const modeTag = buf[off++]!;
	const authMode: AuthMode | null =
		modeTag === AUTH_MODE_TAG.production ? 'production' : modeTag === AUTH_MODE_TAG.demo ? 'demo' : null;
	if (!authMode) throw new Error('deserializeRestoreRecord: bad authMode tag');
	const deviceSalt = buf.slice(off, off + 16);
	off += 16;
	const credLen = view.getUint16(off, false);
	off += 2;
	if (credLen === 0 || credLen > MAX_CREDENTIAL_ID_BYTES) {
		throw new Error('deserializeRestoreRecord: bad credentialId length');
	}
	const fixedRest = credLen + 32 + 1 + 32 + 8 + VAULT_BLOB_ID_LEN + 8;
	if (off + fixedRest > buf.length) throw new Error('deserializeRestoreRecord: truncated');
	const credentialId = buf.slice(off, off + credLen);
	off += credLen;
	const aesKey = buf.slice(off, off + 32);
	off += 32;
	const hasSeed = buf[off++] === 1;
	const accountSeed = hasSeed ? buf.slice(off, off + 32) : null;
	off += 32;
	const inventoryIndex = view.getBigUint64(off, false);
	off += 8;
	const vaultBlobId = new TextDecoder().decode(buf.subarray(off, off + VAULT_BLOB_ID_LEN));
	if (!/^[0-9a-f-]{36}$/i.test(vaultBlobId)) {
		throw new Error('deserializeRestoreRecord: bad vaultBlobId');
	}
	off += VAULT_BLOB_ID_LEN;
	const writtenAtBig = view.getBigUint64(off, false);
	off += 8;
	if (writtenAtBig > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('deserializeRestoreRecord: writtenAt out of range');
	}
	const s1 = getString(buf, view, off);
	const s2 = getString(buf, view, s1.next);
	const s3 = getString(buf, view, s2.next);
	const s4 = getString(buf, view, s3.next);
	if (s4.next !== buf.length) throw new Error('deserializeRestoreRecord: trailing bytes');
	return {
		formatVersion,
		authMode,
		deviceSalt,
		credentialId,
		aesKey,
		accountSeed,
		inventoryIndex,
		vaultBlobId,
		writtenAt: Number(writtenAtBig),
		opaqueClientId: s1.value,
		opaqueServerId: s2.value,
		opaqueAccountId: s3.value,
		deviceLabel: s4.value
	};
}

/** Zero every secret-bearing buffer in a payload. */
export function zeroizeRestoreRecord(p: RestoreRecordPayload): void {
	p.aesKey.fill(0);
	p.accountSeed?.fill(0);
	p.deviceSalt.fill(0);
	p.credentialId.fill(0);
}

/**
 * Seal a payload for storage at `address`. The plaintext pads to a fixed
 * 2 KiB bucket first so every record is the same size on the wire; the
 * AES key is per-address and the AAD binds the address, so a record
 * copied to another address fails to open.
 */
export function sealRestoreRecord(
	root: Uint8Array,
	address: Uint8Array,
	payload: RestoreRecordPayload
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	const serialized = serializeRestoreRecord(payload);
	const padded = padPlaintext(serialized, { minBucket: RESTORE_RECORD_BUCKET_BYTES });
	serialized.fill(0);
	const key = recordKey(root, address);
	const nonce = crypto.getRandomValues(new Uint8Array(RESTORE_NONCE_BYTES));
	try {
		const ciphertext = gcm(key, nonce, recordAad(address)).encrypt(padded);
		return { nonce, ciphertext };
	} finally {
		padded.fill(0);
		key.fill(0);
	}
}

/** Inverse of `sealRestoreRecord`. Throws on tampering or a wrong root/address. */
export function openRestoreRecord(
	root: Uint8Array,
	address: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array
): RestoreRecordPayload {
	if (nonce.length !== RESTORE_NONCE_BYTES) {
		throw new Error('openRestoreRecord: nonce must be 12 bytes');
	}
	const key = recordKey(root, address);
	let padded: Uint8Array;
	try {
		padded = gcm(key, nonce, recordAad(address)).decrypt(ciphertext);
	} finally {
		key.fill(0);
	}
	let plain: Uint8Array;
	try {
		plain = unpadPlaintext(padded);
	} finally {
		padded.fill(0);
	}
	try {
		return deserializeRestoreRecord(plain);
	} finally {
		plain.fill(0);
	}
}

/**
 * Wrap the restore root under the vault data key for local persistence.
 * The device must be able to write records without the Recovery
 * Password in hand, but the plain root on disk would let a
 * disk-only attacker fetch and open records, so it rests sealed under
 * the data key — which is only in memory while the vault is unlocked.
 * The data key is stable across auth rotations and rebinds, so the wrap
 * never needs re-sealing for those.
 */
export function wrapRestoreRoot(
	aesKey: Uint8Array,
	root: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	if (root.length !== RESTORE_ROOT_BYTES) {
		throw new Error(`wrapRestoreRoot: root must be ${RESTORE_ROOT_BYTES} bytes`);
	}
	const key = hkdf(sha512, aesKey, undefined, ROOT_WRAP_INFO, 32);
	const nonce = crypto.getRandomValues(new Uint8Array(RESTORE_NONCE_BYTES));
	try {
		return { nonce, ciphertext: gcm(key, nonce, ROOT_WRAP_AAD).encrypt(root) };
	} finally {
		key.fill(0);
	}
}

export function unwrapRestoreRoot(
	aesKey: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array
): Uint8Array {
	const key = hkdf(sha512, aesKey, undefined, ROOT_WRAP_INFO, 32);
	try {
		const root = gcm(key, nonce, ROOT_WRAP_AAD).decrypt(ciphertext);
		if (root.length !== RESTORE_ROOT_BYTES) {
			root.fill(0);
			throw new Error('unwrapRestoreRoot: unexpected root length');
		}
		return root;
	} finally {
		key.fill(0);
	}
}
