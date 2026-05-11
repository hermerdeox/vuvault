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
	TEST_PARAMS
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

// RFC 9106 §5.3 KAT lives in `argon2id-rfc9106.kat.test.ts` so it
// runs under both `npm run test` and `npm run test:fips`.
