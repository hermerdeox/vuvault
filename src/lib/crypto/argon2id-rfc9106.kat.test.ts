/**
 * Argon2id RFC 9106 §5.3 known-answer test.
 *
 * Pinned KAT runner that proves our `argon2id` integration produces
 * the published byte-for-byte tag for the canonical RFC 9106 §5.3
 * vector. This sibling file (with `.kat.test.ts` in the name) is what
 * `npm run test:fips` (`vitest run kat.test`) picks up alongside the
 * FIPS 203 ML-KEM-1024 runners.
 *
 * The full Argon2id unit / property test surface lives in
 * `argon2.test.ts`, which runs under `npm run test`. Both files share
 * the same `kat/argon2id-rfc9106.json` vector file.
 */

import { describe, expect, it } from 'vitest';
import { deriveMasterPasswordKey, _resetArgon2 } from './argon2';
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

describe('Argon2id · RFC 9106 §5.3 known-answer test (kat)', () => {
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
