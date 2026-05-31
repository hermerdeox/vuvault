import { describe, expect, it } from 'vitest';
import { POST as registerRequest } from '../../src/routes/api/opaque/register/request/+server';
import type { Env, R2Object } from '../../src/lib/server/api/env';

type Row = Record<string, unknown>;

class FakeD1 {
	sessions = new Map<string, Row>();
	rateLimits = new Map<string, number>();
	rateLimitsAvailable = true;
	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		const firstFn = <T>(args: unknown[]) => this.firstImpl<T>(sql, args);
		const runFn = (args: unknown[]) => this.runImpl(sql, args);
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
			}
		};
	}
	// Minimal batch — runs each prepared statement in order. Sufficient
	// to test `rotateToken` which uses INSERT + DELETE atomically.
	async batch(statements: Array<{ _sql: string; _args: unknown[] }>) {
		const results = [];
		for (const stmt of statements) {
			const changes = this.runImpl(stmt._sql, stmt._args);
			results.push({ success: true, meta: { changes } });
		}
		return results;
	}

	private firstImpl<T>(sql: string, args: unknown[]): T | null {
		// Post-0004/0009: authenticate() reads sessions ONLY — no JOIN
		// on accounts, no `device_id` (V1-C2), no `sequence_clock`
		// (V1-C3).
		if (sql.startsWith('SELECT token, account_id, expires_at FROM sessions')) {
			const session = this.sessions.get(args[0] as string);
			if (!session) return null;
			return {
				token: session.token,
				account_id: session.account_id,
				expires_at: session.expires_at
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
		// rotateToken: INSERT INTO sessions (token, account_id, expires_at, created_at)
		if (sql.startsWith('INSERT INTO sessions')) {
			this.sessions.set(args[0] as string, {
				token: args[0],
				account_id: args[1],
				expires_at: args[2]
			});
			return 1;
		}
		// rotateToken: DELETE FROM sessions WHERE token = ?
		if (sql.startsWith('DELETE FROM sessions WHERE token')) {
			return this.sessions.delete(args[0] as string) ? 1 : 0;
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

function seedSession(db: FakeD1, token = 'a'.repeat(64)): string {
	db.sessions.set(token, {
		token,
		account_id: 'acct-1',
		expires_at: Math.floor((Date.now() + 60_000) / 1000)
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

	it('fails closed when the D1 rate-limit table is unavailable (production mode)', async () => {
		const db = new FakeD1();
		db.rateLimitsAvailable = false;
		// Production mode: rate-limiter outage MUST translate to 503
		// so an attacker cannot blow past quotas by triggering D1
		// errors. The default fixture is `fail-open` (preview), so we
		// override here to assert the production contract.
		const testEnv = env({ AUTH_DB: db, OPAQUE_RATE_LIMIT_MODE: 'fail-closed' });
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

	it('fails open when D1 rate-limit table is unavailable in preview mode', async () => {
		const db = new FakeD1();
		db.rateLimitsAvailable = false;
		// Default fixture is `fail-open`. Even with a broken rate
		// limit table, the request is accepted (it should then fail
		// for a different reason — invalid body — proving the limiter
		// did NOT short-circuit with 503).
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
		// Either 400 (passed the limiter, fell through to validation)
		// or 500 (engine attempted to load identity from broken D1).
		// Anything but 503 is acceptable here — the contract is "do
		// not block the request because of the limiter".
		expect(res.status).not.toBe(503);
	});
});

// ---------------------------------------------------------------------------
// V1-C2 / V1-C3 deep assertions: /api/v2/sessions/self
// ---------------------------------------------------------------------------
//
// The release probe (`scripts/release-probe-vu1.mjs`) checks the
// unauthenticated SHAPE of this endpoint (404→401 transition + no
// device-correlating leakage in the error body). These tests cover
// the authenticated invariants the release probe cannot: the
// response body MUST contain ONLY {expiresAt} and MUST NOT carry
// deviceId, accountId, sequenceClock, or any pairing/fingerprint
// field; consecutive calls MUST rotate the bearer token (L08
// Option ii groundwork); and the rotation MUST atomically retire
// the old token in D1.

describe('V1-C2 · /api/v2/sessions/self', () => {
	it('requires authentication (no token → 401)', async () => {
		const { GET: sessionsSelf } = await import(
			'../../src/routes/api/v2/sessions/self/+server'
		);
		const db = new FakeD1();
		const testEnv = env({ AUTH_DB: db });
		const res = await sessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', { method: 'GET' }),
				testEnv
			)
		);
		expect(res.status).toBe(401);
		const text = await res.text();
		// V1-C2 invariant: error body MUST NOT name device-correlating
		// fields. We treat their mere mention as a leak.
		expect(text.toLowerCase()).not.toContain('device');
		expect(text.toLowerCase()).not.toContain('last_login');
		expect(text.toLowerCase()).not.toContain('paired');
		expect(text.toLowerCase()).not.toContain('fingerprint');
	});

	it('returns only {expiresAt} with a valid token', async () => {
		const { GET: sessionsSelf } = await import(
			'../../src/routes/api/v2/sessions/self/+server'
		);
		const db = new FakeD1();
		const token = seedSession(db, 'a'.repeat(64));
		const testEnv = env({ AUTH_DB: db });
		const res = await sessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', {
					method: 'GET',
					headers: { authorization: `Bearer ${token}` }
				}),
				testEnv
			)
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
		expect(body.ok).toBe(true);

		// EXACT shape assertion: the response data object MUST have
		// this one key and ONLY this key.
		const keys = Object.keys(body.data).sort();
		expect(keys).toEqual(['expiresAt']);

		// Forbidden keys MUST be absent.
		const forbidden = [
			'accountId',
			'account_id',
			'deviceId',
			'device_id',
			'sequenceClock',
			'sequence_clock',
			'token',
			'lastLoginAt',
			'last_login_at',
			'paired_at',
			'pairedAt',
			'fingerprint',
			'ip',
			'ipAddress',
			'userAgent',
			'user_agent'
		];
		for (const k of forbidden) {
			expect(body.data).not.toHaveProperty(k);
		}

		expect(typeof body.data.expiresAt).toBe('number');
	});

	it('rotates the bearer token via Next-Token response header', async () => {
		const { GET: sessionsSelf } = await import(
			'../../src/routes/api/v2/sessions/self/+server'
		);
		const db = new FakeD1();
		const origToken = seedSession(db, 'a'.repeat(64));
		const testEnv = env({ AUTH_DB: db });

		// First call: should rotate, emit Next-Token, retire origToken.
		const res1 = await sessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', {
					method: 'GET',
					headers: { authorization: `Bearer ${origToken}` }
				}),
				testEnv
			)
		);
		expect(res1.status).toBe(200);
		const next1 = res1.headers.get('next-token');
		expect(next1).toMatch(/^[0-9a-f]{64}$/);
		expect(next1).not.toBe(origToken);

		// The old token MUST be retired (no longer present in sessions).
		expect(db.sessions.has(origToken)).toBe(false);
		// The new token MUST be present.
		expect(db.sessions.has(next1!)).toBe(true);

		// Second call with the old token: MUST 401 (it's been retired).
		const res2 = await sessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', {
					method: 'GET',
					headers: { authorization: `Bearer ${origToken}` }
				}),
				testEnv
			)
		);
		expect(res2.status).toBe(401);

		// Second call with the NEW token: MUST 200 and again rotate.
		const res3 = await sessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', {
					method: 'GET',
					headers: { authorization: `Bearer ${next1}` }
				}),
				testEnv
			)
		);
		expect(res3.status).toBe(200);
		const next3 = res3.headers.get('next-token');
		expect(next3).toMatch(/^[0-9a-f]{64}$/);
		expect(next3).not.toBe(next1);
		expect(next3).not.toBe(origToken);
	});
});
