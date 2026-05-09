/**
 * ML-KEM-1024 NIST ACVP FIPS 203 known-answer tests (keyGen).
 *
 * These vectors are an unmodified slice (tcId 51-55) of the
 * `usnistgov/ACVP-Server` ML-KEM-keyGen-FIPS203 corpus. The
 * `sourceCommit` field in the JSON pins the upstream commit at
 * extraction time so an auditor can reproduce the vectors with one
 * `curl` command (see `scripts/build-acvp-kat.mjs` for the recipe).
 *
 * For each case we run `ml_kem1024.keygen(d || z)` and assert
 * byte-for-byte equality with the ACVP-published `ek` and `dk`. This
 * is a stronger conformance assertion than the noble-self-generated
 * regression vectors in `ml-kem-1024.kat.test.ts`: those lock the
 * noble integration to byte-stable output, while these lock noble's
 * output to NIST-published material.
 *
 * Both files are intentionally kept — the noble-locked file also
 * exercises encapsulate / decapsulate (which the ACVP keyGen file
 * cannot, since keyGen vectors do not include encaps randomness).
 *
 * Runs under `npm run test:fips` (matched by `kat.test`).
 */

import { describe, expect, it } from 'vitest';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem';
import katVectors from './kat/ml-kem-1024-acvp.json' with { type: 'json' };

type AcvpKatCase = {
	tcId: number;
	tgId: number;
	parameterSet: 'ML-KEM-1024';
	z: string;
	d: string;
	ek: string;
	dk: string;
};

type AcvpKatFile = {
	source: string;
	sourceCommit: string;
	algorithm: 'ML-KEM-1024';
	fips: 'FIPS 203';
	cases: AcvpKatCase[];
};

function fromHex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

const file = katVectors as AcvpKatFile;
const cases = file.cases;

describe('ML-KEM-1024 · NIST ACVP FIPS 203 keyGen KAT', () => {
	it('vector file has a pinned ACVP source commit and at least 3 cases', () => {
		expect(file.source).toMatch(/ACVP-Server/);
		expect(file.fips).toBe('FIPS 203');
		expect(file.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
		expect(cases.length).toBeGreaterThanOrEqual(3);
		for (const c of cases) expect(c.parameterSet).toBe('ML-KEM-1024');
	});

	for (const kat of cases) {
		it(`tcId ${kat.tcId}: noble keygen(d || z) matches ACVP-published ek/dk byte-for-byte`, () => {
			const d = fromHex(kat.d);
			const z = fromHex(kat.z);
			expect(d).toHaveLength(32);
			expect(z).toHaveLength(32);

			const seed = new Uint8Array(64);
			seed.set(d, 0);
			seed.set(z, 32);

			const kp = ml_kem1024.keygen(seed);
			const expectedEk = fromHex(kat.ek);
			const expectedDk = fromHex(kat.dk);
			expect(kp.publicKey).toHaveLength(1568);
			expect(kp.secretKey).toHaveLength(3168);
			expect(expectedEk).toHaveLength(1568);
			expect(expectedDk).toHaveLength(3168);
			expect(Buffer.from(kp.publicKey).equals(Buffer.from(expectedEk))).toBe(
				true
			);
			expect(Buffer.from(kp.secretKey).equals(Buffer.from(expectedDk))).toBe(
				true
			);
		});
	}
});
