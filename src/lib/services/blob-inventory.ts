/**
 * Client-side encrypted blob inventory — Phase 4 / §L07b primitives.
 *
 * Provides the CLIENT crypto primitives behind V1-C1 ("no per-user blob
 * inventories") and V1-C3 ("no cross-account sequence-clock
 * correlation") per `docs/VU-LEVEL-MIGRATION-MAP.md` and the §L07b
 * sub-section of `docs/TIER2-ARCHITECTURE.md`. These primitives only
 * CLOSE those invariants once wired into the live save/restore path —
 * that wiring lives in `inventory-session.ts` + `vault-session.ts` +
 * `document-blobs.ts` and landed 2026-05-31 (see
 * `docs/verifications/2026-05-31-vu1-closure.md`).
 *
 * Variant (a) per-blob random keys + Candidate 1 deterministic-first-
 * pointer bootstrap. The Candidate-1 trade-off is accepted explicitly in
 * `docs/verifications/2026-05-31-vu1-closure.md`; no separate "Appendix
 * B.1" human sign-off was ever actually on record (an earlier draft of
 * this comment implied one that did not exist).
 *
 * High-level shape:
 *
 *   1. The FIRST inventory address is HKDF-derived from
 *      (vaultKey, deviceSalt, "vuvault/v1c1/inventory-bootstrap").
 *      The "deterministic first pointer" admits one bit of metadata
 *      leak (an observer can probe the bootstrap address to confirm
 *      an account exists) — this is the Candidate 1 trade-off.
 *
 *   2. The inventory blob is `{ blobIds, latestCrdtIndex, nextAddr,
 *      version }`, encrypted with the active session AES key and
 *      stored at `/api/v2/inv/{addr}` where `addr` is the 26-char
 *      Crockford base32 encoding of a 16-byte address.
 *
 *   3. After every rotation, the inventory's `nextAddr` field
 *      points to a freshly-random 16-byte address; the OLD address
 *      is unlinkable to the new (because rotation uses a fresh
 *      Uint8Array, not derived from the old).
 *
 *   4. Each blob lives at `/api/v2/blobs/{uuid}`. The server has NO
 *      per-account index of "which blobs belong to whom" — anyone
 *      with a valid session token can fetch a blob if they know its
 *      UUID, but UUIDs are 122 bits of randomness so guessing is
 *      computationally infeasible.
 *
 * This module exports the CLIENT primitives. The matching server
 * routes are in `src/routes/api/v2/blobs/[uuid]/+server.ts` and
 * `src/routes/api/v2/inv/[addr]/+server.ts`.
 *
 * Threat-model footnotes:
 *
 *   - V1-C1 holds against any server-side observer that does not
 *     have a valid session token. The server stores no
 *     (blob_id, account_id) tuple.
 *   - V1-C1 admits the Candidate 1 first-pointer leak: an authorized
 *     auditor with knowledge of (vaultKey, deviceSalt) can derive the
 *     bootstrap address and observe whether an inventory exists. Per
 *     the spec, this is an accepted minimum-viable trade-off; the
 *     unlinkable-bootstrap variant (Candidate 2) is reserved for the
 *     V0 track.
 *   - V1-C3 holds because the GC and rate-limit layers operate on
 *     blob_id (not account_id). Two interleaved uploads from two
 *     different accounts are indistinguishable to an R2 observer.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';
import { gcm } from '@noble/ciphers/aes';

export const INVENTORY_ADDRESS_BYTES = 16;
export const INVENTORY_ADDRESS_HKDF_INFO = 'vuvault/v1c1/inventory-bootstrap';
export const INVENTORY_AES_KEY_BYTES = 32;
export const INVENTORY_NONCE_BYTES = 12;

/**
 * The encrypted inventory blob's plaintext shape. Serialized as
 * little-endian binary (NOT JSON) to keep size deterministic and
 * avoid the bucket-leak from variable JSON whitespace.
 */
export type InventoryPlaintext = {
	blobIds: string[]; // each is a UUID v4 string
	latestCrdtIndex: bigint;
	nextAddr: Uint8Array; // 16 bytes
	version: bigint;
};

/**
 * Crockford base32 alphabet (RFC-ish; uses 0-9 A-Z without I, L, O, U).
 * We use it for the inventory address: 26 characters encodes 128
 * bits with a small alignment loss (130 bits' capacity). The
 * server-side regex is `/^[a-z0-9]{26}$/i` — Crockford's published
 * alphabet is a strict subset of `[A-Z0-9]` so lowercase normalization
 * is sufficient.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Encode a 16-byte address as a 26-character Crockford-base32 string,
 * always lowercase for URL stability.
 */
export function encodeAddress(addr: Uint8Array): string {
	if (addr.length !== INVENTORY_ADDRESS_BYTES) {
		throw new Error('encodeAddress: address must be 16 bytes');
	}
	// 16 bytes = 128 bits; round up to 130 bits = 26 base-32 chars.
	let bits = 0;
	let buf = 0;
	let out = '';
	for (let i = 0; i < addr.length; i++) {
		buf = (buf << 8) | addr[i]!;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += CROCKFORD[(buf >>> bits) & 0x1f];
		}
	}
	if (bits > 0) {
		out += CROCKFORD[(buf << (5 - bits)) & 0x1f];
	}
	return out.toLowerCase();
}

/**
 * Decode a 26-character Crockford-base32 string back to 16 bytes.
 * Accepts case-insensitive input but rejects non-Crockford chars.
 */
export function decodeAddress(s: string): Uint8Array {
	const norm = s.toUpperCase();
	if (norm.length !== 26 || !/^[0-9A-Z]+$/.test(norm)) {
		throw new Error('decodeAddress: not a 26-char Crockford string');
	}
	const out = new Uint8Array(INVENTORY_ADDRESS_BYTES);
	let bits = 0;
	let buf = 0;
	let oi = 0;
	for (const c of norm) {
		const v = CROCKFORD.indexOf(c);
		if (v < 0) throw new Error(`decodeAddress: invalid char '${c}'`);
		buf = (buf << 5) | v;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			if (oi < out.length) out[oi++] = (buf >>> bits) & 0xff;
		}
	}
	if (oi !== INVENTORY_ADDRESS_BYTES) {
		throw new Error('decodeAddress: byte length mismatch');
	}
	return out;
}

/**
 * Derive the deterministic bootstrap inventory address from
 * (vaultKey, deviceSalt). Per Candidate 1, this address is
 * recoverable by anyone who has those two factors — exactly the
 * set of parties who already have the vault key. The trade-off is
 * that the address is the same across rotations, leaking the
 * existence of an account to anyone who already knows the vault
 * key (which is moot — they already have the vault).
 *
 * HKDF parameters:
 *   IKM:  vaultKey (typically 64 bytes from HKDF chain)
 *   salt: deviceSalt (32 bytes)
 *   info: "vuvault/v1c1/inventory-bootstrap"
 *   L:    INVENTORY_ADDRESS_BYTES (16)
 */
export function bootstrapAddress(
	vaultKey: Uint8Array,
	deviceSalt: Uint8Array
): Uint8Array {
	if (vaultKey.length === 0) {
		throw new Error('bootstrapAddress: vaultKey must be non-empty');
	}
	if (deviceSalt.length === 0) {
		throw new Error('bootstrapAddress: deviceSalt must be non-empty');
	}
	return hkdf(
		sha512,
		vaultKey,
		deviceSalt,
		INVENTORY_ADDRESS_HKDF_INFO,
		INVENTORY_ADDRESS_BYTES
	);
}

/**
 * Derive a deterministic per-inventory AES key from
 * (vaultKey, address). Each inventory blob is encrypted with its
 * own key so that compromise of one inventory key does not affect
 * any other. (In practice an attacker who compromised vaultKey can
 * re-derive everything — this is defense in depth against partial
 * key leaks, e.g., a single inventory's AES key being recovered
 * via a side channel.)
 */
export function deriveInventoryKey(
	vaultKey: Uint8Array,
	address: Uint8Array
): Uint8Array {
	return hkdf(
		sha512,
		vaultKey,
		address,
		'vuvault/v1c1/inventory-aes',
		INVENTORY_AES_KEY_BYTES
	);
}

/**
 * Serialize an InventoryPlaintext to a deterministic byte buffer.
 *
 * Wire format (all integers big-endian, lengths in bytes):
 *
 *   u8     'V'  literal byte 0x56 (sanity check)
 *   u8     'I'  literal byte 0x49 (sanity check)
 *   u8     version-tag  (currently 0x01)
 *   u8     reserved     (must be 0)
 *   u64BE  version      (per the InventoryPlaintext)
 *   u64BE  latestCrdtIndex
 *   16 B   nextAddr
 *   u32BE  blobIds.length (number of entries)
 *   then 36 bytes per blob_id (UUID v4 canonical string, ASCII)
 *
 * The serialization is exact-length so padding is the caller's
 * responsibility (see src/lib/crypto/padding.ts).
 */
export function serializeInventory(p: InventoryPlaintext): Uint8Array {
	if (p.nextAddr.length !== INVENTORY_ADDRESS_BYTES) {
		throw new Error('serializeInventory: nextAddr must be 16 bytes');
	}
	for (const id of p.blobIds) {
		if (!/^[0-9a-f-]{36}$/i.test(id)) {
			throw new Error(`serializeInventory: invalid blobId '${id}'`);
		}
	}
	const totalLen = 1 + 1 + 1 + 1 + 8 + 8 + 16 + 4 + p.blobIds.length * 36;
	const out = new Uint8Array(totalLen);
	const view = new DataView(out.buffer);
	let off = 0;
	out[off++] = 0x56; // 'V'
	out[off++] = 0x49; // 'I'
	out[off++] = 0x01; // tag
	out[off++] = 0x00; // reserved
	view.setBigUint64(off, p.version, false);
	off += 8;
	view.setBigUint64(off, p.latestCrdtIndex, false);
	off += 8;
	out.set(p.nextAddr, off);
	off += 16;
	view.setUint32(off, p.blobIds.length, false);
	off += 4;
	const te = new TextEncoder();
	for (const id of p.blobIds) {
		const bytes = te.encode(id);
		if (bytes.length !== 36) {
			throw new Error('serializeInventory: blobId not 36 ASCII bytes');
		}
		out.set(bytes, off);
		off += 36;
	}
	return out;
}

/**
 * Inverse of `serializeInventory`. Throws on malformed input.
 */
export function deserializeInventory(buf: Uint8Array): InventoryPlaintext {
	// Header is 40 bytes (1+1+1+1+8+8+16+4 = magic + tag + reserved +
	// version + latestCrdtIndex + nextAddr + count). The count field
	// at offset 36 needs bytes 36..39 in-bounds, so we require length
	// ≥ 40 BEFORE any DataView reads. (A length-< 40 buffer would
	// otherwise RangeError on getUint32(36) instead of throwing the
	// graceful Error below.)
	if (buf.length < 40) throw new Error('deserializeInventory: too short');
	if (buf[0] !== 0x56 || buf[1] !== 0x49) {
		throw new Error('deserializeInventory: missing VI magic');
	}
	if (buf[2] !== 0x01) {
		throw new Error(`deserializeInventory: unknown version tag ${buf[2]}`);
	}
	if (buf[3] !== 0x00) {
		throw new Error('deserializeInventory: non-zero reserved byte');
	}
	const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
	const version = view.getBigUint64(4, false);
	const latestCrdtIndex = view.getBigUint64(12, false);
	const nextAddr = buf.slice(20, 20 + INVENTORY_ADDRESS_BYTES);
	const count = view.getUint32(36, false);
	if (count > 1_000_000) {
		throw new Error(`deserializeInventory: implausible count ${count}`);
	}
	const expectedLen = 40 + count * 36;
	if (buf.length < expectedLen) {
		throw new Error(
			`deserializeInventory: buffer ${buf.length} < expected ${expectedLen}`
		);
	}
	const td = new TextDecoder();
	const blobIds: string[] = [];
	for (let i = 0; i < count; i++) {
		const start = 40 + i * 36;
		const slice = buf.subarray(start, start + 36);
		const id = td.decode(slice);
		if (!/^[0-9a-f-]{36}$/i.test(id)) {
			throw new Error(`deserializeInventory: invalid blobId at idx ${i}`);
		}
		blobIds.push(id);
	}
	return { blobIds, latestCrdtIndex, nextAddr, version };
}

/**
 * Encrypt an inventory plaintext for storage at the given address.
 * The AES key is derived from (vaultKey, address) so that re-using
 * the same address with a new payload mints a fresh AES key
 * implicitly — but the caller MUST also use a fresh nonce.
 *
 * Returns `{ nonce, ciphertext }`. The server stores them
 * concatenated as `[12-byte nonce || ciphertext+tag]`.
 */
export function sealInventory(
	vaultKey: Uint8Array,
	address: Uint8Array,
	plaintext: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	const key = deriveInventoryKey(vaultKey, address);
	const nonce = crypto.getRandomValues(new Uint8Array(INVENTORY_NONCE_BYTES));
	const cipher = gcm(key, nonce);
	const ciphertext = cipher.encrypt(plaintext);
	return { nonce, ciphertext };
}

/**
 * Inverse of `sealInventory`. Throws on AAD mismatch / tampering.
 */
export function openInventory(
	vaultKey: Uint8Array,
	address: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array
): Uint8Array {
	if (nonce.length !== INVENTORY_NONCE_BYTES) {
		throw new Error('openInventory: nonce must be 12 bytes');
	}
	const key = deriveInventoryKey(vaultKey, address);
	const cipher = gcm(key, nonce);
	return cipher.decrypt(ciphertext);
}

/**
 * Mint a fresh 16-byte inventory address (for rotation). The new
 * address is independent of the old, so a server-side observer
 * cannot link `next` to `prev`.
 */
export function rotateAddress(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(INVENTORY_ADDRESS_BYTES));
}

/**
 * Generate a fresh blob UUID. We use crypto.randomUUID() so the
 * result is 122 bits of randomness in the v4 layout. The server-
 * side regex `/^[0-9a-f-]{36}$/i` accepts this format.
 */
export function newBlobId(): string {
	return crypto.randomUUID();
}
