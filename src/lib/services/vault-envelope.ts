/**
 * Vault envelope wrap/unwrap (Milestone 2 — formatVersion 2).
 *
 * In v1 the AES-GCM key was the user's `vaultKey` directly. In v2 the
 * AES-GCM key is a fresh per-vault 32-byte random AES key, and the
 * `vaultKey` is used to wrap that AES key under the hybrid X25519 +
 * ML-KEM-1024 envelope (`src/lib/crypto/envelope.ts`).
 *
 * Why: the envelope is what makes the vault post-quantum-secure. Once
 * any single device has the wrapped key persisted, an exfil of the
 * IndexedDB blob today still resists a 2032+ quantum cryptanalyst
 * because either the X25519 leg OR the ML-KEM-1024 leg must hold —
 * and the AES-GCM ciphertext under a fresh random key gives us a
 * clean rotation path (re-wrap the AES key without re-encrypting the
 * items) once Milestone 3 lands multi-device key transfer.
 *
 * Hybrid keypair derivation:
 *
 *   x25519_seed  = HKDF-SHA512(vaultKey, salt=deviceSalt, info='vuvault-envelope-derive-v2-x25519', 32)
 *   mlkem_seed   = HKDF-SHA512(vaultKey, salt=deviceSalt, info='vuvault-envelope-derive-v2-mlkem',  64)
 *   keypair      = [x25519.fromSeed(x25519_seed) || ml_kem1024.keygen(mlkem_seed)]
 *
 * Both legs are deterministic from the same `vaultKey` + `deviceSalt`,
 * so any device that can re-derive `vaultKey` (PRF + Secret Key
 * [+ MPK] [+ OpaqueExportKey]) can reproduce the same hybrid keypair
 * and unwrap the AES key. No extra material needs to be persisted.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';
import { x25519 } from '@noble/curves/ed25519';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem';
import {
	HYBRID_PK_LEN,
	HYBRID_SK_LEN,
	X25519_PK_LEN,
	X25519_SK_LEN,
	HEADER_LEN,
	seal,
	open,
	type SealedEnvelope
} from '$lib/crypto/envelope';

const DERIVE_INFO_X25519 = 'vuvault-envelope-derive-v2-x25519';
const DERIVE_INFO_MLKEM = 'vuvault-envelope-derive-v2-mlkem';

const X25519_SEED_LEN = 32;
const MLKEM_SEED_LEN = 64;
const AES_KEY_LEN = 32;

export const ENVELOPE_HEADER_LEN = HEADER_LEN;
export const ENVELOPE_AES_KEY_LEN = AES_KEY_LEN;

/**
 * Deterministically derive the hybrid envelope keypair from the
 * user's `vaultKey` and `deviceSalt`. Pure function — same inputs
 * always produce the same keypair. Each call zeroizes its
 * intermediate seed buffers.
 */
function deriveHybridKeypair(
	vaultKey: Uint8Array,
	deviceSalt: Uint8Array
): { publicKey: Uint8Array; secretKey: Uint8Array } {
	if (vaultKey.length !== AES_KEY_LEN) {
		throw new Error(`vault-envelope: vaultKey must be ${AES_KEY_LEN} bytes`);
	}

	const xSeed = hkdf(
		sha512,
		vaultKey,
		deviceSalt,
		DERIVE_INFO_X25519,
		X25519_SEED_LEN
	);
	const xSk = new Uint8Array(X25519_SK_LEN);
	xSk.set(xSeed);
	const xPk = x25519.getPublicKey(xSk);

	const mlSeed = hkdf(sha512, vaultKey, deviceSalt, DERIVE_INFO_MLKEM, MLKEM_SEED_LEN);
	const mlkem = ml_kem1024.keygen(mlSeed);

	const publicKey = new Uint8Array(HYBRID_PK_LEN);
	publicKey.set(xPk, 0);
	publicKey.set(mlkem.publicKey, X25519_PK_LEN);

	const secretKey = new Uint8Array(HYBRID_SK_LEN);
	secretKey.set(xSk, 0);
	secretKey.set(mlkem.secretKey, X25519_SK_LEN);

	xSeed.fill(0);
	mlSeed.fill(0);

	return { publicKey, secretKey };
}

export type WrappedAesKey = SealedEnvelope;

/**
 * Wrap a freshly-generated 32-byte AES-256 key under the hybrid
 * envelope keyed by the user's `vaultKey`. The output is what gets
 * stored in `VaultBlob.header` (envelope header + nonce + ciphertext).
 *
 * `vaultKey` is deliberately consumed by reference but not mutated.
 */
export function wrapAesKey(
	vaultKey: Uint8Array,
	deviceSalt: Uint8Array,
	aesKey: Uint8Array
): WrappedAesKey {
	if (aesKey.length !== AES_KEY_LEN) {
		throw new Error(`wrapAesKey: aesKey must be ${AES_KEY_LEN} bytes`);
	}
	const kp = deriveHybridKeypair(vaultKey, deviceSalt);
	const sealed = seal(aesKey, kp.publicKey);
	// kp.publicKey is just bytes; the secretKey we never used here.
	// Zero the secret-key buffer just to keep our hands clean.
	kp.secretKey.fill(0);
	return sealed;
}

/**
 * Unwrap a v2 vault's AES-256 key. Throws on any AES-GCM
 * authentication failure, which would only happen if the
 * `vaultKey` is wrong, the envelope header was tampered with, or
 * the wrapped ciphertext was tampered with.
 */
export function unwrapAesKey(
	vaultKey: Uint8Array,
	deviceSalt: Uint8Array,
	wrapped: WrappedAesKey
): Uint8Array {
	const kp = deriveHybridKeypair(vaultKey, deviceSalt);
	try {
		const aesKey = open(wrapped, kp.secretKey);
		if (aesKey.length !== AES_KEY_LEN) {
			throw new Error(
				`unwrapAesKey: unexpected AES key length (got ${aesKey.length})`
			);
		}
		return aesKey;
	} finally {
		kp.secretKey.fill(0);
	}
}

/**
 * Serialize the wrapped AES key into a flat `header` Uint8Array for
 * the persisted `VaultBlob.header`. Layout:
 *
 *   header_struct = wrapped.header (1600 bytes, hybrid KEM header)
 *                ‖ wrapped.nonce  (12 bytes, AES-GCM nonce on the wrap)
 *                ‖ wrapped.ciphertext (32 + 16 = 48 bytes, AES-256-GCM(aesKey))
 *
 * Total v2 header size = 1660 bytes. This is what `VaultBlob.header`
 * holds for `formatVersion === 2`.
 */
export function serializeWrappedKey(wrapped: WrappedAesKey): Uint8Array {
	if (wrapped.header.length !== HEADER_LEN) {
		throw new Error(
			`serializeWrappedKey: hybrid header must be ${HEADER_LEN} bytes`
		);
	}
	if (wrapped.nonce.length !== 12) {
		throw new Error('serializeWrappedKey: nonce must be 12 bytes');
	}
	const out = new Uint8Array(HEADER_LEN + wrapped.nonce.length + wrapped.ciphertext.length);
	let off = 0;
	out.set(wrapped.header, off);
	off += wrapped.header.length;
	out.set(wrapped.nonce, off);
	off += wrapped.nonce.length;
	out.set(wrapped.ciphertext, off);
	return out;
}

export function deserializeWrappedKey(headerBytes: Uint8Array): WrappedAesKey {
	if (headerBytes.length < HEADER_LEN + 12 + 1) {
		throw new Error('deserializeWrappedKey: header bytes too short');
	}
	const header = headerBytes.subarray(0, HEADER_LEN);
	const nonce = headerBytes.subarray(HEADER_LEN, HEADER_LEN + 12);
	const ciphertext = headerBytes.subarray(HEADER_LEN + 12);
	return { header, nonce, ciphertext };
}
