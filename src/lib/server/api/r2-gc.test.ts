/**
 * Unit tests for the opportunistic R2 garbage collection sweep.
 *
 * Exercises `gcAccountNow()` against an in-memory R2 mock so the
 * key-shape contract (vault prefix vs documents subprefix, sequence-
 * clock parsing, uploaded-time eligibility) is locked down.
 */

import { describe, expect, it } from 'vitest';
import { gcAccountNow } from './r2-gc';
import type { Env, R2Bucket } from './env';

type FakeObject = { key: string; uploaded: Date };

class FakeR2 {
	objects = new Map<string, FakeObject>();
	listShouldFail = false;
	deletedKeys: string[] = [];

	put(key: string, _value: unknown, _opts?: unknown): Promise<unknown> {
		this.objects.set(key, { key, uploaded: new Date() });
		return Promise.resolve({});
	}

	get(key: string): Promise<unknown> {
		return Promise.resolve(this.objects.get(key) ?? null);
	}

	delete(key: string): Promise<void> {
		this.deletedKeys.push(key);
		this.objects.delete(key);
		return Promise.resolve();
	}

	list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
		objects: { key: string; uploaded: Date; size: number }[];
		truncated: boolean;
		cursor?: string;
	}> {
		if (this.listShouldFail) return Promise.reject(new Error('R2 unavailable'));
		const prefix = options?.prefix ?? '';
		const items = Array.from(this.objects.values())
			.filter((o) => o.key.startsWith(prefix))
			.map((o) => ({ key: o.key, uploaded: o.uploaded, size: 0 }));
		return Promise.resolve({ objects: items, truncated: false });
	}
}

function envWith(r2: FakeR2): Env {
	return {
		AUTH_DB: {} as Env['AUTH_DB'],
		VAULT_BLOBS: r2 as unknown as R2Bucket
	};
}

describe('r2-gc · gcAccountNow', () => {
	it('deletes vault blobs below currentClock - KEEP_SUPERSEDED', async () => {
		const r2 = new FakeR2();
		const now = new Date();
		const accountId = 'acct-1';
		// Sequence clocks: 1..7 written. Clock=7 is the latest.
		for (let i = 1; i <= 7; i++) {
			r2.objects.set(`vaults/${accountId}/${i}.bin`, {
				key: `vaults/${accountId}/${i}.bin`,
				uploaded: now
			});
		}
		// Add an unrelated account's blob to make sure prefix filter holds.
		r2.objects.set('vaults/other-acct/1.bin', {
			key: 'vaults/other-acct/1.bin',
			uploaded: now
		});

		const result = await gcAccountNow(envWith(r2), accountId, 7);

		// KEEP_SUPERSEDED = 2 -> cutoff = 5, anything <= 5 deleted.
		// That is 1, 2, 3, 4, 5 -> 5 vault blobs deleted.
		expect(result.vaultBlobsDeleted).toBe(5);
		// 6 and 7 still present for this account.
		expect(r2.objects.has(`vaults/${accountId}/6.bin`)).toBe(true);
		expect(r2.objects.has(`vaults/${accountId}/7.bin`)).toBe(true);
		// Other account untouched.
		expect(r2.objects.has('vaults/other-acct/1.bin')).toBe(true);
	});

	it('does not delete document blobs as part of the vault-blob sweep', async () => {
		const r2 = new FakeR2();
		const now = new Date();
		const accountId = 'acct-1';
		r2.objects.set(`vaults/${accountId}/1.bin`, {
			key: `vaults/${accountId}/1.bin`,
			uploaded: now
		});
		r2.objects.set(`vaults/${accountId}/2.bin`, {
			key: `vaults/${accountId}/2.bin`,
			uploaded: now
		});
		const blobId = '11111111-1111-4111-8111-111111111111';
		r2.objects.set(`vaults/${accountId}/documents/${blobId}.bin`, {
			key: `vaults/${accountId}/documents/${blobId}.bin`,
			uploaded: now
		});

		const result = await gcAccountNow(envWith(r2), accountId, 10);

		// Vault blobs 1 and 2 < cutoff 8, both deleted.
		expect(result.vaultBlobsDeleted).toBe(2);
		// Document blob is fresh, NOT deleted by the doc-age pass either.
		expect(result.documentBlobsDeleted).toBe(0);
		expect(
			r2.objects.has(`vaults/${accountId}/documents/${blobId}.bin`)
		).toBe(true);
	});

	it('deletes document blobs older than DOC_BLOB_MAX_AGE_MS', async () => {
		const r2 = new FakeR2();
		const accountId = 'acct-1';
		const fresh = new Date();
		const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
		const freshBlob = '22222222-2222-4222-8222-222222222222';
		const staleBlob = '33333333-3333-4333-8333-333333333333';
		r2.objects.set(`vaults/${accountId}/documents/${freshBlob}.bin`, {
			key: `vaults/${accountId}/documents/${freshBlob}.bin`,
			uploaded: fresh
		});
		r2.objects.set(`vaults/${accountId}/documents/${staleBlob}.bin`, {
			key: `vaults/${accountId}/documents/${staleBlob}.bin`,
			uploaded: stale
		});

		const result = await gcAccountNow(envWith(r2), accountId, 1);

		expect(result.documentBlobsDeleted).toBe(1);
		expect(
			r2.objects.has(`vaults/${accountId}/documents/${freshBlob}.bin`)
		).toBe(true);
		expect(
			r2.objects.has(`vaults/${accountId}/documents/${staleBlob}.bin`)
		).toBe(false);
	});

	it('is a no-op when currentClock <= KEEP_SUPERSEDED', async () => {
		const r2 = new FakeR2();
		const accountId = 'acct-1';
		const now = new Date();
		r2.objects.set(`vaults/${accountId}/1.bin`, {
			key: `vaults/${accountId}/1.bin`,
			uploaded: now
		});
		r2.objects.set(`vaults/${accountId}/2.bin`, {
			key: `vaults/${accountId}/2.bin`,
			uploaded: now
		});

		const result = await gcAccountNow(envWith(r2), accountId, 1);

		expect(result.vaultBlobsDeleted).toBe(0);
		expect(r2.objects.size).toBe(2);
	});

	it('survives an R2 listing failure without throwing', async () => {
		const r2 = new FakeR2();
		r2.listShouldFail = true;
		const result = await gcAccountNow(envWith(r2), 'acct-1', 5);
		expect(result.vaultBlobsDeleted).toBe(0);
		expect(result.documentBlobsDeleted).toBe(0);
	});
});
