/**
 * Unit tests for `voprf.ts` — RFC 9497 VOPRF over Ristretto255.
 *
 * Contract under test:
 *   - publicKey is deterministic from secretKey.
 *   - blind/blindEvaluate/finalize round-trips: finalize() output is
 *     deterministic in (input, sk) regardless of the random blind r.
 *   - DLEQ proof rejects a tampered evaluatedElement.
 *   - DLEQ proof rejects when the server used a DIFFERENT key.
 *   - DLEQ proof rejects a tampered proof.
 *   - Two different inputs produce different outputs.
 *   - Two different keys produce different outputs for the same input.
 *   - capabilityFromVoprfOutput returns 32 bytes deterministically.
 */

import { describe, expect, it } from 'vitest';
import {
	publicKey,
	blind,
	blindEvaluate,
	finalize,
	verifyProof,
	capabilityFromVoprfOutput,
	VOPRF_SCALAR_LEN,
	VOPRF_POINT_LEN,
	VOPRF_PROOF_LEN,
	VOPRF_OUTPUT_LEN
} from './voprf';

const TEST_SK = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const TEST_INPUT = new TextEncoder().encode('vuvault-test-account-seed');

describe('voprf · basics', () => {
	it('exports lengths match Ristretto255-SHA512 ciphersuite', () => {
		expect(VOPRF_SCALAR_LEN).toBe(32);
		expect(VOPRF_POINT_LEN).toBe(32);
		expect(VOPRF_PROOF_LEN).toBe(64);
		expect(VOPRF_OUTPUT_LEN).toBe(64);
	});

	it('publicKey is deterministic from a secret key', () => {
		const pk1 = publicKey(TEST_SK);
		const pk2 = publicKey(TEST_SK);
		expect(pk1.length).toBe(VOPRF_POINT_LEN);
		expect(Array.from(pk1)).toEqual(Array.from(pk2));
	});

	it('different secret keys yield different public keys', () => {
		const sk2 = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);
		const pk1 = publicKey(TEST_SK);
		const pk2 = publicKey(sk2);
		expect(Array.from(pk1)).not.toEqual(Array.from(pk2));
	});

	it('blind produces 32-byte blind + 32-byte blindedElement', () => {
		const { blind: r, blindedElement } = blind(TEST_INPUT);
		expect(r.length).toBe(VOPRF_SCALAR_LEN);
		expect(blindedElement.length).toBe(VOPRF_POINT_LEN);
	});

	it('blind is randomized — same input twice yields different blinded elements', () => {
		const a = blind(TEST_INPUT);
		const b = blind(TEST_INPUT);
		expect(Array.from(a.blind)).not.toEqual(Array.from(b.blind));
		expect(Array.from(a.blindedElement)).not.toEqual(Array.from(b.blindedElement));
	});
});

describe('voprf · three-message round trip', () => {
	it('finalize output is deterministic in (input, sk) regardless of blind r', () => {
		const pk = publicKey(TEST_SK);

		// Run twice with FRESH blinds — outputs must match.
		const a1 = blind(TEST_INPUT);
		const e1 = blindEvaluate(TEST_SK, pk, a1.blindedElement);
		const out1 = finalize(TEST_INPUT, a1.blind, e1.evaluatedElement, e1.proof, pk);
		expect(out1).not.toBeNull();
		expect(out1!.length).toBe(VOPRF_OUTPUT_LEN);

		const a2 = blind(TEST_INPUT);
		const e2 = blindEvaluate(TEST_SK, pk, a2.blindedElement);
		const out2 = finalize(TEST_INPUT, a2.blind, e2.evaluatedElement, e2.proof, pk);
		expect(out2).not.toBeNull();
		expect(Array.from(out1!)).toEqual(Array.from(out2!));
	});

	it('different inputs produce different outputs (same sk)', () => {
		const pk = publicKey(TEST_SK);
		const inA = new TextEncoder().encode('alpha');
		const inB = new TextEncoder().encode('beta');
		const aA = blind(inA);
		const eA = blindEvaluate(TEST_SK, pk, aA.blindedElement);
		const outA = finalize(inA, aA.blind, eA.evaluatedElement, eA.proof, pk);
		const aB = blind(inB);
		const eB = blindEvaluate(TEST_SK, pk, aB.blindedElement);
		const outB = finalize(inB, aB.blind, eB.evaluatedElement, eB.proof, pk);
		expect(outA).not.toBeNull();
		expect(outB).not.toBeNull();
		expect(Array.from(outA!)).not.toEqual(Array.from(outB!));
	});

	it('different keys produce different outputs (same input)', () => {
		const sk2 = new Uint8Array(32).map((_, i) => (i * 13 + 1) & 0xff);
		const pk1 = publicKey(TEST_SK);
		const pk2 = publicKey(sk2);
		const a1 = blind(TEST_INPUT);
		const e1 = blindEvaluate(TEST_SK, pk1, a1.blindedElement);
		const out1 = finalize(TEST_INPUT, a1.blind, e1.evaluatedElement, e1.proof, pk1);
		const a2 = blind(TEST_INPUT);
		const e2 = blindEvaluate(sk2, pk2, a2.blindedElement);
		const out2 = finalize(TEST_INPUT, a2.blind, e2.evaluatedElement, e2.proof, pk2);
		expect(out1).not.toBeNull();
		expect(out2).not.toBeNull();
		expect(Array.from(out1!)).not.toEqual(Array.from(out2!));
	});
});

describe('voprf · DLEQ proof verifies', () => {
	it('verifyProof accepts a fresh proof', () => {
		const pk = publicKey(TEST_SK);
		const a = blind(TEST_INPUT);
		const e = blindEvaluate(TEST_SK, pk, a.blindedElement);
		expect(verifyProof(pk, a.blindedElement, e.evaluatedElement, e.proof)).toBe(true);
	});

	it('rejects a tampered evaluatedElement', () => {
		const pk = publicKey(TEST_SK);
		const a = blind(TEST_INPUT);
		const e = blindEvaluate(TEST_SK, pk, a.blindedElement);
		const tampered = new Uint8Array(e.evaluatedElement);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		expect(verifyProof(pk, a.blindedElement, tampered, e.proof)).toBe(false);
	});

	it('rejects a tampered proof', () => {
		const pk = publicKey(TEST_SK);
		const a = blind(TEST_INPUT);
		const e = blindEvaluate(TEST_SK, pk, a.blindedElement);
		const tampered = new Uint8Array(e.proof);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		expect(verifyProof(pk, a.blindedElement, e.evaluatedElement, tampered)).toBe(false);
	});

	it('rejects when the server used a DIFFERENT key (server bias attack)', () => {
		// Two different server keys. Server pretends to use pk1
		// (publishes pk1) but evaluates with sk2. The proof
		// (which is over pk1) MUST fail.
		const sk1 = TEST_SK;
		const sk2 = new Uint8Array(32).map((_, i) => (i * 17 + 1) & 0xff);
		const pk1 = publicKey(sk1);
		const a = blind(TEST_INPUT);
		const bogusEval = blindEvaluate(sk2, publicKey(sk2), a.blindedElement);
		// Replace the pk in the verifier's view with pk1 — proof
		// over pk2 fails against pk1.
		expect(verifyProof(pk1, a.blindedElement, bogusEval.evaluatedElement, bogusEval.proof)).toBe(
			false
		);
	});

	it('rejects malformed inputs without throwing', () => {
		const pk = publicKey(TEST_SK);
		const a = blind(TEST_INPUT);
		const e = blindEvaluate(TEST_SK, pk, a.blindedElement);
		expect(verifyProof(new Uint8Array(31), a.blindedElement, e.evaluatedElement, e.proof)).toBe(
			false
		);
		expect(verifyProof(pk, a.blindedElement, e.evaluatedElement, new Uint8Array(63))).toBe(false);
	});

	it('finalize returns null when verification fails', () => {
		const pk = publicKey(TEST_SK);
		const a = blind(TEST_INPUT);
		const e = blindEvaluate(TEST_SK, pk, a.blindedElement);
		const tampered = new Uint8Array(e.proof);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		const out = finalize(TEST_INPUT, a.blind, e.evaluatedElement, tampered, pk);
		expect(out).toBeNull();
	});
});

describe('voprf · capabilityFromVoprfOutput', () => {
	it('returns a 32-byte SHA-256 of (DST || voprf_output)', () => {
		const out = capabilityFromVoprfOutput(new Uint8Array(64).fill(0xaa));
		expect(out.length).toBe(32);
	});

	it('is deterministic for the same input', () => {
		const input = new Uint8Array(64).fill(0xbb);
		const a = capabilityFromVoprfOutput(input);
		const b = capabilityFromVoprfOutput(input);
		expect(Array.from(a)).toEqual(Array.from(b));
	});

	it('produces different capabilities for different VOPRF outputs', () => {
		const a = capabilityFromVoprfOutput(new Uint8Array(64).fill(0x01));
		const b = capabilityFromVoprfOutput(new Uint8Array(64).fill(0x02));
		expect(Array.from(a)).not.toEqual(Array.from(b));
	});
});

describe('voprf · V0-C1 unlinkability', () => {
	it('SAME accountSeed under DIFFERENT epoch keys yields UNLINKABLE capabilities', () => {
		// V0-C1 invariant: two server keys → two completely
		// unrelated capability handles for the same accountSeed.
		const sk1 = new Uint8Array(32).map((_, i) => (i + 1) & 0xff);
		const sk2 = new Uint8Array(32).map((_, i) => (i + 17) & 0xff);
		const pk1 = publicKey(sk1);
		const pk2 = publicKey(sk2);

		const accountSeed = new TextEncoder().encode('long-term-account-seed-here');

		const a1 = blind(accountSeed);
		const e1 = blindEvaluate(sk1, pk1, a1.blindedElement);
		const out1 = finalize(accountSeed, a1.blind, e1.evaluatedElement, e1.proof, pk1);
		const cap1 = capabilityFromVoprfOutput(out1!);

		const a2 = blind(accountSeed);
		const e2 = blindEvaluate(sk2, pk2, a2.blindedElement);
		const out2 = finalize(accountSeed, a2.blind, e2.evaluatedElement, e2.proof, pk2);
		const cap2 = capabilityFromVoprfOutput(out2!);

		expect(Array.from(cap1)).not.toEqual(Array.from(cap2));
	});

	it('different account seeds under the SAME epoch key yield distinct capabilities', () => {
		const pk = publicKey(TEST_SK);
		const seedA = new TextEncoder().encode('account-A-seed');
		const seedB = new TextEncoder().encode('account-B-seed');

		const aA = blind(seedA);
		const eA = blindEvaluate(TEST_SK, pk, aA.blindedElement);
		const outA = finalize(seedA, aA.blind, eA.evaluatedElement, eA.proof, pk);
		const capA = capabilityFromVoprfOutput(outA!);

		const aB = blind(seedB);
		const eB = blindEvaluate(TEST_SK, pk, aB.blindedElement);
		const outB = finalize(seedB, aB.blind, eB.evaluatedElement, eB.proof, pk);
		const capB = capabilityFromVoprfOutput(outB!);

		expect(Array.from(capA)).not.toEqual(Array.from(capB));
	});
});
