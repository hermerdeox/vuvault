/**
 * Local password health detection — Weak / Reused.
 *
 * Hard rules:
 *   1. Plaintext passwords NEVER leave this module. The store keeps only
 *      derived booleans / counts and a hash-bucket map keyed by id.
 *   2. The reuse map indexes by SHA-384(password) hex, so two identical
 *      passwords share a bucket without storing the password itself.
 *   3. No analytics. No telemetry. No network calls.
 *
 * Strength model (simplified, zxcvbn-free):
 *   bits = log2(charsetSize) * length
 *   - charsetSize counts the unique character classes present in the
 *     password (lowercase, uppercase, digit, symbol).
 *   - Length is the raw character count. (We do not penalize for
 *     repeats here; the embedded common-password mini-list and the
 *     length floor below catch the most common bad cases.)
 *   - Threshold defaults to 60 bits — anything below counts as weak.
 *   - Common passwords are forced weak regardless of length/charset.
 */

const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
	[
		'password',
		'password1',
		'password123',
		'p@ssword',
		'p@ssw0rd',
		'12345678',
		'123456789',
		'qwerty',
		'qwerty123',
		'letmein',
		'welcome',
		'admin',
		'admin123',
		'iloveyou',
		'monkey',
		'sunshine',
		'football',
		'baseball',
		'dragon',
		'starwars',
		'abc123',
		'changeme',
		'secret',
		'master',
		'asdfasdf',
		'qazwsx',
		'1qaz2wsx',
		'login',
		'access'
	].map((p) => p.toLowerCase())
);

export const WEAK_BITS_THRESHOLD = 60;

export type Strength = {
	bits: number;
	weak: boolean;
	reason: 'short' | 'low-entropy' | 'common' | null;
};

export function estimatePasswordStrength(password: string): Strength {
	if (typeof password !== 'string' || password.length === 0) {
		return { bits: 0, weak: true, reason: 'short' };
	}
	if (COMMON_PASSWORDS.has(password.toLowerCase())) {
		return { bits: 0, weak: true, reason: 'common' };
	}
	let charset = 0;
	if (/[a-z]/.test(password)) charset += 26;
	if (/[A-Z]/.test(password)) charset += 26;
	if (/\d/.test(password)) charset += 10;
	if (/[^a-zA-Z0-9]/.test(password)) charset += 32;
	if (charset === 0) charset = 1;

	const bits = Math.log2(charset) * password.length;
	if (password.length < 8) {
		return { bits, weak: true, reason: 'short' };
	}
	if (bits < WEAK_BITS_THRESHOLD) {
		return { bits, weak: true, reason: 'low-entropy' };
	}
	return { bits, weak: false, reason: null };
}

/**
 * Hash a password with SHA-384 via WebCrypto. Returns the hex digest so
 * it can be used as a Map key. The password input is consumed inside
 * the function and is never persisted by the health service.
 */
export async function hashPasswordForReuse(password: string): Promise<string> {
	if (!password) return '';
	const enc = new TextEncoder().encode(password);
	const digest = await crypto.subtle.digest('SHA-384', enc);
	const bytes = new Uint8Array(digest);
	let out = '';
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i]!.toString(16).padStart(2, '0');
	}
	return out;
}

export type ItemHealth = {
	id: string;
	weak: boolean;
	reused: boolean;
	bits: number;
	weakReason: Strength['reason'];
};

export type VaultHealth = {
	weakIds: Set<string>;
	reusedIds: Set<string>;
	weakCount: number;
	reusedCount: number;
	byId: Map<string, ItemHealth>;
};

export type HealthInput = {
	id: string;
	password?: string;
};

/**
 * Compute health for the supplied items. The `password` strings on
 * `HealthInput` are read once, hashed for reuse detection, and never
 * stored. The returned `VaultHealth` contains only ids, booleans, and
 * the derived bit estimate — never plaintext.
 */
export async function computeVaultHealth(items: HealthInput[]): Promise<VaultHealth> {
	const byId = new Map<string, ItemHealth>();
	const weakIds = new Set<string>();
	const reusedIds = new Set<string>();

	// Group by hash to find reuse. Plaintext passwords are kept on the
	// stack only for the duration of this loop and are not retained.
	const buckets = new Map<string, string[]>();

	for (const item of items) {
		if (!item.password) continue;
		const hash = await hashPasswordForReuse(item.password);
		const arr = buckets.get(hash) ?? [];
		arr.push(item.id);
		buckets.set(hash, arr);
	}

	const reuseMembers = new Set<string>();
	for (const [, ids] of buckets) {
		if (ids.length >= 2) {
			for (const id of ids) reuseMembers.add(id);
		}
	}

	for (const item of items) {
		if (!item.password) continue;
		const strength = estimatePasswordStrength(item.password);
		const reused = reuseMembers.has(item.id);
		const record: ItemHealth = {
			id: item.id,
			weak: strength.weak,
			reused,
			bits: strength.bits,
			weakReason: strength.reason
		};
		byId.set(item.id, record);
		if (strength.weak) weakIds.add(item.id);
		if (reused) reusedIds.add(item.id);
	}

	return {
		weakIds,
		reusedIds,
		weakCount: weakIds.size,
		reusedCount: reusedIds.size,
		byId
	};
}
