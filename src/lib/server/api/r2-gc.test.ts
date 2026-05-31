/**
 * Unit tests for the v2 reference-counted R2 garbage collection sweep.
 *
 * Exercises `gcV2Now()` against in-memory fakes for the global D1
 * reference tables (`blob_references` / `inv_references`) and the R2
 * bucket, locking down the contract that:
 *   - only references older than the age cutoff are collected,
 *   - the matching R2 object key is account-free (`v2/blobs/{uuid}` /
 *     `v2/inv/{addr}`),
 *   - the D1 row is dropped even when the R2 delete fails,
 *   - a D1 read failure degrades to "deleted nothing" rather than
 *     throwing into the originating request.
 */

import { describe, expect, it } from 'vitest';
import { gcV2Now } from './r2-gc';
import type { Env, R2Bucket } from './env';

const DAY_SEC = 24 * 60 * 60;
const NOW_SEC = Math.floor(Date.now() / 1000);
const STALE_SEC = NOW_SEC - 30 * DAY_SEC; // well past the 14-day window
const FRESH_SEC = NOW_SEC; // just refreshed — must survive

class FakeR2 {
	deletedKeys: string[] = [];
	deleteShouldFail = false;

	delete(key: string): Promise<void> {
		if (this.deleteShouldFail) return Promise.reject(new Error('R2 unavailable'));
		this.deletedKeys.push(key);
		return Promise.resolve();
	}
}

class FakeStmt {
	private args: unknown[] = [];
	constructor(
		private db: FakeD1,
		private sql: string
	) {}

	bind(...args: unknown[]): this {
		this.args = args;
		return this;
	}

	all<T>(): Promise<{ results: T[] }> {
		if (this.db.selectShouldFail) return Promise.reject(new Error('D1 unavailable'));
		const [cutoff, limit] = this.args as [number, number];
		if (this.sql.includes('FROM blob_references')) {
			return Promise.resolve({ results: pick(this.db.blobRefs, cutoff, limit, 'blob_id') as T[] });
		}
		if (this.sql.includes('FROM inv_references')) {
			return Promise.resolve({ results: pick(this.db.invRefs, cutoff, limit, 'addr') as T[] });
		}
		return Promise.resolve({ results: [] as T[] });
	}

	run(): Promise<{ meta: { changes: number } }> {
		if (this.sql.includes('DELETE FROM blob_references')) {
			this.db.blobRefs.delete(this.args[0] as string);
		} else if (this.sql.includes('DELETE FROM inv_references')) {
			this.db.invRefs.delete(this.args[0] as string);
		}
		return Promise.resolve({ meta: { changes: 1 } });
	}
}

class FakeD1 {
	blobRefs = new Map<string, number>();
	invRefs = new Map<string, number>();
	selectShouldFail = false;

	prepare(sql: string): FakeStmt {
		return new FakeStmt(this, sql);
	}
}

function pick(
	table: Map<string, number>,
	cutoff: number,
	limit: number,
	col: 'blob_id' | 'addr'
): Record<string, string>[] {
	return [...table.entries()]
		.filter(([, t]) => t < cutoff)
		.sort((a, b) => a[1] - b[1])
		.slice(0, limit)
		.map(([id]) => ({ [col]: id }));
}

function envWith(db: FakeD1, r2: FakeR2): Env {
	return {
		AUTH_DB: db as unknown as Env['AUTH_DB'],
		VAULT_BLOBS: r2 as unknown as R2Bucket
	};
}

describe('r2-gc · gcV2Now', () => {
	it('collects stale references and leaves fresh ones', async () => {
		const db = new FakeD1();
		db.blobRefs.set('11111111-1111-4111-8111-111111111111', STALE_SEC);
		db.blobRefs.set('22222222-2222-4222-8222-222222222222', FRESH_SEC);
		db.invRefs.set('aaaaaaaaaaaaaaaaaaaaaaaaaa', STALE_SEC);
		db.invRefs.set('bbbbbbbbbbbbbbbbbbbbbbbbbb', FRESH_SEC);
		const r2 = new FakeR2();

		const result = await gcV2Now(envWith(db, r2));

		expect(result).toEqual({ v2BlobsDeleted: 1, v2InvsDeleted: 1 });
		expect(r2.deletedKeys).toContain('v2/blobs/11111111-1111-4111-8111-111111111111.bin');
		expect(r2.deletedKeys).toContain('v2/inv/aaaaaaaaaaaaaaaaaaaaaaaaaa.bin');
		// Account-free key shape — never a vaults/{accountId}/... path.
		expect(r2.deletedKeys.every((k) => k.startsWith('v2/'))).toBe(true);
		// Fresh rows survive.
		expect(db.blobRefs.has('22222222-2222-4222-8222-222222222222')).toBe(true);
		expect(db.invRefs.has('bbbbbbbbbbbbbbbbbbbbbbbbbb')).toBe(true);
		// Stale rows are gone from D1.
		expect(db.blobRefs.has('11111111-1111-4111-8111-111111111111')).toBe(false);
		expect(db.invRefs.has('aaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
	});

	it('drops the D1 row even when the R2 delete fails', async () => {
		const db = new FakeD1();
		db.blobRefs.set('33333333-3333-4333-8333-333333333333', STALE_SEC);
		const r2 = new FakeR2();
		r2.deleteShouldFail = true;

		const result = await gcV2Now(envWith(db, r2));

		expect(result.v2BlobsDeleted).toBe(1);
		expect(r2.deletedKeys).toHaveLength(0);
		expect(db.blobRefs.size).toBe(0);
	});

	it('degrades to zero on a D1 read failure without throwing', async () => {
		const db = new FakeD1();
		db.selectShouldFail = true;
		const r2 = new FakeR2();

		const result = await gcV2Now(envWith(db, r2));

		expect(result).toEqual({ v2BlobsDeleted: 0, v2InvsDeleted: 0 });
		expect(r2.deletedKeys).toHaveLength(0);
	});

	it('returns zero when nothing is past the cutoff', async () => {
		const db = new FakeD1();
		db.blobRefs.set('44444444-4444-4444-8444-444444444444', FRESH_SEC);
		const r2 = new FakeR2();

		const result = await gcV2Now(envWith(db, r2));

		expect(result).toEqual({ v2BlobsDeleted: 0, v2InvsDeleted: 0 });
		expect(db.blobRefs.size).toBe(1);
	});
});
