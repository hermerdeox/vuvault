/**
 * Vault envelope — hybrid post-quantum KEM + AES-256-GCM AEAD.
 *
 * Layer L03 of the architectural blueprint. Resistant to harvest-now-
 * decrypt-later attacks: a vault exfiltrated today remains undecryptable
 * in 2032+ when scalable quantum cryptanalysis becomes practical, as
 * long as either the X25519 OR the ML-KEM-1024 leg holds.
 *
 * Design:
 *   1. Recipient holds long-term hybrid keypair: [X25519 sk || ML-KEM sk].
 *   2. Sender generates ephemeral X25519 keypair, encapsulates to recipient's
 *      X25519 + ML-KEM-1024 public keys.
 *   3. Both shared secrets are concatenated and fed to HKDF-SHA512 with a
 *      domain separator to derive the AEAD key.
 *   4. AES-256-GCM encrypts the payload; nonce is sender-random.
 *
 * References:
 *   - FIPS 203 (ML-KEM)
 *   - RFC 7748 (X25519)
 *   - NIST SP 800-56C (key derivation)
 *
 * Note: Phase 6 wires the real ML-KEM-1024 path. P0 vault persistence
 * (`vault-session.ts`) does NOT call this module — it uses a single-key
 * AES-GCM scheme. This module is reserved for future multi-device key
 * transfer (sharing the vault key with a paired device) and Phase 6+
 * vault-key wrapping.
 */

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';
import { gcm } from '@noble/ciphers/aes';
import { ml_kem1024 } from '@noble/post-quantum/ml-kem';

export type EnvelopeKeypair = {
	publicKey: Uint8Array; // concatenated [X25519 pk || ML-KEM pk]
	secretKey: Uint8Array; // concatenated [X25519 sk || ML-KEM sk]
};

export type SealedEnvelope = {
	header: Uint8Array; // [X25519 epk || ML-KEM ct]
	nonce: Uint8Array; // 12 bytes for AES-GCM
	ciphertext: Uint8Array; // AES-256-GCM AEAD output
};

export const X25519_PK_LEN = 32;
export const X25519_SK_LEN = 32;
export const MLKEM1024_PK_LEN = 1568;
export const MLKEM1024_SK_LEN = 3168;
export const MLKEM1024_CT_LEN = 1568;

export const HYBRID_PK_LEN = X25519_PK_LEN + MLKEM1024_PK_LEN;
export const HYBRID_SK_LEN = X25519_SK_LEN + MLKEM1024_SK_LEN;
export const HEADER_LEN = X25519_PK_LEN + MLKEM1024_CT_LEN;

const KDF_INFO = 'vuvault-envelope-v1';
const AEAD_KEY_LEN = 32;
const AES_NONCE_LEN = 12;

export function generateKeypair(): EnvelopeKeypair {
	// X25519 component
	const xSk = crypto.getRandomValues(new Uint8Array(X25519_SK_LEN));
	const xPk = x25519.getPublicKey(xSk);

	// ML-KEM-1024 component
	const seed = crypto.getRandomValues(new Uint8Array(64));
	const mlkem = ml_kem1024.keygen(seed);
	seed.fill(0);

	const publicKey = new Uint8Array(HYBRID_PK_LEN);
	publicKey.set(xPk, 0);
	publicKey.set(mlkem.publicKey, X25519_PK_LEN);

	const secretKey = new Uint8Array(HYBRID_SK_LEN);
	secretKey.set(xSk, 0);
	secretKey.set(mlkem.secretKey, X25519_SK_LEN);

	return { publicKey, secretKey };
}

function combinedKey(xShared: Uint8Array, mlkemShared: Uint8Array): Uint8Array {
	const ikm = new Uint8Array(xShared.length + mlkemShared.length);
	ikm.set(xShared, 0);
	ikm.set(mlkemShared, xShared.length);
	const out = hkdf(sha512, ikm, undefined, KDF_INFO, AEAD_KEY_LEN);
	ikm.fill(0);
	return out;
}

export function seal(plaintext: Uint8Array, recipientPubkey: Uint8Array): SealedEnvelope {
	if (recipientPubkey.length !== HYBRID_PK_LEN) {
		throw new Error(`seal: recipientPubkey must be ${HYBRID_PK_LEN} bytes`);
	}

	const xRecipient = recipientPubkey.subarray(0, X25519_PK_LEN);
	const mlkemRecipient = recipientPubkey.subarray(X25519_PK_LEN);

	// X25519 ephemeral
	const xEphemeralSk = crypto.getRandomValues(new Uint8Array(X25519_SK_LEN));
	const xEphemeralPk = x25519.getPublicKey(xEphemeralSk);
	const xShared = x25519.getSharedSecret(xEphemeralSk, xRecipient);
	xEphemeralSk.fill(0);

	// ML-KEM encapsulation
	const { cipherText: mlkemCt, sharedSecret: mlkemShared } = ml_kem1024.encapsulate(
		mlkemRecipient
	);

	const aeadKey = combinedKey(xShared, mlkemShared);
	xShared.fill(0);
	mlkemShared.fill(0);

	// Build the header BEFORE encryption so we can bind it as AAD.
	// Without this, an attacker who intercepts the envelope could
	// substitute their own (xEphemeralPk, mlkemCt) header; AES-GCM
	// would still authenticate the ciphertext under the unrelated key,
	// silently delivering controlled plaintext to the recipient.
	// Binding the header to the ciphertext via AAD makes header
	// substitution a guaranteed `decrypt` failure.
	const header = new Uint8Array(HEADER_LEN);
	header.set(xEphemeralPk, 0);
	header.set(mlkemCt, X25519_PK_LEN);

	const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN));
	const aead = gcm(aeadKey, nonce, header);
	const ciphertext = aead.encrypt(plaintext);
	aeadKey.fill(0);

	return { header, nonce, ciphertext };
}

export function open(envelope: SealedEnvelope, secretKey: Uint8Array): Uint8Array {
	if (secretKey.length !== HYBRID_SK_LEN) {
		throw new Error(`open: secretKey must be ${HYBRID_SK_LEN} bytes`);
	}
	if (envelope.header.length !== HEADER_LEN) {
		throw new Error(`open: header must be ${HEADER_LEN} bytes`);
	}

	const xSk = secretKey.subarray(0, X25519_SK_LEN);
	const mlkemSk = secretKey.subarray(X25519_SK_LEN);

	const xEphemeralPk = envelope.header.subarray(0, X25519_PK_LEN);
	const mlkemCt = envelope.header.subarray(X25519_PK_LEN);

	const xShared = x25519.getSharedSecret(xSk, xEphemeralPk);
	const mlkemShared = ml_kem1024.decapsulate(mlkemCt, mlkemSk);

	const aeadKey = combinedKey(xShared, mlkemShared);
	xShared.fill(0);
	mlkemShared.fill(0);

	// Recompute AAD from the supplied header. Any mutation of
	// ephemeral pubkey or ML-KEM ciphertext bytes since `seal()`
	// produced the envelope causes AES-GCM authentication to fail.
	const aead = gcm(aeadKey, envelope.nonce, envelope.header);
	const plaintext = aead.decrypt(envelope.ciphertext);
	aeadKey.fill(0);
	return plaintext;
}
