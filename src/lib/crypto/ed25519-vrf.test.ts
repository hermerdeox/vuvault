/**
 * Unit tests for `ed25519-vrf.ts` — the AKD VRF primitive.
 *
 * Contract under test:
 *   - Deterministic: vrfProve(sk, m) is the same across calls.
 *   - Round-trip: vrfVerify(pk, m, vrfOutput(proof), proof) is true.
 *   - Tampered proof: any single-bit flip in proof bytes fails verify.
 *   - Tampered output: any single-bit flip in output bytes fails verify.
 *   - Wrong public key: verify fails.
 *   - Wrong message: verify fails.
 *   - Domain separation: a raw Ed25519 signature over `message`
 *     (without the VRF domain prefix) is rejected as a VRF proof.
 */

import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import {
	vrfProve,
	vrfVerify,
	vrfOutput,
	vrfProveWithOutput,
	vrfPublicKey,
	bytesToHex,
	hexToBytes,
	VRF_PROOF_LEN,
	VRF_OUTPUT_LEN,
	VRF_PUBKEY_LEN
} from './ed25519-vrf';

const TEST_SECRET = new Uint8Array(32).map((_, i) => (i * 11 + 1) & 0xff);
const TEST_MESSAGE = new TextEncoder().encode('vuvault-test-message');

describe('ed25519-vrf · basics', () => {
	it('vrfPublicKey returns a 32-byte point', () => {
		const pk = vrfPublicKey(TEST_SECRET);
		expect(pk.length).toBe(VRF_PUBKEY_LEN);
	});

	it('vrfProve returns a 64-byte proof', () => {
		const proof = vrfProve(TEST_SECRET, TEST_MESSAGE);
		expect(proof.length).toBe(VRF_PROOF_LEN);
	});

	it('vrfOutput returns 64 bytes', () => {
		const proof = vrfProve(TEST_SECRET, TEST_MESSAGE);
		const out = vrfOutput(proof);
		expect(out.length).toBe(VRF_OUTPUT_LEN);
	});

	it('is deterministic for the same (sk, msg) — Ed25519 sign is deterministic', () => {
		const p1 = vrfProve(TEST_SECRET, TEST_MESSAGE);
		const p2 = vrfProve(TEST_SECRET, TEST_MESSAGE);
		expect(Array.from(p1)).toEqual(Array.from(p2));
		const o1 = vrfOutput(p1);
		const o2 = vrfOutput(p2);
		expect(Array.from(o1)).toEqual(Array.from(o2));
	});

	it('produces different outputs for different messages', () => {
		const o1 = vrfProveWithOutput(TEST_SECRET, new TextEncoder().encode('alpha'));
		const o2 = vrfProveWithOutput(TEST_SECRET, new TextEncoder().encode('beta'));
		expect(Array.from(o1.output)).not.toEqual(Array.from(o2.output));
	});

	it('produces different outputs for different secret keys', () => {
		const sk2 = new Uint8Array(32).map((_, i) => (i * 17 + 5) & 0xff);
		const o1 = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		const o2 = vrfProveWithOutput(sk2, TEST_MESSAGE);
		expect(Array.from(o1.output)).not.toEqual(Array.from(o2.output));
	});
});

describe('ed25519-vrf · verify', () => {
	it('vrfVerify accepts a valid (pk, msg, output, proof)', () => {
		const pk = vrfPublicKey(TEST_SECRET);
		const { proof, output } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		expect(vrfVerify(pk, TEST_MESSAGE, output, proof)).toBe(true);
	});

	it('rejects a single-bit flip in the proof', () => {
		const pk = vrfPublicKey(TEST_SECRET);
		const { proof, output } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		const tampered = new Uint8Array(proof);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		expect(vrfVerify(pk, TEST_MESSAGE, output, tampered)).toBe(false);
	});

	it('rejects a single-bit flip in the output (output mismatch)', () => {
		const pk = vrfPublicKey(TEST_SECRET);
		const { proof, output } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		const tampered = new Uint8Array(output);
		tampered[0] = (tampered[0]! ^ 1) & 0xff;
		expect(vrfVerify(pk, TEST_MESSAGE, tampered, proof)).toBe(false);
	});

	it('rejects a wrong public key', () => {
		const otherSecret = new Uint8Array(32).map((_, i) => (i * 13 + 7) & 0xff);
		const wrongPk = vrfPublicKey(otherSecret);
		const { proof, output } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		expect(vrfVerify(wrongPk, TEST_MESSAGE, output, proof)).toBe(false);
	});

	it('rejects a different message', () => {
		const pk = vrfPublicKey(TEST_SECRET);
		const { proof, output } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		const otherMsg = new TextEncoder().encode('vuvault-other-message');
		expect(vrfVerify(pk, otherMsg, output, proof)).toBe(false);
	});

	it('rejects a raw Ed25519 signature over the bare message (domain separation)', () => {
		// An attacker who can get the server to sign an arbitrary
		// message with the AKD signing key MUST NOT be able to pass
		// that signature off as a VRF proof for the same message.
		// The domain prefix `vuvault-vrf-v1` makes the two
		// signatures provably distinct.
		const pk = vrfPublicKey(TEST_SECRET);
		const rawSig = ed25519.sign(TEST_MESSAGE, TEST_SECRET);
		// Even if the attacker also forges a matching output, the
		// proof verification fails because the signature was over
		// the bare message, not the domain-prefixed message.
		const { output: realOutput } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		expect(vrfVerify(pk, TEST_MESSAGE, realOutput, rawSig)).toBe(false);
	});

	it('rejects malformed inputs without throwing', () => {
		const pk = vrfPublicKey(TEST_SECRET);
		const { proof, output } = vrfProveWithOutput(TEST_SECRET, TEST_MESSAGE);
		expect(vrfVerify(new Uint8Array(31), TEST_MESSAGE, output, proof)).toBe(false);
		expect(vrfVerify(pk, TEST_MESSAGE, output, new Uint8Array(63))).toBe(false);
		expect(vrfVerify(pk, TEST_MESSAGE, new Uint8Array(63), proof)).toBe(false);
	});
});

describe('ed25519-vrf · hex helpers', () => {
	it('bytesToHex round-trips with hexToBytes', () => {
		const bytes = new Uint8Array([0, 1, 0x7f, 0x80, 0xff, 0xa5]);
		const hex = bytesToHex(bytes);
		expect(hex).toBe('00017f80ffa5');
		expect(Array.from(hexToBytes(hex))).toEqual(Array.from(bytes));
	});

	it('hexToBytes accepts 0x prefix', () => {
		expect(Array.from(hexToBytes('0xabcd'))).toEqual([0xab, 0xcd]);
	});

	it('hexToBytes rejects odd-length or invalid hex', () => {
		expect(() => hexToBytes('a')).toThrow();
		expect(() => hexToBytes('zz')).toThrow();
	});
});
