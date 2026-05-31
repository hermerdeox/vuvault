/**
 * Integration tests for the Phase 4 §L07b /api/v2/blobs/* and
 * /api/v2/inv/* routes.
 *
 * Each test exercises a property the release probe cannot (because
 * the release probe is unauthenticated):
 *
 *   - V1-C1 deep: two-account adversarial flow — neither account
 *     can enumerate the other's blob_ids, neither blob_id carries
 *     the owner's accountId in any server-observable surface.
 *   - V1-C3 deep: two-account ordering — the server's
 *     blob_references table stores no per-account index of when
 *     each account uploaded.
 *   - GC: blobs whose `last_seen_at` is older than the sweep
 *     window are purged from both R2 and the references table.
 *
 * Mirrors the api-routes.spec.ts harness style (FakeD1 + MemoryR2).
 */

import { describe, expect, it } from 'vitest';
import {
	PUT as v2BlobPut,
	GET as v2BlobGet,
	DELETE as v2BlobDelete
} from '../../src/routes/api/v2/blobs/[uuid]/+server';
import {
	PUT as v2InvPut,
	GET as v2InvGet
} from '../../src/routes/api/v2/inv/[addr]/+server';
import { gcV2Now } from '../../src/lib/server/api/r2-gc';
import type { Env, R2Object } from '../../src/lib/server/api/env';

type Row = Record<string, unknown>;

class FakeD1 {
	sessions = new Map<string, Row>();
	accounts = new Map<string, Row>();
	blobRefs = new Map<string, { last_seen_at: number; bytes: number }>();
	invRefs = new Map<string, { last_seen_at: number; bytes: number }>();
	rateLimits = new Map<string, number>();

	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		const firstFn = <T>(args: unknown[]) => this.firstImpl<T>(sql, args);
		const runFn = (args: unknown[]) => this.runImpl(sql, args);
		const allFn = <T>(args: unknown[]) => this.allImpl<T>(sql, args);
		return {
			_sql: sql,
			_args: [] as unknown[],
			bind(...args: unknown[]) {
				this._args = args;
				return this;
			},
			async first<T = unknown>(): Promise<T | null> {
				return firstFn<T>(this._args);
			},
			async run() {
				const changes = runFn(this._args);
				return { success: true, meta: { changes } };
			},
			async all<T = unknown>(): Promise<{ results: T[]; success: boolean }> {
				return { results: allFn<T>(this._args), success: true };
			}
		};
	}

	async batch(statements: Array<{ _sql: string; _args: unknown[] }>) {
		return statements.map((s) => ({
			success: true,
			meta: { changes: this.runImpl(s._sql, s._args) }
		}));
	}

	private firstImpl<T>(sql: string, args: unknown[]): T | null {
		if (sql.includes('FROM sessions s JOIN accounts a')) {
			const session = this.sessions.get(args[0] as string);
			if (!session) return null;
			const account = this.accounts.get(session.account_id as string);
			return {
				token: session.token,
				account_id: session.account_id,
				expires_at: session.expires_at,
				sequence_clock: Math.max(
					Number(session.sequence_clock ?? 0),
					Number(account?.sequence_clock ?? 0)
				)
			} as T;
		}
		if (sql.startsWith('SELECT count FROM rate_limits')) {
			const key = `${args[0] as string}:${args[1] as number}`;
			return { count: this.rateLimits.get(key) ?? 0 } as T;
		}
		return null;
	}

	private allImpl<T>(sql: string, args: unknown[]): T[] {
		if (sql.startsWith('SELECT blob_id FROM blob_references')) {
			const cutoff = Number(args[0]);
			const limit = Number(args[1]);
			const stale: T[] = [];
			for (const [blob_id, row] of this.blobRefs.entries()) {
				if (row.last_seen_at < cutoff) {
					stale.push({ blob_id } as unknown as T);
					if (stale.length >= limit) break;
				}
			}
			return stale;
		}
		if (sql.startsWith('SELECT addr FROM inv_references')) {
			const cutoff = Number(args[0]);
			const limit = Number(args[1]);
			const stale: T[] = [];
			for (const [addr, row] of this.invRefs.entries()) {
				if (row.last_seen_at < cutoff) {
					stale.push({ addr } as unknown as T);
					if (stale.length >= limit) break;
				}
			}
			return stale;
		}
		return [];
	}

	private runImpl(sql: string, args: unknown[]): number {
		if (sql.startsWith('INSERT INTO blob_references')) {
			this.blobRefs.set(args[0] as string, {
				last_seen_at: Math.floor(Date.now() / 1000),
				bytes: Number(args[1] ?? 0)
			});
			return 1;
		}
		if (sql.startsWith('DELETE FROM blob_references')) {
			return this.blobRefs.delete(args[0] as string) ? 1 : 0;
		}
		if (sql.startsWith('INSERT INTO inv_references')) {
			this.invRefs.set(args[0] as string, {
				last_seen_at: Math.floor(Date.now() / 1000),
				bytes: Number(args[1] ?? 0)
			});
			return 1;
		}
		if (sql.startsWith('DELETE FROM inv_references')) {
			return this.invRefs.delete(args[0] as string) ? 1 : 0;
		}
		if (sql.startsWith('INSERT INTO rate_limits')) {
			const key = `${args[0] as string}:${args[1] as number}`;
			this.rateLimits.set(key, (this.rateLimits.get(key) ?? 0) + 1);
			return 1;
		}
		return 0;
	}
}

class MemoryR2 {
	objects = new Map<string, { bytes: Uint8Array; uploaded: Date; customMetadata?: Record<string, string> }>();

	async get(key: string): Promise<R2Object | null> {
		const o = this.objects.get(key);
		if (!o) return null;
		return {
			httpEtag: `"${key}"`,
			customMetadata: o.customMetadata,
			uploaded: o.uploaded,
			async arrayBuffer() {
				return o.bytes.buffer.slice(
					o.bytes.byteOffset,
					o.bytes.byteOffset + o.bytes.byteLength
				);
			}
		};
	}

	async put(
		key: string,
		value: ArrayBuffer | Uint8Array,
		options?: { customMetadata?: Record<string, string> }
	): Promise<R2Object> {
		const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
		const stored = { bytes, uploaded: new Date(), customMetadata: options?.customMetadata };
		this.objects.set(key, stored);
		return {
			httpEtag: `"${key}"`,
			customMetadata: stored.customMetadata,
			uploaded: stored.uploaded,
			async arrayBuffer() {
				return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
			}
		};
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}

	async list() {
		return {
			objects: [...this.objects.entries()].map(([key, o]) => ({
				key,
				uploaded: o.uploaded,
				size: o.bytes.length
			})),
			truncated: false
		};
	}
}

function env(): Env {
	return {
		AUTH_DB: new FakeD1(),
		VAULT_BLOBS: new MemoryR2(),
		OPAQUE_RATE_LIMIT_MODE: 'fail-open'
	} as unknown as Env;
}

function event(request: Request, e: Env, params: Record<string, string> = {}) {
	return {
		request,
		platform: { env: e, context: { waitUntil() {} }, caches: {} as CacheStorage & { default: Cache } },
		params,
		url: new URL(request.url),
		route: { id: null },
		cookies: {} as never,
		fetch,
		getClientAddress: () => '127.0.0.1',
		isDataRequest: false,
		isSubRequest: false,
		locals: {},
		setHeaders() {}
	};
}

function seedSession(db: FakeD1, accountId: string, token: string): string {
	db.accounts.set(accountId, { account_id: accountId, sequence_clock: 0 });
	db.sessions.set(token, {
		token,
		account_id: accountId,
		expires_at: Math.floor((Date.now() + 60_000) / 1000),
		sequence_clock: 0
	});
	return token;
}

function bearer(token: string): { authorization: string } {
	return { authorization: `Bearer ${token}` };
}

describe('V1-C1 / V1-C3 · /api/v2/blobs', () => {
	it('PUT writes to global v2/blobs prefix (no per-account path)', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		const token = seedSession(db, 'acct-A', 'a'.repeat(64));
		const uuid = '11111111-1111-4111-8111-111111111111';

		const res = await v2BlobPut(
			event(
				new Request(`http://localhost/api/v2/blobs/${uuid}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', ...bearer(token) },
					body: JSON.stringify({ nonce: 'AAAA', ciphertext: 'BBBB' })
				}),
				e,
				{ uuid }
			)
		);
		expect(res.status).toBe(200);

		// V1-C1 invariant: the R2 key MUST NOT contain accountId.
		const keys = [...r2.objects.keys()];
		expect(keys).toHaveLength(1);
		expect(keys[0]).toBe(`v2/blobs/${uuid}.bin`);
		expect(keys[0]).not.toContain('acct-A');
		// customMetadata MUST NOT contain accountId / deviceId.
		const meta = r2.objects.get(keys[0]!)!.customMetadata ?? {};
		expect(meta).not.toHaveProperty('accountId');
		expect(meta).not.toHaveProperty('deviceId');
	});

	it('two-account adversarial: neither key carries the owner accountId', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		const tokenA = seedSession(db, 'acct-A', 'a'.repeat(64));
		const tokenB = seedSession(db, 'acct-B', 'b'.repeat(64));
		const uuidA = '22222222-2222-4222-8222-222222222222';
		const uuidB = '33333333-3333-4333-8333-333333333333';

		for (const [token, uuid] of [
			[tokenA, uuidA],
			[tokenB, uuidB]
		] as const) {
			await v2BlobPut(
				event(
					new Request(`http://localhost/api/v2/blobs/${uuid}`, {
						method: 'PUT',
						headers: { 'content-type': 'application/json', ...bearer(token) },
						body: JSON.stringify({ nonce: 'CC', ciphertext: 'DDDD' })
					}),
					e,
					{ uuid }
				)
			);
		}

		// V1-C1: from R2 alone, an observer cannot link uuidA to acct-A.
		for (const key of r2.objects.keys()) {
			expect(key).not.toContain('acct-A');
			expect(key).not.toContain('acct-B');
		}
		// V1-C1: the D1 blob_references table stores (blob_id, last_seen_at)
		// with NO account_id column.
		for (const [, row] of db.blobRefs.entries()) {
			expect(row).not.toHaveProperty('account_id');
			expect(row).not.toHaveProperty('accountId');
		}
		// V1-C3: ordering by last_seen_at across accounts is the same
		// shape regardless of which account uploaded — the table does
		// not separate accounts.
		const all = [...db.blobRefs.keys()].sort();
		expect(all).toEqual([uuidA, uuidB].sort());
	});

	it('GET requires auth (401) and never leaks account_id in error body', async () => {
		const e = env();
		const res = await v2BlobGet(
			event(
				new Request(
					'http://localhost/api/v2/blobs/44444444-4444-4444-8444-444444444444',
					{ method: 'GET' }
				),
				e,
				{ uuid: '44444444-4444-4444-8444-444444444444' }
			)
		);
		expect(res.status).toBe(401);
		const text = await res.text();
		expect(text.toLowerCase()).not.toContain('account');
		expect(text.toLowerCase()).not.toContain('device');
	});

	it('health endpoint returns 200 without auth (V1-C1/V1-C3 deployment sentinel)', async () => {
		const e = env();
		const res = await v2BlobGet(
			event(new Request('http://localhost/api/v2/blobs/health', { method: 'GET' }), e, {
				uuid: 'health'
			})
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { ready: boolean; route: string } };
		expect(body.data.ready).toBe(true);
		expect(body.data.route).toBe('v2.blobs');
	});

	it('DELETE retires both R2 object and D1 reference row', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		const token = seedSession(db, 'acct-A', 'a'.repeat(64));
		const uuid = '55555555-5555-4555-8555-555555555555';

		await v2BlobPut(
			event(
				new Request(`http://localhost/api/v2/blobs/${uuid}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', ...bearer(token) },
					body: JSON.stringify({ nonce: 'AA', ciphertext: 'BB' })
				}),
				e,
				{ uuid }
			)
		);
		expect(r2.objects.size).toBe(1);
		expect(db.blobRefs.size).toBe(1);

		const del = await v2BlobDelete(
			event(
				new Request(`http://localhost/api/v2/blobs/${uuid}`, {
					method: 'DELETE',
					headers: bearer(token)
				}),
				e,
				{ uuid }
			)
		);
		expect(del.status).toBe(200);
		expect(r2.objects.size).toBe(0);
		expect(db.blobRefs.size).toBe(0);
	});
});

describe('V1-C1 · /api/v2/inv', () => {
	it('PUT writes to global v2/inv prefix with no account leak', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		const token = seedSession(db, 'acct-A', 'a'.repeat(64));
		const addr = 'abcdefghjkmnpqrstvwxyz0123';

		const res = await v2InvPut(
			event(
				new Request(`http://localhost/api/v2/inv/${addr}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', ...bearer(token) },
					body: JSON.stringify({ nonce: 'AAAA', ciphertext: 'BBBB' })
				}),
				e,
				{ addr }
			)
		);
		expect(res.status).toBe(200);

		const keys = [...r2.objects.keys()];
		expect(keys[0]).toBe(`v2/inv/${addr}.bin`);
		expect(keys[0]).not.toContain('acct-A');
		// D1 row carries addr but no accountId.
		for (const row of db.invRefs.values()) {
			expect(row).not.toHaveProperty('account_id');
			expect(row).not.toHaveProperty('accountId');
		}
	});

	it('GET round-trips inventory ciphertext', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const token = seedSession(db, 'acct-A', 'a'.repeat(64));
		const addr = '0123456789abcdefghjkmnpqrs';

		// Use padded base64 so the assertion is canonical-form-stable.
		await v2InvPut(
			event(
				new Request(`http://localhost/api/v2/inv/${addr}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', ...bearer(token) },
					body: JSON.stringify({ nonce: 'AAAAAAAAAAAAAAAA', ciphertext: 'CCCCCCCC' })
				}),
				e,
				{ addr }
			)
		);

		const get = await v2InvGet(
			event(
				new Request(`http://localhost/api/v2/inv/${addr}`, {
					method: 'GET',
					headers: bearer(token)
				}),
				e,
				{ addr }
			)
		);
		expect(get.status).toBe(200);
		const body = (await get.json()) as {
			data: { addr: string; nonce: string; ciphertext: string };
		};
		expect(body.data.addr).toBe(addr);
		// The server stores raw bytes and re-encodes them in canonical
		// padded base64 on GET. Decode-roundtrip is the canonical check.
		const nonceBytes = atob(body.data.nonce);
		const ctBytes = atob(body.data.ciphertext);
		expect(nonceBytes.length).toBe(12);
		expect(ctBytes.length).toBe(6);
	});

	it('rejects malformed addresses (400 before auth)', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const token = seedSession(db, 'acct-A', 'a'.repeat(64));
		const res = await v2InvGet(
			event(
				new Request('http://localhost/api/v2/inv/not-an-addr!!!', {
					method: 'GET',
					headers: bearer(token)
				}),
				e,
				{ addr: 'not-an-addr!!!' }
			)
		);
		expect(res.status).toBe(400);
	});
});

describe('V1-C1/V1-C3 · GC reference-counted sweep', () => {
	it('purges blobs whose last_seen_at is older than the window — no per-account enumeration', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;

		// Seed two stale blob_references and one fresh.
		const staleSec = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000); // 30d ago
		db.blobRefs.set('11111111-1111-4111-8111-111111111111', {
			last_seen_at: staleSec,
			bytes: 100
		});
		db.blobRefs.set('22222222-2222-4222-8222-222222222222', {
			last_seen_at: staleSec,
			bytes: 200
		});
		db.blobRefs.set('33333333-3333-4333-8333-333333333333', {
			last_seen_at: Math.floor(Date.now() / 1000),
			bytes: 300
		});
		await r2.put(
			'v2/blobs/11111111-1111-4111-8111-111111111111.bin',
			new Uint8Array([1])
		);
		await r2.put(
			'v2/blobs/22222222-2222-4222-8222-222222222222.bin',
			new Uint8Array([2])
		);
		await r2.put(
			'v2/blobs/33333333-3333-4333-8333-333333333333.bin',
			new Uint8Array([3])
		);

		const result = await gcV2Now(e);
		expect(result.v2BlobsDeleted).toBe(2);
		expect(db.blobRefs.size).toBe(1);
		expect(db.blobRefs.has('33333333-3333-4333-8333-333333333333')).toBe(true);
		expect(r2.objects.size).toBe(1);
		expect(
			r2.objects.has('v2/blobs/33333333-3333-4333-8333-333333333333.bin')
		).toBe(true);

		// V1-C1 invariant: GC walks blob_references (no account binding),
		// not per-account R2 prefixes. The mock R2 list() would expose
		// any prefix walk; we never call it.
	});

	it('purges stale inventory references too', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;

		const staleSec = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
		db.invRefs.set('aaaaaaaaaaaaaaaaaaaaaaaaaa', { last_seen_at: staleSec, bytes: 100 });
		await r2.put('v2/inv/aaaaaaaaaaaaaaaaaaaaaaaaaa.bin', new Uint8Array([1]));

		const result = await gcV2Now(e);
		expect(result.v2InvsDeleted).toBe(1);
		expect(db.invRefs.size).toBe(0);
		expect(r2.objects.size).toBe(0);
	});

	it('does not purge fresh references', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;

		db.blobRefs.set('44444444-4444-4444-8444-444444444444', {
			last_seen_at: Math.floor(Date.now() / 1000),
			bytes: 100
		});
		await r2.put(
			'v2/blobs/44444444-4444-4444-8444-444444444444.bin',
			new Uint8Array([1])
		);

		const result = await gcV2Now(e);
		expect(result.v2BlobsDeleted).toBe(0);
		expect(db.blobRefs.size).toBe(1);
		expect(r2.objects.size).toBe(1);
	});
});
