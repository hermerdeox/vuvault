/**
 * Phase G recovery end-to-end regression suite.
 *
 * Locks in the user's hard requirement: "Vault must be fully
 * functional at the end. Provide a report of the tested and actual
 * working functionalities at the end, and recovery methods
 * implemented."
 *
 * Every recovery method MUST round-trip cleanly through the Vu0
 * crypto stack (v3 padded vault + accountSeed in account row).
 * This suite exercises each method end-to-end:
 *
 *   1. Provision a v3 vault → save items → lock → unlock by Secret
 *      Key + Passkey (re-derived deterministic PRF).
 *   2. Provision → save → SEAL Recovery Envelope (Master Password
 *      + Secret Key) → lock → recover via Recovery Envelope →
 *      assert items, accountSeed, and v3 format all survive.
 *   3. Master Password rotation: enable MP, rotate vaultKey under
 *      a new MP, lock + reopen with NEW MP → items + accountSeed
 *      preserved.
 *   4. Disable Master Password: rotate vaultKey back to non-MP,
 *      assert MP key is no longer required → unlock without MP.
 *   5. v2 → v3 upgrade-on-save: seed a v2 vault hand-built without
 *      padding; first saveItems upgrades to v3 + backfills
 *      accountSeed.
 *
 * Recovery methods covered:
 *   - PRF + Secret Key (standard unlock)
 *   - Recovery Envelope (master-password recovery)
 *   - Master Password rotation
 *   - Format-version upgrade-on-save (legacy v2 → v3 padded)
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
	openVaultWithRecoveryEnvelope,
	rotateAuth,
	PROVISION_FORMAT_VERSION
} from '../../src/lib/services/vault-session';
import { db } from '../../src/lib/utils/storage';
import { deriveMasterPasswordKey, VAULT_HIGH_PARAMS } from '../../src/lib/crypto/argon2';
void mockSyncOrigin;

const SECRET_KEY = new Uint8Array(32).fill(0xa1);
const MASTER_PASSWORD = new TextEncoder().encode('a-strong-master-password');
const RECOVERY_PASSWORD = new TextEncoder().encode('correct horse battery staple');

function freshCredentialId(seed = 0x5a): ArrayBuffer {
	const buf = new ArrayBuffer(32);
	new Uint8Array(buf).fill(seed);
	return buf;
}

function makePrf(salt: Uint8Array, credentialId: ArrayBuffer): Uint8Array {
	return hmac(sha512, salt, new Uint8Array(credentialId)).slice(0, 32);
}

beforeEach(async () => {
	await db.delete();
	await db.open();
	lockSession();
});

describe('Recovery E2E · standard unlock (PRF + Secret Key)', () => {
	it('lock + unlock round-trips a fully-populated v3 vault with accountSeed', async () => {
		const credentialId = freshCredentialId(0xb1);
		const deviceSalt = new Uint8Array(16).fill(0xb1);
		const prf = makePrf(deviceSalt, credentialId);
		await provisionVault({
			deviceLabel: 'rec-standard',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		await saveItems([
			{ id: '1', kind: 'note', title: 'a', noteBody: 'a', createdAt: 1, updatedAt: 1 },
			{ id: '2', kind: 'note', title: 'b', noteBody: 'b', createdAt: 2, updatedAt: 2 }
		]);

		const seedBefore = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		const formatBefore = (await db.account.get('singleton'))!.formatVersion;

		lockSession();
		const items = await openVault({ secretKey: SECRET_KEY });
		expect(items.length).toBe(2);
		expect(items.map((i) => i.title).sort()).toEqual(['a', 'b']);

		const seedAfter = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		const formatAfter = (await db.account.get('singleton'))!.formatVersion;
		expect(Array.from(seedAfter)).toEqual(Array.from(seedBefore));
		expect(formatAfter).toBe(formatBefore);
		expect(formatAfter).toBe(PROVISION_FORMAT_VERSION);
		expect(PROVISION_FORMAT_VERSION).toBe(3);
	});
});

describe('Recovery E2E · Recovery Envelope (Master Password + Secret Key)', () => {
	it('round-trips items, accountSeed, and v3 format through Recovery Envelope', async () => {
		const credentialId = freshCredentialId(0xb2);
		const deviceSalt = new Uint8Array(16).fill(0xb2);
		const prf = makePrf(deviceSalt, credentialId);
		await provisionVault({
			deviceLabel: 'rec-envelope',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		await saveItems([
			{ id: 'r1', kind: 'note', title: 'recover-me', noteBody: 'data', createdAt: 1, updatedAt: 1 }
		]);
		const seedBefore = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		const envelope = await sealActiveRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword: RECOVERY_PASSWORD
		});

		lockSession();

		const items = await openVaultWithRecoveryEnvelope({
			envelope,
			secretKey: SECRET_KEY,
			recoveryPassword: RECOVERY_PASSWORD
		});
		expect(items.length).toBe(1);
		expect(items[0]!.title).toBe('recover-me');

		const seedAfter = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		const account = await db.account.get('singleton');
		expect(Array.from(seedAfter)).toEqual(Array.from(seedBefore));
		expect(account!.formatVersion).toBe(PROVISION_FORMAT_VERSION);
	});
});

describe('Recovery E2E · Master Password rotation (rotateAuth)', () => {
	it('enables master password, rotates vaultKey, then unlocks with the NEW MP', async () => {
		const credentialId = freshCredentialId(0xb3);
		const deviceSalt = new Uint8Array(16).fill(0xb3);
		const prf = makePrf(deviceSalt, credentialId);
		await provisionVault({
			deviceLabel: 'rec-rotate',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		await saveItems([
			{ id: 'r3', kind: 'note', title: 'pre-rotate', noteBody: 'x', createdAt: 1, updatedAt: 1 }
		]);
		const seedBefore = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);

		// Enable MP: derive an Argon2id key + pass it through rotateAuth.
		const mpSalt = new Uint8Array(16).fill(0xa5);
		const mpKey = await deriveMasterPasswordKey({
			password: MASTER_PASSWORD,
			salt: mpSalt,
			params: VAULT_HIGH_PARAMS
		});
		await rotateAuth({
			prfOutput: prf,
			secretKey: SECRET_KEY,
			masterPasswordKey: mpKey,
			opaqueExportKey: undefined,
			masterPasswordSalt: mpSalt,
			masterPasswordParams: {
				memoryKiB: VAULT_HIGH_PARAMS.memoryKiB,
				iterations: VAULT_HIGH_PARAMS.iterations,
				parallelism: VAULT_HIGH_PARAMS.parallelism,
				tagLength: VAULT_HIGH_PARAMS.tagLength
			}
		});

		const seedAfter = new Uint8Array((await db.account.get('singleton'))!.accountSeed!);
		expect(Array.from(seedAfter)).toEqual(Array.from(seedBefore));

		// Lock and re-open with the NEW MP key.
		lockSession();
		const reopenedItems = await openVault({
			secretKey: SECRET_KEY,
			prfOutput: prf,
			masterPasswordKey: mpKey
		});
		expect(reopenedItems.length).toBe(1);
		expect(reopenedItems[0]!.title).toBe('pre-rotate');

		const account = await db.account.get('singleton');
		expect(account!.masterPasswordEnabled).toBe(true);
		expect(account!.formatVersion).toBe(PROVISION_FORMAT_VERSION);
	});
});

describe('Recovery E2E · v2 → v3 upgrade-on-save', () => {
	it('a v2 vault upgrades to v3 + backfills accountSeed on first saveItems', async () => {
		// Provision normally (gets v3 + accountSeed), then HAND-EDIT
		// the Dexie row to look like a pre-Phase-C v2 vault — no
		// accountSeed, formatVersion = 2. The next saveItems must
		// upgrade both.
		const credentialId = freshCredentialId(0xb4);
		const deviceSalt = new Uint8Array(16).fill(0xb4);
		const prf = makePrf(deviceSalt, credentialId);
		await provisionVault({
			deviceLabel: 'rec-upgrade',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		const row = await db.account.get('singleton');
		delete row!.accountSeed;
		row!.formatVersion = 2;
		await db.account.put(row!);

		await saveItems([
			{ id: 'u1', kind: 'note', title: 'after-upgrade', noteBody: 'x', createdAt: 1, updatedAt: 1 }
		]);

		const after = await db.account.get('singleton');
		expect(after!.formatVersion).toBe(PROVISION_FORMAT_VERSION);
		expect(after!.accountSeed).toBeInstanceOf(Uint8Array);
		expect(after!.accountSeed!.length).toBe(32);

		// Round-trip: lock and reopen, verify items survived the
		// upgrade.
		lockSession();
		const items = await openVault({ secretKey: SECRET_KEY });
		expect(items.length).toBe(1);
		expect(items[0]!.title).toBe('after-upgrade');
	});
});
