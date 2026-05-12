import { describe, expect, it } from 'vitest';
import {
	assertRecoveryPasswordPolicy,
	validateRecoveryPassword
} from './recovery-password-policy';

describe('recovery password policy', () => {
	it('accepts long high-entropy passphrases', () => {
		const result = validateRecoveryPassword('orchid-river-glass-comet-47!');
		expect(result.ok).toBe(true);
		expect(result.bits).toBeGreaterThanOrEqual(80);
	});

	it('rejects short, common, repeated, and app-term values', () => {
		expect(validateRecoveryPassword('password').issues).toContain('too-short');
		expect(validateRecoveryPassword('password').issues).toContain('common');
		expect(validateRecoveryPassword('aaaaaaaaaaaaaaaa').issues).toContain('repeated');
		expect(validateRecoveryPassword('vuvault-recovery-password-2026!').issues).toContain(
			'app-term'
		);
	});

	it('rejects values containing the Secret Key', () => {
		const encoded = '0W3GF1R70W3GF1R70W3GF1R70W3GF1R70W3GF1R70W3GF1R70W3G';
		expect(validateRecoveryPassword(`safe-prefix-${encoded}`, { secretKey: encoded }).issues).toContain(
			'contains-secret-key'
		);
	});

	it('throws a concise error for service-layer enforcement', () => {
		expect(() => assertRecoveryPasswordPolicy('qwerty1234567890')).toThrow(
			/Avoid keyboard|Use a longer/
		);
	});
});
