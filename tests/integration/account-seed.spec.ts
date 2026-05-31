/**
 * Phase C integration tests — accountSeed lifecycle and recovery.
 *
 * Verifies:
 *   1. provisionVault mints a 32-byte accountSeed in the account row.
 *   2. The seed survives lock → unlock (it's in Dexie, not memory).
 *   3. Backfill: a pre-Phase-C account (no accountSeed field) gets
 *      one minted on the first post-Phase-C saveItems.
 *   4. Recovery Envelope round-trip preserves accountSeed (the vault
 *      AES key opens the encrypted vault — accountSeed lives in the
 *      account row, NOT inside the encrypted vault, so RE recovery
 *      keeps the row intact).
 *
 * The accountSeed will be the V0-C1 long-term identity that
 * per-epoch VOPRF capability handles derive from in Phase D. This
 * suite locks the mint + persistence invariants down before the
 * dependent crypto layer ships.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';

vi.mock('$lib/crypto/webauthn-prf', () => ({
	evaluatePRF: vi.fn(
		async ({ credentialId, salt }: { credentialId: ArrayBuffer; salt: Uint8Array }) => {
			const cred = new Uint8Array(credentialId);
			return hmac(sha512, salt, cred).slice(0, 32);
		}
	),
	registerPasskey: vi.fn(),
	isWebAuthnSupported: () => true,
	isPlatformAuthenticatorAvailable: async () => true
}));

const mockSyncOrigin = '';
vi.mock('$lib/utils/env', () => ({
	isDemoAuthEnabled: () => true,
	getRpId: () => 'test.invalid',
	getSyncOrigin: () => mockSyncOrigin,
	isSyncOriginConfigured: () => mockSyncOrigin !== '',
	PUBLIC_BUNDLE_HASH: 'test',
	PUBLIC_VAULT_VERSION: '0.0.0',
	BUNDLE_HASH_SHORT: 'test',
	verifyBundleIntegrity: async () => ({
		expected: 'test',
		expectedShort: 'test',
		state: 'placeholder' as const,
		rekorUrl: 'https://search.sigstore.dev/?hash=test'
	})
}));

import {
	provisionVault,
	saveItems,
	openVault,
	lockSession,
	sealActiveRecoveryEnvelope,
	openVaultWithRecoveryEnvelope
} from '../../src/lib/services/vault-session';
import { db } from '../../src/lib/utils/storage';
void mockSyncOrigin;

const SECRET_KEY = new Uint8Array(32).fill(0xa1);
const RECOVERY_PASSWORD = new TextEncoder().encode('correct horse battery staple');

function freshCredentialId(): ArrayBuffer {
	const buf = new ArrayBuffer(32);
	new Uint8Array(buf).fill(0x5a);
	return buf;
}

beforeEach(async () => {
	await db.delete();
	await db.open();
	lockSession();
});

describe('Phase C · accountSeed mint + persist', () => {
	it('provisionVault writes a 32-byte accountSeed to the account row', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb1);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-mint',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		const account = await db.account.get('singleton');
		expect(account?.accountSeed).toBeInstanceOf(Uint8Array);
		expect(account!.accountSeed!.length).toBe(32);
	});

	it('accountSeed is preserved across lock → unlock (Dexie-persisted)', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb2);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-persist',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		const seed1 = (await db.account.get('singleton'))!.accountSeed!;
		expect(seed1.length).toBe(32);
		const seed1Copy = new Uint8Array(seed1);

		lockSession();
		await openVault({ secretKey: SECRET_KEY });

		const seed2 = (await db.account.get('singleton'))!.accountSeed!;
		expect(Array.from(seed2)).toEqual(Array.from(seed1Copy));
	});

	it('different vaults get different accountSeeds (per-account randomness)', async () => {
		const cred1 = freshCredentialId();
		const salt1 = new Uint8Array(16).fill(0xb3);
		const prf1 = hmac(sha512, salt1, new Uint8Array(cred1)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-a',
			secretKey: SECRET_KEY,
			credentialId: cred1,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf1,
			deviceSalt: salt1
		});
		const seedA = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);

		// Fresh DB to mint a separate vault.
		await db.delete();
		await db.open();
		lockSession();

		const cred2 = freshCredentialId();
		const salt2 = new Uint8Array(16).fill(0xb4);
		const prf2 = hmac(sha512, salt2, new Uint8Array(cred2)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-b',
			secretKey: SECRET_KEY,
			credentialId: cred2,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf2,
			deviceSalt: salt2
		});
		const seedB = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);

		expect(Array.from(seedA)).not.toEqual(Array.from(seedB));
	});
});

describe('Phase C · backfill for pre-existing accounts (no accountSeed)', () => {
	it('saveItems mints accountSeed when the row lacks one', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb5);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-backfill',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		// Simulate a pre-Phase-C account by stripping the seed and
		// downgrading formatVersion back to v2 (the upgrade path
		// also triggers backfill via the `upgrading || seedBackfill`
		// condition).
		const row = await db.account.get('singleton');
		delete row!.accountSeed;
		row!.formatVersion = 2;
		await db.account.put(row!);

		await saveItems([
			{
				id: 'a',
				kind: 'note',
				title: 'backfill',
				noteBody: 'forces a save',
				createdAt: 1,
				updatedAt: 1
			}
		]);

		const after = await db.account.get('singleton');
		expect(after!.accountSeed).toBeInstanceOf(Uint8Array);
		expect(after!.accountSeed!.length).toBe(32);
	});

	it('subsequent saveItems do not re-mint accountSeed', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb6);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-stable',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		const seed1 = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);

		await saveItems([
			{ id: 'x', kind: 'note', title: 'x', noteBody: 'x', createdAt: 1, updatedAt: 1 }
		]);
		const seed2 = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		expect(Array.from(seed2)).toEqual(Array.from(seed1));

		await saveItems([
			{ id: 'y', kind: 'note', title: 'y', noteBody: 'y', createdAt: 2, updatedAt: 2 }
		]);
		const seed3 = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		expect(Array.from(seed3)).toEqual(Array.from(seed1));
	});
});

describe('Phase C · Recovery Envelope preserves accountSeed', () => {
	it('master-password recovery round-trip keeps accountSeed intact', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb7);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'seed-recovery',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		await saveItems([
			{ id: 'r', kind: 'note', title: 'recover me', noteBody: 'm', createdAt: 1, updatedAt: 1 }
		]);
		const originalSeed = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);

		// Seal a Recovery Envelope using the active session keys.
		const envelope = await sealActiveRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword: RECOVERY_PASSWORD
		});
		expect(envelope).toBeDefined();

		// Lock and recover.
		lockSession();
		const items = await openVaultWithRecoveryEnvelope({
			envelope,
			secretKey: SECRET_KEY,
			recoveryPassword: RECOVERY_PASSWORD
		});
		expect(items.length).toBe(1);
		expect(items[0]!.title).toBe('recover me');

		// accountSeed survived the recovery — it's in the account
		// row (Dexie), not inside the encrypted vault blob, so the
		// Recovery Envelope path leaves it untouched.
		const recoveredSeed = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		expect(Array.from(recoveredSeed)).toEqual(Array.from(originalSeed));
	});
});
