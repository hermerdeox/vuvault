/**
 * ML-KEM-1024 deterministic regression vectors.
 *
 * Locks our `@noble/post-quantum` integration to byte-stable output for a
 * fixed set of (seed, msg) inputs. Any silent upstream change to
 * `ml_kem1024.keygen()` or `ml_kem1024.encapsulate()` that alters the
 * derived public/secret/ciphertext bytes — for any reason, security or
 * otherwise — fails this test loudly.
 *
 * The vectors live in `kat/ml-kem-1024.json` alongside the noble version
 * they were generated against. To regenerate after a deliberate noble
 * upgrade, re-run the generator described in the JSON header notes.
 *
 * This is the "FIPS 203 regression suite" that `npm run test:fips`
 * targets in CI; it runs in the standard `npm run test` matrix as well.
 */

import { describe, expect, it } from 'vitest';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem';
import { sha384 } from '@noble/hashes/sha2';
import katVectors from './kat/ml-kem-1024.json' with { type: 'json' };

type KatCase = {
	label: string;
	seed: string;
	msg: string;
	publicKeySha384: string;
	secretKeySha384: string;
	cipherTextSha384: string;
	sharedSecret: string;
};

function fromHex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function toHex(u8: Uint8Array): string {
	return Array.from(u8)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

const cases = (katVectors as { cases: KatCase[] }).cases;

describe('ML-KEM-1024 · FIPS 203 deterministic vectors', () => {
	it('the KAT JSON references @noble/post-quantum and is non-empty', () => {
		// Sanity: a corrupt or missing vector file is itself a CI signal.
		expect(cases.length).toBeGreaterThanOrEqual(5);
	});

	for (const kat of cases) {
		it(`reproduces ${kat.label} keygen + encapsulate + decapsulate byte-for-byte`, () => {
			const seed = fromHex(kat.seed);
			const msg = fromHex(kat.msg);
			expect(seed).toHaveLength(64);
			expect(msg).toHaveLength(32);

			const kp = ml_kem1024.keygen(seed);
			expect(kp.publicKey).toHaveLength(1568);
			expect(kp.secretKey).toHaveLength(3168);
			expect(toHex(sha384(kp.publicKey))).toBe(kat.publicKeySha384);
			expect(toHex(sha384(kp.secretKey))).toBe(kat.secretKeySha384);

			const enc = ml_kem1024.encapsulate(kp.publicKey, msg);
			expect(enc.cipherText).toHaveLength(1568);
			expect(enc.sharedSecret).toHaveLength(32);
			expect(toHex(sha384(enc.cipherText))).toBe(kat.cipherTextSha384);
			expect(toHex(enc.sharedSecret)).toBe(kat.sharedSecret);

			const ss = ml_kem1024.decapsulate(enc.cipherText, kp.secretKey);
			expect(toHex(ss)).toBe(kat.sharedSecret);
		});
	}
});
