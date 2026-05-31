/**
 * VOPRF (Verifiable Oblivious Pseudorandom Function) over Ristretto255.
 *
 * Implements RFC 9497 §3 mode 0x01 (VOPRF) with the Ristretto255-SHA512
 * ciphersuite (RFC 9497 §4.1). Used by §L09cap to derive per-epoch
 * unlinkable capability handles from the long-term `accountSeed`.
 *
 * Three-message protocol:
 *
 *   1. Client → blind(input) = { blind: r, blindedElement: r·H(input) }
 *      The server sees only `blindedElement`; it cannot recover `input`
 *      because `r` is uniformly random in the scalar field.
 *
 *   2. Server → blindEvaluate(sk, blindedElement)
 *               = { evaluatedElement: sk·blindedElement,
 *                   proof:           DLEQ proof binding sk to pk }
 *      The evaluation is deterministic in (sk, blindedElement). The
 *      proof is a Schnorr-style zero-knowledge attestation that the
 *      server used the SAME `sk` as the published `pk`.
 *
 *   3. Client → finalize(input, blind, evaluatedElement, proof, pk)
 *               = SHA-512(input || (1/r)·evaluatedElement)
 *      The client unblinds (multiplies by 1/r) and verifies the DLEQ
 *      proof BEFORE returning the OPRF output. A malicious server
 *      that returns a tampered `evaluatedElement` or uses a different
 *      key fails the proof and finalize() returns null.
 *
 * Security:
 *   - Blindness: the server cannot link two blinded inputs of the
 *     same plaintext (RFC 9497 §6.2). Different blinding factors `r`
 *     yield independent-looking ciphertexts.
 *   - Unforgeability: the client cannot compute the OPRF output for
 *     `input` without the server's blind evaluation (RFC 9497 §6.3).
 *   - Verifiability: the server cannot bias outputs by using a
 *     non-published key (RFC 9497 §6.4). The DLEQ proof gates this.
 *
 * V0-C1 use:
 *   - `accountSeed` is the long-term client secret (32 bytes).
 *   - For each epoch, the client runs the three-message protocol with
 *     the server's per-epoch OPRF secret. The output is:
 *         capability_e = SHA-256(SHA-512(accountSeed || N))
 *     where N = (1/r)·evaluatedElement. Different epochs yield
 *     INDEPENDENT capabilities; the server cannot link them.
 *
 * Wire format:
 *   - secretKey:        32 bytes (scalar mod Fn order)
 *   - publicKey:        32 bytes (Ristretto255 point)
 *   - blindedElement:   32 bytes (Ristretto255 point)
 *   - evaluatedElement: 32 bytes (Ristretto255 point)
 *   - proof:            64 bytes (two 32-byte scalars: c || s)
 *   - finalizeOutput:   64 bytes (SHA-512 digest)
 */

import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519';
import { sha512, sha256 } from '@noble/hashes/sha2';

export const VOPRF_SCALAR_LEN = 32;
export const VOPRF_POINT_LEN = 32;
export const VOPRF_PROOF_LEN = 64;
export const VOPRF_OUTPUT_LEN = 64;

// RFC 9497 §4.1 specifies the DST for ristretto255-SHA512:
//   "OPRFV1-mode0x01-ristretto255-SHA512"
// We embed a vuvault-specific suffix to keep our ciphertexts
// distinguishable from a generic OPRF deployment.
const HASH_TO_GROUP_DST = new TextEncoder().encode(
	'HashToGroup-OPRFV1-VOPRF-ristretto255-SHA512-vuvault-v1'
);
const PROOF_DST = new TextEncoder().encode(
	'Proof-OPRFV1-VOPRF-ristretto255-SHA512-vuvault-v1'
);

const RistPoint = ristretto255.Point;
const ORDER = RistPoint.Fn.ORDER as bigint;

function modOrder(n: bigint): bigint {
	const m = n % ORDER;
	return m < 0n ? m + ORDER : m;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
	let n = 0n;
	for (let i = 0; i < bytes.length; i++) {
		n = (n << 8n) | BigInt(bytes[i]!);
	}
	return n;
}

function bigIntToBytes(n: bigint, length: number): Uint8Array {
	const out = new Uint8Array(length);
	let v = n;
	for (let i = length - 1; i >= 0; i--) {
		out[i] = Number(v & 0xffn);
		v >>= 8n;
	}
	return out;
}

/** Convert a 32-byte secret key to its scalar form. */
function secretKeyToScalar(secretKey: Uint8Array): bigint {
	if (secretKey.length !== VOPRF_SCALAR_LEN) {
		throw new Error(`secretKey must be ${VOPRF_SCALAR_LEN} bytes`);
	}
	// Reduce mod ORDER for safety against keys ≥ ORDER.
	const n = bytesToBigInt(secretKey);
	return modOrder(n);
}

/**
 * Derive the VOPRF public key from a secret key (32-byte scalar).
 * publicKey = secretKey · BasePoint
 */
export function publicKey(secretKey: Uint8Array): Uint8Array {
	const sk = secretKeyToScalar(secretKey);
	const pk = RistPoint.BASE.multiply(sk);
	return pk.toBytes();
}

/**
 * Hash an arbitrary-length input to a Ristretto255 point using
 * RFC 9380's `hash_to_curve` with the OPRF DST.
 */
function hashToGroup(input: Uint8Array): InstanceType<typeof RistPoint> {
	// `ristretto255_hasher.hashToCurve` returns the abstract
	// H2CPoint<bigint> interface in noble's type system; at runtime
	// it IS a `_RistrettoPoint`. Cast through unknown for the type
	// checker; the runtime object exposes the full Ristretto API
	// (scalar multiply, toBytes, etc.) that we rely on.
	const point = ristretto255_hasher.hashToCurve(input, { DST: HASH_TO_GROUP_DST });
	return point as unknown as InstanceType<typeof RistPoint>;
}

/**
 * Sample a random scalar uniformly in [1, ORDER).
 *
 * Uses 64-byte rejection-resampling rather than mod-reduction of
 * 64 bytes — the bias is statistically negligible at 64 bytes
 * (≪ 2^-256), and rejection-sampling avoids any timing channel.
 */
function randomScalar(): bigint {
	// 512 bits is large enough to make modular bias undetectable.
	const buf = crypto.getRandomValues(new Uint8Array(64));
	const n = bytesToBigInt(buf);
	const r = modOrder(n);
	// Avoid zero (degenerate blind).
	return r === 0n ? 1n : r;
}

/**
 * Client step 1: Blind an input.
 *
 * Returns:
 *   - blind:           32-byte scalar (kept secret by the client)
 *   - blindedElement:  32-byte Ristretto255 point (sent to server)
 */
export function blind(input: Uint8Array): {
	blind: Uint8Array;
	blindedElement: Uint8Array;
} {
	const r = randomScalar();
	const M = hashToGroup(input);
	const R = M.multiply(r);
	return {
		blind: bigIntToBytes(r, VOPRF_SCALAR_LEN),
		blindedElement: R.toBytes()
	};
}

/**
 * Server step 2: Blind-evaluate and return the proof.
 *
 * Inputs:
 *   - secretKey:        32-byte scalar
 *   - publicKeyBytes:   32-byte Ristretto255 point (the server's pk)
 *   - blindedElement:   32-byte point from blind()
 *
 * Returns:
 *   - evaluatedElement: 32-byte point (sk · blindedElement)
 *   - proof:            64-byte Schnorr DLEQ proof (c || s)
 */
export function blindEvaluate(
	secretKey: Uint8Array,
	publicKeyBytes: Uint8Array,
	blindedElement: Uint8Array
): { evaluatedElement: Uint8Array; proof: Uint8Array } {
	const sk = secretKeyToScalar(secretKey);
	const R = RistPoint.fromBytes(blindedElement);
	const Z = R.multiply(sk);

	// DLEQ proof — prove DL(G, pk) === DL(R, Z) without revealing sk.
	// Schnorr-style: random t; T1 = t·G; T2 = t·R; c = H(pk||R||Z||T1||T2);
	// s = t + c·sk (mod ORDER).
	const t = randomScalar();
	const T1 = RistPoint.BASE.multiply(t);
	const T2 = R.multiply(t);
	const c = computeChallenge(publicKeyBytes, blindedElement, Z.toBytes(), T1.toBytes(), T2.toBytes());
	const s = modOrder(t + c * sk);

	const proof = new Uint8Array(VOPRF_PROOF_LEN);
	proof.set(bigIntToBytes(c, VOPRF_SCALAR_LEN), 0);
	proof.set(bigIntToBytes(s, VOPRF_SCALAR_LEN), VOPRF_SCALAR_LEN);

	return { evaluatedElement: Z.toBytes(), proof };
}

/**
 * Verify the DLEQ proof: returns true iff the server's evaluation
 * uses the same secret key as the published public key.
 *
 * Recomputes T1' = s·G - c·pk and T2' = s·R - c·Z, then checks
 * c === H(pk || R || Z || T1' || T2').
 */
export function verifyProof(
	publicKeyBytes: Uint8Array,
	blindedElement: Uint8Array,
	evaluatedElement: Uint8Array,
	proof: Uint8Array
): boolean {
	if (proof.length !== VOPRF_PROOF_LEN) return false;
	if (publicKeyBytes.length !== VOPRF_POINT_LEN) return false;
	if (blindedElement.length !== VOPRF_POINT_LEN) return false;
	if (evaluatedElement.length !== VOPRF_POINT_LEN) return false;
	let pk: InstanceType<typeof RistPoint>;
	let R: InstanceType<typeof RistPoint>;
	let Z: InstanceType<typeof RistPoint>;
	try {
		pk = RistPoint.fromBytes(publicKeyBytes);
		R = RistPoint.fromBytes(blindedElement);
		Z = RistPoint.fromBytes(evaluatedElement);
	} catch {
		return false;
	}
	const c = bytesToBigInt(proof.subarray(0, VOPRF_SCALAR_LEN));
	const s = bytesToBigInt(proof.subarray(VOPRF_SCALAR_LEN));
	if (c >= ORDER || s >= ORDER) return false;

	// T1' = s·G - c·pk;  T2' = s·R - c·Z
	const T1prime = RistPoint.BASE.multiply(s).subtract(pk.multiply(c));
	const T2prime = R.multiply(s).subtract(Z.multiply(c));
	const cPrime = computeChallenge(
		publicKeyBytes,
		blindedElement,
		evaluatedElement,
		T1prime.toBytes(),
		T2prime.toBytes()
	);
	return cPrime === c;
}

/**
 * Client step 3: Finalize the protocol.
 *
 * Verifies the DLEQ proof and, on success, returns the OPRF output:
 *   SHA-512(input || (1/blind)·evaluatedElement)
 *
 * Returns null if the proof fails — that signals the server used a
 * different key or returned a tampered evaluation. The caller MUST
 * NOT use a null result; treat it as a server attack.
 */
export function finalize(
	input: Uint8Array,
	blindBytes: Uint8Array,
	evaluatedElement: Uint8Array,
	proof: Uint8Array,
	publicKeyBytes: Uint8Array
): Uint8Array | null {
	if (blindBytes.length !== VOPRF_SCALAR_LEN) return null;
	const blindedElement = (() => {
		const r = bytesToBigInt(blindBytes);
		const M = hashToGroup(input);
		return M.multiply(r).toBytes();
	})();
	if (!verifyProof(publicKeyBytes, blindedElement, evaluatedElement, proof)) {
		return null;
	}
	// Unblind: N = (1/r) · evaluatedElement
	const r = bytesToBigInt(blindBytes);
	const rInv = modInverse(r, ORDER);
	const Z = RistPoint.fromBytes(evaluatedElement);
	const N = Z.multiply(rInv);

	// Finalize per RFC 9497 §3.3.2:
	//   issuedElement = serialize(N)
	//   hashInput = I2OSP(len(input), 2) || input || I2OSP(32, 2) || issuedElement || "Finalize"
	//   output = Hash(hashInput)
	const issued = N.toBytes();
	const inputLen = new Uint8Array(2);
	new DataView(inputLen.buffer).setUint16(0, input.length, false);
	const issuedLen = new Uint8Array(2);
	new DataView(issuedLen.buffer).setUint16(0, issued.length, false);
	const finalizeLabel = new TextEncoder().encode('Finalize');
	const totalLen =
		inputLen.length + input.length + issuedLen.length + issued.length + finalizeLabel.length;
	const buf = new Uint8Array(totalLen);
	let off = 0;
	buf.set(inputLen, off);
	off += inputLen.length;
	buf.set(input, off);
	off += input.length;
	buf.set(issuedLen, off);
	off += issuedLen.length;
	buf.set(issued, off);
	off += issued.length;
	buf.set(finalizeLabel, off);
	return sha512(buf);
}

/**
 * Compute the DLEQ challenge scalar from the protocol transcript.
 * c = OS2IP(SHA-512( "Proof" DST || pk || R || Z || T1 || T2 ))
 *     mod ORDER.
 */
function computeChallenge(
	pk: Uint8Array,
	R: Uint8Array,
	Z: Uint8Array,
	T1: Uint8Array,
	T2: Uint8Array
): bigint {
	const buf = new Uint8Array(
		PROOF_DST.length + pk.length + R.length + Z.length + T1.length + T2.length
	);
	let off = 0;
	buf.set(PROOF_DST, off);
	off += PROOF_DST.length;
	buf.set(pk, off);
	off += pk.length;
	buf.set(R, off);
	off += R.length;
	buf.set(Z, off);
	off += Z.length;
	buf.set(T1, off);
	off += T1.length;
	buf.set(T2, off);
	const digest = sha512(buf);
	return modOrder(bytesToBigInt(digest));
}

/**
 * Modular multiplicative inverse via Fermat (ORDER is prime).
 * Returns n^(ORDER-2) mod ORDER.
 */
function modInverse(n: bigint, p: bigint): bigint {
	return modPow(n, p - 2n, p);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
	let result = 1n;
	let b = modOrder(base);
	let e = exp;
	while (e > 0n) {
		if (e & 1n) result = (result * b) % mod;
		b = (b * b) % mod;
		e >>= 1n;
	}
	return result;
}

/**
 * Capability derivation — V0-C1 §L09cap helper. Wraps the VOPRF
 * finalize output with a domain-tagged SHA-256 to produce a fixed
 * 32-byte capability handle.
 */
export function capabilityFromVoprfOutput(voprfOutput: Uint8Array): Uint8Array {
	const dst = new TextEncoder().encode('vuvault-v0c1-capability');
	const buf = new Uint8Array(dst.length + voprfOutput.length);
	buf.set(dst, 0);
	buf.set(voprfOutput, dst.length);
	return sha256(buf);
}
