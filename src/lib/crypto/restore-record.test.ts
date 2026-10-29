/**
 * Restore record primitives (new-device restore).
 *
 *   - addresses are deterministic per (root, day, slot) and unrelated
 *     across days/slots/roots (V0-C1: nothing recurs without the root);
 *   - the record round-trips, pads to one fixed bucket, and refuses to
 *     open under a wrong root, a moved address, or a flipped byte;
 *   - the root wrap under the data key round-trips and fails closed.
 */

import { describe, expect, it } from 'vitest';
import {
	restoreAddress,
	restoreDay,
	sealRestoreRecord,
	openRestoreRecord,
	serializeRestoreRecord,
	deserializeRestoreRecord,
	wrapRestoreRoot,
	unwrapRestoreRoot,
	RESTORE_RECORD_BUCKET_BYTES,
	type RestoreRecordPayload
} from './restore-record';
import { encodeAddress } from '$lib/services/blob-inventory';

const ROOT = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);
const OTHER_ROOT = new Uint8Array(32).map((_, i) => (i * 13 + 7) & 0xff);
const AES_KEY = new Uint8Array(32).map((_, i) => (i * 3 + 1) & 0xff);

function payload(overrides: Partial<RestoreRecordPayload> = {}): RestoreRecordPayload {
	return {
		formatVersion: 3,
		authMode: 'production',
		deviceSalt: new Uint8Array(16).fill(0x5a),
		credentialId: new Uint8Array(48).map((_, i) => i),
		aesKey: AES_KEY.slice(),
		accountSeed: new Uint8Array(32).fill(0xa5),
		inventoryIndex: 17n,
		vaultBlobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		writtenAt: 1_700_000_000_000,
		opaqueClientId: 'c'.repeat(64),
		opaqueServerId: 'vuvault.app',
		opaqueAccountId: 'acct-123',
		deviceLabel: 'Dim’s MacBook',
		...overrides
	};
}

describe('restore-record · addresses', () => {
	it('is deterministic per (root, day, slot) and distinct across each input', () => {
		const a = restoreAddress(ROOT, 20_000, 0);
		expect(restoreAddress(ROOT, 20_000, 0)).toEqual(a);
		const addrs = [
			a,
			restoreAddress(ROOT, 20_001, 0),
			restoreAddress(ROOT, 20_000, 1),
			restoreAddress(OTHER_ROOT, 20_000, 0)
		].map(encodeAddress);
		expect(new Set(addrs).size).toBe(addrs.length);
		for (const s of addrs) expect(s).toMatch(/^[0-9a-z]{26}$/);
	});

	it('buckets time into UTC days', () => {
		expect(restoreDay(0)).toBe(0);
		expect(restoreDay(86_400_000 - 1)).toBe(0);
		expect(restoreDay(86_400_000)).toBe(1);
	});

	it('rejects out-of-range inputs', () => {
		expect(() => restoreAddress(ROOT.slice(0, 16), 1, 0)).toThrow(/32 bytes/);
		expect(() => restoreAddress(ROOT, -1, 0)).toThrow(/day/);
		expect(() => restoreAddress(ROOT, 1, 70_000)).toThrow(/slot/);
	});
});

describe('restore-record · serialization', () => {
	it('round-trips every field, with and without an account seed', () => {
		for (const seed of [new Uint8Array(32).fill(7), null]) {
			const p = payload({ accountSeed: seed });
			const back = deserializeRestoreRecord(serializeRestoreRecord(p));
			expect(back).toEqual(p);
		}
	});

	it('refuses malformed payloads', () => {
		expect(() => serializeRestoreRecord(payload({ deviceSalt: new Uint8Array(15) }))).toThrow();
		expect(() => serializeRestoreRecord(payload({ aesKey: new Uint8Array(16) }))).toThrow();
		expect(() => serializeRestoreRecord(payload({ vaultBlobId: 'nope' }))).toThrow();
		expect(() => serializeRestoreRecord(payload({ credentialId: new Uint8Array(0) }))).toThrow();
		const good = serializeRestoreRecord(payload());
		expect(() => deserializeRestoreRecord(good.slice(0, 40))).toThrow(/truncated|short/);
		const badMagic = good.slice();
		badMagic[0] = 0x00;
		expect(() => deserializeRestoreRecord(badMagic)).toThrow(/magic/);
	});
});

describe('restore-record · seal / open', () => {
	const addr = restoreAddress(ROOT, 20_123, 2);

	it('round-trips and pads every record to the same bucket', () => {
		const small = sealRestoreRecord(ROOT, addr, payload({ deviceLabel: 'a' }));
		const large = sealRestoreRecord(
			ROOT,
			addr,
			payload({ deviceLabel: 'x'.repeat(200), credentialId: new Uint8Array(900).fill(1) })
		);
		// GCM tag is 16 bytes on top of the padded plaintext.
		expect(small.ciphertext.length).toBe(RESTORE_RECORD_BUCKET_BYTES + 16);
		expect(large.ciphertext.length).toBe(RESTORE_RECORD_BUCKET_BYTES + 16);
		const back = openRestoreRecord(ROOT, addr, small.nonce, small.ciphertext);
		expect(back.deviceLabel).toBe('a');
		expect(back.aesKey).toEqual(AES_KEY);
		expect(back.inventoryIndex).toBe(17n);
	});

	it('fails closed under a wrong root, a moved address, or a flipped byte', () => {
		const sealed = sealRestoreRecord(ROOT, addr, payload());
		expect(() => openRestoreRecord(OTHER_ROOT, addr, sealed.nonce, sealed.ciphertext)).toThrow();
		const moved = restoreAddress(ROOT, 20_123, 3);
		expect(() => openRestoreRecord(ROOT, moved, sealed.nonce, sealed.ciphertext)).toThrow();
		const flipped = sealed.ciphertext.slice();
		flipped[100] = flipped[100]! ^ 0x01;
		expect(() => openRestoreRecord(ROOT, addr, sealed.nonce, flipped)).toThrow();
	});
});

describe('restore-record · root wrap under the data key', () => {
	it('round-trips and refuses a wrong data key', () => {
		const wrapped = wrapRestoreRoot(AES_KEY, ROOT);
		expect(unwrapRestoreRoot(AES_KEY, wrapped.nonce, wrapped.ciphertext)).toEqual(ROOT);
		const wrong = AES_KEY.slice();
		wrong[0] = wrong[0]! ^ 0xff;
		expect(() => unwrapRestoreRoot(wrong, wrapped.nonce, wrapped.ciphertext)).toThrow();
	});
});
