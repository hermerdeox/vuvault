/**
 * Integration tests for the local vault session.
 *
 * Uses `fake-indexeddb` to give Dexie a real IDB implementation under
 * Node so `provisionVault` / `openVault` / `saveItems` can run end to
 * end. WebAuthn is mocked to give deterministic PRF output per salt.
 *
 * What this test exercises end-to-end:
 *   - production-mode provisioning, locking, and re-opening
 *   - demo-mode provisioning, locking, and re-opening
 *   - the PRF salt lifecycle invariant (same salt provisions and opens)
 *   - wrong Secret Key fails closed
 *   - tampered ciphertext fails closed
 *   - tampered AAD fails closed (auth mode swap, salt swap)
 *   - storage validators reject malformed rows
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// fake-indexeddb registers globalThis.indexedDB and friends
import 'fake-indexeddb/auto';

import { sha512 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';

// Mock the WebAuthn module BEFORE importing anything that uses it.
// In production mode, evaluatePRF returns HMAC-SHA512(salt, credentialId)[..32].
// This gives us a deterministic per-(credentialId,salt) output, just like
// a real authenticator would for the same (credential, salt) pair.
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

// Demo auth must be permitted in tests so the demo-mode branch can run.
// Sync stays unwired so the existing tests exercise the local-only
// path; D2 explicitly toggles `getSyncOrigin` on a per-test basis.
let mockSyncOrigin = '';
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
	openVault,
	saveItems,
	lockSession,
	isSessionActive,
	generateDeviceSalt,
	currentFormatVersion,
	rotateAuth,
	PROVISION_FORMAT_VERSION
} from './vault-session';
import { db, validateAccountRow, validateVaultRow } from '$lib/utils/storage';
import type { VaultItem } from '$lib/stores/vault.svelte';
import { evaluatePRF } from '$lib/crypto/webauthn-prf';
import { deriveVaultKey } from '$lib/crypto/derive';
import { gcm } from '@noble/ciphers/aes';
import { sha384 } from '@noble/hashes/sha2';
import { serializeItems } from '$lib/crypto/vault-codec';

const SECRET_KEY: Uint8Array = (() => {
	const k = new Uint8Array(32);
	for (let i = 0; i < 32; i++) k[i] = i;
	return k;
})();

const SECRET_KEY_WRONG: Uint8Array = (() => {
	const k = new Uint8Array(32);
	for (let i = 0; i < 32; i++) k[i] = (i + 1) & 0xff;
	return k;
})();

function freshCredentialId(): ArrayBuffer {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return buf.buffer;
}

beforeAll(() => {
	// Use a fixed initial timestamp source that's strictly increasing.
	let t = 1_700_000_000_000;
	vi.spyOn(Date, 'now').mockImplementation(() => ++t);
});

beforeEach(async () => {
	// Wipe Dexie between tests so each one starts clean.
	await db.delete();
	await db.open();
	lockSession();
	(evaluatePRF as ReturnType<typeof vi.fn>).mockClear();
});

afterEach(async () => {
	lockSession();
});

describe('vault-session — production mode', () => {
	it('provisions, persists, opens, and round-trips items', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();

		// At registration time the authenticator returns a salt-bound PRF.
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;

		await provisionVault({
			deviceLabel: 'test-mac',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		expect(isSessionActive()).toBe(true);

		// Add an item and save.
		const item: VaultItem = {
			id: 'i1',
			kind: 'login',
			title: 'GitHub',
			username: 'r-lopez',
			password: 'test-pw',
			url: 'https://github.com',
			createdAt: 1,
			updatedAt: 1
		};
		await saveItems([item]);

		// Lock and re-open with the SAME persisted salt.
		lockSession();
		expect(isSessionActive()).toBe(false);
		const opened = await openVault({ secretKey: SECRET_KEY });
		expect(opened).toHaveLength(1);
		const first = opened[0];
		expect(first?.title).toBe('GitHub');
		expect(first?.kind === 'login' ? first.password : null).toBe('test-pw');
	});

	it('rejects unlock with a wrong Secret Key', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'test',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		lockSession();
		await expect(openVault({ secretKey: SECRET_KEY_WRONG })).rejects.toThrow(
			/decryption failed/i
		);
	});

	it('refuses to provision a production vault without a real PRF output', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		await expect(
			provisionVault({
				deviceLabel: 'x',
				secretKey: SECRET_KEY,
				credentialId,
				credentialPublicKey: new ArrayBuffer(0),
				authMode: 'production',
				prfOutput: null,
				deviceSalt
			})
		).rejects.toThrow(/Production provisioning requires a real/);
	});

	it('PRF salt lifecycle: provisioning salt and unlock salt MUST match', async () => {
		// This is the regression test for the unrecoverable-vault bug.
		// If StepProvision ever generates a fresh salt different from the
		// one PRF was registered against, this test starts failing because
		// HKDF-SHA512( PRF(provisionSalt) ‖ secretKey, persistedSalt )
		// produces a different vault key than
		// HKDF-SHA512( PRF(persistedSalt) ‖ secretKey, persistedSalt ).
		const credentialId = freshCredentialId();
		const provisionSalt = generateDeviceSalt();
		const wrongPersistedSalt = generateDeviceSalt();

		// Authenticator returns PRF tied to provisionSalt.
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: provisionSalt
		})) as Uint8Array;

		// We persist a DIFFERENT salt — the bug being regression-tested.
		await provisionVault({
			deviceLabel: 'x',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt: wrongPersistedSalt
		});
		lockSession();

		// Unlock re-evaluates PRF against `wrongPersistedSalt`, deriving a
		// different key. AES-GCM authentication MUST fail.
		await expect(openVault({ secretKey: SECRET_KEY })).rejects.toThrow(
			/decryption failed/i
		);
	});

	it('detects tampered ciphertext', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'x',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		lockSession();

		// Flip a byte in the persisted ciphertext.
		const row = await db.vault.get('singleton');
		if (!row) throw new Error('vault row missing');
		row.ciphertext[0] = (row.ciphertext[0] ?? 0) ^ 0xff;
		await db.vault.put(row);

		await expect(openVault({ secretKey: SECRET_KEY })).rejects.toThrow(
			/decryption failed/i
		);
	});

	it('detects tampered authMode in AAD (production swapped to demo)', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'x',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		lockSession();

		// Mutate the persisted authMode to 'demo'. AAD now mismatches the
		// AAD used at seal time AND the demo derivation produces a
		// different vault key, so unlock must fail.
		const account = await db.account.get('singleton');
		if (!account) throw new Error('account missing');
		account.authMode = 'demo';
		await db.account.put(account);

		await expect(openVault({ secretKey: SECRET_KEY })).rejects.toThrow();
	});

	it('detects swapped deviceSalt in account row', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'x',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		lockSession();

		// Flip a byte in the persisted deviceSalt.
		const account = await db.account.get('singleton');
		if (!account) throw new Error('account missing');
		account.deviceSalt = new Uint8Array(account.deviceSalt);
		account.deviceSalt[0] = (account.deviceSalt[0] ?? 0) ^ 0xff;
		await db.account.put(account);

		await expect(openVault({ secretKey: SECRET_KEY })).rejects.toThrow();
	});
});

describe('vault-session — demo mode', () => {
	it('provisions and re-opens deterministically', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		await provisionVault({
			deviceLabel: 'demo',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'demo',
			prfOutput: null,
			deviceSalt
		});
		await saveItems([
			{
				id: 'i1',
				kind: 'note',
				title: 'note',
				noteBody: 'demo body',
				createdAt: 1,
				updatedAt: 1
			}
		]);
		lockSession();
		const opened = await openVault({ secretKey: SECRET_KEY });
		expect(opened).toHaveLength(1);
		const first = opened[0];
		expect(first?.kind === 'note' ? first.noteBody : null).toBe('demo body');
	});
});

describe('vault-session — formatVersion 1 → 2 migration', () => {
	/**
	 * Hand-craft a Milestone 1 (v1) account + vault row directly in
	 * Dexie. Then unlock via openVault (v1 branch), mutate, save —
	 * which must transparently upgrade to v2 — and re-unlock to
	 * confirm the v2 path round-trips against the same items.
	 */
	function makeAadV1(
		formatVersion: number,
		authMode: 'production' | 'demo',
		deviceSalt: Uint8Array,
		credentialId: ArrayBuffer
	): Uint8Array {
		const AAD_DOMAIN = new TextEncoder().encode('vuvault-vault-aad-v1');
		const AUTH_TAG = authMode === 'production' ? 0x01 : 0x02;
		const credBytes = new Uint8Array(credentialId);
		const credDigest = sha384(credBytes).slice(0, 32);
		const out = new Uint8Array(
			AAD_DOMAIN.length + 1 + 1 + deviceSalt.length + credDigest.length
		);
		let off = 0;
		out.set(AAD_DOMAIN, off);
		off += AAD_DOMAIN.length;
		out[off++] = formatVersion & 0xff;
		out[off++] = AUTH_TAG;
		out.set(deviceSalt, off);
		off += deviceSalt.length;
		out.set(credDigest, off);
		return out;
	}

	async function seedV1Vault(items: VaultItem[]) {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		const v1Key = deriveVaultKey({
			prfOutput,
			secretKey: SECRET_KEY,
			deviceSalt,
			version: 1
		});
		const aad = makeAadV1(1, 'production', deviceSalt, credentialId);
		const nonce = crypto.getRandomValues(new Uint8Array(12));
		const ciphertext = gcm(v1Key, nonce, aad).encrypt(serializeItems(items));
		await db.transaction('rw', db.account, db.vault, async () => {
			await db.account.put({
				id: 'singleton',
				deviceLabel: 'm1-mac',
				deviceSalt,
				credentialId,
				credentialPublicKey: new ArrayBuffer(0),
				authMode: 'production',
				formatVersion: 1,
				createdAt: 1,
				plan: 'free'
			});
			await db.vault.put({
				id: 'singleton',
				header: new Uint8Array(0),
				nonce,
				ciphertext,
				updatedAt: 1
			});
		});
		return { credentialId, deviceSalt };
	}

	it('opens a hand-seeded v1 vault and upgrades to v2 on first save', async () => {
		const seedItems: VaultItem[] = [
			{
				id: 'legacy-1',
				kind: 'login',
				title: 'old-login',
				username: 'legacy',
				password: 'inherited-from-m1',
				createdAt: 1,
				updatedAt: 1
			}
		];
		await seedV1Vault(seedItems);

		// First unlock — must take the v1 branch.
		const opened = await openVault({ secretKey: SECRET_KEY });
		expect(opened).toHaveLength(1);
		expect(currentFormatVersion()).toBe(1);
		const first = opened[0];
		expect(first?.kind === 'login' ? first.password : null).toBe('inherited-from-m1');

		// Mutate + save → upgrades to v2.
		const mutated: VaultItem[] = [
			...opened,
			{
				id: 'new-2',
				kind: 'note',
				title: 'fresh',
				noteBody: 'after upgrade',
				createdAt: 2,
				updatedAt: 2
			}
		];
		await saveItems(mutated);

		// The on-disk row should now have a non-empty header (v2 wraps).
		const accountRow = await db.account.get('singleton');
		const vaultRow = await db.vault.get('singleton');
		expect(accountRow?.formatVersion).toBe(PROVISION_FORMAT_VERSION);
		expect(vaultRow?.header.length).toBeGreaterThan(0);

		// Lock and re-open — now via the v2 branch.
		lockSession();
		const reopened = await openVault({ secretKey: SECRET_KEY });
		expect(reopened).toHaveLength(2);
		expect(currentFormatVersion()).toBe(2);
		expect(reopened.map((i) => i.title).sort()).toEqual(['fresh', 'old-login']);
	});

	it('a v2-provisioned vault stays v2 across save → lock → unlock', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		const result = await provisionVault({
			deviceLabel: 'fresh-v2',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		expect(result.formatVersion).toBe(PROVISION_FORMAT_VERSION);
		expect(currentFormatVersion()).toBe(PROVISION_FORMAT_VERSION);

		await saveItems([
			{
				id: 'a',
				kind: 'note',
				title: 'one',
				noteBody: 'body',
				createdAt: 1,
				updatedAt: 1
			}
		]);

		lockSession();
		const reopened = await openVault({ secretKey: SECRET_KEY });
		expect(reopened).toHaveLength(1);
		expect(currentFormatVersion()).toBe(2);
	});

	it('rejects an account row with an unknown formatVersion at unlock time', async () => {
		// Seed a row with formatVersion 99 — the storage validators
		// throw, so getAccount() bubbles the error up to openVault.
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		await db.account.put({
			id: 'singleton',
			deviceLabel: 'future',
			deviceSalt,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			formatVersion: 99 as unknown as 1,
			createdAt: 1,
			plan: 'free'
		});
		await db.vault.put({
			id: 'singleton',
			header: new Uint8Array(0),
			nonce: new Uint8Array(12),
			ciphertext: new Uint8Array(32),
			updatedAt: 1
		});
		await expect(openVault({ secretKey: SECRET_KEY })).rejects.toThrow();
	});
});

describe('vault-session — rotateAuth (Milestone 2 master password)', () => {
	it('enables, locks, and re-opens with a master-password key', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'rotate',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});

		await saveItems([
			{
				id: 'i1',
				kind: 'note',
				title: 'before',
				noteBody: 'pre-mpk',
				createdAt: 1,
				updatedAt: 1
			}
		]);

		const mpk = new Uint8Array(32);
		mpk.fill(0xab);
		const salt = new Uint8Array(16);
		salt.fill(0xcd);
		await rotateAuth({
			prfOutput,
			secretKey: SECRET_KEY,
			masterPasswordKey: mpk,
			masterPasswordSalt: salt,
			masterPasswordParams: {
				memoryKiB: 1024,
				iterations: 2,
				parallelism: 1,
				tagLength: 32
			}
		});

		// Lock and re-open WITHOUT MPK → should fail closed.
		lockSession();
		await expect(openVault({ secretKey: SECRET_KEY })).rejects.toThrow();

		// Lock and re-open WITH MPK → succeeds.
		const opened = await openVault({
			secretKey: SECRET_KEY,
			masterPasswordKey: mpk
		});
		expect(opened).toHaveLength(1);
		const first = opened[0];
		expect(first?.kind === 'note' ? first.noteBody : null).toBe('pre-mpk');
	});

	it('disables a previously-enabled master password', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		const mpk = new Uint8Array(32);
		mpk.fill(0x55);
		await provisionVault({
			deviceLabel: 'rotate-disable',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt,
			masterPasswordKey: mpk
		});
		// Need to mark account as MPK-enabled — provisionVault doesn't
		// know about the storage flag yet, so set it directly. (The
		// Settings UI does this in the rotation path; the inline
		// onboarding-time MPK flow that lands later will too.)
		const acc = await db.account.get('singleton');
		if (acc) {
			acc.masterPasswordEnabled = true;
			acc.masterPasswordSalt = new Uint8Array(16).fill(0x66);
			acc.masterPasswordParams = {
				memoryKiB: 1024,
				iterations: 2,
				parallelism: 1,
				tagLength: 32
			};
			await db.account.put(acc);
		}
		await saveItems([
			{
				id: 'i1',
				kind: 'note',
				title: 'has-mpk',
				noteBody: 'still-here',
				createdAt: 1,
				updatedAt: 1
			}
		]);

		await rotateAuth({
			prfOutput,
			secretKey: SECRET_KEY,
			masterPasswordKey: null
		});
		const accAfter = await db.account.get('singleton');
		expect(accAfter?.masterPasswordEnabled).toBe(false);
		expect(accAfter?.masterPasswordSalt).toBeUndefined();

		// Lock and re-open WITHOUT MPK → succeeds.
		lockSession();
		const opened = await openVault({ secretKey: SECRET_KEY });
		expect(opened).toHaveLength(1);
	});

	it('refuses rotation when the vault is locked', async () => {
		await expect(
			rotateAuth({
				prfOutput: new Uint8Array(32),
				secretKey: SECRET_KEY
			})
		).rejects.toThrow(/must be unlocked/);
	});
});

// --- Sync-fallback parity (Workstream D2) -------------------------
//
// These tests assert the local-only path remains the source of truth
// when sync is either unconfigured (PUBLIC_SYNC_ORIGIN='') or fails
// at runtime (server returns 503). The vault must never be blocked
// by a sync failure.

describe('sync fallback', () => {
	beforeEach(() => {
		// Outer beforeEach already wipes the DB via `db.delete()`.
		mockSyncOrigin = '';
	});

	it('saves and re-opens locally when sync is unconfigured', async () => {
		// Same path as every existing test — exercises the
		// short-circuit in saveItems / openVault when isSyncWired()
		// returns false.
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'no-sync',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		await saveItems([
			{
				id: 'a',
				kind: 'note',
				title: 'local-only',
				createdAt: 1,
				updatedAt: 1,
				noteBody: 'no server in sight'
			}
		]);
		lockSession();
		const opened = await openVault({ secretKey: SECRET_KEY });
		expect(opened).toHaveLength(1);
		expect(opened[0]?.kind === 'note' ? opened[0].noteBody : null).toBe(
			'no server in sight'
		);
	});

	it('saves locally even when uploadBlob would 503 (fire-and-forget)', async () => {
		// Mock fetch to reject with a 503 — saveItems still succeeds
		// because the upload is fire-and-forget. The local Dexie row
		// is the source of truth and persists.
		mockSyncOrigin = 'https://sync.test.invalid';
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: false, error: 'unavailable' }), {
					status: 503,
					headers: { 'content-type': 'application/json' }
				})
		);
		try {
			const credentialId = freshCredentialId();
			const deviceSalt = generateDeviceSalt();
			const prfOutput = (await evaluatePRF({
				credentialId,
				salt: deviceSalt
			})) as Uint8Array;
			await provisionVault({
				deviceLabel: 'sync-down',
				secretKey: SECRET_KEY,
				credentialId,
				credentialPublicKey: new ArrayBuffer(0),
				authMode: 'production',
				prfOutput,
				deviceSalt
			});
			await saveItems([
				{
					id: 'b',
					kind: 'note',
					title: 'with-failed-sync',
					createdAt: 2,
					updatedAt: 2,
					noteBody: 'local saved despite 503'
				}
			]);
			// Yield the microtask queue so the fire-and-forget upload
			// has a chance to land its rejection (and not propagate).
			await new Promise((resolve) => setTimeout(resolve, 0));
			lockSession();
			const opened = await openVault({ secretKey: SECRET_KEY });
			expect(opened).toHaveLength(1);
		} finally {
			globalThis.fetch = originalFetch;
			mockSyncOrigin = '';
		}
	});
});

describe('storage validators', () => {
	it('rejects rows with the wrong device salt length', () => {
		const bad = {
			id: 'singleton',
			deviceLabel: 'x',
			deviceSalt: new Uint8Array(8), // wrong length
			credentialId: new ArrayBuffer(8),
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			formatVersion: 1,
			createdAt: 1,
			plan: 'free'
		};
		expect(() => validateAccountRow(bad)).toThrow(/deviceSalt must be 16 bytes/);
	});

	it('rejects unknown formatVersion', () => {
		const bad = {
			id: 'singleton',
			deviceLabel: 'x',
			deviceSalt: new Uint8Array(16),
			credentialId: new ArrayBuffer(8),
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			formatVersion: 99,
			createdAt: 1,
			plan: 'free'
		};
		expect(() => validateAccountRow(bad)).toThrow(/formatVersion is not a known/);
	});

	it('rejects empty ciphertext', () => {
		const bad = {
			id: 'singleton',
			header: new Uint8Array(0),
			nonce: new Uint8Array(12),
			ciphertext: new Uint8Array(0),
			updatedAt: 1
		};
		expect(() => validateVaultRow(bad)).toThrow(/non-empty Uint8Array/);
	});

	it('rejects wrong nonce length', () => {
		const bad = {
			id: 'singleton',
			header: new Uint8Array(0),
			nonce: new Uint8Array(8),
			ciphertext: new Uint8Array(32),
			updatedAt: 1
		};
		expect(() => validateVaultRow(bad)).toThrow(/nonce must be 12 bytes/);
	});
});
