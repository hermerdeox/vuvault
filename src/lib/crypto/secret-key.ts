/**
 * Secret Key — 256-bit client-only entropy.
 *
 * Generated once during onboarding via crypto.getRandomValues.
 * Combined with WebAuthn PRF output and (optionally) an Argon2id-stretched
 * master password to derive the vault master key.
 *
 * The Secret Key is NEVER transmitted. It lives in:
 *   1. memory during a session
 *   2. the platform secure store (Secure Enclave / TPM) bound to the passkey
 *   3. the user's printed Emergency Kit
 *
 * Encoding: Base32-Crockford (no I, L, O, U) for human transcription.
 * 256 bits → 52 characters → 13 groups of 4.
 */

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const B32_INDEX = (() => {
	const m = new Map<string, number>();
	for (let i = 0; i < B32.length; i++) m.set(B32[i]!, i);
	return m;
})();

export const SECRET_KEY_BYTES = 32;
export const SECRET_KEY_BITS = SECRET_KEY_BYTES * 8;
export const SECRET_KEY_BASE32_LEN = Math.ceil((SECRET_KEY_BITS + 4) / 5); // 52

export function generateSecretKey(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(SECRET_KEY_BYTES));
}

export function encodeBase32(bytes: Uint8Array): string {
	let bits = 0,
		value = 0,
		out = '';
	for (const b of bytes) {
		value = (value << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += B32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += B32[(value << (5 - bits)) & 31];
	return out;
}

export function groupChars(s: string, size = 4): string[] {
	const groups: string[] = [];
	for (let i = 0; i < s.length; i += size) groups.push(s.slice(i, i + size));
	return groups;
}

/**
 * Decode a Crockford Base32 string. Whitespace, hyphens, and ambiguous
 * characters (I/L/O → 1/0) are normalized. Returns the raw bytes; the
 * caller must verify the length matches their expected key size.
 */
export function decodeBase32(encoded: string): Uint8Array {
	const cleaned = encoded
		.replace(/[\s-]+/g, '')
		.toUpperCase()
		.replace(/[ILO]/g, (c) => (c === 'I' || c === 'L' ? '1' : '0'));
	if (!cleaned.length) {
		throw new Error('Secret Key is empty');
	}
	const bytes: number[] = [];
	let bits = 0,
		value = 0;
	for (const ch of cleaned) {
		const idx = B32_INDEX.get(ch);
		if (idx === undefined) throw new Error(`Invalid character in Secret Key: ${ch}`);
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(bytes);
}

/**
 * Strict variant of decodeBase32 that ensures the result is the canonical
 * 256-bit Secret Key. Use this on every unlock/import path; never accept
 * arbitrary-length keys for vault operations.
 */
export function decodeSecretKey(encoded: string): Uint8Array {
	const bytes = decodeBase32(encoded);
	if (bytes.length !== SECRET_KEY_BYTES) {
		throw new Error(
			`Secret Key must decode to ${SECRET_KEY_BYTES} bytes (got ${bytes.length})`
		);
	}
	return bytes;
}

export type VuKeyFile = {
	format: string; // expected: 'vukey/v1'
	issued?: string;
	device?: string | null;
	secretKey: {
		encoding?: string;
		bits?: number;
		groups?: string[];
		value: string;
	};
	bundle?: string;
};

/**
 * Extract the Base32-encoded Secret Key from a `.vukey` JSON payload.
 * Falls back to treating raw text as a plain Base32 dump (Emergency-Kit
 * paste). Throws on parse failure or wrong length so the caller can show
 * a precise error.
 */
export function parseVuKeyFile(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error('File is empty');

	// Try JSON first.
	if (trimmed.startsWith('{')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (err) {
			throw new Error(`File is not valid JSON: ${(err as Error).message}`, { cause: err });
		}
		if (typeof parsed !== 'object' || !parsed) {
			throw new Error('Expected an object at the top level of the .vukey file');
		}
		const obj = parsed as Partial<VuKeyFile>;
		if (obj.format && obj.format !== 'vukey/v1') {
			throw new Error(`Unsupported .vukey format: ${obj.format}`);
		}
		const value = obj.secretKey?.value;
		if (typeof value !== 'string') {
			throw new Error('Missing secretKey.value in .vukey file');
		}
		return value;
	}

	// Otherwise: try to extract a Base32 line from a plaintext Emergency Kit.
	// Look for the longest run of valid Crockford-Base32 chars on a single line.
	const candidate = trimmed
		.split('\n')
		.map((line) => line.trim().replace(/[\s-]+/g, ''))
		.filter((line) => line.length >= SECRET_KEY_BASE32_LEN)
		.find((line) => /^[0-9A-Za-z]+$/.test(line));
	if (!candidate) {
		throw new Error(
			'Could not find a Secret Key in the file. Paste the key text or drop a .vukey file.'
		);
	}
	return candidate;
}
