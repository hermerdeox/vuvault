import { describe, expect, it } from 'vitest';
import { POST as registerRequest } from '../../src/routes/api/opaque/register/request/+server';
import { POST as blobUpload } from '../../src/routes/api/blobs/upload/+server';
import { GET as blobLatest } from '../../src/routes/api/blobs/latest/+server';
import {
	PUT as documentPut,
	GET as documentGet,
	DELETE as documentDelete
} from '../../src/routes/api/documents/[blobId]/+server';
import type { Env, R2Object } from '../../src/lib/server/api/env';

type Row = Record<string, unknown>;

class FakeD1 {
	sessions = new Map<string, Row>();
	accounts = new Map<string, Row>();
	rateLimits = new Map<string, number>();
	rateLimitsAvailable = true;
	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		const firstFn = <T>(args: unknown[]) => this.firstImpl<T>(sql, args);
		const runFn = (args: unknown[]) => this.runImpl(sql, args);
		return {
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
			}
		};
	}

	private firstImpl<T>(sql: string, args: unknown[]): T | null {
		if (sql.includes('FROM sessions s JOIN accounts a')) {
			const session = this.sessions.get(args[0] as string);
			if (!session) return null;
			const account = this.accounts.get(session.account_id as string);
			return {
				token: session.token,
				account_id: session.account_id,
				device_id: session.device_id,
				expires_at: session.expires_at,
				sequence_clock: Math.max(
					Number(session.sequence_clock ?? 0),
					Number(account?.sequence_clock ?? 0)
				)
			} as T;
		}
		if (sql.startsWith('SELECT count FROM rate_limits')) {
			if (!this.rateLimitsAvailable) throw new Error('rate_limits missing');
			const key = `${args[0] as string}:${args[1] as number}`;
			return { count: this.rateLimits.get(key) ?? 0 } as T;
		}
		return null;
	}

	private runImpl(sql: string, args: unknown[]): number {
		if (sql.startsWith('INSERT INTO rate_limits')) {
			if (!this.rateLimitsAvailable) throw new Error('rate_limits missing');
			const key = `${args[0] as string}:${args[1] as number}`;
			this.rateLimits.set(key, (this.rateLimits.get(key) ?? 0) + 1);
			return 1;
		}
		if (sql.startsWith('UPDATE accounts SET sequence_clock')) {
			const token = args[1] as string;
			const newClock = Number(args[0]);
			const session = this.sessions.get(token);
			if (!session) return 0;
			const accountId = session.account_id as string;
			const account = this.accounts.get(accountId);
			if (account && Number(account.sequence_clock ?? 0) < newClock) {
				account.sequence_clock = newClock;
				return 1;
			}
			return 0;
		}
		if (sql.startsWith('UPDATE sessions SET sequence_clock')) {
			const session = this.sessions.get(args[1] as string);
			if (session) session.sequence_clock = Math.max(Number(session.sequence_clock ?? 0), Number(args[0]));
			return session ? 1 : 0;
		}
		return 0;
	}
}

class MemoryR2 {
	objects = new Map<string, { bytes: Uint8Array; uploaded: Date; customMetadata?: Record<string, string> }>();
	pageSize = Number.POSITIVE_INFINITY;

	async get(key: string): Promise<R2Object | null> {
		const object = this.objects.get(key);
		if (!object) return null;
		return {
			httpEtag: `"${key}"`,
			customMetadata: object.customMetadata,
			uploaded: object.uploaded,
			async arrayBuffer() {
				return object.bytes.buffer.slice(
					object.bytes.byteOffset,
					object.bytes.byteOffset + object.bytes.byteLength
				);
			}
		};
	}

	async put(
		key: string,
		value: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
		options?: { customMetadata?: Record<string, string> }
	): Promise<R2Object> {
		if (value instanceof ReadableStream) throw new Error('stream test input unsupported');
		const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
		this.objects.set(key, {
			bytes: new Uint8Array(bytes),
			uploaded: new Date(),
			customMetadata: options?.customMetadata
		});
		const stored = await this.get(key);
		if (!stored) throw new Error('put failed');
		return stored;
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}

	async list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
		objects: { key: string; uploaded: Date; size: number }[];
		truncated: boolean;
		cursor?: string;
	}> {
		const start = options?.cursor ? Number.parseInt(options.cursor, 10) : 0;
		const pageSize = Math.min(options?.limit ?? this.pageSize, this.pageSize);
		const all = [...this.objects.entries()]
			.filter(([key]) => (options?.prefix ? key.startsWith(options.prefix) : true))
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, object]) => ({ key, uploaded: object.uploaded, size: object.bytes.length }));
		const objects = all.slice(start, start + pageSize);
		const next = start + objects.length;
		return { objects, truncated: next < all.length, cursor: next < all.length ? String(next) : undefined };
	}
}

function env(overrides: Partial<Env> = {}): Env {
	return {
		AUTH_DB: new FakeD1(),
		VAULT_BLOBS: new MemoryR2(),
		OPAQUE_RATE_LIMIT_MODE: 'fail-open',
		...overrides
	} as Env;
}

function event(
	request: Request,
	testEnv: Env,
	params: Record<string, string> = {}
) {
	return {
		request,
		platform: {
			env: testEnv,
			context: { waitUntil() {} },
			caches: {} as CacheStorage & { default: Cache }
		},
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

function jsonRequest(path: string, body: unknown, init: RequestInit = {}): Request {
	return new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
		body: JSON.stringify(body)
	});
}

async function json(res: Response) {
	return (await res.json()) as { ok: boolean; error?: string; data?: unknown };
}

function seedSession(db: FakeD1, token = 'a'.repeat(64), clock = 0): string {
	db.accounts.set('acct-1', {
		account_id: 'acct-1',
		sequence_clock: Math.max(Number(db.accounts.get('acct-1')?.sequence_clock ?? 0), clock)
	});
	db.sessions.set(token, {
		token,
		account_id: 'acct-1',
		device_id: 'device-1',
		expires_at: Math.floor((Date.now() + 60_000) / 1000),
		sequence_clock: clock
	});
	return token;
}

describe('api route handlers', () => {
	it('returns 400 for malformed OPAQUE registration bodies in preview mode', async () => {
		const testEnv = env();
		const res = await registerRequest(
			event(jsonRequest('/api/opaque/register/request', { clientId: 'alice' }), testEnv)
		);
		expect(res.status).toBe(400);
		expect(await json(res)).toMatchObject({ ok: false, error: 'invalid request body' });
	});

	it('fails closed when the D1 rate-limit table is unavailable', async () => {
		const db = new FakeD1();
		db.rateLimitsAvailable = false;
		const testEnv = env({ AUTH_DB: db });
		const res = await registerRequest(
			event(
				jsonRequest('/api/opaque/register/request', {
					clientId: 'alice',
					request: 'AA=='
				}),
				testEnv
			)
		);
		expect(res.status).toBe(503);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'rate limiter unavailable'
		});
	});

	it('requires a valid bearer token for blob upload', async () => {
		const testEnv = env();
		const res = await blobUpload(
			event(jsonRequest('/api/blobs/upload', { sequenceClock: 1 }), testEnv)
		);
		expect(res.status).toBe(401);
		expect(await json(res)).toMatchObject({ ok: false, error: 'unauthorized' });
	});

	it('enforces monotonic sequence clocks on blob upload', async () => {
		const db = new FakeD1();
		const token = seedSession(db, 'b'.repeat(64), 5);
		const testEnv = env({ AUTH_DB: db });
		const res = await blobUpload(
			event(
				jsonRequest(
					'/api/blobs/upload',
					{
						header: 'AQ==',
						nonce: 'Ag==',
						ciphertext: 'Aw==',
						sequenceClock: 5
					},
					{ headers: { authorization: `Bearer ${token}` } }
				),
				testEnv
			)
		);
		expect(res.status).toBe(409);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'sequence clock not monotonic'
		});
	});

	it('rejects stale uploads against the durable account sequence clock', async () => {
		const db = new FakeD1();
		const token = seedSession(db, '0'.repeat(64), 1);
		db.accounts.get('acct-1')!.sequence_clock = 10;
		const testEnv = env({ AUTH_DB: db });
		const res = await blobUpload(
			event(
				jsonRequest(
					'/api/blobs/upload',
					{
						header: 'AQ==',
						nonce: 'Ag==',
						ciphertext: 'Aw==',
						sequenceClock: 2
					},
					{ headers: { authorization: `Bearer ${token}` } }
				),
				testEnv
			)
		);
		expect(res.status).toBe(409);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'sequence clock not monotonic'
		});
	});

	it('rejects oversized encoded vault payloads before decode', async () => {
		const db = new FakeD1();
		const token = seedSession(db, '9'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db });
		const res = await blobUpload(
			event(
				jsonRequest(
					'/api/blobs/upload',
					{
						header: 'A'.repeat(6000),
						nonce: 'Ag==',
						ciphertext: 'Aw==',
						sequenceClock: 1
					},
					{ headers: { authorization: `Bearer ${token}` } }
				),
				testEnv
			)
		);
		expect(res.status).toBe(400);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'encoded blob size out of range'
		});
	});

	it('rejects document PUT with no bearer token', async () => {
		const testEnv = env();
		const res = await documentPut(
			event(
				new Request('http://localhost/api/documents/abcdef12-3456-7890', {
					method: 'PUT',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ nonce: 'AA==', ciphertext: 'AQID' })
				}),
				testEnv,
				{ blobId: 'abcdef12-3456-7890' }
			)
		);
		expect(res.status).toBe(401);
	});

	it('rejects document PUT with an invalid blob id', async () => {
		const db = new FakeD1();
		const token = seedSession(db, 'd'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db });
		const res = await documentPut(
			event(
				new Request('http://localhost/api/documents/not%20a%20uuid', {
					method: 'PUT',
					headers: {
						authorization: `Bearer ${token}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({ nonce: 'AA==', ciphertext: 'AQID' })
				}),
				testEnv,
				{ blobId: 'not a uuid' }
			)
		);
		expect(res.status).toBe(400);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'invalid blob id'
		});
	});

	it('rejects non-v4 document UUIDs', async () => {
		const db = new FakeD1();
		const token = seedSession(db, 'f'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db });
		const blobId = '11111111-2222-3333-4444-555555555555';
		const res = await documentPut(
			event(
				new Request(`http://localhost/api/documents/${blobId}`, {
					method: 'PUT',
					headers: {
						authorization: `Bearer ${token}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({ nonce: 'AA==', ciphertext: 'AQID' })
				}),
				testEnv,
				{ blobId }
			)
		);
		expect(res.status).toBe(400);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'invalid blob id'
		});
	});

	it('rejects oversized encoded document payloads before decode', async () => {
		const db = new FakeD1();
		const token = seedSession(db, '1'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db });
		const blobId = '22222222-3333-4444-8555-666666666666';
		const res = await documentPut(
			event(
				new Request(`http://localhost/api/documents/${blobId}`, {
					method: 'PUT',
					headers: {
						authorization: `Bearer ${token}`,
						'content-type': 'application/json'
					},
					body: JSON.stringify({ nonce: 'A'.repeat(100), ciphertext: 'AQID' })
				}),
				testEnv,
				{ blobId }
			)
		);
		expect(res.status).toBe(400);
		expect(await json(res)).toMatchObject({
			ok: false,
			error: 'encoded blob size out of range'
		});
	});

	it('round-trips an encrypted document blob through R2', async () => {
		const db = new FakeD1();
		const r2 = new MemoryR2();
		const token = seedSession(db, 'e'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db, VAULT_BLOBS: r2 });
		const auth = { headers: { authorization: `Bearer ${token}` } };
		const blobId = '11111111-2222-4333-8444-555555555555';
		const put = await documentPut(
			event(
				new Request(`http://localhost/api/documents/${blobId}`, {
					method: 'PUT',
					headers: { ...auth.headers, 'content-type': 'application/json' },
					body: JSON.stringify({ nonce: 'AAAA', ciphertext: 'AQIDBAUG' })
				}),
				testEnv,
				{ blobId }
			)
		);
		expect(put.status).toBe(200);

		const get = await documentGet(
			event(
				new Request(`http://localhost/api/documents/${blobId}`, {
					headers: auth.headers
				}),
				testEnv,
				{ blobId }
			)
		);
		expect(get.status).toBe(200);
		expect(await json(get)).toMatchObject({
			ok: true,
			data: {
				blobId,
				nonce: 'AAAA',
				ciphertext: 'AQIDBAUG'
			}
		});

		const del = await documentDelete(
			event(
				new Request(`http://localhost/api/documents/${blobId}`, {
					method: 'DELETE',
					headers: auth.headers
				}),
				testEnv,
				{ blobId }
			)
		);
		expect(del.status).toBe(200);

		const after = await documentGet(
			event(
				new Request(`http://localhost/api/documents/${blobId}`, {
					headers: auth.headers
				}),
				testEnv,
				{ blobId }
			)
		);
		expect(after.status).toBe(404);
	});

	it('uploads and fetches the highest-sequence blob through R2', async () => {
		const db = new FakeD1();
		const r2 = new MemoryR2();
		const token = seedSession(db, 'c'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db, VAULT_BLOBS: r2 });
		const auth = { headers: { authorization: `Bearer ${token}` } };

		const upload = await blobUpload(
			event(
				jsonRequest(
					'/api/blobs/upload',
					{
						header: 'AQ==',
						nonce: 'Ag==',
						ciphertext: 'Aw==',
						sequenceClock: 1
					},
					auth
				),
				testEnv
			)
		);
		expect(upload.status).toBe(200);

		const latest = await blobLatest(
			event(
				new Request('http://localhost/api/blobs/latest', {
					headers: { authorization: `Bearer ${token}` }
				}),
				testEnv
			)
		);
		expect(latest.status).toBe(200);
		expect(await json(latest)).toMatchObject({
			ok: true,
			data: {
				header: 'AQ==',
				nonce: 'Ag==',
				ciphertext: 'Aw==',
				sequenceClock: 1
			}
		});
	});

	it('ignores document and malformed keys when selecting the latest vault blob', async () => {
		const db = new FakeD1();
		const r2 = new MemoryR2();
		const token = seedSession(db, '2'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db, VAULT_BLOBS: r2 });
		await r2.put('vaults/acct-1/documents/99999999-9999-4999-8999-999999999999.bin', new Uint8Array([1]));
		await r2.put('vaults/acct-1/not-a-clock.bin', new Uint8Array([1]));

		const upload = await blobUpload(
			event(
				jsonRequest(
					'/api/blobs/upload',
					{
						header: 'BA==',
						nonce: 'BQ==',
						ciphertext: 'Bg==',
						sequenceClock: 7
					},
					{ headers: { authorization: `Bearer ${token}` } }
				),
				testEnv
			)
		);
		expect(upload.status).toBe(200);

		const latest = await blobLatest(
			event(
				new Request('http://localhost/api/blobs/latest', {
					headers: { authorization: `Bearer ${token}` }
				}),
				testEnv
			)
		);
		expect(latest.status).toBe(200);
		expect(await json(latest)).toMatchObject({
			ok: true,
			data: {
				header: 'BA==',
				nonce: 'BQ==',
				ciphertext: 'Bg==',
				sequenceClock: 7
			}
		});
	});

	it('walks truncated R2 listings when selecting the latest vault blob', async () => {
		const db = new FakeD1();
		const r2 = new MemoryR2();
		r2.pageSize = 1;
		const token = seedSession(db, '3'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db, VAULT_BLOBS: r2 });
		const auth = { headers: { authorization: `Bearer ${token}` } };

		for (const sequenceClock of [1, 2, 3]) {
			const upload = await blobUpload(
				event(
					jsonRequest(
						'/api/blobs/upload',
						{
							header: btoa(String.fromCharCode(sequenceClock)),
							nonce: 'Ag==',
							ciphertext: 'Aw==',
							sequenceClock
						},
						auth
					),
					testEnv
				)
			);
			expect(upload.status).toBe(200);
		}

		const latest = await blobLatest(
			event(
				new Request('http://localhost/api/blobs/latest', {
					headers: auth.headers
				}),
				testEnv
			)
		);
		expect(latest.status).toBe(200);
		expect(await json(latest)).toMatchObject({
			ok: true,
			data: {
				header: btoa(String.fromCharCode(3)),
				sequenceClock: 3
			}
		});
	});
});
