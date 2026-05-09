import { describe, expect, it } from 'vitest';
import { generateTOTP, decodeBase32Totp, parseTotpSeed } from './totp';

describe('TOTP', () => {
	it('decodes RFC 4648 Base32', () => {
		expect(Array.from(decodeBase32Totp('JBSWY3DPEHPK3PXP'))).toEqual([
			0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef
		]);
	});

	it('generates the canonical RFC 6238 test vector at t=59', () => {
		// RFC 6238 test secret '12345678901234567890' (ASCII)
		const secret = new TextEncoder().encode('12345678901234567890');
		const { code } = generateTOTP({
			secret,
			period: 30,
			digits: 8,
			timestamp: 59 * 1000
		});
		expect(code).toBe('94287082');
	});

	it('parses an otpauth:// URI', () => {
		const uri =
			'otpauth://totp/Issuer:user@example.com?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&algorithm=SHA1';
		const parsed = parseTotpSeed(uri);
		expect(parsed.secret).toHaveLength(10);
		expect(parsed.period).toBe(30);
		expect(parsed.digits).toBe(6);
		expect(parsed.algorithm).toBe('SHA1');
		expect(parsed.issuer).toBe('Issuer');
	});

	it('parses a plain Base32 seed with whitespace', () => {
		const parsed = parseTotpSeed('JBSW Y3DP EHPK 3PXP');
		expect(parsed.secret).toHaveLength(10);
	});

	it('rejects an empty seed', () => {
		expect(() => parseTotpSeed('')).toThrow(/Empty TOTP seed/);
	});
});
