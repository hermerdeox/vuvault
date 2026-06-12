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
	sealActiveRecoveryEnvelope,
	openVaultWithRecoveryEnvelope,
	rebindRecoveredVault,
	PROVISION_FORMAT_VERSION,
	sealDocument,
	openDocument,
	sha256Hex,
	CurrentMasterPasswordIncorrect
} from './vault-session';
import { attachDocumentFile } from './document-blobs';
import { setSessionToken } from './sync-client';
import {
	db,
	validateAccountRow,
	validateVaultRow,
	validateDocumentBlobRow,
	saveDocumentBlob,
	getDocumentBlob,
	deleteDocumentBlob,
	listDocumentBlobIds,
	AccountExistsError
} from '$lib/utils/storage';
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

/**
 * In-memory v2 transport that records every requested URL and serves
 * the blob + inventory routes the live save/document path uses. Any
 * route OTHER than `/api/v2/blobs/*` or `/api/v2/inv/*` (notably the
 * retired per-account `/api/blobs/*` / `/api/documents/*` routes)
 * returns a loud 404 and is still recorded, so a transport leak would
 * surface as a non-v2 URL in `urls`.
 */
function makeV2RecordingFetch(urls: string[]): typeof fetch {
	const blobStore = new Map<string, { nonce: string; ciphertext: string }>();
	const invStore = new Map<string, { nonce: string; ciphertext: string }>();
	let clock = 1;
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		urls.push(url);
		const method = (init?.method ?? 'GET').toUpperCase();
		const body = (): { nonce: string; ciphertext: string } =>
			JSON.parse(String(init?.body ?? '{}'));
		const jr = (status: number, data: unknown): Response =>
			new Response(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data }), {
				status,
				headers: { 'content-type': 'application/json' }
			});

		const blob = url.match(/\/api\/v2\/blobs\/([^/?#]+)$/);
		if (blob) {
			const id = blob[1]!;
			if (method === 'PUT') {
				blobStore.set(id, body());
				return jr(200, { blobId: id, updatedAt: clock++ });
			}
			if (method === 'GET') {
				const hit = blobStore.get(id);
				if (!hit) return jr(404, 'not found');
				return jr(200, { blobId: id, ...hit, updatedAt: clock++ });
			}
			if (method === 'DELETE') return jr(200, { blobId: id, deletedAt: clock++ });
		}
		const inv = url.match(/\/api\/v2\/inv\/([^/?#]+)$/);
		if (inv) {
			const addr = inv[1]!;
			if (method === 'PUT') {
				invStore.set(addr, body());
				return jr(200, { addr, updatedAt: clock++ });
			}
			if (method === 'GET') {
				const hit = invStore.get(addr);
				if (!hit) return jr(404, 'no inventory');
				return jr(200, { addr, ...hit, updatedAt: clock++ });
			}
		}
		return jr(404, `unexpected route ${method} ${url}`);
	}) as unknown as typeof fetch;
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

	it('refuses to overwrite an existing vault on a second provision (no silent clobber)', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'first',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});

		// Persist a real item so we can prove the blob is untouched.
		await saveItems([
			{
				id: 'i1',
				kind: 'login',
				title: 'GitHub',
				username: 'u',
				password: 'p',
				url: 'https://github.com',
				createdAt: 1,
				updatedAt: 1
			}
		]);
		const vaultBefore = await db.vault.get('singleton');
		const accountBefore = await db.account.get('singleton');

		// A second provision with DIFFERENT material (e.g. a re-entrant
		// onboarding effect or a stale tab) must be refused — never allowed
		// to clobber the singleton rows and orphan the existing vault.
		const cred2 = freshCredentialId();
		const salt2 = generateDeviceSalt();
		const prf2 = (await evaluatePRF({ credentialId: cred2, salt: salt2 })) as Uint8Array;
		await expect(
			provisionVault({
				deviceLabel: 'second',
				secretKey: SECRET_KEY_WRONG,
				credentialId: cred2,
				credentialPublicKey: new ArrayBuffer(0),
				authMode: 'production',
				prfOutput: prf2,
				deviceSalt: salt2
			})
		).rejects.toBeInstanceOf(AccountExistsError);

		// The original account + vault rows are byte-for-byte intact...
		expect(await db.vault.get('singleton')).toEqual(vaultBefore);
		expect(await db.account.get('singleton')).toEqual(accountBefore);

		// ...and the original Secret Key still opens it with the saved item.
		lockSession();
		const opened = await openVault({ secretKey: SECRET_KEY });
		expect(opened).toHaveLength(1);
		expect(opened[0]?.title).toBe('GitHub');
	});

	it('opens with a Recovery Envelope after passkey loss and rebinds a new passkey', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
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
		const item: VaultItem = {
			id: 'recovery-login',
			kind: 'login',
			title: 'Recovered',
			username: 'user',
			password: 'survives',
			createdAt: 1,
			updatedAt: 1
		};
		await saveItems([item]);
		const envelope = await sealActiveRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple'
		});
		lockSession();

		const recovered = await openVaultWithRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword: 'correct horse recovery staple',
			envelope
		});
		expect(recovered[0]?.title).toBe('Recovered');

		const newCredentialId = freshCredentialId();
		const newDeviceSalt = generateDeviceSalt();
		const newPrfOutput = (await evaluatePRF({
			credentialId: newCredentialId,
			salt: newDeviceSalt
		})) as Uint8Array;
		await rebindRecoveredVault({
			secretKey: SECRET_KEY,
			credentialId: newCredentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: newPrfOutput,
			deviceSalt: newDeviceSalt
		});
		lockSession();

		const reopened = await openVault({ secretKey: SECRET_KEY });
		expect(reopened[0]?.kind === 'login' ? reopened[0].password : null).toBe(
			'survives'
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

		// Lock and re-open — now via the v3 branch (saveItems
		// upgrades to PROVISION_FORMAT_VERSION which is v3 post-
		// Phase-A V0-C2 padding wiring).
		lockSession();
		const reopened = await openVault({ secretKey: SECRET_KEY });
		expect(reopened).toHaveLength(2);
		expect(currentFormatVersion()).toBe(PROVISION_FORMAT_VERSION);
		expect(reopened.map((i) => i.title).sort()).toEqual(['fresh', 'old-login']);
	});

	it('preserves optional account fields during the atomic v1 → v2 upgrade', async () => {
		await seedV1Vault([
			{
				id: 'legacy-optional',
				kind: 'note',
				title: 'legacy optional',
				noteBody: 'metadata should survive',
				createdAt: 1,
				updatedAt: 1
			}
		]);
		await openVault({ secretKey: SECRET_KEY });

		const before = await db.account.get('singleton');
		expect(before).toBeDefined();
		before!.opaqueState = 'enrolled';
		before!.opaqueAccountId = 'acct-upgrade';
		before!.opaqueServerId = 'opaque.example';
		before!.opaqueClientId = 'client-upgrade';
		before!.masterPasswordEnabled = true;
		before!.masterPasswordSalt = new Uint8Array(16).fill(0x42);
		before!.masterPasswordParams = {
			memoryKiB: 1024,
			iterations: 2,
			parallelism: 1,
			tagLength: 32
		};
		await db.account.put(before!);

		await saveItems([
			{
				id: 'legacy-optional',
				kind: 'note',
				title: 'legacy optional',
				noteBody: 'metadata survived',
				createdAt: 1,
				updatedAt: 2
			}
		]);

		const after = await db.account.get('singleton');
		expect(after?.formatVersion).toBe(PROVISION_FORMAT_VERSION);
		expect(after?.opaqueState).toBe('enrolled');
		expect(after?.opaqueAccountId).toBe('acct-upgrade');
		expect(after?.opaqueServerId).toBe('opaque.example');
		expect(after?.opaqueClientId).toBe('client-upgrade');
		expect(after?.masterPasswordEnabled).toBe(true);
		expect(after?.masterPasswordSalt).toEqual(new Uint8Array(16).fill(0x42));
		expect(after?.masterPasswordParams?.tagLength).toBe(32);
	});

	it('a freshly provisioned vault stays at PROVISION_FORMAT_VERSION across save → lock → unlock', async () => {
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
		expect(currentFormatVersion()).toBe(PROVISION_FORMAT_VERSION);
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
			masterPasswordKey: null,
			currentMasterPasswordKey: mpk
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

	it('rejects MP disable when currentMasterPasswordKey is missing', async () => {
		// Set up an MPK-enabled account exactly the way the "disables a
		// previously-enabled master password" test above does — then attempt
		// to disable without supplying the current MPK. The new gate in
		// rotateAuth must throw CurrentMasterPasswordIncorrect rather than
		// silently stripping the factor.
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		const mpk = new Uint8Array(32);
		mpk.fill(0x77);
		await provisionVault({
			deviceLabel: 'rotate-disable-missing',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt,
			masterPasswordKey: mpk
		});
		const acc = await db.account.get('singleton');
		if (acc) {
			acc.masterPasswordEnabled = true;
			acc.masterPasswordSalt = new Uint8Array(16).fill(0x88);
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
				title: 'mpk',
				noteBody: 'protect',
				createdAt: 1,
				updatedAt: 1
			}
		]);

		await expect(
			rotateAuth({
				prfOutput,
				secretKey: SECRET_KEY,
				masterPasswordKey: null
				// currentMasterPasswordKey deliberately omitted
			})
		).rejects.toBeInstanceOf(CurrentMasterPasswordIncorrect);

		// Account row must be UNCHANGED — disable never landed.
		const accAfter = await db.account.get('singleton');
		expect(accAfter?.masterPasswordEnabled).toBe(true);
		expect(accAfter?.masterPasswordSalt).toBeDefined();
	});

	it('rejects MP disable when currentMasterPasswordKey is wrong', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		const mpk = new Uint8Array(32);
		mpk.fill(0x99);
		await provisionVault({
			deviceLabel: 'rotate-disable-wrong',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt,
			masterPasswordKey: mpk
		});
		const acc = await db.account.get('singleton');
		if (acc) {
			acc.masterPasswordEnabled = true;
			acc.masterPasswordSalt = new Uint8Array(16).fill(0xaa);
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
				title: 'mpk',
				noteBody: 'protect',
				createdAt: 1,
				updatedAt: 1
			}
		]);

		const wrongMpk = new Uint8Array(32);
		wrongMpk.fill(0xee); // not 0x99

		await expect(
			rotateAuth({
				prfOutput,
				secretKey: SECRET_KEY,
				masterPasswordKey: null,
				currentMasterPasswordKey: wrongMpk
			})
		).rejects.toBeInstanceOf(CurrentMasterPasswordIncorrect);

		const accAfter = await db.account.get('singleton');
		expect(accAfter?.masterPasswordEnabled).toBe(true);
	});

	// --- Regression: key rotation must NOT orphan attachments or the
	// Recovery Envelope (critical data-loss audit finding). rotateAuth
	// rotates the WRAPPING key only; the data key stays live, so
	// documents and the envelope (both sealed under it) survive. ---

	async function provisionForRotate(): Promise<{ mpk: Uint8Array; prfOutput: Uint8Array }> {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({ credentialId, salt: deviceSalt })) as Uint8Array;
		await provisionVault({
			deviceLabel: 'rotate-docs',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		const mpk = new Uint8Array(32);
		mpk.fill(0x7e);
		return { mpk, prfOutput };
	}

	it('keeps documents decryptable after a master-password rotation', async () => {
		const { mpk, prfOutput } = await provisionForRotate();
		const docPlain = new TextEncoder().encode('passport scan — confidential');
		const sealed = await sealDocument(docPlain);

		await rotateAuth({
			prfOutput,
			secretKey: SECRET_KEY,
			masterPasswordKey: mpk,
			masterPasswordSalt: new Uint8Array(16).fill(0x11),
			masterPasswordParams: { memoryKiB: 1024, iterations: 2, parallelism: 1, tagLength: 32 }
		});

		// The document — sealed under the data key BEFORE the rotation —
		// must still open. (Old code minted a fresh data key here and
		// bricked it.)
		const opened = await openDocument({
			blobId: sealed.blobId,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext
		});
		expect(new TextDecoder().decode(opened)).toBe('passport scan — confidential');
	});

	it('keeps the Recovery Envelope valid after a master-password rotation', async () => {
		const { mpk, prfOutput } = await provisionForRotate();
		const recoveryPassword = 'Jasper! Maple! Lantern! Orchid!';
		const envelope = await sealActiveRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword
		});

		await rotateAuth({
			prfOutput,
			secretKey: SECRET_KEY,
			masterPasswordKey: mpk,
			masterPasswordSalt: new Uint8Array(16).fill(0x22),
			masterPasswordParams: { memoryKiB: 1024, iterations: 2, parallelism: 1, tagLength: 32 }
		});

		lockSession();
		// The envelope wraps the data key directly; the post-rotation
		// vault blob is re-sealed under that SAME data key, so recovery
		// must still decrypt it. (Old code re-sealed under a fresh key
		// and silently bricked the envelope.)
		const items = await openVaultWithRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword,
			envelope
		});
		expect(Array.isArray(items)).toBe(true);
	});

	it('keeps documents decryptable across a v2→v3 upgrade-on-save', async () => {
		await provisionForRotate();
		const docPlain = new TextEncoder().encode('lease.pdf — confidential');
		const sealed = await sealDocument(docPlain);

		// Force the upgrade-on-save path with a live data key by marking
		// the account row as the older format (the exact condition that
		// used to mint a fresh AES key and orphan the document).
		const acc = await db.account.get('singleton');
		await db.account.put({ ...acc!, formatVersion: 2 });

		await saveItems([
			{ id: 'i1', kind: 'note', title: 'n', noteBody: 'x', createdAt: 1, updatedAt: 1 }
		]);

		const opened = await openDocument({
			blobId: sealed.blobId,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext
		});
		expect(new TextDecoder().decode(opened)).toBe('lease.pdf — confidential');
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

	it('saves locally even when the v2 blob upload would 503 (fire-and-forget)', async () => {
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

	it('routes document attach + vault save over v2 only (no legacy per-account routes)', async () => {
		// Behavioral proof behind the V1-C1/V1-C3 closure that the
		// shape-only release probe cannot make: drive the production
		// attach + save path against a recording transport and assert the
		// client touches ONLY /api/v2/blobs/* and /api/v2/inv/*. The
		// retired per-account /api/blobs/* and /api/documents/* routes
		// must never appear.
		mockSyncOrigin = 'https://sync.test.invalid';
		const originalFetch = globalThis.fetch;
		const urls: string[] = [];
		globalThis.fetch = makeV2RecordingFetch(urls);
		try {
			const credentialId = freshCredentialId();
			const deviceSalt = generateDeviceSalt();
			const prfOutput = (await evaluatePRF({
				credentialId,
				salt: deviceSalt
			})) as Uint8Array;
			await provisionVault({
				deviceLabel: 'v2-only',
				secretKey: SECRET_KEY,
				credentialId,
				credentialPublicKey: new ArrayBuffer(0),
				authMode: 'production',
				prfOutput,
				deviceSalt
			});
			// A live session token makes the document path's sync branch
			// fire (isSyncWired() && hasSession()).
			setSessionToken('f'.repeat(64));

			// Document attach is fully awaited: deterministically PUTs a
			// /api/v2/blobs/{uuid} object and records its id in the
			// /api/v2/inv/{addr} inventory.
			const fakeFile = {
				name: 'memo.txt',
				type: 'text/plain',
				arrayBuffer: async () => new TextEncoder().encode('secret memo').buffer
			} as unknown as File;
			const attached = await attachDocumentFile(fakeFile);
			expect(attached.remote).toBe(true);

			// Whole-vault save: the push is fire-and-forget, so yield the
			// macrotask queue enough times for the upload + inventory
			// persist chain to settle.
			await saveItems([
				{
					id: 'c',
					kind: 'note',
					title: 'v2-routed',
					createdAt: 3,
					updatedAt: 3,
					noteBody: 'pushed over v2'
				}
			]);
			for (let i = 0; i < 25; i++) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}

			// Both v2 surfaces were exercised, and nothing legacy leaked.
			expect(urls.length).toBeGreaterThan(0);
			expect(urls.some((u) => u.includes('/api/v2/blobs/'))).toBe(true);
			expect(urls.some((u) => u.includes('/api/v2/inv/'))).toBe(true);
			for (const u of urls) {
				expect(u).not.toContain('/api/blobs/');
				expect(u).not.toContain('/api/documents/');
			}
		} finally {
			mockSyncOrigin = '';
			globalThis.fetch = originalFetch;
			setSessionToken(null);
			lockSession();
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

describe('document blob crypto', () => {
	async function provision(): Promise<void> {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({
			credentialId,
			salt: deviceSalt
		})) as Uint8Array;
		await provisionVault({
			deviceLabel: 'doc-test',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
	}

	it('seals and opens a document round-trip', async () => {
		await provision();
		const plaintext = new TextEncoder().encode('lease contents — confidential');
		const sealed = await sealDocument(plaintext);
		expect(sealed.size).toBe(plaintext.length);
		expect(sealed.sha256Hex).toHaveLength(64);
		expect(sealed.ciphertext.length).toBeGreaterThan(plaintext.length);
		const opened = await openDocument({
			blobId: sealed.blobId,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext
		});
		expect(new TextDecoder().decode(opened)).toBe(
			'lease contents — confidential'
		);
		expect(sha256Hex(opened)).toBe(sealed.sha256Hex);
	});

	it('rejects an opened blob with a different blobId (AAD swap)', async () => {
		await provision();
		const sealed = await sealDocument(new Uint8Array([1, 2, 3, 4, 5]));
		await expect(
			openDocument({
				blobId: '00000000-0000-0000-0000-000000000000',
				nonce: sealed.nonce,
				ciphertext: sealed.ciphertext
			})
		).rejects.toThrow();
	});

	it('rejects tampered ciphertext', async () => {
		await provision();
		const sealed = await sealDocument(new Uint8Array([9, 9, 9, 9]));
		const tampered = new Uint8Array(sealed.ciphertext);
		tampered[0] = tampered[0]! ^ 0xff;
		await expect(
			openDocument({
				blobId: sealed.blobId,
				nonce: sealed.nonce,
				ciphertext: tampered
			})
		).rejects.toThrow();
	});

	it('refuses to seal when the vault is locked', async () => {
		lockSession();
		await expect(sealDocument(new Uint8Array(1))).rejects.toThrow(
			/vault must be unlocked/
		);
	});

	it('persists, validates, and clears document blob rows', async () => {
		await provision();
		const sealed = await sealDocument(new Uint8Array([1, 2, 3]));
		await saveDocumentBlob({
			id: sealed.blobId,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			size: sealed.size,
			sha256: sealed.sha256Hex,
			createdAt: Date.now()
		});
		const got = await getDocumentBlob(sealed.blobId);
		expect(got).toBeDefined();
		expect(got?.id).toBe(sealed.blobId);
		const ids = await listDocumentBlobIds();
		expect(ids).toContain(sealed.blobId);
		await deleteDocumentBlob(sealed.blobId);
		expect(await getDocumentBlob(sealed.blobId)).toBeUndefined();
	});

	it('document blob row validator rejects malformed rows', () => {
		expect(() =>
			validateDocumentBlobRow({
				id: 'x',
				nonce: new Uint8Array(8),
				ciphertext: new Uint8Array(2),
				size: 2,
				sha256: 'ZZ',
				createdAt: 1
			})
		).toThrow(/nonce must be 12 bytes/);
	});
});
