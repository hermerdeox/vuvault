import { describe, expect, it } from 'vitest';

import {
	openRecoveryEnvelope,
	sealRecoveryEnvelope,
	serializeRecoveryEnvelope,
	deserializeRecoveryEnvelope
} from './recovery-envelope';
import { TEST_PARAMS } from './argon2';

const SECRET_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const AES_KEY = Uint8Array.from({ length: 32 }, (_, i) => 0xa0 + i);
const SALT = Uint8Array.from({ length: 16 }, (_, i) => 0x10 + i);
const NONCE = Uint8Array.from({ length: 12 }, (_, i) => 0x20 + i);
const DEVICE_SALT = Uint8Array.from({ length: 16 }, (_, i) => 0x30 + i);
const CREDENTIAL_ID = Uint8Array.from({ length: 32 }, (_, i) => 0x40 + i).buffer;

const context = {
	deviceSalt: DEVICE_SALT,
	credentialId: CREDENTIAL_ID,
	formatVersion: 2,
	authMode: 'production' as const
};

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
