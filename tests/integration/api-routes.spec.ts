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
				runFn(this._args);
				return { success: true };
			}
		};
	}

	private firstImpl<T>(sql: string, args: unknown[]): T | null {
		if (sql.startsWith('SELECT token, account_id, device_id, expires_at, sequence_clock')) {
			return (this.sessions.get(args[0] as string) ?? null) as T | null;
		}
		return null;
	}

	private runImpl(sql: string, args: unknown[]): void {
		if (sql.startsWith('UPDATE sessions SET sequence_clock')) {
			const session = this.sessions.get(args[1] as string);
			if (session) session.sequence_clock = args[0];
		}
	}
}

class MemoryR2 {
	objects = new Map<string, { bytes: Uint8Array; uploaded: Date; customMetadata?: Record<string, string> }>();

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

	async list(options?: { prefix?: string }): Promise<{
		objects: { key: string; uploaded: Date; size: number }[];
		truncated: boolean;
	}> {
		const objects = [...this.objects.entries()]
			.filter(([key]) => (options?.prefix ? key.startsWith(options.prefix) : true))
			.map(([key, object]) => ({ key, uploaded: object.uploaded, size: object.bytes.length }));
		return { objects, truncated: false };
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

	it('fails closed when a production rate-limit binding is missing', async () => {
		const testEnv = env({ OPAQUE_RATE_LIMIT_MODE: 'fail-closed' });
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
			error: 'rate limiter binding not configured'
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

	it('round-trips an encrypted document blob through R2', async () => {
		const db = new FakeD1();
		const r2 = new MemoryR2();
		const token = seedSession(db, 'e'.repeat(64), 0);
		const testEnv = env({ AUTH_DB: db, VAULT_BLOBS: r2 });
		const auth = { headers: { authorization: `Bearer ${token}` } };
		const blobId = '11111111-2222-3333-4444-555555555555';
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
});
