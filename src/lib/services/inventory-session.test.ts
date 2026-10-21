/**
 * Behavioral tests for the inventory session — the live glue that
 * writes every whole-vault blob pointer through a client-side
 * encrypted inventory over the v2 transport only.
 *
 * These prove the properties the release probe's shape-only checks
 * cannot:
 *   1. every save writes its inventory to a FRESH address
 *      (`inventoryAddress(vaultKey, deviceSalt, index)`), so no address
 *      recurs across saves (V0-C1), and each re-opens to exactly the one
 *      vault blob id;
 *   2. the manual pull finds saves the device has not seen and adopts
 *      the newest, while a session that starts at its persisted index
 *      finds nothing — unlock never needs to re-read old saves;
 *   3. a reserved index is never reused, even when its upload failed;
 *   4. inventory requests carry an anonymous token and never the
 *      session token, and only the `/api/v2/inv/` surface is written.
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
	inventoryRecordVaultBlob,
	inventoryPullNewer
} from './inventory-session';
import { setSessionToken } from './sync-client';
import {
	inventoryAddress,
	encodeAddress,
	openInventory,
	deserializeInventory
} from './blob-inventory';
import { createFakeTokenIssuer } from './test-utils/fake-token-issuer';

const VAULT_KEY: Uint8Array = (() => {
	const k = new Uint8Array(64);
	for (let i = 0; i < 64; i++) k[i] = (i * 7 + 3) & 0xff;
	return k;
})();

const DEVICE_SALT: Uint8Array = (() => {
	const s = new Uint8Array(32);
	for (let i = 0; i < 32; i++) s[i] = (i * 3 + 1) & 0xff;
	return s;
})();

// Canonical UUID-v4-shaped ids (must satisfy serializeInventory's
// /^[0-9a-f-]{36}$/i blobId check).
const VAULT_BLOB_A = '11111111-1111-4111-8111-111111111111';
const VAULT_BLOB_B = '22222222-2222-4222-8222-222222222222';

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

type StoredInv = { nonce: string; ciphertext: string };
type Recorded = { url: string; method: string; headers: Record<string, string> };

/**
 * In-memory v2 inventory transport behind a fake token issuer. Serves
 * PUT/GET against `/api/v2/inv/{addr}` only for requests carrying a
 * valid, unspent anonymous token. A 404 with the literal `no inventory`
 * error mirrors the real route's "absent" signal. ANY other route
 * (notably the retired per-account ones) returns a loud 404 so a leak
 * would surface as an unexpected recorded URL.
 */
function installFetchMock(opts: { failInvPut?: boolean } = {}) {
	const requests: Recorded[] = [];
	const invStore = new Map<string, StoredInv>();
	const issuer = createFakeTokenIssuer();
	let clock = 1;
	const original = globalThis.fetch;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method ?? 'GET').toUpperCase();
		const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
		requests.push({ url, method, headers });

		const tokenRoute = issuer.handle(url, method, init?.body as string | undefined);
		if (tokenRoute) return tokenRoute;

		const invMatch = url.match(/\/api\/v2\/inv\/([^/?#]+)$/);
		if (invMatch) {
			if (!issuer.redeem(headers['x-vu0-token'] ?? null)) {
				return jsonResponse(401, { ok: false, error: 'invalid token' });
			}
			const addr = invMatch[1]!;
			if (method === 'PUT') {
				if (opts.failInvPut) return jsonResponse(503, { ok: false, error: 'unavailable' });
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
		requests,
		invStore,
		issuer,
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

function openStored(stored: StoredInv, index: bigint) {
	const plaintext = openInventory(
		VAULT_KEY,
		inventoryAddress(VAULT_KEY, DEVICE_SALT, index),
		base64ToBytes(stored.nonce),
		base64ToBytes(stored.ciphertext)
	);
	return deserializeInventory(plaintext);
}

afterEach(() => {
	clearInventorySession();
	setSessionToken(null);
	mockSyncOrigin = 'https://sync.test.invalid';
});

describe('inventory session — per-save address rotation', () => {
	it('writes every save to a fresh address that re-opens to its one vault blob', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			const first = await inventoryRecordVaultBlob(VAULT_BLOB_A);
			const second = await inventoryRecordVaultBlob(VAULT_BLOB_B);
			expect(first).toEqual({ ok: true, index: 1n });
			expect(second).toEqual({ ok: true, index: 2n });
			expect(inventoryVaultBlobId()).toBe(VAULT_BLOB_B);
			expect(inventoryLatestIndex()).toBe(2n);

			const addr1 = encodeAddress(inventoryAddress(VAULT_KEY, DEVICE_SALT, 1n));
			const addr2 = encodeAddress(inventoryAddress(VAULT_KEY, DEVICE_SALT, 2n));
			expect(addr1).not.toBe(addr2);
			expect([...mock.invStore.keys()].sort()).toEqual([addr1, addr2].sort());

			const inv1 = openStored(mock.invStore.get(addr1)!, 1n);
			const inv2 = openStored(mock.invStore.get(addr2)!, 2n);
			expect(inv1.blobIds).toEqual([VAULT_BLOB_A]);
			expect(inv1.latestCrdtIndex).toBe(1n);
			expect(inv2.blobIds).toEqual([VAULT_BLOB_B]);
			expect(inv2.latestCrdtIndex).toBe(2n);
		} finally {
			mock.restore();
		}
	});

	it('manual pull adopts saves the device has not seen; a caught-up session pulls nothing', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			await inventoryRecordVaultBlob(VAULT_BLOB_A);
			await inventoryRecordVaultBlob(VAULT_BLOB_B);

			// A holder of the same keys that starts from scratch probes
			// forward and lands on the newest save.
			clearInventorySession();
			initInventorySession(VAULT_KEY, DEVICE_SALT, 0n);
			const pulled = await inventoryPullNewer();
			expect(pulled).toEqual({ blobId: VAULT_BLOB_B, index: 2n });
			expect(inventoryLatestIndex()).toBe(2n);

			// The device itself starts at its persisted index: nothing newer.
			clearInventorySession();
			initInventorySession(VAULT_KEY, DEVICE_SALT, 2n);
			expect(await inventoryPullNewer()).toBeNull();
			expect(inventoryVaultBlobId()).toBeNull();
		} finally {
			mock.restore();
		}
	});

	it('never reuses a reserved index, even when its upload failed', async () => {
		const failing = installFetchMock({ failInvPut: true });
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			const failed = await inventoryRecordVaultBlob(VAULT_BLOB_A);
			expect(failed).toEqual({ ok: false, index: 1n });
			expect(inventoryVaultBlobId()).toBeNull();
		} finally {
			failing.restore();
		}
		const mock = installFetchMock();
		try {
			const retried = await inventoryRecordVaultBlob(VAULT_BLOB_A);
			expect(retried).toEqual({ ok: true, index: 2n });
			expect([...mock.invStore.keys()]).toEqual([
				encodeAddress(inventoryAddress(VAULT_KEY, DEVICE_SALT, 2n))
			]);
		} finally {
			mock.restore();
		}
	});

	it('reserves nothing and returns index 0 when sync is not wired', async () => {
		mockSyncOrigin = '';
		initInventorySession(VAULT_KEY, DEVICE_SALT, 5n);
		expect(await inventoryRecordVaultBlob(VAULT_BLOB_A)).toEqual({ ok: false, index: 0n });
		expect(inventoryLatestIndex()).toBe(5n);
	});

	it('spends one anonymous token per inventory request and never sends the session token there', async () => {
		const mock = installFetchMock();
		setSessionToken('f'.repeat(64));
		try {
			initInventorySession(VAULT_KEY, DEVICE_SALT);
			await inventoryRecordVaultBlob(VAULT_BLOB_A);
			await inventoryRecordVaultBlob(VAULT_BLOB_B);
			clearInventorySession();
			initInventorySession(VAULT_KEY, DEVICE_SALT, 0n);
			await inventoryPullNewer();

			const inv = mock.requests.filter((r) => r.url.includes('/api/v2/'));
			expect(inv.length).toBeGreaterThan(0);
			for (const r of inv) {
				expect(r.url).toContain('/api/v2/inv/');
				expect(r.headers['x-vu0-token']).toMatch(/^v1\.\d+\./);
				expect(r.headers.authorization).toBeUndefined();
			}
			// Every v2 request redeemed a distinct token.
			expect(mock.issuer.spentCount).toBe(inv.length);
			// Issuance is the only Bearer-authenticated call.
			for (const r of mock.requests.filter((x) => x.headers.authorization)) {
				expect(r.url).toMatch(/\/api\/v0\/tokens\/issue$/);
			}
			for (const r of mock.requests) {
				expect(r.url).not.toContain('/api/blobs/');
				expect(r.url).not.toContain('/api/documents/');
			}
		} finally {
			mock.restore();
		}
	});
});
