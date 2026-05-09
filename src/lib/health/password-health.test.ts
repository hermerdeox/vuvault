import { describe, expect, it } from 'vitest';
import {
	estimatePasswordStrength,
	hashPasswordForReuse,
	computeVaultHealth,
	WEAK_BITS_THRESHOLD
} from './password-health';

describe('estimatePasswordStrength', () => {
	it('flags an empty password as weak', () => {
		const r = estimatePasswordStrength('');
		expect(r.weak).toBe(true);
		expect(r.reason).toBe('short');
	});

	it('flags short passwords as weak even with diverse charset', () => {
		const r = estimatePasswordStrength('aB3$');
		expect(r.weak).toBe(true);
		expect(r.reason).toBe('short');
	});

	it('flags a known common password as weak regardless of length', () => {
		const r = estimatePasswordStrength('Password123'.toLowerCase());
		expect(r.weak).toBe(true);
		expect(r.reason).toBe('common');
	});

	it('rejects a long but low-entropy password', () => {
		// 12 lowercase chars: log2(26) * 12 ≈ 56 bits, below threshold.
		const r = estimatePasswordStrength('abcdefghijkl');
		expect(r.weak).toBe(true);
		expect(r.bits).toBeLessThan(WEAK_BITS_THRESHOLD);
	});

	it('accepts a strong password', () => {
		const r = estimatePasswordStrength('Tr0ub4dor&3-Lemon-Sky-Forest');
		expect(r.weak).toBe(false);
		expect(r.bits).toBeGreaterThanOrEqual(WEAK_BITS_THRESHOLD);
	});
});

describe('hashPasswordForReuse', () => {
	it('returns a deterministic SHA-384 hex of the input', async () => {
		const a = await hashPasswordForReuse('hello');
		const b = await hashPasswordForReuse('hello');
		expect(a).toBe(b);
		expect(a).toHaveLength(96); // SHA-384 → 384 bits → 96 hex chars
	});

	it('different inputs produce different hashes', async () => {
		const a = await hashPasswordForReuse('hello');
		const b = await hashPasswordForReuse('world');
		expect(a).not.toBe(b);
	});

	it('handles unicode without throwing', async () => {
		const out = await hashPasswordForReuse('café-🔒-vault');
		expect(out).toHaveLength(96);
	});

	it('returns empty string for empty input', async () => {
		expect(await hashPasswordForReuse('')).toBe('');
	});
});

describe('computeVaultHealth', () => {
	it('groups items that share the same password as reused', async () => {
		const items = [
			{ id: 'a', password: 'StrongUnique-AAAA-1234!' },
			{ id: 'b', password: 'StrongUnique-AAAA-1234!' }, // duplicate of a
			{ id: 'c', password: 'StrongUnique-CCCC-5678!' }
		];
		const health = await computeVaultHealth(items);
		expect(health.reusedIds.has('a')).toBe(true);
		expect(health.reusedIds.has('b')).toBe(true);
		expect(health.reusedIds.has('c')).toBe(false);
		expect(health.reusedCount).toBe(2);
	});

	it('counts weak passwords', async () => {
		const items = [
			{ id: 'short', password: 'aB3$' }, // weak: short
			{ id: 'common', password: 'password' }, // weak: common
			{ id: 'strong', password: 'Tr0ub4dor&3-Lemon-Sky-Forest' }
		];
		const health = await computeVaultHealth(items);
		expect(health.weakIds.has('short')).toBe(true);
		expect(health.weakIds.has('common')).toBe(true);
		expect(health.weakIds.has('strong')).toBe(false);
		expect(health.weakCount).toBe(2);
	});

	it('skips items that have no password', async () => {
		const items = [
			{ id: 'a' },
			{ id: 'b', password: '' },
			{ id: 'c', password: 'StrongUnique-XXXX-9999!' }
		];
		const health = await computeVaultHealth(items);
		expect(health.byId.has('a')).toBe(false);
		expect(health.byId.has('b')).toBe(false);
		expect(health.byId.has('c')).toBe(true);
	});

	it('returned VaultHealth never contains plaintext password material', async () => {
		const SECRET = 'StrongUnique-AAAA-1234!';
		const items = [{ id: 'a', password: SECRET }];
		const health = await computeVaultHealth(items);
		const dump = JSON.stringify(
			{
				weakIds: Array.from(health.weakIds),
				reusedIds: Array.from(health.reusedIds),
				byId: Array.from(health.byId.entries()).map(([k, v]) => [
					k,
					{ ...v }
				])
			},
			null,
			2
		);
		expect(dump).not.toContain(SECRET);
	});
});
