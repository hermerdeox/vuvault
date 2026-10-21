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
	syncNow,
	lockSession,
	isSessionActive,
	generateDeviceSalt,
	currentFormatVersion,
	rotateAuth,
	sealActiveRecoveryEnvelope,
	openVaultWithRecoveryEnvelope,
	rebindRecoveredVault,
	PROVISION_FORMAT_VERSION,
	VAULT_PAD_FLOOR_BYTES,
	CurrentMasterPasswordIncorrect
} from './vault-session';
import { setSessionToken, fetchV2Blob } from './sync-client';
import { createFakeTokenIssuer } from './test-utils/fake-token-issuer';
import { inventoryVaultBlobId } from './inventory-session';
import {
	db,
	validateAccountRow,
	validateVaultRow,
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
type RecordedCall = { method: string; url: string; headers: Record<string, string> };

/**
 * Let a fire-and-forget push chain settle: token issuance (key GET +
 * issue POST + 16 VOPRF finalizations), blob PUT, inventory PUT and the
 * Dexie sync-state write. The mocks resolve immediately, so a bounded
 * run of macrotask turns is enough.
 */
async function settle(): Promise<void> {
	for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));
}

function makeV2RecordingFetch(urls: string[], calls: RecordedCall[] = []): typeof fetch {
	const blobStore = new Map<string, { nonce: string; ciphertext: string }>();
	const invStore = new Map<string, { nonce: string; ciphertext: string }>();
	const issuer = createFakeTokenIssuer();
	let clock = 1;
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		urls.push(url);
		const method = (init?.method ?? 'GET').toUpperCase();
		const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
		calls.push({ method, url, headers });
		const tokenRoute = issuer.handle(url, method, init?.body as string | undefined);
		if (tokenRoute) return tokenRoute;
		const body = (): { nonce: string; ciphertext: string } =>
			JSON.parse(String(init?.body ?? '{}'));
		const jr = (status: number, data: unknown): Response =>
			new Response(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data }), {
				status,
				headers: { 'content-type': 'application/json' }
			});

		// The v2 routes are token-only, like the real server: every request
		// must spend a valid, unspent anonymous token.
		if (url.includes('/api/v2/') && !issuer.redeem(headers['x-vu0-token'] ?? null)) {
			return jr(401, 'invalid token');
		}
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
			if (method === 'DELETE') {
				// Actually remove it so a later GET 404s — lets tests prove
				// whether a blob was destroyed by the sync path.
				blobStore.delete(id);
				return jr(200, { blobId: id, deletedAt: clock++ });
			}
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

	// --- Regression: key rotation must NOT orphan the Recovery Envelope
	// (critical data-loss audit finding). rotateAuth rotates the WRAPPING
	// key only; the data key stays live, so the envelope (which wraps it
	// directly) survives. ---

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

	it('keeps the Recovery Envelope valid across a v2→v3 upgrade-on-save', async () => {
		await provisionForRotate();

		// Simulate a vault provisioned before the v3 bump — the exact
		// population this regression targets.
		const acc = await db.account.get('singleton');
		await db.account.put({ ...acc!, formatVersion: 2 });

		// User enables recovery WHILE the account row still says v2.
		const recoveryPassword = 'Jasper! Maple! Lantern! Orchid!';
		const envelope = await sealActiveRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword
		});

		// Any ordinary save upgrades the row to v3. Pre-fix, the envelope
		// AAD was rebuilt from that mutated row on open, so this single
		// save permanently bricked recovery with an invalid GCM tag.
		await saveItems([
			{ id: 'i1', kind: 'note', title: 'n', noteBody: 'x', createdAt: 1, updatedAt: 1 }
		]);
		expect((await db.account.get('singleton'))!.formatVersion).toBe(PROVISION_FORMAT_VERSION);

		lockSession();

		const items = await openVaultWithRecoveryEnvelope({
			secretKey: SECRET_KEY,
			recoveryPassword,
			envelope
		});
		expect(items.map((i) => i.id)).toContain('i1');
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

	it('routes vault saves over token-authorized v2 only (no session token, no legacy routes)', async () => {
		// Behavioral proof the shape-only release probe cannot make: drive
		// the production save path against a recording transport and assert
		// the client touches ONLY /api/v2/blobs/* and /api/v2/inv/* — each
		// with an anonymous token and never the session token — plus the
		// Bearer-authenticated token issuance. The retired per-account
		// /api/blobs/* and /api/documents/* routes must never appear.
		mockSyncOrigin = 'https://sync.test.invalid';
		const originalFetch = globalThis.fetch;
		const urls: string[] = [];
		const calls: RecordedCall[] = [];
		globalThis.fetch = makeV2RecordingFetch(urls, calls);
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
			// A live session token makes the push's sync branch fire
			// (isSyncWired() && hasSession()).
			setSessionToken('f'.repeat(64));

			// Whole-vault save: the push is fire-and-forget, so let the
			// issuance + upload + inventory chain settle.
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
			await settle();

			expect(urls.some((u) => u.includes('/api/v2/blobs/'))).toBe(true);
			expect(urls.some((u) => u.includes('/api/v2/inv/'))).toBe(true);
			for (const c of calls) {
				expect(c.url).not.toContain('/api/blobs/');
				expect(c.url).not.toContain('/api/documents/');
				if (c.url.includes('/api/v2/')) {
					expect(c.headers['x-vu0-token']).toMatch(/^v1\./);
					expect(c.headers.authorization).toBeUndefined();
				}
				if (c.headers.authorization) {
					expect(c.url).toMatch(/\/api\/v0\/tokens\/issue$/);
				}
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

describe('vault-session — destructive-sync regressions (finding #3)', () => {
	const REAL_TOKEN = 'a'.repeat(64);

	const itemA: VaultItem = {
		id: 'a',
		kind: 'note',
		title: 'A',
		createdAt: 1,
		updatedAt: 1,
		noteBody: 'alpha'
	};
	const itemB: VaultItem = {
		id: 'b',
		kind: 'note',
		title: 'B',
		createdAt: 2,
		updatedAt: 2,
		noteBody: 'bravo'
	};

	async function provisionAndLogin(): Promise<void> {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({ credentialId, salt: deviceSalt })) as Uint8Array;
		await provisionVault({
			deviceLabel: 'sync-device',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		setSessionToken(REAL_TOKEN);
	}

	beforeEach(() => {
		mockSyncOrigin = 'https://sync.test.invalid';
	});
	afterEach(() => {
		setSessionToken(null);
		mockSyncOrigin = '';
	});

	it('unlock never overwrites a newer local vault whose push failed (and never reads the server)', async () => {
		// The old unlock-pull compared the server's save counter with an
		// in-memory one that restarted at 0, so after an offline save it
		// "adopted" the older server copy over the newer local vault.
		const originalFetch = globalThis.fetch;
		const calls: RecordedCall[] = [];
		const recording = makeV2RecordingFetch([], calls);
		globalThis.fetch = recording;
		try {
			await provisionAndLogin();
			await saveItems([itemA]); // server: [A]
			await settle();

			// Go offline for the second save: the local row gets [A, B],
			// the push fails, the server keeps [A].
			globalThis.fetch = vi.fn(
				async () =>
					new Response(JSON.stringify({ ok: false, error: 'unavailable' }), {
						status: 503,
						headers: { 'content-type': 'application/json' }
					})
			) as unknown as typeof fetch;
			await saveItems([itemA, itemB]);
			await settle();

			globalThis.fetch = recording;
			lockSession();
			setSessionToken(REAL_TOKEN);
			calls.length = 0;
			const opened = await openVault({ secretKey: SECRET_KEY });
			expect(opened.map((i) => i.title).sort()).toEqual(['A', 'B']);
			// Unlock issued no v2 reads at all.
			expect(calls.filter((c) => c.url.includes('/api/v2/') && c.method === 'GET')).toEqual([]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('manual syncNow promotes a newer remote save instead of clobbering it', async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = makeV2RecordingFetch([]);
		try {
			await provisionAndLogin();
			await saveItems([itemA]); // server: blob1 [A], index 1
			await settle();
			const staleVaultRow = await db.vault.get('singleton');
			const staleAccountRow = await db.account.get('singleton');
			expect(staleAccountRow?.inventoryIndex).toBe(1);
			await saveItems([itemA, itemB]); // server: blob2 [A, B], index 2
			await settle();
			const newerBlobId = inventoryVaultBlobId()!; // blob2
			expect(newerBlobId).toBeTruthy();

			// Roll this device back to its post-first-save state (vault [A],
			// index 1), as if another holder of the keys made the second save.
			await db.vault.put(staleVaultRow!);
			await db.account.put(staleAccountRow!);
			lockSession();
			setSessionToken(REAL_TOKEN);
			await openVault({ secretKey: SECRET_KEY }); // local [A]; unlock never pulls

			// Manual sync probes forward from index 1, finds index 2, and must
			// ADOPT [A, B] rather than push [A] over it.
			const result = await syncNow();
			expect(result.status).toBe('promoted');
			if (result.status === 'promoted') {
				expect(result.items.map((i) => i.title).sort()).toEqual(['A', 'B']);
			}
			expect((await db.account.get('singleton'))?.inventoryIndex).toBe(2);

			// The newer remote blob survives.
			const stillThere = await fetchV2Blob(newerBlobId);
			expect(stillThere.ok).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
			setSessionToken(null);
		}
	});

	it('never deletes or keep-alives superseded objects, and never reuses an inventory address', async () => {
		// A delete or keep-alive next to the write that supersedes it
		// would tie the old object to the new one in a single session.
		const calls: RecordedCall[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = makeV2RecordingFetch([], calls);
		try {
			await provisionAndLogin();
			await saveItems([itemA]);
			await settle();
			await saveItems([itemA, itemB]);
			await settle();
			const result = await syncNow();
			expect(['promoted', 'local-newer']).toContain(result.status);
			await settle();

			expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
			expect(calls.some((c) => /keepalive/.test(c.url))).toBe(false);
			const invPuts = calls
				.filter((c) => c.method === 'PUT' && c.url.includes('/api/v2/inv/'))
				.map((c) => c.url);
			expect(invPuts.length).toBe(3);
			expect(new Set(invPuts).size).toBe(invPuts.length);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('unlock refreshes a server copy that is about to age out, as a fresh save', async () => {
		const calls: RecordedCall[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = makeV2RecordingFetch([], calls);
		try {
			await provisionAndLogin();
			await saveItems([itemA]);
			await settle();
			// Pretend the last push was long ago.
			const acc = await db.account.get('singleton');
			await db.account.put({ ...acc!, inventoryPushedAt: 1 });

			lockSession();
			setSessionToken(REAL_TOKEN);
			calls.length = 0;
			await openVault({ secretKey: SECRET_KEY });
			await settle();

			const puts = calls.filter((c) => c.method === 'PUT').map((c) => c.url);
			expect(puts.some((u) => u.includes('/api/v2/blobs/'))).toBe(true);
			expect(puts.some((u) => u.includes('/api/v2/inv/'))).toBe(true);
			const after = await db.account.get('singleton');
			expect(after?.inventoryIndex).toBe(2);
			expect(after!.inventoryPushedAt!).toBeGreaterThan(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

describe('vault-session — fixed-size vault padding (V0-C2)', () => {
	it('seals vaults of very different sizes under the floor to identical ciphertext lengths', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		const prfOutput = (await evaluatePRF({ credentialId, salt: deviceSalt })) as Uint8Array;
		await provisionVault({
			deviceLabel: 'padding',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput,
			deviceSalt
		});
		const sizes: number[] = [];
		sizes.push((await db.vault.get('singleton'))!.ciphertext.length); // empty vault
		await saveItems([
			{ id: 'n1', kind: 'note', title: 't', noteBody: 'x', createdAt: 1, updatedAt: 1 }
		]);
		sizes.push((await db.vault.get('singleton'))!.ciphertext.length);
		const many: VaultItem[] = Array.from({ length: 80 }, (_, i) => ({
			id: `l${i}`,
			kind: 'login' as const,
			title: `Account ${i}`,
			username: `user${i}@example.com`,
			password: 'correct-horse-battery-staple-' + i,
			url: `https://site${i}.example.com/login`,
			createdAt: i,
			updatedAt: i
		}));
		await saveItems(many);
		sizes.push((await db.vault.get('singleton'))!.ciphertext.length);

		// AES-GCM adds a 16-byte tag to the padded plaintext.
		expect(new Set(sizes)).toEqual(new Set([VAULT_PAD_FLOOR_BYTES + 16]));
		lockSession();
	});
});
