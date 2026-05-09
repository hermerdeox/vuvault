import { describe, expect, it } from 'vitest';
import {
	wrapAesKey,
	unwrapAesKey,
	serializeWrappedKey,
	deserializeWrappedKey,
	ENVELOPE_HEADER_LEN
} from './vault-envelope';

function bytes(n: number, fill: number): Uint8Array {
	const out = new Uint8Array(n);
	out.fill(fill);
	return out;
}

const VAULT_KEY = bytes(32, 0x42);
const DEVICE_SALT = bytes(16, 0x11);
const AES_KEY = bytes(32, 0x77);

describe('vault-envelope (formatVersion 2 wrap/unwrap)', () => {
	it('wraps and unwraps an AES key round-trip', () => {
		const wrapped = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		expect(wrapped.header.length).toBe(ENVELOPE_HEADER_LEN);
		expect(wrapped.nonce.length).toBe(12);
		expect(wrapped.ciphertext.length).toBeGreaterThan(0);

		const recovered = unwrapAesKey(VAULT_KEY, DEVICE_SALT, wrapped);
		expect(Buffer.from(recovered).equals(Buffer.from(AES_KEY))).toBe(true);
	});

	it('different vaultKeys cannot unwrap', () => {
		const wrapped = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		expect(() =>
			unwrapAesKey(bytes(32, 0xaa), DEVICE_SALT, wrapped)
		).toThrow();
	});

	it('different deviceSalts cannot unwrap', () => {
		const wrapped = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		expect(() =>
			unwrapAesKey(VAULT_KEY, bytes(16, 0x99), wrapped)
		).toThrow();
	});

	it('detects header tampering on the wrapped key', () => {
		const wrapped = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		wrapped.header[0] = (wrapped.header[0] ?? 0) ^ 0xff;
		expect(() => unwrapAesKey(VAULT_KEY, DEVICE_SALT, wrapped)).toThrow();
	});

	it('serialize/deserialize round-trip', () => {
		const wrapped = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		const flat = serializeWrappedKey(wrapped);
		const back = deserializeWrappedKey(flat);
		// Bytes survive serialization untouched.
		expect(Buffer.from(back.header).equals(Buffer.from(wrapped.header))).toBe(true);
		expect(Buffer.from(back.nonce).equals(Buffer.from(wrapped.nonce))).toBe(true);
		expect(Buffer.from(back.ciphertext).equals(Buffer.from(wrapped.ciphertext))).toBe(
			true
		);
		// And unwrap still works through serialization.
		const recovered = unwrapAesKey(VAULT_KEY, DEVICE_SALT, back);
		expect(Buffer.from(recovered).equals(Buffer.from(AES_KEY))).toBe(true);
	});

	it('rejects wrong-size aesKey', () => {
		expect(() => wrapAesKey(VAULT_KEY, DEVICE_SALT, bytes(31, 0))).toThrow(
			/aesKey must be 32 bytes/
		);
	});

	it('keypair derivation is deterministic from vaultKey + deviceSalt', () => {
		// Two wraps of the same AES key with the same vaultKey/salt
		// produce DIFFERENT envelopes (random nonce + ML-KEM ct), but
		// both decrypt to the same AES key — proves the keypair is
		// stable across calls.
		const a = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		const b = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
		const ra = unwrapAesKey(VAULT_KEY, DEVICE_SALT, a);
		const rb = unwrapAesKey(VAULT_KEY, DEVICE_SALT, b);
		expect(Buffer.from(ra).equals(Buffer.from(rb))).toBe(true);
	});

	// --- Workstream D3 — header byte-identity --------------------
	//
	// The serialized header length is part of the AAD-bound contract
	// the M3 sync Worker has to honor: blob upload re-emits these
	// bytes verbatim, and the AAD that authenticates the AES-GCM
	// blob includes `SHA-384(header)`. A drift in the header layout
	// (length, field order, etc.) silently breaks decrypt for every
	// existing vault. Lock the byte length here so any future change
	// to the envelope format must update this test deliberately.
	it('serialized header is exactly 1660 bytes', () => {
		const wrapped = wrapAesKey(VAULT_KEY, DEVICE_SALT, AES_KEY);
		const flat = serializeWrappedKey(wrapped);
		expect(flat.length).toBe(1660);
	});

	it('serialized header length is stable across distinct keypairs', () => {
		// Different vault keys → different ML-KEM ciphertexts inside
		// the wrap, but the SERIALIZED header length is fixed.
		const a = serializeWrappedKey(wrapAesKey(bytes(32, 0x01), DEVICE_SALT, AES_KEY));
		const b = serializeWrappedKey(
			wrapAesKey(bytes(32, 0xfe), bytes(16, 0xa5), AES_KEY)
		);
		expect(a.length).toBe(1660);
		expect(b.length).toBe(1660);
	});
});
