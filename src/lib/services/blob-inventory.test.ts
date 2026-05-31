/**
 * Unit tests for `blob-inventory.ts` — Phase 4 §L07b primitives.
 *
 * Contract under test:
 *   - `bootstrapAddress` is deterministic given (vaultKey, deviceSalt).
 *   - Different (vaultKey, deviceSalt) produce different addresses.
 *   - `rotateAddress` produces a fresh, non-deterministic 16-byte
 *     address each call.
 *   - `encodeAddress` / `decodeAddress` round-trip.
 *   - `serializeInventory` / `deserializeInventory` round-trip.
 *   - `sealInventory` / `openInventory` round-trip and reject
 *     tampered ciphertext (AES-GCM tag failure).
 *   - V1-C1 invariant: `deriveInventoryKey` for different addresses
 *     produces different keys.
 */

import { describe, expect, it } from 'vitest';
import {
	INVENTORY_ADDRESS_BYTES,
	bootstrapAddress,
	rotateAddress,
	encodeAddress,
	decodeAddress,
	serializeInventory,
	deserializeInventory,
	sealInventory,
	openInventory,
	deriveInventoryKey,
	newBlobId
} from './blob-inventory';

const VAULT_KEY = new Uint8Array(64).map((_, i) => (i * 7 + 3) & 0xff);
const DEVICE_SALT = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff);

describe('blob-inventory · address derivation', () => {
	it('bootstrapAddress is deterministic for same (vaultKey, deviceSalt)', () => {
		const a = bootstrapAddress(VAULT_KEY, DEVICE_SALT);
		const b = bootstrapAddress(VAULT_KEY, DEVICE_SALT);
		expect(a.length).toBe(INVENTORY_ADDRESS_BYTES);
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('bootstrapAddress changes when vaultKey changes', () => {
		const a = bootstrapAddress(VAULT_KEY, DEVICE_SALT);
		const other = new Uint8Array(VAULT_KEY);
		other[0] = (other[0]! ^ 1) & 0xff;
		const b = bootstrapAddress(other, DEVICE_SALT);
		expect(Array.from(a)).not.toEqual(Array.from(b));
	});

	it('bootstrapAddress changes when deviceSalt changes', () => {
		const a = bootstrapAddress(VAULT_KEY, DEVICE_SALT);
		const other = new Uint8Array(DEVICE_SALT);
		other[0] = (other[0]! ^ 1) & 0xff;
		const b = bootstrapAddress(VAULT_KEY, other);
		expect(Array.from(a)).not.toEqual(Array.from(b));
	});

	it('bootstrapAddress rejects empty inputs', () => {
		expect(() => bootstrapAddress(new Uint8Array(0), DEVICE_SALT)).toThrow();
		expect(() => bootstrapAddress(VAULT_KEY, new Uint8Array(0))).toThrow();
	});

	it('rotateAddress is 16 random bytes and changes on every call', () => {
		const a = rotateAddress();
		const b = rotateAddress();
		expect(a.length).toBe(INVENTORY_ADDRESS_BYTES);
		expect(b.length).toBe(INVENTORY_ADDRESS_BYTES);
		expect(Array.from(a)).not.toEqual(Array.from(b));
	});
});

describe('blob-inventory · Crockford base32', () => {
	it('encode/decode round-trips for canonical addresses', () => {
		for (let i = 0; i < 16; i++) {
			const addr = new Uint8Array(16).map(() =>
				Math.floor(Math.random() * 256)
			);
			const encoded = encodeAddress(addr);
			expect(encoded).toMatch(/^[a-z0-9]{26}$/);
			const back = decodeAddress(encoded);
			expect(Array.from(back)).toEqual(Array.from(addr));
		}
	});

	it('encodes lowercase by default', () => {
		const addr = new Uint8Array(16).fill(0xff);
		expect(encodeAddress(addr)).toBe(encodeAddress(addr).toLowerCase());
	});

	it('accepts uppercase input on decode', () => {
		const addr = new Uint8Array(16).map((_, i) => i);
		const enc = encodeAddress(addr);
		const back = decodeAddress(enc.toUpperCase());
		expect(Array.from(back)).toEqual(Array.from(addr));
	});

	it('rejects malformed addresses', () => {
		expect(() => decodeAddress('not-a-real-address!!!')).toThrow();
		expect(() => decodeAddress('a'.repeat(25))).toThrow(); // too short
		expect(() => decodeAddress('a'.repeat(27))).toThrow(); // too long
	});

	it('encode rejects wrong-size address', () => {
		expect(() => encodeAddress(new Uint8Array(15))).toThrow();
		expect(() => encodeAddress(new Uint8Array(17))).toThrow();
	});
});

describe('blob-inventory · serialize / deserialize', () => {
	it('round-trips an empty inventory', () => {
		const p = {
			blobIds: [] as string[],
			latestCrdtIndex: 0n,
			nextAddr: rotateAddress(),
			version: 1n
		};
		const buf = serializeInventory(p);
		const back = deserializeInventory(buf);
		expect(back.blobIds).toEqual([]);
		expect(back.latestCrdtIndex).toBe(0n);
		expect(Array.from(back.nextAddr)).toEqual(Array.from(p.nextAddr));
		expect(back.version).toBe(1n);
	});

	it('round-trips a populated inventory', () => {
		const blobIds = [newBlobId(), newBlobId(), newBlobId()];
		const p = {
			blobIds,
			latestCrdtIndex: 12345678901234n,
			nextAddr: rotateAddress(),
			version: 7n
		};
		const buf = serializeInventory(p);
		const back = deserializeInventory(buf);
		expect(back.blobIds).toEqual(blobIds);
		expect(back.latestCrdtIndex).toBe(12345678901234n);
		expect(Array.from(back.nextAddr)).toEqual(Array.from(p.nextAddr));
		expect(back.version).toBe(7n);
	});

	it('rejects malformed inputs', () => {
		expect(() => deserializeInventory(new Uint8Array(0))).toThrow();
		const bad = new Uint8Array(40);
		bad[0] = 0xff; // wrong magic
		expect(() => deserializeInventory(bad)).toThrow(/magic/);
	});

	it('rejects 38- and 39-byte buffers with a graceful "too short" error', () => {
		// Regression: before the fix, the length guard was `< 38` but
		// the count field at offset 36 needs bytes 36..39 in-bounds.
		// A length-38 buffer would pass the guard then throw a raw
		// RangeError from DataView.getUint32. The new guard `< 40`
		// returns a graceful Error instead.
		for (const n of [1, 38, 39]) {
			const tooShort = new Uint8Array(n);
			tooShort[0] = 0x56;
			tooShort[1] = 0x49;
			if (n > 2) tooShort[2] = 0x01;
			expect(() => deserializeInventory(tooShort)).toThrow(/too short/);
		}
	});

	it('rejects invalid blobIds', () => {
		expect(() =>
			serializeInventory({
				blobIds: ['not-a-uuid'],
				latestCrdtIndex: 0n,
				nextAddr: rotateAddress(),
				version: 1n
			})
		).toThrow();
	});
});

describe('blob-inventory · seal / open AES-GCM', () => {
	it('round-trips an inventory through the AES-GCM seal/open', () => {
		const addr = rotateAddress();
		const p = {
			blobIds: [newBlobId(), newBlobId()],
			latestCrdtIndex: 99n,
			nextAddr: rotateAddress(),
			version: 1n
		};
		const plaintext = serializeInventory(p);
		const { nonce, ciphertext } = sealInventory(VAULT_KEY, addr, plaintext);
		expect(nonce.length).toBe(12);
		const opened = openInventory(VAULT_KEY, addr, nonce, ciphertext);
		const back = deserializeInventory(opened);
		expect(back.blobIds).toEqual(p.blobIds);
		expect(back.version).toBe(p.version);
	});

	it('rejects ciphertext tampering (AES-GCM tag failure)', () => {
		const addr = rotateAddress();
		const p = {
			blobIds: [newBlobId()],
			latestCrdtIndex: 1n,
			nextAddr: rotateAddress(),
			version: 1n
		};
		const { nonce, ciphertext } = sealInventory(
			VAULT_KEY,
			addr,
			serializeInventory(p)
		);
		const tampered = new Uint8Array(ciphertext);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		expect(() => openInventory(VAULT_KEY, addr, nonce, tampered)).toThrow();
	});

	it('rejects wrong inventory key (different address)', () => {
		const addr = rotateAddress();
		const p = {
			blobIds: [newBlobId()],
			latestCrdtIndex: 1n,
			nextAddr: rotateAddress(),
			version: 1n
		};
		const { nonce, ciphertext } = sealInventory(
			VAULT_KEY,
			addr,
			serializeInventory(p)
		);
		// Different address → different derived key → tag failure.
		expect(() =>
			openInventory(VAULT_KEY, rotateAddress(), nonce, ciphertext)
		).toThrow();
	});

	it('V1-C1: different addresses produce different inventory keys', () => {
		const a1 = rotateAddress();
		const a2 = rotateAddress();
		const k1 = deriveInventoryKey(VAULT_KEY, a1);
		const k2 = deriveInventoryKey(VAULT_KEY, a2);
		expect(Array.from(k1)).not.toEqual(Array.from(k2));
	});
});

describe('blob-inventory · newBlobId', () => {
	it('mints canonical UUID v4 strings', () => {
		for (let i = 0; i < 4; i++) {
			const id = newBlobId();
			expect(id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
			);
		}
	});

	it('mints unique IDs on consecutive calls', () => {
		const ids = new Set([newBlobId(), newBlobId(), newBlobId(), newBlobId()]);
		expect(ids.size).toBe(4);
	});
});
