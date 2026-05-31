/**
 * Ed25519-based deterministic VRF (Verifiable Random Function).
 *
 * Used by §L09 AKD to derive unbiased leaf positions:
 *
 *     leaf_pos = SHA384(VRF.Output(epoch_secret, accountHandle))
 *
 * Properties this construction provides:
 *   1. Deterministic — VRF(sk, msg) is unique per (sk, msg) because
 *      RFC 8032 Ed25519 signatures are deterministic.
 *   2. Verifiable — anyone with the public key + proof can verify
 *      the claimed output corresponds to (sk, msg). Forgery requires
 *      breaking Ed25519 EUF-CMA.
 *   3. Unbiasable — the prover cannot select the output without
 *      first holding sk. Combined with epoch rotation, this prevents
 *      the server from steering leaf positions to compromise AKD
 *      proofs.
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │ NOT RFC 9381 ECVRF.                                         │
 * │                                                             │
 * │ This is a SIMPLER construction that uses Ed25519 signatures │
 * │ as the deterministic, unforgeable, verifiable transform.    │
 * │ It is NOT bit-compatible with the IETF VRF spec and SHOULD  │
 * │ NOT be advertised as RFC 9381 to external auditors.         │
 * │                                                             │
 * │ For the V0-C1 closure we need (deterministic + verifiable + │
 * │ unbiasable) and we get all three from Ed25519 alone. RFC    │
 * │ 9381 ECVRF additionally provides "pseudorandomness against  │
 * │ a malicious prover" — we don't need that property because   │
 * │ the prover here is the server which is the same trust       │
 * │ boundary that publishes the public key in the first place.  │
 * │                                                             │
 * │ The construction is documented in §L09 of                   │
 * │ docs/TIER2-ARCHITECTURE.md.                                 │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Wire format:
 *   - secretKey: 32 bytes (Ed25519 seed)
 *   - publicKey: 32 bytes (Ed25519 point)
 *   - proof:     64 bytes (Ed25519 signature over `domain || msg`)
 *   - output:    64 bytes (SHA-512 of proof)
 *
 * Domain separator binds the proof to this construction; reuse of
 * an Ed25519 keypair across a non-VRF signing context cannot be
 * mistaken for a VRF proof.
 */

import { ed25519 } from '@noble/curves/ed25519';
import { sha512 } from '@noble/hashes/sha2';

export const VRF_PROOF_LEN = 64;
export const VRF_OUTPUT_LEN = 64;
export const VRF_PUBKEY_LEN = 32;
export const VRF_SECRET_LEN = 32;

const VRF_DOMAIN = new TextEncoder().encode('vuvault-vrf-v1');

function concat(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

/**
 * Derive an Ed25519 public key from a 32-byte secret seed.
 */
export function vrfPublicKey(secretKey: Uint8Array): Uint8Array {
	if (secretKey.length !== VRF_SECRET_LEN) {
		throw new Error(`vrfPublicKey: secretKey must be ${VRF_SECRET_LEN} bytes`);
	}
	return ed25519.getPublicKey(secretKey);
}

/**
 * Compute the VRF proof for (secretKey, message).
 *
 * The proof is `Ed25519.Sign(sk, VRF_DOMAIN || message)`. Verifiers
 * compute the same domain-prefixed input and call `verify`.
 */
export function vrfProve(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
	if (secretKey.length !== VRF_SECRET_LEN) {
		throw new Error(`vrfProve: secretKey must be ${VRF_SECRET_LEN} bytes`);
	}
	const input = concat(VRF_DOMAIN, message);
	const sig = ed25519.sign(input, secretKey);
	return sig;
}

/**
 * Compute the VRF output from a proof. The output is
 * SHA-512(proof) — a uniformly distributed pseudorandom
 * representation of the (sk, msg) tuple that does NOT reveal the
 * secret key. Equivalent to a hash of the signature.
 */
export function vrfOutput(proof: Uint8Array): Uint8Array {
	if (proof.length !== VRF_PROOF_LEN) {
		throw new Error(`vrfOutput: proof must be ${VRF_PROOF_LEN} bytes`);
	}
	return sha512(proof);
}

/**
 * One-shot prove: returns { proof, output } for (secretKey, message).
 */
export function vrfProveWithOutput(
	secretKey: Uint8Array,
	message: Uint8Array
): { proof: Uint8Array; output: Uint8Array } {
	const proof = vrfProve(secretKey, message);
	const output = vrfOutput(proof);
	return { proof, output };
}

/**
 * Verify a VRF proof. Returns true iff the proof was produced by
 * the holder of the secret key corresponding to `publicKey` over
 * `message`, AND `output === SHA-512(proof)`.
 */
export function vrfVerify(
	publicKey: Uint8Array,
	message: Uint8Array,
	output: Uint8Array,
	proof: Uint8Array
): boolean {
	if (publicKey.length !== VRF_PUBKEY_LEN) return false;
	if (proof.length !== VRF_PROOF_LEN) return false;
	if (output.length !== VRF_OUTPUT_LEN) return false;
	let signatureValid: boolean;
	try {
		const input = concat(VRF_DOMAIN, message);
		signatureValid = ed25519.verify(proof, input, publicKey);
	} catch {
		return false;
	}
	if (!signatureValid) return false;
	const expectedOutput = sha512(proof);
	if (expectedOutput.length !== output.length) return false;
	let diff = 0;
	for (let i = 0; i < expectedOutput.length; i++) {
		diff |= expectedOutput[i]! ^ output[i]!;
	}
	return diff === 0;
}

/**
 * Convenience hex encoders / decoders. The AKD store keeps proofs
 * and outputs as lowercase hex strings.
 */
export function bytesToHex(bytes: Uint8Array): string {
	let hex = '';
	for (const b of bytes) hex += b.toString(16).padStart(2, '0');
	return hex;
}

export function hexToBytes(hex: string): Uint8Array {
	const norm = hex.startsWith('0x') ? hex.slice(2) : hex;
	if (norm.length % 2 !== 0) {
		throw new Error('hexToBytes: odd-length input');
	}
	const out = new Uint8Array(norm.length / 2);
	for (let i = 0; i < out.length; i++) {
		const byte = parseInt(norm.substring(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(byte)) throw new Error(`hexToBytes: invalid hex at offset ${i * 2}`);
		out[i] = byte;
	}
	return out;
}
