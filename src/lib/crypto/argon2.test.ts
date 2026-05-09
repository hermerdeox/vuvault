/**
 * Argon2id (RFC 9106) tests.
 *
 * The production VAULT_HIGH_PARAMS preset (~2–3s per call, 256 MiB
 * memory) is too heavy for fast unit testing. We use the lower-cost
 * TEST_PARAMS for round-trip + property tests, and exercise the WASM
 * binary's parameter switches with a separate determinism test at
 * higher (but still tractable) costs.
 */

import { describe, expect, it } from 'vitest';
import {
	deriveMasterPasswordKey,
	generateMasterPasswordSalt,
	VAULT_HIGH_PARAMS,
	TEST_PARAMS,
	_resetArgon2
} from './argon2';

const SALT = new TextEncoder().encode('vuvault-salt-16b');
expectSaltLen();
function expectSaltLen() {
	if (SALT.length !== 16) throw new Error('test salt should be 16 bytes');
}

describe('Argon2id · deriveMasterPasswordKey', () => {
	it('returns a 32-byte key', async () => {
		const key = await deriveMasterPasswordKey({
			password: 'correct-horse-battery-staple',
			salt: SALT,
			params: TEST_PARAMS
		});
		expect(key).toHaveLength(32);
	});

	it('is deterministic for the same (password, salt, params)', async () => {
		const a = await deriveMasterPasswordKey({
			password: 'pw',
			salt: SALT,
			params: TEST_PARAMS
		});
		const b = await deriveMasterPasswordKey({
			password: 'pw',
			salt: SALT,
			params: TEST_PARAMS
		});
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
	});

	it('different passwords produce different keys', async () => {
		const a = await deriveMasterPasswordKey({
			password: 'pw-a',
			salt: SALT,
			params: TEST_PARAMS
		});
		const b = await deriveMasterPasswordKey({
			password: 'pw-b',
			salt: SALT,
			params: TEST_PARAMS
		});
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	it('different salts produce different keys', async () => {
		const otherSalt = new TextEncoder().encode('different-salt-x');
		const a = await deriveMasterPasswordKey({
			password: 'pw',
			salt: SALT,
			params: TEST_PARAMS
		});
		const b = await deriveMasterPasswordKey({
			password: 'pw',
			salt: otherSalt,
			params: TEST_PARAMS
		});
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	it('different params produce different keys', async () => {
		const a = await deriveMasterPasswordKey({
			password: 'pw',
			salt: SALT,
			params: { ...TEST_PARAMS, iterations: 1 }
		});
		const b = await deriveMasterPasswordKey({
			password: 'pw',
			salt: SALT,
			params: { ...TEST_PARAMS, iterations: 2 }
		});
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	it('rejects empty password', async () => {
		await expect(
			deriveMasterPasswordKey({
				password: '',
				salt: SALT,
				params: TEST_PARAMS
			})
		).rejects.toThrow(/non-empty/);
	});

	it('rejects empty salt', async () => {
		await expect(
			deriveMasterPasswordKey({
				password: 'pw',
				salt: new Uint8Array(0),
				params: TEST_PARAMS
			})
		).rejects.toThrow(/salt must be non-empty/);
	});

	it('rejects non-32-byte tag length', async () => {
		await expect(
			deriveMasterPasswordKey({
				password: 'pw',
				salt: SALT,
				params: { ...TEST_PARAMS, tagLength: 16 }
			})
		).rejects.toThrow(/tagLength must be 32/);
	});

	it('VAULT_HIGH_PARAMS pins the production preset (256 MiB, t=4, p=1)', () => {
		// This test only locks the constants from drifting — it makes
		// no claim about matching any externally-published preset.
		// Rationale for these specific numbers lives in the header
		// comment of `argon2.ts`.
		expect(VAULT_HIGH_PARAMS).toEqual({
			memoryKiB: 262144,
			iterations: 4,
			parallelism: 1,
			tagLength: 32
		});
	});

	it('generateMasterPasswordSalt returns 16 bytes', () => {
		const a = generateMasterPasswordSalt();
		const b = generateMasterPasswordSalt();
		expect(a).toHaveLength(16);
		expect(b).toHaveLength(16);
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});
});

import katFile from './kat/argon2id-rfc9106.json' with { type: 'json' };

type RfcKatCase = {
	label: string;
	params: {
		memoryKiB: number;
		iterations: number;
		parallelism: number;
		tagLength: number;
	};
	password: string;
	salt: string;
	secret: string;
	ad: string;
	tag: string;
};

function fromHex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

describe('Argon2id · RFC 9106 §5.3 known-answer test', () => {
	const cases = (katFile as { cases: RfcKatCase[] }).cases;

	it('vector file is well-formed', () => {
		expect(cases.length).toBeGreaterThanOrEqual(1);
		for (const c of cases) {
			expect(c.params.tagLength).toBe(32);
			expect(c.tag).toMatch(/^[0-9a-f]{64}$/);
		}
	});

	for (const kat of cases) {
		it(`${kat.label}: produces the RFC-9106-published 32-byte tag byte-for-byte`, async () => {
			// Drop the cached WASM module first so the 32-KiB allocation
			// for this case doesn't fight the 256-KiB allocation from
			// the determinism describe below.
			_resetArgon2();
			const tag = await deriveMasterPasswordKey({
				password: kat.password,
				salt: fromHex(kat.salt),
				secret: fromHex(kat.secret),
				ad: fromHex(kat.ad),
				params: kat.params,
				rawHexPassword: true
			});
			expect(tag).toHaveLength(32);
			expect(Buffer.from(tag).equals(Buffer.from(fromHex(kat.tag)))).toBe(true);
		});
	}
});
