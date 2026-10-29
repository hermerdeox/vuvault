/**
 * Integration tests for `/api/v2/restore/<addr>` (new-device restore).
 *
 *   - PUT and DELETE spend an anonymous token (401 without one), like
 *     every other v2 object; the R2 key is the account-free
 *     `v2/restore/<addr>.bin` and D1 tracks only (addr, last_seen_at).
 *   - GET is deliberately unauthenticated: a restoring device has no
 *     session yet. It is rate-limited per IP and answers 404 for an
 *     unknown address — never 401.
 *   - the reference GC reaps stale records under the same prefix.
 */

import { describe, expect, it } from 'vitest';
import {
	PUT as restorePut,
	GET as restoreGet,
	DELETE as restoreDelete
} from '../../src/routes/api/v2/restore/[addr]/+server';
import { gcV2Now } from '../../src/lib/server/api/r2-gc';
import { issueTokens } from '../../src/lib/server/api/anon-tokens';
import { blind, finalize } from '../../src/lib/crypto/voprf';
import type { Env, R2Object } from '../../src/lib/server/api/env';

class FakeD1 {
	restoreRefs = new Map<string, { last_seen_at: number; bytes: number }>();
	spentTokens = new Set<string>();
	rateLimits = new Map<string, number>();

	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		const rateLimits = this.rateLimits;
		const restoreRefs = this.restoreRefs;
		const runImpl = (args: unknown[]) => this.run(sql, args);
		return {
			_sql: sql,
			_args: [] as unknown[],
			bind(...args: unknown[]) {
				this._args = args;
				return this;
			},
			async first<T = unknown>(): Promise<T | null> {
				if (sql.startsWith('SELECT count FROM rate_limits')) {
					const key = `${this._args[0] as string}:${this._args[1] as number}`;
					return { count: rateLimits.get(key) ?? 0 } as T;
				}
				return null;
			},
			async run() {
				return { success: true, meta: { changes: runImpl(this._args) } };
			},
			async all<T = unknown>(): Promise<{ results: T[]; success: boolean }> {
				if (sql.startsWith('SELECT addr FROM restore_references')) {
					const cutoff = Number(this._args[0]);
					const results = [...restoreRefs.entries()]
						.filter(([, row]) => row.last_seen_at < cutoff)
						.map(([addr]) => ({ addr }) as unknown as T);
					return { results, success: true };
				}
				return { results: [], success: true };
			}
		};
	}

	run(sql: string, args: unknown[]): number {
		if (sql.startsWith('INSERT INTO restore_references')) {
			this.restoreRefs.set(args[0] as string, {
				last_seen_at: Math.floor(Date.now() / 1000),
				bytes: Number(args[1] ?? 0)
			});
			return 1;
		}
		if (sql.startsWith('DELETE FROM restore_references')) {
			return this.restoreRefs.delete(args[0] as string) ? 1 : 0;
		}
		if (sql.startsWith('INSERT INTO anon_tokens_spent')) {
			const hash = args[0] as string;
			if (this.spentTokens.has(hash)) return 0;
			this.spentTokens.add(hash);
			return 1;
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
				return o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength);
			}
		};
	}
	async put(key: string, value: ArrayBuffer | Uint8Array, options?: { customMetadata?: Record<string, string> }) {
		const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
		const stored = { bytes, uploaded: new Date(), customMetadata: options?.customMetadata };
		this.objects.set(key, stored);
		return (await this.get(key))!;
	}
	async delete(key: string) {
		this.objects.delete(key);
	}
	async list() {
		return { objects: [], truncated: false };
	}
}

function env(): Env {
	return {
		AUTH_DB: new FakeD1(),
		VAULT_BLOBS: new MemoryR2(),
		OPAQUE_RATE_LIMIT_MODE: 'fail-open',
		AKD_SIGNING_KEY_HEX: '22'.repeat(32)
	} as unknown as Env;
}

function b64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function anonToken(e: Env): { 'x-vu0-token': string } {
	const input = crypto.getRandomValues(new Uint8Array(32));
	const b = blind(input);
	const issued = issueTokens(e, [b.blindedElement])!;
	const output = finalize(input, b.blind, issued.evaluated[0]!, issued.proofs[0]!, issued.publicKey);
	expect(output).not.toBeNull();
	return { 'x-vu0-token': `v1.${issued.keyId}.${b64(input)}.${b64(output!)}` };
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

const ADDR = 'abcdefghjkmnpqrstvwxyz0123';
const OTHER = 'zyxwvtsrqpnmkjhgfedcba9876';

function put(e: Env, addr: string, headers: Record<string, string>) {
	return restorePut(
		event(
			new Request(`http://localhost/api/v2/restore/${addr}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json', ...headers },
				body: JSON.stringify({ nonce: b64(new Uint8Array(12).fill(1)), ciphertext: b64(new Uint8Array(64).fill(2)) })
			}),
			e,
			{ addr }
		)
	);
}

function get(e: Env, addr: string, headers: Record<string, string> = {}) {
	return restoreGet(
		event(
			new Request(`http://localhost/api/v2/restore/${addr}`, {
				method: 'GET',
				headers: { 'cf-connecting-ip': '203.0.113.9', ...headers }
			}),
			e,
			{ addr }
		)
	);
}

describe('/api/v2/restore · write side', () => {
	it('PUT requires an anonymous token and stores under the account-free prefix', async () => {
		const e = env();
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		const db = e.AUTH_DB as unknown as FakeD1;

		expect((await put(e, ADDR, {})).status).toBe(401);
		expect((await put(e, ADDR, { authorization: 'Bearer ' + 'a'.repeat(64) })).status).toBe(401);
		expect((await put(e, ADDR, anonToken(e))).status).toBe(200);

		expect([...r2.objects.keys()]).toEqual([`v2/restore/${ADDR}.bin`]);
		expect(r2.objects.get(`v2/restore/${ADDR}.bin`)!.customMetadata).toEqual({ kind: 'v2-restore' });
		expect(db.restoreRefs.has(ADDR)).toBe(true);
		for (const row of db.restoreRefs.values()) {
			expect(row).not.toHaveProperty('account_id');
		}
	});

	it('refuses a malformed address and an oversized body', async () => {
		const e = env();
		expect((await put(e, 'not-an-address', anonToken(e))).status).toBe(400);
		const huge = restorePut(
			event(
				new Request(`http://localhost/api/v2/restore/${ADDR}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/json', ...anonToken(e) },
					body: JSON.stringify({ nonce: 'AAAA', ciphertext: 'A'.repeat(40_000) })
				}),
				e,
				{ addr: ADDR }
			)
		);
		expect((await huge).status).toBe(400);
	});

	it('DELETE requires a token and drops both the object and the reference', async () => {
		const e = env();
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		const db = e.AUTH_DB as unknown as FakeD1;
		await put(e, ADDR, anonToken(e));

		const unauth = await restoreDelete(
			event(new Request(`http://localhost/api/v2/restore/${ADDR}`, { method: 'DELETE' }), e, { addr: ADDR })
		);
		expect(unauth.status).toBe(401);
		expect(r2.objects.size).toBe(1);

		const ok = await restoreDelete(
			event(
				new Request(`http://localhost/api/v2/restore/${ADDR}`, { method: 'DELETE', headers: anonToken(e) }),
				e,
				{ addr: ADDR }
			)
		);
		expect(ok.status).toBe(200);
		expect(r2.objects.size).toBe(0);
		expect(db.restoreRefs.has(ADDR)).toBe(false);
	});
});

describe('/api/v2/restore · read side (pre-session)', () => {
	it('GET needs no credential, returns the stored record, and 404s for an unknown address', async () => {
		const e = env();
		await put(e, ADDR, anonToken(e));

		const hit = await get(e, ADDR);
		expect(hit.status).toBe(200);
		const body = (await hit.json()) as { ok: boolean; data: { addr: string; nonce: string; ciphertext: string } };
		expect(body.ok).toBe(true);
		expect(body.data.addr).toBe(ADDR);
		expect(body.data.nonce).toBe(b64(new Uint8Array(12).fill(1)));
		expect(body.data.ciphertext).toBe(b64(new Uint8Array(64).fill(2)));

		const miss = await get(e, OTHER);
		expect(miss.status).toBe(404);
		const missBody = (await miss.json()) as { error: string };
		expect(missBody.error).toBe('no restore record');
	});

	it('GET refreshes the reference (heartbeat-by-read) so a live record is never reaped', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		await put(e, ADDR, anonToken(e));
		// Age the reference far past the 60-day window, then read it.
		db.restoreRefs.set(ADDR, { last_seen_at: 1, bytes: 10 });
		expect((await get(e, ADDR)).status).toBe(200);
		expect(db.restoreRefs.get(ADDR)!.last_seen_at).toBeGreaterThan(1);

		const swept = await gcV2Now(e);
		expect(swept.v2RestoreDeleted).toBe(0);
		expect(r2.objects.size).toBe(1);
	});

	it('GET is rate-limited by network origin', async () => {
		const e = env();
		let last = 200;
		for (let i = 0; i < 130; i++) {
			last = (await get(e, OTHER)).status;
			if (last === 429) break;
		}
		expect(last).toBe(429);
	});

	it('rejects a malformed address before touching storage', async () => {
		const e = env();
		expect((await get(e, 'short')).status).toBe(400);
	});
});

describe('/api/v2/restore · GC', () => {
	it('reaps a stale record from R2 and D1 under the v2/restore prefix', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		const r2 = e.VAULT_BLOBS as unknown as MemoryR2;
		await put(e, ADDR, anonToken(e));
		await put(e, OTHER, anonToken(e));
		db.restoreRefs.set(ADDR, { last_seen_at: 1, bytes: 10 });

		const swept = await gcV2Now(e);
		expect(swept.v2RestoreDeleted).toBe(1);
		expect([...r2.objects.keys()]).toEqual([`v2/restore/${OTHER}.bin`]);
		expect(db.restoreRefs.has(ADDR)).toBe(false);
	});
});
