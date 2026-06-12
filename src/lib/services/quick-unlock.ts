/**
 * Trusted-device quick unlock.
 *
 * Stores a local-only ciphertext of the 256-bit Secret Key, sealed by a
 * key derived from the registered WebAuthn PRF output. This reduces
 * returning-user friction without storing plaintext key material or
 * bypassing OPAQUE/master-password factors.
 */
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha512, sha384 } from '@noble/hashes/sha2';
import { evaluatePRF } from '$lib/crypto/webauthn-prf';
import {
	deleteQuickUnlock,
	getAccount,
	getQuickUnlock,
	saveQuickUnlock,
	type AccountRecord
} from '$lib/utils/storage';

/**
 * Thrown by `openQuickUnlock` only when the cached ciphertext itself is
 * no longer usable — an AES-GCM authentication failure under a correctly
 * resolved PRF, which means the cache is stale (passkey re-registered),
 * tampered, or corrupt. In that one case the cache is deleted before the
 * throw. Every OTHER failure (the user dismissed the Touch ID prompt, the
 * authenticator returned no PRF, a timeout) propagates as a plain Error
 * and leaves the cache intact — an accidental Cancel must never destroy
 * trusted-device quick unlock. The `code` lets the unlock UI branch
 * across the dynamic-import boundary.
 */
export class QuickUnlockCacheError extends Error {
	readonly code = 'quick-unlock-cache-invalid' as const;
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'QuickUnlockCacheError';
	}
}

const QUICK_UNLOCK_VERSION = 1;
const SECRET_KEY_LEN = 32;
const PRF_OUTPUT_LEN = 32;
const AES_NONCE_LEN = 12;
const QUICK_UNLOCK_KEY_LEN = 32;
const QUICK_UNLOCK_INFO = 'vuvault-quick-unlock-v1';
const AAD_DOMAIN = new TextEncoder().encode('vuvault-quick-unlock-aad-v1');

function zeroize(buf: Uint8Array | null | undefined): void {
	buf?.fill(0);
}

function deriveQuickUnlockKey(account: AccountRecord, prfOutput: Uint8Array): Uint8Array {
	if (prfOutput.length !== PRF_OUTPUT_LEN) {
		throw new Error(`Quick unlock PRF output must be ${PRF_OUTPUT_LEN} bytes`);
	}
	return hkdf(
		sha512,
		prfOutput,
		account.deviceSalt,
		QUICK_UNLOCK_INFO,
		QUICK_UNLOCK_KEY_LEN
	);
}

function makeAad(account: AccountRecord): Uint8Array {
	const credentialDigest = sha384(new Uint8Array(account.credentialId)).slice(0, 32);
	const saltDigest = sha384(account.deviceSalt).slice(0, 32);
	const out = new Uint8Array(AAD_DOMAIN.length + 1 + 1 + saltDigest.length + credentialDigest.length);
	let off = 0;
	out.set(AAD_DOMAIN, off);
	off += AAD_DOMAIN.length;
	out[off++] = QUICK_UNLOCK_VERSION;
	out[off++] = account.authMode === 'production' ? 0x01 : 0x02;
	out.set(saltDigest, off);
	off += saltDigest.length;
	out.set(credentialDigest, off);
	return out;
}

async function resolvePrfOutput(account: AccountRecord): Promise<Uint8Array> {
	if (account.authMode !== 'production') {
		throw new Error('Quick unlock requires a production WebAuthn PRF account.');
	}
	const prfOutput = await evaluatePRF({
		credentialId: account.credentialId,
		salt: account.deviceSalt
	});
	if (!prfOutput) {
		throw new Error(
			'Authenticator did not return a PRF output. Use the same registered passkey/device.'
		);
	}
	return prfOutput;
}

export async function hasQuickUnlock(): Promise<boolean> {
	try {
		const [account, record] = await Promise.all([getAccount(), getQuickUnlock()]);
		return Boolean(account && record?.enabled && account.authMode === 'production');
	} catch {
		return false;
	}
}

export async function enableQuickUnlock(
	secretKey: Uint8Array,
	opts: { prfOutput?: Uint8Array | null } = {}
): Promise<void> {
	if (secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(`Quick unlock secretKey must be ${SECRET_KEY_LEN} bytes`);
	}
	const account = await getAccount();
	if (!account) throw new Error('No account found');
	if (account.authMode !== 'production') {
		await deleteQuickUnlock();
		return;
	}

	let prfOutput: Uint8Array | null = null;
	let key: Uint8Array | null = null;
	try {
		prfOutput = opts.prfOutput ?? (await resolvePrfOutput(account));
		key = deriveQuickUnlockKey(account, prfOutput);
		const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN));
		const ciphertext = gcm(key, nonce, makeAad(account)).encrypt(secretKey);
		const now = Date.now();
		await saveQuickUnlock({
			version: QUICK_UNLOCK_VERSION,
			enabled: true,
			nonce,
			ciphertext,
			createdAt: now
		});
	} finally {
		if (!opts.prfOutput) zeroize(prfOutput);
		zeroize(key);
	}
}

export async function openQuickUnlock(): Promise<{
	secretKey: Uint8Array;
	prfOutput: Uint8Array;
}> {
	const account = await getAccount();
	if (!account) throw new Error('No account found');
	const record = await getQuickUnlock();
	if (!record?.enabled) throw new Error('Quick unlock is not enabled on this device.');

	let prfOutput: Uint8Array | null = null;
	let key: Uint8Array | null = null;
	try {
		// PRF resolution can fail for transient, NON-destructive reasons:
		// the user dismissed the Touch ID / passkey prompt (WebAuthn
		// NotAllowedError, which `evaluatePRF` surfaces as a null output),
		// a timeout, or the wrong device. None of these indict the cached
		// ciphertext, so they must propagate untouched — deleting here is
		// exactly the "self-destruct on Cancel" bug. (The old code matched
		// resolvePrfOutput's "Authenticator did not return a PRF output"
		// message on /auth/i and wiped the cache on every cancellation.)
		prfOutput = await resolvePrfOutput(account);
		key = deriveQuickUnlockKey(account, prfOutput);

		// From here the PRF is valid, so an AES-GCM failure DOES indict the
		// cache: the only causes are a changed PRF (re-registered passkey),
		// tampering, or corruption. Self-destruct so the stale cache can be
		// cleanly re-enrolled, and raise a typed error the UI can recognize.
		let plaintext: Uint8Array;
		try {
			plaintext = gcm(key, record.nonce, makeAad(account)).decrypt(record.ciphertext);
		} catch (err) {
			await deleteQuickUnlock();
			throw new QuickUnlockCacheError(
				'Quick unlock is no longer valid on this device and was cleared. Unlock with your Secret Key.',
				{ cause: err }
			);
		}
		if (plaintext.length !== SECRET_KEY_LEN) {
			zeroize(plaintext);
			await deleteQuickUnlock();
			throw new QuickUnlockCacheError(
				'Quick unlock cache decrypted to an invalid Secret Key length and was cleared.'
			);
		}

		await saveQuickUnlock({
			version: record.version,
			enabled: record.enabled,
			nonce: record.nonce,
			ciphertext: record.ciphertext,
			createdAt: record.createdAt,
			lastUsedAt: Date.now()
		});
		return {
			secretKey: plaintext,
			prfOutput: prfOutput.slice()
		};
	} finally {
		zeroize(prfOutput);
		zeroize(key);
	}
}

export async function disableQuickUnlock(): Promise<void> {
	await deleteQuickUnlock();
}
