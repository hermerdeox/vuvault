/**
 * Local Recovery Envelope.
 *
 * Seals the vault AES data key with a key derived from the user's 256-bit
 * Secret Key and a separate Recovery Password. This is deliberately
 * independent from WebAuthn PRF so it can recover after passkey loss,
 * while still keeping the server mathematically unable to decrypt.
 *
 * AAD note: the envelope binds the account CONTEXT (device salt,
 * credential id, auth mode) but deliberately NOT the vault's
 * `formatVersion`. The payload here is the format-agnostic 32-byte data
 * key, and the vault blob's own AAD already authenticates its format.
 * Binding it here coupled this key wrapper to a payload encoding that
 * legitimately changes underneath it: an envelope sealed while the
 * account row said v2 became permanently unopenable as soon as the very
 * next `saveItems` upgraded that row to v3. `openRecoveryEnvelope` still
 * accepts the old layout so envelopes sealed by earlier builds keep
 * working — including ones already bricked by that drift.
 */
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha384, sha512 } from '@noble/hashes/sha2';
import {
	deriveMasterPasswordKey,
	generateMasterPasswordSalt,
	VAULT_HIGH_PARAMS,
	type Argon2idParams
} from './argon2';
import type { AuthMode } from '$lib/utils/storage';

export const RECOVERY_ENVELOPE_VERSION = 1;
export const RECOVERY_ENVELOPE_KEY_LEN = 32;
export const RECOVERY_ENVELOPE_SALT_LEN = 16;
export const RECOVERY_ENVELOPE_NONCE_LEN = 12;
export const RECOVERY_ENVELOPE_AES_KEY_LEN = 32;

const RECOVERY_INFO = 'vuvault-recovery-envelope-key-v1';
const AAD_DOMAIN = new TextEncoder().encode('vuvault-recovery-envelope-aad-v1');
const PAYLOAD_DOMAIN = 'vuvault-recovery-envelope-payload-v1';

export type RecoveryEnvelopeContext = {
	deviceSalt: Uint8Array;
	credentialId: ArrayBuffer;
	authMode: AuthMode;
};

/**
 * Vault format versions that ever appeared in a pre-fix envelope AAD.
 *
 * Permanently frozen: only 1-3 ever reached this field, and envelopes
 * sealed under the current layout carry no format version at all, so a
 * future v4 can never extend this list. Ordered most-likely first.
 */
const LEGACY_AAD_FORMAT_VERSIONS = [3, 2, 1] as const;

export type RecoveryEnvelopeSealed = {
	version: 1;
	salt: Uint8Array;
	params: Argon2idParams;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
};

export type RecoveryEnvelopeSerializable = {
	version: 1;
	salt: string;
	params: Argon2idParams;
	nonce: string;
	ciphertext: string;
};

function zeroize(buf: Uint8Array | null | undefined): void {
	buf?.fill(0);
}

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function contextDigests(ctx: RecoveryEnvelopeContext): {
	saltDigest: Uint8Array;
	credDigest: Uint8Array;
} {
	return {
		saltDigest: sha384(ctx.deviceSalt).slice(0, 32),
		credDigest: sha384(new Uint8Array(ctx.credentialId)).slice(0, 32)
	};
}

/** Current AAD layout. Carries no vault formatVersion — see the file header. */
function makeAad(ctx: RecoveryEnvelopeContext): Uint8Array {
	const { saltDigest, credDigest } = contextDigests(ctx);
	const out = new Uint8Array(AAD_DOMAIN.length + 1 + 1 + saltDigest.length + credDigest.length);
	let off = 0;
	out.set(AAD_DOMAIN, off);
	off += AAD_DOMAIN.length;
	out[off++] = RECOVERY_ENVELOPE_VERSION;
	out[off++] = ctx.authMode === 'production' ? 0x01 : 0x02;
	out.set(saltDigest, off);
	off += saltDigest.length;
	out.set(credDigest, off);
	return out;
}

/**
 * Pre-fix AAD layout, which carried the vault formatVersion byte between
 * the envelope version and the auth mode. Retained for read compatibility
 * only; nothing seals with it. One byte longer than the current layout,
 * so the two can never be confused.
 */
function makeLegacyAad(ctx: RecoveryEnvelopeContext, formatVersion: number): Uint8Array {
	const { saltDigest, credDigest } = contextDigests(ctx);
	const out = new Uint8Array(AAD_DOMAIN.length + 1 + 1 + 1 + saltDigest.length + credDigest.length);
	let off = 0;
	out.set(AAD_DOMAIN, off);
	off += AAD_DOMAIN.length;
	out[off++] = RECOVERY_ENVELOPE_VERSION;
	out[off++] = formatVersion & 0xff;
	out[off++] = ctx.authMode === 'production' ? 0x01 : 0x02;
	out.set(saltDigest, off);
	off += saltDigest.length;
	out.set(credDigest, off);
	return out;
}

function serializePayload(aesKey: Uint8Array): Uint8Array {
	if (aesKey.length !== RECOVERY_ENVELOPE_AES_KEY_LEN) {
		throw new Error(
			`Recovery payload AES key must be ${RECOVERY_ENVELOPE_AES_KEY_LEN} bytes`
		);
	}
	const domain = new TextEncoder().encode(PAYLOAD_DOMAIN);
	const out = new Uint8Array(1 + domain.length + aesKey.length);
	out[0] = RECOVERY_ENVELOPE_VERSION;
	out.set(domain, 1);
	out.set(aesKey, 1 + domain.length);
	return out;
}

function deserializePayload(payload: Uint8Array): Uint8Array {
	const domain = new TextEncoder().encode(PAYLOAD_DOMAIN);
	const expectedLen = 1 + domain.length + RECOVERY_ENVELOPE_AES_KEY_LEN;
	if (payload.length !== expectedLen) {
		throw new Error('Recovery payload has unexpected length');
	}
	if (payload[0] !== RECOVERY_ENVELOPE_VERSION) {
		throw new Error('Recovery payload version is not supported');
	}
	for (let i = 0; i < domain.length; i++) {
		if (payload[1 + i] !== domain[i]) {
			throw new Error('Recovery payload domain mismatch');
		}
	}
	return payload.slice(1 + domain.length);
}

export async function deriveRecoveryKey(input: {
	secretKey: Uint8Array;
	recoveryPassword: string;
	salt: Uint8Array;
	params?: Argon2idParams;
}): Promise<Uint8Array> {
	if (input.secretKey.length !== RECOVERY_ENVELOPE_KEY_LEN) {
		throw new Error(
			`deriveRecoveryKey: Secret Key must be ${RECOVERY_ENVELOPE_KEY_LEN} bytes`
		);
	}
	if (!input.recoveryPassword) {
		throw new Error('deriveRecoveryKey: Recovery Password is required');
	}
	if (!input.salt || input.salt.length === 0) {
		throw new Error('deriveRecoveryKey: salt is required');
	}
	const params = input.params ?? VAULT_HIGH_PARAMS;
	const passwordKey = await deriveMasterPasswordKey({
		password: input.recoveryPassword,
		salt: input.salt,
		params
	});
	const ikm = new Uint8Array(input.secretKey.length + passwordKey.length);
	ikm.set(input.secretKey, 0);
	ikm.set(passwordKey, input.secretKey.length);
	try {
		return hkdf(
			sha512,
			ikm,
			input.salt,
			RECOVERY_INFO,
			RECOVERY_ENVELOPE_KEY_LEN
		);
	} finally {
		zeroize(passwordKey);
		zeroize(ikm);
	}
}

export async function sealRecoveryEnvelope(input: {
	aesKey: Uint8Array;
	secretKey: Uint8Array;
	recoveryPassword: string;
	context: RecoveryEnvelopeContext;
	params?: Argon2idParams;
	salt?: Uint8Array;
	nonce?: Uint8Array;
}): Promise<RecoveryEnvelopeSealed> {
	const salt = input.salt ?? generateMasterPasswordSalt();
	const params = input.params ?? VAULT_HIGH_PARAMS;
	const nonce =
		input.nonce ?? crypto.getRandomValues(new Uint8Array(RECOVERY_ENVELOPE_NONCE_LEN));
	let key: Uint8Array | null = null;
	const payload = serializePayload(input.aesKey);
	try {
		key = await deriveRecoveryKey({
			secretKey: input.secretKey,
			recoveryPassword: input.recoveryPassword,
			salt,
			params
		});
		const ciphertext = gcm(key, nonce, makeAad(input.context)).encrypt(payload);
		return {
			version: RECOVERY_ENVELOPE_VERSION,
			salt,
			params,
			nonce,
			ciphertext
		};
	} finally {
		zeroize(key);
		zeroize(payload);
	}
}

export async function openRecoveryEnvelope(input: {
	envelope: Pick<RecoveryEnvelopeSealed, 'version' | 'salt' | 'params' | 'nonce' | 'ciphertext'>;
	secretKey: Uint8Array;
	recoveryPassword: string;
	context: RecoveryEnvelopeContext;
}): Promise<Uint8Array> {
	if (input.envelope.version !== RECOVERY_ENVELOPE_VERSION) {
		throw new Error('Recovery Envelope version is not supported');
	}
	let key: Uint8Array | null = null;
	try {
		// The Argon2id derivation is the expensive step (256 MiB at the
		// production preset), so it runs exactly once. Only the cheap GCM
		// tag check is retried across candidate AADs below.
		key = await deriveRecoveryKey({
			secretKey: input.secretKey,
			recoveryPassword: input.recoveryPassword,
			salt: input.envelope.salt,
			params: input.envelope.params
		});

		// Current layout first, then each pre-fix layout. Every candidate
		// differs only in public, non-secret metadata, and each attempt is
		// still a full GCM authentication — so this widens what a VALID
		// envelope can be read as, never what forges one.
		const candidates: Uint8Array[] = [
			makeAad(input.context),
			...LEGACY_AAD_FORMAT_VERSIONS.map((v) => makeLegacyAad(input.context, v))
		];

		for (const aad of candidates) {
			let payload: Uint8Array;
			try {
				payload = gcm(key, input.envelope.nonce, aad).decrypt(input.envelope.ciphertext);
			} catch {
				continue; // wrong layout — try the next candidate
			}
			// Tag verified: the key and context are correct. A malformed
			// payload past this point is real corruption, not a mismatch,
			// so let it throw rather than trying further candidates.
			try {
				return deserializePayload(payload);
			} finally {
				zeroize(payload);
			}
		}

		throw new Error(
			'Recovery Envelope did not open. Check the Secret Key and Recovery Password, and that this envelope belongs to this vault.'
		);
	} finally {
		zeroize(key);
	}
}

export function serializeRecoveryEnvelope(
	envelope: Pick<RecoveryEnvelopeSealed, 'version' | 'salt' | 'params' | 'nonce' | 'ciphertext'>
): RecoveryEnvelopeSerializable {
	if (envelope.version !== RECOVERY_ENVELOPE_VERSION) {
		throw new Error('Recovery Envelope version is not supported');
	}
	return {
		version: RECOVERY_ENVELOPE_VERSION,
		salt: bytesToBase64(envelope.salt),
		params: envelope.params,
		nonce: bytesToBase64(envelope.nonce),
		ciphertext: bytesToBase64(envelope.ciphertext)
	};
}

export function deserializeRecoveryEnvelope(
	input: RecoveryEnvelopeSerializable
): RecoveryEnvelopeSealed {
	if (input.version !== RECOVERY_ENVELOPE_VERSION) {
		throw new Error('Recovery Envelope version is not supported');
	}
	return {
		version: RECOVERY_ENVELOPE_VERSION,
		salt: base64ToBytes(input.salt),
		params: input.params,
		nonce: base64ToBytes(input.nonce),
		ciphertext: base64ToBytes(input.ciphertext)
	};
}
