import { encodeBase32 } from '$lib/crypto/secret-key';

export const RECOVERY_PASSWORD_MIN_LENGTH = 16;
export const RECOVERY_PASSWORD_TARGET_BITS = 80;

export type RecoveryPasswordIssue =
	| 'required'
	| 'too-short'
	| 'too-weak'
	| 'common'
	| 'repeated'
	| 'keyboard'
	| 'date-like'
	| 'app-term'
	| 'contains-secret-key';

export type RecoveryPasswordPolicyResult = {
	ok: boolean;
	bits: number;
	issues: RecoveryPasswordIssue[];
	message: string;
};

export type RecoveryPasswordPolicyContext = {
	secretKey?: Uint8Array | string | null;
};

const COMMON = new Set(
	[
		'password',
		'password1',
		'password123',
		'correcthorsebatterystaple',
		'letmein',
		'welcome',
		'qwerty',
		'qwerty123',
		'admin',
		'admin123',
		'secret',
		'masterpassword',
		'recoverypassword'
	].map((p) => p.toLowerCase())
);

const APP_TERMS = ['vuvault', 'vault', 'recovery', 'password', 'emergency'];
const KEYBOARD_RUNS = [
	'abcdefghijklmnopqrstuvwxyz',
	'zyxwvutsrqponmlkjihgfedcba',
	'0123456789',
	'9876543210',
	'qwertyuiop',
	'poiuytrewq',
	'asdfghjkl',
	'lkjhgfdsa',
	'zxcvbnm',
	'mnbvcxz'
];

function estimateBits(password: string): number {
	let charset = 0;
	if (/[a-z]/.test(password)) charset += 26;
	if (/[A-Z]/.test(password)) charset += 26;
	if (/\d/.test(password)) charset += 10;
	if (/[^a-zA-Z0-9]/.test(password)) charset += 32;
	if (charset === 0) charset = 1;
	const rawBits = Math.log2(charset) * password.length;
	const uniqueChars = new Set(password).size;
	const uniquenessPenalty = Math.min(1, uniqueChars / Math.max(8, password.length / 2));
	return rawBits * uniquenessPenalty;
}

function normalize(s: string): string {
	return s.toLowerCase().replace(/[\s_-]+/g, '');
}

function containsKeyboardRun(normalized: string): boolean {
	return KEYBOARD_RUNS.some((run) => {
		for (let i = 0; i <= run.length - 5; i++) {
			if (normalized.includes(run.slice(i, i + 5))) return true;
		}
		return false;
	});
}

function containsSecretKey(password: string, secretKey: RecoveryPasswordPolicyContext['secretKey']): boolean {
	if (!secretKey) return false;
	const encoded =
		typeof secretKey === 'string' ? secretKey : encodeBase32(secretKey);
	const normalizedPassword = normalize(password);
	const normalizedKey = normalize(encoded);
	return (
		normalizedPassword.includes(normalizedKey) ||
		normalizedKey.includes(normalizedPassword)
	);
}

function messageFor(issues: RecoveryPasswordIssue[], bits: number): string {
	if (issues.includes('required')) return 'Recovery Password is required.';
	if (issues.includes('too-short')) {
		return `Use at least ${RECOVERY_PASSWORD_MIN_LENGTH} characters.`;
	}
	if (issues.includes('contains-secret-key')) {
		return 'Do not include your Secret Key in the Recovery Password.';
	}
	if (issues.includes('common')) return 'Use a less common Recovery Password.';
	if (issues.includes('repeated')) return 'Avoid repeated characters.';
	if (issues.includes('keyboard')) return 'Avoid keyboard or alphabet sequences.';
	if (issues.includes('date-like')) return 'Avoid dates or years.';
	if (issues.includes('app-term')) {
		return 'Avoid obvious VuVault/recovery/password terms.';
	}
	if (issues.includes('too-weak')) {
		return `Use a longer passphrase; estimated strength is ${Math.round(bits)} bits.`;
	}
	return 'Recovery Password is strong.';
}

export function validateRecoveryPassword(
	password: string,
	context: RecoveryPasswordPolicyContext = {}
): RecoveryPasswordPolicyResult {
	const issues: RecoveryPasswordIssue[] = [];
	const trimmed = password.trim();
	const normalized = normalize(trimmed);
	const bits = estimateBits(trimmed);

	if (!trimmed) issues.push('required');
	if (trimmed.length < RECOVERY_PASSWORD_MIN_LENGTH) issues.push('too-short');
	if (COMMON.has(normalized)) issues.push('common');
	if (/^(.)\1{7,}$/u.test(trimmed)) issues.push('repeated');
	if (containsKeyboardRun(normalized)) issues.push('keyboard');
	if (/(19|20)\d{2}/.test(normalized) || /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(trimmed)) {
		issues.push('date-like');
	}
	if (APP_TERMS.some((term) => normalized.includes(term))) issues.push('app-term');
	if (containsSecretKey(trimmed, context.secretKey)) issues.push('contains-secret-key');
	if (bits < RECOVERY_PASSWORD_TARGET_BITS) issues.push('too-weak');

	const uniqueIssues = Array.from(new Set(issues));
	return {
		ok: uniqueIssues.length === 0,
		bits,
		issues: uniqueIssues,
		message: messageFor(uniqueIssues, bits)
	};
}

export function assertRecoveryPasswordPolicy(
	password: string,
	context: RecoveryPasswordPolicyContext = {}
): void {
	const result = validateRecoveryPassword(password, context);
	if (!result.ok) {
		throw new Error(result.message);
	}
}
