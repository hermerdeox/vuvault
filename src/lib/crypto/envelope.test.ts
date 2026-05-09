import { describe, expect, it } from 'vitest';
import {
	generateKeypair,
	seal,
	open,
	HYBRID_PK_LEN,
	HYBRID_SK_LEN,
	HEADER_LEN,
	MLKEM1024_PK_LEN,
	X25519_PK_LEN
} from './envelope';

describe('envelope (X25519 + ML-KEM-1024 hybrid)', () => {
	it('generates a real hybrid keypair with the expected lengths', () => {
		const kp = generateKeypair();
		expect(kp.publicKey).toHaveLength(HYBRID_PK_LEN);
		expect(kp.secretKey).toHaveLength(HYBRID_SK_LEN);
		// Confirm the ML-KEM half is non-zero (regression check that we're
		// no longer using the placeholder zero-fill).
		const mlkemHalf = kp.publicKey.slice(X25519_PK_LEN);
		expect(mlkemHalf).toHaveLength(MLKEM1024_PK_LEN);
		expect(mlkemHalf.some((b) => b !== 0)).toBe(true);
	});

	it('round-trips a payload', () => {
		const kp = generateKeypair();
		const message = new TextEncoder().encode('hello vault');
		const sealed = seal(message, kp.publicKey);
		expect(sealed.header).toHaveLength(HEADER_LEN);
		const opened = open(sealed, kp.secretKey);
		expect(new TextDecoder().decode(opened)).toBe('hello vault');
	});

	it('different sealings produce different ciphertexts even for the same payload', () => {
		const kp = generateKeypair();
		const message = new Uint8Array([1, 2, 3, 4, 5]);
		const a = seal(message, kp.publicKey);
		const b = seal(message, kp.publicKey);
		// Header (ML-KEM ct) must differ since encapsulation uses fresh randomness.
		expect(Buffer.from(a.header).equals(Buffer.from(b.header))).toBe(false);
	});

	it('rejects wrong-size keys', () => {
		const kp = generateKeypair();
		expect(() => seal(new Uint8Array([1]), new Uint8Array(10))).toThrow(
			/recipientPubkey must be/
		);
		const sealed = seal(new Uint8Array([1, 2, 3]), kp.publicKey);
		expect(() => open(sealed, new Uint8Array(10))).toThrow(/secretKey must be/);
	});

	it('decryption fails when the wrong secret key is used', () => {
		const a = generateKeypair();
		const b = generateKeypair();
		const sealed = seal(new TextEncoder().encode('secret'), a.publicKey);
		expect(() => open(sealed, b.secretKey)).toThrow();
	});

	it('detects header tampering (AAD binding)', () => {
		// Header is bound as AAD; flipping any byte in the header MUST
		// fail decrypt even if the ciphertext is untouched.
		const kp = generateKeypair();
		const sealed = seal(new TextEncoder().encode('payload'), kp.publicKey);
		// Flip a byte in the X25519 ephemeral pubkey portion.
		sealed.header[0] = (sealed.header[0] ?? 0) ^ 0xff;
		expect(() => open(sealed, kp.secretKey)).toThrow();
	});

	it('detects ciphertext tampering', () => {
		const kp = generateKeypair();
		const sealed = seal(new TextEncoder().encode('payload'), kp.publicKey);
		sealed.ciphertext[0] = (sealed.ciphertext[0] ?? 0) ^ 0xff;
		expect(() => open(sealed, kp.secretKey)).toThrow();
	});
});
