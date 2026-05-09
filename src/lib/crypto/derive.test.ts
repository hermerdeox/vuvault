import { describe, expect, it } from 'vitest';
import {
	deriveVaultKey,
	generateDeviceSalt,
	VAULT_KEY_LEN,
	PRF_OUTPUT_LEN,
	SECRET_KEY_LEN,
	DEVICE_SALT_LEN
} from './derive';

function bytes(len: number, fill = 0x42): Uint8Array {
	const out = new Uint8Array(len);
	out.fill(fill);
	return out;
}

describe('deriveVaultKey', () => {
	it('returns 32 bytes', () => {
		const key = deriveVaultKey({
			prfOutput: bytes(PRF_OUTPUT_LEN),
			secretKey: bytes(SECRET_KEY_LEN, 0x99),
			deviceSalt: bytes(DEVICE_SALT_LEN, 0x11)
		});
		expect(key).toHaveLength(VAULT_KEY_LEN);
	});

	it('is deterministic across calls with the same inputs', () => {
		const opts = {
			prfOutput: bytes(PRF_OUTPUT_LEN, 0x10),
			secretKey: bytes(SECRET_KEY_LEN, 0x20),
			deviceSalt: bytes(DEVICE_SALT_LEN, 0x30)
		};
		const a = deriveVaultKey(opts);
		const b = deriveVaultKey(opts);
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('changes when any factor changes', () => {
		const base = {
			prfOutput: bytes(PRF_OUTPUT_LEN, 0x10),
			secretKey: bytes(SECRET_KEY_LEN, 0x20),
			deviceSalt: bytes(DEVICE_SALT_LEN, 0x30)
		};
		const original = deriveVaultKey(base);
		const altPrf = deriveVaultKey({ ...base, prfOutput: bytes(PRF_OUTPUT_LEN, 0x11) });
		const altSk = deriveVaultKey({ ...base, secretKey: bytes(SECRET_KEY_LEN, 0x21) });
		const altSalt = deriveVaultKey({ ...base, deviceSalt: bytes(DEVICE_SALT_LEN, 0x31) });
		expect(Array.from(original)).not.toEqual(Array.from(altPrf));
		expect(Array.from(original)).not.toEqual(Array.from(altSk));
		expect(Array.from(original)).not.toEqual(Array.from(altSalt));
	});

	it('rejects wrong-size inputs', () => {
		expect(() =>
			deriveVaultKey({
				prfOutput: bytes(31),
				secretKey: bytes(SECRET_KEY_LEN),
				deviceSalt: bytes(DEVICE_SALT_LEN)
			})
		).toThrow(/prfOutput must be 32 bytes/);
		expect(() =>
			deriveVaultKey({
				prfOutput: bytes(PRF_OUTPUT_LEN),
				secretKey: bytes(33),
				deviceSalt: bytes(DEVICE_SALT_LEN)
			})
		).toThrow(/secretKey must be 32 bytes/);
		expect(() =>
			deriveVaultKey({
				prfOutput: bytes(PRF_OUTPUT_LEN),
				secretKey: bytes(SECRET_KEY_LEN),
				deviceSalt: bytes(15)
			})
		).toThrow(/deviceSalt must be 16 bytes/);
	});
});

describe('generateDeviceSalt', () => {
	it('returns 16 bytes', () => {
		expect(generateDeviceSalt()).toHaveLength(DEVICE_SALT_LEN);
	});
});

describe('deriveVaultKey · v2 with OPAQUE export key (M2)', () => {
	const base = {
		prfOutput: bytes(PRF_OUTPUT_LEN, 0xaa),
		secretKey: bytes(SECRET_KEY_LEN, 0xbb),
		deviceSalt: bytes(DEVICE_SALT_LEN, 0xcc)
	};

	it('v1 and v2 derive identical keys for identical inputs without OPAQUE', () => {
		// This is the property that makes the v1 → v2 on-save upgrade
		// transparent for non-OPAQUE accounts: openVault derives the
		// same vaultKey under either version when no extra material is
		// present. The version distinction is carried by the AAD, not
		// the HKDF info.
		const v1 = deriveVaultKey({ ...base });
		const v2 = deriveVaultKey({ ...base, version: 2 });
		expect(Array.from(v1)).toEqual(Array.from(v2));
	});

	it('v2 + opaqueExportKey changes the derived key', () => {
		const baseV2 = deriveVaultKey({ ...base, version: 2 });
		const withExport = deriveVaultKey({
			...base,
			version: 2,
			opaqueExportKey: bytes(64, 0x77)
		});
		expect(Array.from(baseV2)).not.toEqual(Array.from(withExport));
	});

	it('v1 rejects opaqueExportKey', () => {
		expect(() =>
			deriveVaultKey({
				...base,
				opaqueExportKey: bytes(64, 0x55)
			})
		).toThrow(/only supported when version=2/);
	});

	it('v2 rejects opaqueExportKey shorter than 32 bytes', () => {
		expect(() =>
			deriveVaultKey({
				...base,
				version: 2,
				opaqueExportKey: bytes(16, 0x55)
			})
		).toThrow(/at least 32 bytes/);
	});

	it('only the leading 32 bytes of opaqueExportKey are used', () => {
		// SHA-512 export keys from Ristretto255 OPAQUE are 64 bytes;
		// VuVault's HKDF only consumes the first 32. Two 64-byte
		// keys that share the leading 32 must produce identical
		// vault keys.
		const head = bytes(32, 0x44);
		const tailA = new Uint8Array(64);
		tailA.set(head, 0);
		tailA.fill(0x88, 32);
		const tailB = new Uint8Array(64);
		tailB.set(head, 0);
		tailB.fill(0x99, 32);
		const a = deriveVaultKey({ ...base, version: 2, opaqueExportKey: tailA });
		const b = deriveVaultKey({ ...base, version: 2, opaqueExportKey: tailB });
		expect(Array.from(a)).toEqual(Array.from(b));
	});
});
