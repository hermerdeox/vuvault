/**
 * Behavioral tests for the inventory session — the live glue that
 * closes V1-C1 ("no per-user blob inventories") and V1-C3 ("no
 * cross-account sequence-clock correlation") by routing every blob
 * pointer through the client-side encrypted inventory at the
 * deterministic bootstrap address, over the v2 transport only.
 *
 * These prove three things the release probe's shape-only checks
 * cannot:
 *   1. save → lock → restore round-trips the whole-vault blob pointer
 *      back out of the server inventory. A fresh in-memory session
 *      re-derives the same bootstrap address from (vaultKey,
 *      deviceSalt), pulls the inventory, and recovers the vault blob
 *      id with the monotonic save counter advanced.
 *   2. the persisted inventory ciphertext re-opens with
 *      `openInventory`/`deserializeInventory` and lists exactly the
 *      vault + document blob ids — i.e. the positional `blobIds`
 *      convention (`[vault, ...docs]`) survives the seal/serialize
 *      round-trip.
 *   3. the manager only ever writes the `/api/v2/inv/` surface — never
 *      the retired per-account `/api/blobs/*` or `/api/documents/*`
 *      routes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Sync must look wired so `isSyncWired()` is true and `call()` issues
// real fetches against the recording mock below. Naming the variable
// `mock*` keeps vitest's vi.mock hoist-guard happy.
let mockSyncOrigin = 'https://sync.test.invalid';
vi.mock('$lib/utils/env', () => ({
	getSyncOrigin: () => mockSyncOrigin,
	isSyncOriginConfigured: () => mockSyncOrigin !== ''
}));

import {
	initInventorySession,
	clearInventorySession,
	inventoryVaultBlobId,
	inventoryLatestIndex,
	inventorySetVaultBlob,
	inventoryAddDocumentBlob,
	inventoryPullVault
} from './inventory-session';
import { setSessionToken } from './sync-client';
import {
	bootstrapAddress,
	encodeAddress,
	openInventory,
	deserializeInventory
} from './blob-inventory';

const VAULT_KEY: Uint8Array = (() => {
	const k = new Uint8Array(64);
	for (let i = 0; i < 64; i++) k[i] = (i * 7 + 3) & 0xff;
	return k;
})();

const VAULT_KEY_OTHER: Uint8Array = (() => {
	const k = new Uint8Array(64);
	for (let i = 0; i < 64; i++) k[i] = (i * 11 + 5) & 0xff;
	return k;
})();

const DEVICE_SALT: Uint8Array = (() => {
	const s = new Uint8Array(32);
	for (let i = 0; i < 32; i++) s[i] = (i * 3 + 1) & 0xff;
	return s;
})();

// Canonical UUID-v4-shaped ids (must satisfy serializeInventory's
// /^[0-9a-f-]{36}$/i blobId check).
const VAULT_BLOB = '11111111-1111-4111-8111-111111111111';
const DOC_BLOB = '22222222-2222-4222-8222-222222222222';

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

type StoredInv = { nonce: string; ciphertext: string };

/**
 * In-memory v2 inventory transport. Records every requested URL and
 * serves PUT/GET against `/api/v2/inv/{addr}`. A 404 with the literal
 * `no inventory` error mirrors the real route's "absent" signal, which
 * the inventory session maps to a fresh empty inventory. ANY other
 * route (notably the retired per-account ones) returns a loud 404 so a
 * leak would surface as an unexpected recorded URL.
 */
function installFetchMock() {
	const urls: string[] = [];
	const invStore = new Map<string, StoredInv>();
	let clock = 1;
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		urls.push(url);
		const method = (init?.method ?? 'GET').toUpperCase();
		const invMatch = url.match(/\/api\/v2\/inv\/([^/?#]+)$/);
		if (invMatch) {
			const addr = invMatch[1]!;
			if (method === 'PUT') {
				const body = JSON.parse(String(init?.body ?? '{}')) as StoredInv;
				invStore.set(addr, { nonce: body.nonce, ciphertext: body.ciphertext });
				return jsonResponse(200, { ok: true, data: { addr, updatedAt: clock++ } });
			}
			if (method === 'GET') {
				const hit = invStore.get(addr);
				if (!hit) return jsonResponse(404, { ok: false, error: 'no inventory' });
				return jsonResponse(200, {
					ok: true,
					data: { addr, nonce: hit.nonce, ciphertext: hit.ciphertext, updatedAt: clock++ }
				});
			}
		}
		return jsonResponse(404, { ok: false, error: `unexpected route ${method} ${url}` });
	}) as unknown as typeof fetch;
	return {
		urls,
		invStore,
		restore() {
			globalThis.fetch = original;
		}
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => {
	clearInventorySession();
	setSessionToken(null);
	mockSyncOrigin = 'https://sync.test.invalid';
});

describe('inventory session — v2 transport round-trip', () => {
	it('round-trips the whole-vault blob pointer through the bootstrap inventory', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			const set = await inventorySetVaultBlob(VAULT_BLOB);
			expect(set.ok).toBe(true);
			expect(set.previousBlobId).toBeNull();
			expect(await inventoryAddDocumentBlob(DOC_BLOB)).toBe(true);
			expect(inventoryVaultBlobId()).toBe(VAULT_BLOB);
			expect(inventoryLatestIndex()).toBe(1n);

			// Simulate lock → restore: a fresh in-memory session with the
			// same (vaultKey, deviceSalt) derives the same bootstrap
			// address, so the pull recovers the server inventory.
			clearInventorySession();
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			expect(inventoryVaultBlobId()).toBeNull();
			expect(inventoryLatestIndex()).toBe(0n);

			const pulled = await inventoryPullVault();
			expect(pulled).not.toBeNull();
			expect(pulled?.blobId).toBe(VAULT_BLOB);
			expect(pulled?.index).toBe(1n);
			expect(inventoryVaultBlobId()).toBe(VAULT_BLOB);
			expect(inventoryLatestIndex()).toBe(1n);
		} finally {
			mock.restore();
		}
	});

	it('persists vault + document ids that re-open via openInventory/deserializeInventory', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			await inventorySetVaultBlob(VAULT_BLOB);
			await inventoryAddDocumentBlob(DOC_BLOB);

			// Re-derive the bootstrap address and open the last-persisted
			// ciphertext exactly as a passive holder of (vaultKey,
			// deviceSalt) would — proving the positional convention.
			const addrBytes = bootstrapAddress(VAULT_KEY, DEVICE_SALT);
			const addr = encodeAddress(addrBytes);
			const stored = mock.invStore.get(addr);
			expect(stored).toBeDefined();

			const plaintext = openInventory(
				VAULT_KEY,
				addrBytes,
				base64ToBytes(stored!.nonce),
				base64ToBytes(stored!.ciphertext)
			);
			const inv = deserializeInventory(plaintext);
			expect(inv.blobIds).toEqual([VAULT_BLOB, DOC_BLOB]);
			// A document attach bumps `version` but NOT the save counter.
			expect(inv.latestCrdtIndex).toBe(1n);
		} finally {
			mock.restore();
		}
	});

	it('writes only the /api/v2/inv surface — never legacy per-account routes', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			await inventorySetVaultBlob(VAULT_BLOB);
			await inventoryAddDocumentBlob(DOC_BLOB);
			clearInventorySession();
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			await inventoryPullVault();

			expect(mock.urls.length).toBeGreaterThan(0);
			for (const url of mock.urls) {
				expect(url).toContain('/api/v2/inv/');
				expect(url).not.toContain('/api/blobs/');
				expect(url).not.toContain('/api/documents/');
			}
		} finally {
			mock.restore();
		}
	});

	it('starts empty when the server holds no inventory (404 → absent)', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			// A vault key with nothing stored at its bootstrap address.
			initInventorySession(VAULT_KEY_OTHER, DEVICE_SALT);
			const pulled = await inventoryPullVault();
			expect(pulled).toBeNull();
			expect(inventoryVaultBlobId()).toBeNull();
			expect(inventoryLatestIndex()).toBe(0n);
		} finally {
			mock.restore();
		}
	});
});
