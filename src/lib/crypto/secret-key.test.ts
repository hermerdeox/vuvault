import { describe, expect, it } from 'vitest';
import {
	generateSecretKey,
	encodeBase32,
	decodeBase32,
	decodeSecretKey,
	parseVuKeyFile,
	groupChars,
	SECRET_KEY_BYTES,
	SECRET_KEY_BASE32_LEN
} from './secret-key';

describe('secret-key encoding', () => {
	it('generates 32 cryptographically random bytes', () => {
		const a = generateSecretKey();
		const b = generateSecretKey();
		expect(a).toHaveLength(SECRET_KEY_BYTES);
		expect(b).toHaveLength(SECRET_KEY_BYTES);
		// Vanishingly small chance of collision; document it as a sanity check.
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
	});

	it('round-trips Base32 encode/decode', () => {
		const original = generateSecretKey();
		const encoded = encodeBase32(original);
		const decoded = decodeBase32(encoded);
		expect(Array.from(decoded.slice(0, SECRET_KEY_BYTES))).toEqual(Array.from(original));
	});

	it('encodes to the expected Crockford length for 256 bits', () => {
		const k = generateSecretKey();
		const enc = encodeBase32(k);
		expect(enc).toHaveLength(SECRET_KEY_BASE32_LEN);
	});

	it('normalizes I→1, L→1, O→0 ambiguous chars', () => {
		const k = generateSecretKey();
		const enc = encodeBase32(k);
		// Inject ambiguous case and lowercase variants; should still decode equally.
		const messy = enc
			.split('')
			.map((c) => (c === '1' && Math.random() < 0.5 ? 'I' : c))
			.map((c) => (c === '0' && Math.random() < 0.5 ? 'O' : c))
			.join(' ')
			.toLowerCase();
		const decoded = decodeBase32(messy);
		expect(Array.from(decoded.slice(0, SECRET_KEY_BYTES))).toEqual(Array.from(k));
	});

	it('rejects invalid characters', () => {
		expect(() => decodeBase32('!!!')).toThrow(/Invalid character/);
	});

	it('decodeSecretKey enforces 32-byte length', () => {
		expect(() => decodeSecretKey('AAAA')).toThrow(/must decode to 32 bytes/);
	});

	it('groups 4 chars per token by default', () => {
		expect(groupChars('AABBCCDD')).toEqual(['AABB', 'CCDD']);
	});
});

describe('parseVuKeyFile', () => {
	it('extracts secretKey.value from a vukey/v1 JSON', () => {
		const k = generateSecretKey();
		const enc = encodeBase32(k);
		const payload = JSON.stringify({
			format: 'vukey/v1',
			secretKey: { value: enc }
		});
		expect(parseVuKeyFile(payload)).toBe(enc);
	});

	it('rejects unknown formats', () => {
		const payload = JSON.stringify({ format: 'vukey/v9', secretKey: { value: 'x' } });
		expect(() => parseVuKeyFile(payload)).toThrow(/Unsupported .vukey format/);
	});

	it('extracts the key line from an emergency-kit text dump', () => {
		const k = generateSecretKey();
		const enc = encodeBase32(k);
		const text = [
			'VuVault Emergency Kit',
			'====================',
			'',
			'Secret Key:',
			groupChars(enc, 4).join(' '),
			'',
			'Bundle hash: 9f4c7d2e8b16a4f1'
		].join('\n');
		const extracted = parseVuKeyFile(text);
		expect(decodeSecretKey(extracted)).toHaveLength(SECRET_KEY_BYTES);
	});

	it('throws if the file is empty', () => {
		expect(() => parseVuKeyFile('   ')).toThrow(/empty/);
	});
});
