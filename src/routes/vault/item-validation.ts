/**
 * Per-kind validation for the ItemEditor. Pure functions so they can
 * be unit-tested in isolation without mounting the editor component.
 *
 * Validation is deliberately permissive: passwords managers must accept
 * messy real-world data (legacy URLs without scheme, cards with mixed
 * spacing, identities without phone numbers, etc.). The goal here is to
 * catch *clearly broken* inputs and give helpful copy when fields are
 * malformed, not to enforce a strict format.
 */

import type { ItemKind } from '$lib/stores/vault.svelte';

export type ValidationResult = {
	ok: boolean;
	/** Field id → error message. Only set for fields that fail. */
	fieldErrors: Record<string, string>;
	/**
	 * Field id → advisory warning. Does NOT block save (`ok` stays
	 * true if the only issues are warnings). UI surfaces these in the
	 * same banner colors as errors but with a different icon.
	 */
	fieldWarnings?: Record<string, string>;
	/** Optional general/banner-level error message. */
	formError?: string;
};

export type LoginInput = {
	title: string;
	url: string;
	username: string;
	password: string;
	totpSeed: string;
};

export type CardInput = {
	title: string;
	cardholder: string;
	cardNumber: string;
	cardExpiry: string;
	cardCvc: string;
};

export type NoteInput = {
	title: string;
	noteBody: string;
};

export type IdentityInput = {
	title: string;
	identityName: string;
	identityEmail: string;
	identityPhone: string;
	identityAddress: string;
};

export type SshInput = {
	title: string;
	sshKeyBody: string;
	sshPassphrase: string;
};

export type SeedInput = {
	title: string;
	seedPhrase: string;
};

export type DocumentInput = {
	title: string;
	docDescription: string;
	docExternalRef: string;
	/** Metadata for an already-encrypted attached file, if any. */
	docFileName?: string;
	docMimeType?: string;
	docSize?: number;
};

/**
 * Hard upper bound on attached document plaintext size. Aligns with the
 * R2 upload route's ciphertext cap so a save here never produces a blob
 * the sync server will reject. 8 MiB matches `MAX_CIPHERTEXT_BYTES` in
 * [src/routes/api/v2/blobs/[uuid]/+server.ts](src/routes/api/v2/blobs/[uuid]/+server.ts);
 * GCM tag + 12-byte nonce adds at most 28 bytes so the plaintext cap is
 * deliberately a few KB under that.
 */
export const DOCUMENT_FILE_MAX = 8 * 1024 * 1024 - 1024;

export const TITLE_MAX = 200;
export const NOTE_MAX = 100_000;
export const ADDRESS_MAX = 1_000;
export const SSH_KEY_MAX = 100_000;
export const SEED_MAX = 4_000;
const URL_RE = /^(https?:\/\/[^\s]+|[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s.-]{4,}$/;
const EXPIRY_RE = /^(0[1-9]|1[0-2])\s*\/\s*\d{2,4}$/;
const CVC_RE = /^\d{3,4}$/;
const CARD_RE = /^\d[\d\s-]{11,30}$/;
const SEED_WORD_RE = /^[a-z]+$/;

function checkTitle(title: string, errs: Record<string, string>) {
	if (!title.trim()) {
		errs.title = 'Title is required.';
	} else if (title.length > TITLE_MAX) {
		errs.title = `Title is too long (max ${TITLE_MAX} characters).`;
	}
}

export function validateLogin(input: LoginInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);

	if (input.url && input.url.length > 2048) {
		fieldErrors.url = 'URL is too long.';
	} else if (input.url && !URL_RE.test(input.url.trim())) {
		fieldErrors.url = 'URL does not look valid (use https://example.com).';
	}

	if (!input.username.trim() && !input.password) {
		// A login with neither a username nor a password is almost
		// certainly a mistake — it would never be useful for autofill or
		// recall. Permit notes-only flows by switching the item kind.
		fieldErrors.username =
			'Add a username, a password, or both — a login needs at least one.';
	}

	if (input.totpSeed) {
		const v = input.totpSeed.trim();
		if (!v.toLowerCase().startsWith('otpauth://') && !/^[A-Z2-7\s=]+$/i.test(v)) {
			fieldErrors.totpSeed =
				'TOTP seed must be a Base32 secret or an otpauth:// URI.';
		}
	}

	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors
	};
}

export function validateCard(input: CardInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);

	if (input.cardNumber) {
		const cleaned = input.cardNumber.replace(/[\s-]/g, '');
		if (!/^\d{12,19}$/.test(cleaned)) {
			fieldErrors.cardNumber = 'Card number must be 12–19 digits.';
		} else if (!CARD_RE.test(input.cardNumber)) {
			fieldErrors.cardNumber = 'Card number contains unexpected characters.';
		}
	}

	if (input.cardExpiry && !EXPIRY_RE.test(input.cardExpiry.trim())) {
		fieldErrors.cardExpiry = 'Expiry must be MM/YY or MM/YYYY.';
	}

	if (input.cardCvc && !CVC_RE.test(input.cardCvc.trim())) {
		fieldErrors.cardCvc = 'CVC must be 3 or 4 digits.';
	}

	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors
	};
}

export function validateNote(input: NoteInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);
	if (input.noteBody.length > NOTE_MAX) {
		fieldErrors.noteBody = `Note body is too long (max ${NOTE_MAX} characters).`;
	}
	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors
	};
}

export function validateIdentity(input: IdentityInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);
	if (input.identityEmail && !EMAIL_RE.test(input.identityEmail.trim())) {
		fieldErrors.identityEmail = 'Email does not look valid.';
	}
	if (input.identityPhone && !PHONE_RE.test(input.identityPhone.trim())) {
		fieldErrors.identityPhone = 'Phone number does not look valid.';
	}
	if (input.identityAddress.length > ADDRESS_MAX) {
		fieldErrors.identityAddress = `Address is too long (max ${ADDRESS_MAX} characters).`;
	}
	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors
	};
}

export function validateSsh(input: SshInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	const fieldWarnings: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);
	if (!input.sshKeyBody.trim()) {
		fieldErrors.sshKeyBody = 'Private key body is required.';
	} else if (input.sshKeyBody.length > SSH_KEY_MAX) {
		fieldErrors.sshKeyBody = `Key body is too long (max ${SSH_KEY_MAX} characters).`;
	} else if (
		!input.sshKeyBody.includes('-----BEGIN') ||
		!input.sshKeyBody.includes('-----END')
	) {
		// Advisory ONLY — some pasted keys are partial or wrapped. We
		// surface the missing-markers note so the user can verify, but
		// do not block save. Pre-Milestone-2 review found the previous
		// behavior incorrectly set fieldErrors and refused saves.
		fieldWarnings.sshKeyBody =
			'Key body does not contain the expected -----BEGIN / -----END markers.';
	}
	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors,
		fieldWarnings: Object.keys(fieldWarnings).length > 0 ? fieldWarnings : undefined
	};
}

export function validateSeed(input: SeedInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);
	const phrase = input.seedPhrase.trim();
	if (!phrase) {
		fieldErrors.seedPhrase = 'Seed phrase is required.';
	} else if (phrase.length > SEED_MAX) {
		fieldErrors.seedPhrase = `Seed phrase is too long (max ${SEED_MAX} characters).`;
	} else {
		const words = phrase.toLowerCase().split(/\s+/).filter(Boolean);
		const recognizedLengths = [12, 15, 18, 21, 24];
		if (!recognizedLengths.includes(words.length)) {
			fieldErrors.seedPhrase = `Seed phrase has ${words.length} words; expected 12, 15, 18, 21, or 24.`;
		} else if (!words.every((w) => SEED_WORD_RE.test(w))) {
			fieldErrors.seedPhrase = 'Seed phrase contains non-letter characters.';
		}
	}
	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors
	};
}

export function validateDocument(input: DocumentInput): ValidationResult {
	const fieldErrors: Record<string, string> = {};
	checkTitle(input.title, fieldErrors);
	if (input.docDescription.length > NOTE_MAX) {
		fieldErrors.docDescription = `Description is too long (max ${NOTE_MAX} characters).`;
	}
	if (input.docExternalRef && input.docExternalRef.length > 1024) {
		fieldErrors.docExternalRef = 'External reference is too long.';
	}
	if (typeof input.docSize === 'number' && input.docSize > DOCUMENT_FILE_MAX) {
		fieldErrors.docFile = `File is too large (max ${(DOCUMENT_FILE_MAX / (1024 * 1024)).toFixed(1)} MB).`;
	}
	if (input.docFileName && input.docFileName.length > 512) {
		fieldErrors.docFile = 'File name is too long.';
	}
	return {
		ok: Object.keys(fieldErrors).length === 0,
		fieldErrors
	};
}

export function labelFor(kind: ItemKind): string {
	const labels: Record<ItemKind, string> = {
		login: 'Login',
		card: 'Card',
		note: 'Secure note',
		identity: 'Identity',
		ssh: 'SSH key',
		'crypto-seed': 'Crypto seed',
		document: 'Document'
	};
	return labels[kind];
}
