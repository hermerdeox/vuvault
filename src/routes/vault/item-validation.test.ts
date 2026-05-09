import { describe, expect, it } from 'vitest';
import {
	validateLogin,
	validateCard,
	validateNote,
	validateIdentity,
	validateSsh,
	validateSeed,
	validateDocument,
	TITLE_MAX
} from './item-validation';

describe('validateLogin', () => {
	it('requires a title', () => {
		const r = validateLogin({
			title: '',
			url: '',
			username: 'r',
			password: 'p',
			totpSeed: ''
		});
		expect(r.ok).toBe(false);
		expect(r.fieldErrors.title).toBeTruthy();
	});

	it('requires either a username or a password', () => {
		const r = validateLogin({
			title: 'Empty',
			url: '',
			username: '',
			password: '',
			totpSeed: ''
		});
		expect(r.ok).toBe(false);
		expect(r.fieldErrors.username).toBeTruthy();
	});

	it('accepts a well-formed entry', () => {
		const r = validateLogin({
			title: 'GitHub',
			url: 'https://github.com',
			username: 'r-lopez',
			password: 'pw',
			totpSeed: 'JBSWY3DPEHPK3PXP'
		});
		expect(r.ok).toBe(true);
	});

	it('rejects a malformed URL', () => {
		const r = validateLogin({
			title: 'Bad',
			url: 'not a url',
			username: 'u',
			password: 'p',
			totpSeed: ''
		});
		expect(r.fieldErrors.url).toBeTruthy();
	});

	it('accepts otpauth:// URI', () => {
		const r = validateLogin({
			title: 'OK',
			url: '',
			username: 'u',
			password: 'p',
			totpSeed: 'otpauth://totp/Issuer:user?secret=JBSWY3DPEHPK3PXP'
		});
		expect(r.ok).toBe(true);
	});

	it('rejects garbage TOTP', () => {
		const r = validateLogin({
			title: 'OK',
			url: '',
			username: 'u',
			password: 'p',
			totpSeed: '!@#$ not a seed'
		});
		expect(r.fieldErrors.totpSeed).toBeTruthy();
	});

	it('rejects a title that exceeds TITLE_MAX', () => {
		const r = validateLogin({
			title: 'x'.repeat(TITLE_MAX + 1),
			url: '',
			username: 'u',
			password: 'p',
			totpSeed: ''
		});
		expect(r.fieldErrors.title).toMatch(/too long/);
	});
});

describe('validateCard', () => {
	it('accepts a well-formed card', () => {
		const r = validateCard({
			title: 'BoA',
			cardholder: 'R LOPEZ',
			cardNumber: '4111 1111 1111 1111',
			cardExpiry: '09/28',
			cardCvc: '123'
		});
		expect(r.ok).toBe(true);
	});

	it('rejects a short number', () => {
		const r = validateCard({
			title: 'x',
			cardholder: '',
			cardNumber: '1234',
			cardExpiry: '',
			cardCvc: ''
		});
		expect(r.fieldErrors.cardNumber).toBeTruthy();
	});

	it('rejects a malformed expiry', () => {
		const r = validateCard({
			title: 'x',
			cardholder: '',
			cardNumber: '',
			cardExpiry: '13/99',
			cardCvc: ''
		});
		expect(r.fieldErrors.cardExpiry).toBeTruthy();
	});

	it('rejects a non-digit CVC', () => {
		const r = validateCard({
			title: 'x',
			cardholder: '',
			cardNumber: '',
			cardExpiry: '',
			cardCvc: 'abc'
		});
		expect(r.fieldErrors.cardCvc).toBeTruthy();
	});
});

describe('validateNote', () => {
	it('accepts a normal note', () => {
		expect(validateNote({ title: 'n', noteBody: 'hi' }).ok).toBe(true);
	});

	it('rejects oversize body', () => {
		const big = 'x'.repeat(200_000);
		expect(validateNote({ title: 'n', noteBody: big }).fieldErrors.noteBody).toBeTruthy();
	});
});

describe('validateIdentity', () => {
	it('rejects malformed email', () => {
		const r = validateIdentity({
			title: 'me',
			identityName: '',
			identityEmail: 'not-an-email',
			identityPhone: '',
			identityAddress: ''
		});
		expect(r.fieldErrors.identityEmail).toBeTruthy();
	});

	it('accepts blank optional fields', () => {
		const r = validateIdentity({
			title: 'me',
			identityName: 'Sam',
			identityEmail: '',
			identityPhone: '',
			identityAddress: ''
		});
		expect(r.ok).toBe(true);
	});
});

describe('validateSsh', () => {
	it('rejects empty key body', () => {
		const r = validateSsh({
			title: 'k',
			sshKeyBody: '',
			sshPassphrase: ''
		});
		expect(r.fieldErrors.sshKeyBody).toBeTruthy();
		expect(r.ok).toBe(false);
	});

	it('warns but DOES NOT block when BEGIN/END markers are missing', () => {
		const r = validateSsh({
			title: 'k',
			sshKeyBody: 'looks-like-a-blob-but-is-not',
			sshPassphrase: ''
		});
		// Advisory only — must save successfully.
		expect(r.ok).toBe(true);
		expect(r.fieldErrors.sshKeyBody).toBeUndefined();
		expect(r.fieldWarnings?.sshKeyBody).toBeTruthy();
	});

	it('accepts a key body with markers, no warning', () => {
		const r = validateSsh({
			title: 'k',
			sshKeyBody:
				'-----BEGIN OPENSSH PRIVATE KEY-----\nFFFFFFF==\n-----END OPENSSH PRIVATE KEY-----',
			sshPassphrase: ''
		});
		expect(r.ok).toBe(true);
		expect(r.fieldWarnings).toBeUndefined();
	});
});

describe('validateSeed', () => {
	const PHRASE_12 =
		'apple banana cherry date elderberry fig grape honey indigo juniper kiwi lemon';

	it('accepts a 12-word phrase', () => {
		expect(
			validateSeed({ title: 'wallet', seedPhrase: PHRASE_12 }).ok
		).toBe(true);
	});

	it('rejects an 11-word phrase', () => {
		const phrase = PHRASE_12.split(' ').slice(0, 11).join(' ');
		expect(
			validateSeed({ title: 'wallet', seedPhrase: phrase }).fieldErrors.seedPhrase
		).toBeTruthy();
	});

	it('rejects words containing non-letters', () => {
		const phrase = PHRASE_12.split(' ');
		phrase[0] = 'app1e';
		expect(
			validateSeed({ title: 'wallet', seedPhrase: phrase.join(' ') }).fieldErrors
				.seedPhrase
		).toBeTruthy();
	});
});

describe('validateDocument', () => {
	it('accepts metadata-only document', () => {
		expect(
			validateDocument({
				title: 'Lease',
				docDescription: 'Greenville office, 24 months',
				docExternalRef: ''
			}).ok
		).toBe(true);
	});

	it('rejects empty title', () => {
		expect(
			validateDocument({
				title: '   ',
				docDescription: '',
				docExternalRef: ''
			}).fieldErrors.title
		).toBeTruthy();
	});
});
