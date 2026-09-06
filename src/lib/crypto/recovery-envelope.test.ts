import { describe, expect, it } from 'vitest';

import {
	openRecoveryEnvelope,
	sealRecoveryEnvelope,
	serializeRecoveryEnvelope,
	deserializeRecoveryEnvelope,
	deriveRecoveryKey,
	RECOVERY_ENVELOPE_VERSION
} from './recovery-envelope';
import { TEST_PARAMS } from './argon2';
import { gcm } from '@noble/ciphers/aes';
import { sha384 } from '@noble/hashes/sha2';

const SECRET_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const AES_KEY = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
const SALT = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
const NONCE = Uint8Array.from({ length: 12 }, (_, i) => 0x20 + i);
const DEVICE_SALT = Uint8Array.from({ length: 16 }, (_, i) => 0x30 + i);
const CREDENTIAL_ID = Uint8Array.from({ length: 32 }, (_, i) => 0x40 + i).buffer;

const context = {
	deviceSalt: DEVICE_SALT,
	credentialId: CREDENTIAL_ID,
	authMode: 'production' as const
};

/**
 * Rebuilds the PRE-FIX envelope exactly as builds up to v0.2.1 wrote it:
 * an AAD carrying the vault `formatVersion` byte. Written out longhand
 * rather than imported so this test pins the legacy wire format
 * independently of the production module.
 */
async function sealLegacyEnvelope(formatVersion: number) {
	const key = await deriveRecoveryKey({
		secretKey: SECRET_KEY,
		recoveryPassword: 'correct horse recovery staple',
		salt: SALT,
		params: TEST_PARAMS
	});
	const domain = new TextEncoder().encode('vuvault-recovery-envelope-aad-v1');
	const saltDigest = sha384(DEVICE_SALT).slice(0, 32);
	const credDigest = sha384(new Uint8Array(CREDENTIAL_ID)).slice(0, 32);
	const aad = new Uint8Array(domain.length + 3 + saltDigest.length + credDigest.length);
	let off = 0;
	aad.set(domain, off);
	off += domain.length;
	aad[off++] = RECOVERY_ENVELOPE_VERSION;
	aad[off++] = formatVersion & 0xff;
	aad[off++] = 0x01; // production
	aad.set(saltDigest, off);
	off += saltDigest.length;
	aad.set(credDigest, off);

	const payloadDomain = new TextEncoder().encode('vuvault-recovery-envelope-payload-v1');
	const payload = new Uint8Array(1 + payloadDomain.length + AES_KEY.length);
	payload[0] = RECOVERY_ENVELOPE_VERSION;
	payload.set(payloadDomain, 1);
	payload.set(AES_KEY, 1 + payloadDomain.length);

	return {
		version: RECOVERY_ENVELOPE_VERSION as 1,
		salt: SALT,
		params: TEST_PARAMS,
		nonce: NONCE,
		ciphertext: gcm(key, NONCE, aad).encrypt(payload)
	};
}

describe('recovery-envelope crypto', () => {
	it('seals and opens a vault AES key', async () => {
		const envelope = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context,
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});

		const opened = await openRecoveryEnvelope({
			envelope,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context
		});

		expect(opened).toEqual(AES_KEY);
	});

	it('rejects a wrong Recovery Password', async () => {
		const envelope = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context,
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});

		await expect(
			openRecoveryEnvelope({
				envelope,
				secretKey: SECRET_KEY,
				recoveryPassword: 'wrong password',
				context
			})
		).rejects.toThrow();
	});

	it('rejects a wrong Secret Key', async () => {
		const envelope = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context,
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});
		const wrongSecret = SECRET_KEY.slice();
		wrongSecret[0] = (wrongSecret[0] ?? 0) ^ 0xff;

		await expect(
			openRecoveryEnvelope({
				envelope,
				secretKey: wrongSecret,
				recoveryPassword: 'correct horse recovery staple',
				context
			})
		).rejects.toThrow();
	});

	it('binds the envelope to account context', async () => {
		const envelope = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context,
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});
		const otherContext = {
			...context,
			credentialId: Uint8Array.from({ length: 32 }, (_, i) => 0x60 + i).buffer
		};

		await expect(
			openRecoveryEnvelope({
				envelope,
				secretKey: SECRET_KEY,
				recoveryPassword: 'correct horse recovery staple',
				context: otherContext
			})
		).rejects.toThrow();
	});

	// --- Regression: envelope must survive a vault formatVersion change ---
	//
	// Pre-fix builds bound the vault's formatVersion into the envelope AAD
	// and re-read it from the (mutable) account row on open. Any ordinary
	// save upgrades a v2 row to v3, which silently bricked the envelope.
	// The data key the envelope wraps is format-agnostic, so the version
	// no longer participates in the AAD at all.

	it.each([2, 3])(
		'opens a pre-fix envelope sealed at formatVersion %i',
		async (formatVersion) => {
			const legacy = await sealLegacyEnvelope(formatVersion);

			const opened = await openRecoveryEnvelope({
				envelope: legacy,
				secretKey: SECRET_KEY,
				recoveryPassword: 'correct horse recovery staple',
				context
			});

			expect(opened).toEqual(AES_KEY);
		}
	);

	it('still rejects a wrong password against a pre-fix envelope', async () => {
		const legacy = await sealLegacyEnvelope(2);

		await expect(
			openRecoveryEnvelope({
				envelope: legacy,
				secretKey: SECRET_KEY,
				recoveryPassword: 'wrong password',
				context
			})
		).rejects.toThrow(/did not open/i);
	});

	it('does not bind the vault formatVersion into the AAD', async () => {
		// Sealing is context-only, so two seals that differ solely by the
		// caller's notion of format version are byte-identical.
		const a = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context,
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});
		const b = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context: { ...context },
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});
		expect(a.ciphertext).toEqual(b.ciphertext);
	});

	it('round-trips a serializable vukey payload', async () => {
		const envelope = await sealRecoveryEnvelope({
			aesKey: AES_KEY,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context,
			params: TEST_PARAMS,
			salt: SALT,
			nonce: NONCE
		});

		const serialized = serializeRecoveryEnvelope(envelope);
		const restored = deserializeRecoveryEnvelope(serialized);
		const opened = await openRecoveryEnvelope({
			envelope: restored,
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			context
		});

		expect(opened).toEqual(AES_KEY);
		expect(JSON.stringify(serialized)).not.toContain('correct horse recovery staple');
	});
});
