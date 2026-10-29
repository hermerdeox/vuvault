/**
 * New-device restore — end-to-end over the client stack.
 *
 * Proves, against an in-memory v2 server (blobs, inventories, restore
 * records, anonymous tokens), that:
 *
 *   1. enabling recovery on a synced vault publishes a sealed restore
 *      record, and a device with ONLY Secret Key + Recovery Password
 *      finds it, walks the chain to the newest save, and ends up with
 *      the same items — bound to its own fresh passkey;
 *   2. the restored device's own record goes to a fresh slot (never
 *      rewriting the old device's address) and it can lock/unlock;
 *   3. a wrong Recovery Password finds nothing;
 *   4. a master-password rotation neither restarts the inventory chain
 *      nor drops the restore state (the chain hangs off the data key);
 *   5. rotating the Recovery Password deletes this device's old records
 *      and re-keys, and disabling recovery deletes them;
 *   6. steady-state cadence: one record per day, then one per 64 saves.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';

vi.mock('$lib/crypto/webauthn-prf', () => ({
	evaluatePRF: vi.fn(
		async ({ credentialId, salt }: { credentialId: ArrayBuffer; salt: Uint8Array }) =>
			hmac(sha512, salt, new Uint8Array(credentialId)).slice(0, 32)
	),
	registerPasskey: vi.fn(),
	isWebAuthnSupported: () => true,
	isPlatformAuthenticatorAvailable: async () => true
}));

let mockSyncOrigin = 'https://sync.test.invalid';
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
	rotateAuth,
	adoptRestoredVault,
	generateDeviceSalt,
	hasRestoreRootInMemory,
	syncNow
} from '../../src/lib/services/vault-session';
import {
	enableRecovery,
	disableRecoveryEnvelope,
	deriveRecoveryMaterialFor,
	hasServerRestore
} from '../../src/lib/services/recovery-envelope';
import { discoverRestoreRecord } from '../../src/lib/services/server-restore';
import { setSessionToken } from '../../src/lib/services/sync-client';
import { createFakeTokenIssuer } from '../../src/lib/services/test-utils/fake-token-issuer';
import { db } from '../../src/lib/utils/storage';
import { evaluatePRF } from '../../src/lib/crypto/webauthn-prf';
import { deriveMasterPasswordKey, VAULT_HIGH_PARAMS } from '../../src/lib/crypto/argon2';
import { RESTORE_RECORD_BUCKET_BYTES } from '../../src/lib/crypto/restore-record';
import type { VaultItem } from '../../src/lib/stores/vault.svelte';

const SECRET_KEY = new Uint8Array(32).map((_, i) => (i * 5 + 3) & 0xff);
const RECOVERY_PASSWORD = 'correct horse battery staple ninety';
const OTHER_PASSWORD = 'wrong horse battery staple ninety';
const OPAQUE_EXPORT_KEY = new Uint8Array(64).fill(0x42);
const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const STRETCH_TIMEOUT = 90_000;

const itemA: VaultItem = { id: 'a', kind: 'note', title: 'A', noteBody: 'alpha', createdAt: 1, updatedAt: 1 };
const itemB: VaultItem = { id: 'b', kind: 'note', title: 'B', noteBody: 'bravo', createdAt: 2, updatedAt: 2 };
const itemC: VaultItem = { id: 'c', kind: 'note', title: 'C', noteBody: 'charlie', createdAt: 3, updatedAt: 3 };

type Call = { method: string; url: string; headers: Record<string, string> };

/** In-memory v2 server shared across "devices" in a test. */
function makeServer() {
	const blobs = new Map<string, { nonce: string; ciphertext: string }>();
	const invs = new Map<string, { nonce: string; ciphertext: string }>();
	const restores = new Map<string, { nonce: string; ciphertext: string }>();
	const issuer = createFakeTokenIssuer();
	const calls: Call[] = [];
	let clock = 1;
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method ?? 'GET').toUpperCase();
		const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
		calls.push({ method, url, headers });
		const tokenRoute = issuer.handle(url, method, init?.body as string | undefined);
		if (tokenRoute) return tokenRoute;
		const body = (): { nonce: string; ciphertext: string } => JSON.parse(String(init?.body ?? '{}'));
		const jr = (status: number, data: unknown): Response =>
			new Response(JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data }), {
				status,
				headers: { 'content-type': 'application/json' }
			});

		const restore = url.match(/\/api\/v2\/restore\/([^/?#]+)$/);
		if (restore) {
			const addr = restore[1]!;
			if (method === 'GET') {
				// Unauthenticated by design — but a credential here would be a bug.
				if (headers.authorization || headers['x-vu0-token']) return jr(400, 'unexpected credential on restore GET');
				const hit = restores.get(addr);
				return hit ? jr(200, { addr, ...hit, updatedAt: clock++ }) : jr(404, 'no restore record');
			}
			if (!issuer.redeem(headers['x-vu0-token'] ?? null)) return jr(401, 'invalid token');
			if (method === 'PUT') {
				restores.set(addr, body());
				return jr(200, { addr, updatedAt: clock++ });
			}
			if (method === 'DELETE') {
				restores.delete(addr);
				return jr(200, { addr, deletedAt: clock++ });
			}
		}
		if (url.includes('/api/v2/') && !issuer.redeem(headers['x-vu0-token'] ?? null)) {
			return jr(401, 'invalid token');
		}
		const blob = url.match(/\/api\/v2\/blobs\/([^/?#]+)$/);
		if (blob) {
			const id = blob[1]!;
			if (method === 'PUT') {
				blobs.set(id, body());
				return jr(200, { blobId: id, updatedAt: clock++ });
			}
			if (method === 'GET') {
				const hit = blobs.get(id);
				return hit ? jr(200, { blobId: id, ...hit, updatedAt: clock++ }) : jr(404, 'no blob');
			}
		}
		const inv = url.match(/\/api\/v2\/inv\/([^/?#]+)$/);
		if (inv) {
			const addr = inv[1]!;
			if (method === 'PUT') {
				invs.set(addr, body());
				return jr(200, { addr, updatedAt: clock++ });
			}
			if (method === 'GET') {
				const hit = invs.get(addr);
				return hit ? jr(200, { addr, ...hit, updatedAt: clock++ }) : jr(404, 'no inventory');
			}
		}
		return jr(404, `unexpected route ${method} ${url}`);
	}) as unknown as typeof fetch;
	return { blobs, invs, restores, calls, fetch: fetchImpl };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 80; i++) await new Promise((r) => setTimeout(r, 0));
}

function restorePuts(calls: Call[]): string[] {
	return calls.filter((c) => c.method === 'PUT' && c.url.includes('/api/v2/restore/')).map((c) => c.url);
}

async function provisionSyncedDevice(label: string, token: string) {
	const credentialId = crypto.getRandomValues(new Uint8Array(32)).buffer;
	const deviceSalt = generateDeviceSalt();
	const prfOutput = (await evaluatePRF({ credentialId, salt: deviceSalt })) as Uint8Array;
	await provisionVault({
		deviceLabel: label,
		secretKey: SECRET_KEY,
		credentialId,
		credentialPublicKey: new ArrayBuffer(0),
		authMode: 'production',
		prfOutput,
		deviceSalt,
		// Provision as an OPAQUE-enrolled account would be: the export key
		// is folded into the vault key, and the row says enrolled below.
		opaqueExportKey: OPAQUE_EXPORT_KEY
	});
	// Records need an OPAQUE identity to hand the restoring device.
	await db.account.update('singleton', {
		opaqueState: 'enrolled',
		opaqueAccountId: 'acct-1',
		opaqueServerId: 'test.invalid',
		opaqueClientId: 'client-1'
	});
	setSessionToken(token);
	return { credentialId, deviceSalt };
}

async function wipeDevice(): Promise<void> {
	lockSession();
	setSessionToken(null);
	await db.delete();
	await db.open();
}

async function restoreOntoFreshDevice(server: ReturnType<typeof makeServer>, password = RECOVERY_PASSWORD) {
	const material = await deriveRecoveryMaterialFor({ secretKey: SECRET_KEY, recoveryPassword: password });
	const hit = await discoverRestoreRecord(material.restoreRoot);
	if (!hit) return { hit: null, material, items: null as VaultItem[] | null };
	// "OPAQUE login" on the new device.
	setSessionToken(TOKEN_B);
	const credentialId = crypto.getRandomValues(new Uint8Array(32)).buffer;
	const deviceSalt = generateDeviceSalt();
	const prfOutput = (await evaluatePRF({ credentialId, salt: deviceSalt })) as Uint8Array;
	const items = await adoptRestoredVault({
		record: hit.record,
		foundAt: { day: hit.day, slot: hit.slot },
		secretKey: SECRET_KEY,
		opaqueExportKey: OPAQUE_EXPORT_KEY,
		opaque: { accountId: 'acct-1', serverId: 'test.invalid', clientId: hit.record.opaqueClientId },
		deviceLabel: 'new-device',
		credentialId,
		credentialPublicKey: new ArrayBuffer(0),
		authMode: 'production',
		prfOutput,
		deviceSalt
	});
	void server;
	return { hit, material, items };
}

beforeAll(() => {
	let t = 1_700_000_000_000;
	vi.spyOn(Date, 'now').mockImplementation(() => ++t);
});

let originalFetch: typeof fetch;
beforeEach(async () => {
	originalFetch = globalThis.fetch;
	mockSyncOrigin = 'https://sync.test.invalid';
	await db.delete();
	await db.open();
	lockSession();
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	setSessionToken(null);
	lockSession();
});

describe('new-device restore · round trip', () => {
	it(
		'restores the newest vault onto a device that has only Secret Key + Recovery Password',
		async () => {
			const server = makeServer();
			globalThis.fetch = server.fetch;
			await provisionSyncedDevice('old-device', TOKEN_A);

			const enabled = await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			expect(enabled.serverRestore).toBe('installed');
			await settle();
			expect(hasRestoreRootInMemory()).toBe(true);
			expect(await hasServerRestore()).toBe(true);
			// The install published exactly one record, same size bucket as every record.
			expect(restorePuts(server.calls)).toHaveLength(1);
			const stored = [...server.restores.values()][0]!;
			expect(atob(stored.ciphertext).length).toBe(RESTORE_RECORD_BUCKET_BYTES + 16);

			// Two more saves the same day: the chain advances, no new record is due.
			await saveItems([itemA]);
			await settle();
			await saveItems([itemA, itemB]);
			await settle();
			expect(restorePuts(server.calls)).toHaveLength(1);
			const oldRecordAddr = restorePuts(server.calls)[0]!;

			// The device is lost.
			await wipeDevice();
			expect(hasRestoreRootInMemory()).toBe(false);

			// A fresh device: Secret Key + Recovery Password, nothing else.
			const { hit, material, items } = await restoreOntoFreshDevice(server);
			expect(hit).not.toBeNull();
			expect(hit!.record.deviceLabel).toBe('old-device');
			expect(hit!.record.inventoryIndex).toBe(1n); // the install-time record
			// …but the walk reached the newest save (index 3): both items.
			expect(items!.map((i) => i.title).sort()).toEqual(['A', 'B']);
			// Reads on the restore route carried no credential at all.
			const restoreGets = server.calls.filter((c) => c.method === 'GET' && c.url.includes('/api/v2/restore/'));
			expect(restoreGets.length).toBeGreaterThan(0);
			for (const c of restoreGets) {
				expect(c.headers.authorization).toBeUndefined();
				expect(c.headers['x-vu0-token']).toBeUndefined();
			}

			// The new device enables recovery from the material it already
			// stretched: no second Argon2id, and its record lands at the NEXT
			// slot of that day — the old device's address is never rewritten.
			const again = await enableRecovery({
				secretKey: SECRET_KEY,
				recoveryPassword: RECOVERY_PASSWORD,
				material
			});
			expect(again.serverRestore).toBe('installed');
			await settle();
			const puts = restorePuts(server.calls);
			expect(puts).toHaveLength(2);
			expect(puts[1]).not.toBe(oldRecordAddr);
			const row = await db.account.get('singleton');
			expect(row?.restorePointerDay).toBe(hit!.day);
			expect(row?.restorePointerSlot).toBe(hit!.slot + 1);
			expect(row?.opaqueState).toBe('enrolled');
			expect(row?.opaqueClientId).toBe('client-1');
			expect(row?.restoreRootCiphertext).toBeInstanceOf(Uint8Array);

			// Ordinary life on the new device: save, lock, unlock with its own passkey.
			await saveItems([itemA, itemB, itemC]);
			await settle();
			lockSession();
			setSessionToken(TOKEN_B);
			const reopened = await openVault({ secretKey: SECRET_KEY, opaqueExportKey: OPAQUE_EXPORT_KEY });
			expect(reopened.map((i) => i.title).sort()).toEqual(['A', 'B', 'C']);
			expect(hasRestoreRootInMemory()).toBe(true);
			material.envelopeKey.fill(0);
			material.restoreRoot.fill(0);
		},
		STRETCH_TIMEOUT
	);

	it(
		'finds nothing under a wrong Recovery Password',
		async () => {
			const server = makeServer();
			globalThis.fetch = server.fetch;
			await provisionSyncedDevice('old-device', TOKEN_A);
			await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			await settle();
			await wipeDevice();

			const { hit } = await restoreOntoFreshDevice(server, OTHER_PASSWORD);
			expect(hit).toBeNull();
			expect(await db.account.get('singleton')).toBeUndefined();
		},
		STRETCH_TIMEOUT
	);

	it(
		'refuses to restore over a device that already has a vault',
		async () => {
			const server = makeServer();
			globalThis.fetch = server.fetch;
			await provisionSyncedDevice('old-device', TOKEN_A);
			await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			await settle();
			const material = await deriveRecoveryMaterialFor({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			const hit = (await discoverRestoreRecord(material.restoreRoot))!;
			await expect(
				adoptRestoredVault({
					record: hit.record,
					foundAt: { day: hit.day, slot: hit.slot },
					secretKey: SECRET_KEY,
					opaqueExportKey: OPAQUE_EXPORT_KEY,
					opaque: { accountId: 'acct-1', serverId: 'test.invalid', clientId: 'client-1' },
					deviceLabel: 'dup',
					credentialId: new ArrayBuffer(32),
					credentialPublicKey: new ArrayBuffer(0),
					authMode: 'demo',
					prfOutput: null,
					deviceSalt: generateDeviceSalt()
				})
			).rejects.toThrow(/already has a vault/);
		},
		STRETCH_TIMEOUT
	);
});

describe('new-device restore · survives auth rotation', () => {
	it(
		'a master-password rotation keeps the chain and the restore state, so a later restore still works',
		async () => {
			const server = makeServer();
			globalThis.fetch = server.fetch;
			await provisionSyncedDevice('old-device', TOKEN_A);
			await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			await settle();
			await saveItems([itemA]);
			await settle();
			const before = await db.account.get('singleton');
			expect(before?.inventoryIndex).toBe(2);

			const salt = new Uint8Array(16).fill(0x11);
			const mpk = await deriveMasterPasswordKey({ password: 'a-strong-master-password', salt, params: VAULT_HIGH_PARAMS });
			const prf = (await evaluatePRF({ credentialId: before!.credentialId, salt: before!.deviceSalt })) as Uint8Array;
			await rotateAuth({
				prfOutput: prf,
				secretKey: SECRET_KEY,
				masterPasswordKey: mpk,
				masterPasswordSalt: salt,
				masterPasswordParams: VAULT_HIGH_PARAMS,
				// OPAQUE factor unchanged, but an enrolled account must restate it.
				opaqueExportKey: OPAQUE_EXPORT_KEY,
				currentOpaqueExportKey: OPAQUE_EXPORT_KEY,
				opaqueAccountId: 'acct-1',
				opaqueServerId: 'test.invalid',
				opaqueClientId: 'client-1'
			});
			const after = await db.account.get('singleton');
			// Chain position and restore state carried over — no restart at 0.
			expect(after?.inventoryIndex).toBe(2);
			expect(after?.restoreRootCiphertext).toEqual(before?.restoreRootCiphertext);
			expect(hasRestoreRootInMemory()).toBe(true);

			await saveItems([itemA, itemB]);
			await settle();
			expect((await db.account.get('singleton'))?.inventoryIndex).toBe(3);
			// Same chain: the manual pull sees nothing newer than itself.
			expect((await syncNow()).status).toBe('local-newer');

			await wipeDevice();
			const { items } = await restoreOntoFreshDevice(server);
			expect(items!.map((i) => i.title).sort()).toEqual(['A', 'B']);
		},
		STRETCH_TIMEOUT
	);
});

describe('new-device restore · password rotation and disable', () => {
	it(
		'rotating the Recovery Password deletes the old records and re-keys; disabling deletes the new ones',
		async () => {
			const server = makeServer();
			globalThis.fetch = server.fetch;
			await provisionSyncedDevice('old-device', TOKEN_A);
			const first = await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			expect(first.serverRestore).toBe('installed');
			await settle();
			const oldAddr = restorePuts(server.calls)[0]!;

			const rotated = await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: OTHER_PASSWORD });
			expect(rotated.serverRestore).toBe('rotated');
			await settle();
			const deletes = server.calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
			expect(deletes).toContain(oldAddr);
			expect(server.restores.size).toBe(1);
			const newAddr = restorePuts(server.calls).at(-1)!;
			expect(newAddr).not.toBe(oldAddr);

			// The old password no longer finds anything; the new one does.
			const oldMaterial = await deriveRecoveryMaterialFor({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			expect(await discoverRestoreRecord(oldMaterial.restoreRoot)).toBeNull();
			const newMaterial = await deriveRecoveryMaterialFor({ secretKey: SECRET_KEY, recoveryPassword: OTHER_PASSWORD });
			expect(await discoverRestoreRecord(newMaterial.restoreRoot)).not.toBeNull();

			// Re-affirming the same password is a no-op rotation-wise.
			const same = await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: OTHER_PASSWORD, material: newMaterial });
			expect(same.serverRestore).toBe('unchanged');
			await settle();

			await disableRecoveryEnvelope();
			await settle();
			expect(server.restores.size).toBe(0);
			expect(hasRestoreRootInMemory()).toBe(false);
			const row = await db.account.get('singleton');
			expect(row?.restoreRootCiphertext).toBeUndefined();
			expect(row?.restorePointers).toBeUndefined();
		},
		STRETCH_TIMEOUT * 2
	);
});

describe('new-device restore · record cadence', () => {
	it(
		'publishes once per day, then once every 64 saves, each at a fresh address',
		async () => {
			const server = makeServer();
			globalThis.fetch = server.fetch;
			await provisionSyncedDevice('old-device', TOKEN_A);
			await enableRecovery({ secretKey: SECRET_KEY, recoveryPassword: RECOVERY_PASSWORD });
			await settle();
			expect(restorePuts(server.calls)).toHaveLength(1);

			const items: VaultItem[] = [];
			for (let i = 0; i < 64; i++) {
				items.push({ id: `n${i}`, kind: 'note', title: `n${i}`, noteBody: '', createdAt: i, updatedAt: i });
				await saveItems(items);
				await settle();
			}
			// Install record at index 1; saves ran indices 2..65. The 64th save
			// past the record (index 65) is the first one that is due again.
			const puts = restorePuts(server.calls);
			expect(puts).toHaveLength(2);
			expect(new Set(puts).size).toBe(2);
			const row = await db.account.get('singleton');
			expect(row?.restorePointerSlot).toBe(1);
			expect(row?.restorePointerIndex).toBe(65);
			expect(row?.restorePointers).toHaveLength(2);
		},
		STRETCH_TIMEOUT
	);
});
