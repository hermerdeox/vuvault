/**
 * Integration tests for V0-C1 anonymous request tokens
 * (`src/lib/server/api/anon-tokens.ts`):
 *
 *   - `POST /api/v0/tokens/issue` blind-evaluates a batch for a
 *     Bearer-authenticated session and stores nothing that ties the
 *     issuance to the session or account.
 *   - `GET /api/v0/tokens/key` serves the key the issuance signs with.
 *   - A token minted through the route redeems exactly once.
 *   - `/api/v2/sessions/self` stays Bearer-only (it rotates the session
 *     token) and no longer accepts the removed capability header.
 *
 * Redemption on the blob / inventory routes is covered in
 * `v2-blobs.spec.ts`. Mirrors the api-routes.spec.ts harness style.
 */

import { describe, expect, it } from 'vitest';
import { POST as tokensIssue } from '../../src/routes/api/v0/tokens/issue/+server';
import { GET as tokensKey } from '../../src/routes/api/v0/tokens/key/+server';
import { GET as v2SessionsSelf } from '../../src/routes/api/v2/sessions/self/+server';
import { redeemToken, TOKEN_MAX_BATCH } from '../../src/lib/server/api/anon-tokens';
import { blind, finalize } from '../../src/lib/crypto/voprf';
import type { Env } from '../../src/lib/server/api/env';

type Row = Record<string, unknown>;

class FakeD1 {
	sessions = new Map<string, Row>();
	rateLimits = new Map<string, number>();
	spentTokens = new Map<string, { key_id: number }>();

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
				return { success: true, meta: { changes: runFn(this._args) } };
			},
			async all<T = unknown>() {
				return { results: [] as T[], success: true };
			}
		};
	}

	private firstImpl<T>(sql: string, args: unknown[]): T | null {
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
			const key = `${args[0] as string}:${args[1] as number}`;
			return { count: this.rateLimits.get(key) ?? 0 } as T;
		}
		return null;
	}

	private runImpl(sql: string, args: unknown[]): number {
		if (sql.startsWith('INSERT INTO rate_limits')) {
			const key = `${args[0] as string}:${args[1] as number}`;
			this.rateLimits.set(key, (this.rateLimits.get(key) ?? 0) + 1);
			return 1;
		}
		if (sql.startsWith('INSERT INTO anon_tokens_spent')) {
			const hash = args[0] as string;
			if (this.spentTokens.has(hash)) return 0;
			this.spentTokens.set(hash, { key_id: Number(args[1]) });
			return 1;
		}
		return 0;
	}
}

const SESSION = 'c'.repeat(64);

function env(opts: { signingKey?: boolean } = {}): Env {
	const db = new FakeD1();
	db.sessions.set(SESSION, {
		token: SESSION,
		account_id: 'acct-A',
		expires_at: Math.floor((Date.now() + 60_000) / 1000)
	});
	return {
		AUTH_DB: db,
		VAULT_BLOBS: {},
		OPAQUE_RATE_LIMIT_MODE: 'fail-open',
		...(opts.signingKey === false ? {} : { AKD_SIGNING_KEY_HEX: '22'.repeat(32) })
	} as unknown as Env;
}

function event(request: Request, e: Env) {
	return {
		request,
		platform: { env: e, context: { waitUntil() {} }, caches: {} as CacheStorage & { default: Cache } },
		params: {},
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

function b64(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes));
}

function unb64(text: string): Uint8Array {
	return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function issue(e: Env, blinded: string[], auth: string | null = SESSION) {
	return tokensIssue(
		event(
			new Request('http://localhost/api/v0/tokens/issue', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(auth ? { authorization: `Bearer ${auth}` } : {})
				},
				body: JSON.stringify({ blinded })
			}),
			e
		)
	);
}

type IssueBody = {
	ok: boolean;
	data: { keyId: number; publicKey: string; evaluated: string[]; proofs: string[] };
};

describe('V0-C1 · POST /api/v0/tokens/issue', () => {
	it('requires a Bearer session', async () => {
		const res = await issue(env(), [b64(blind(new Uint8Array(32)).blindedElement)], null);
		expect(res.status).toBe(401);
	});

	it('mints tokens that verify client-side and redeem exactly once', async () => {
		const e = env();
		const inputs = Array.from({ length: 4 }, () => crypto.getRandomValues(new Uint8Array(32)));
		const blinds = inputs.map((i) => blind(i));
		const res = await issue(e, blinds.map((b) => b64(b.blindedElement)));
		expect(res.status).toBe(200);
		const body = (await res.json()) as IssueBody;
		expect(body.data.evaluated).toHaveLength(4);
		expect(body.data.proofs).toHaveLength(4);

		const pk = unb64(body.data.publicKey);
		for (let i = 0; i < 4; i++) {
			const output = finalize(
				inputs[i]!,
				blinds[i]!.blind,
				unb64(body.data.evaluated[i]!),
				unb64(body.data.proofs[i]!),
				pk
			);
			expect(output).not.toBeNull();
			const header = `v1.${body.data.keyId}.${b64(inputs[i]!)}.${b64(output!)}`;
			expect(await redeemToken(e, header)).toBe(true);
			expect(await redeemToken(e, header)).toBe(false);
		}
	});

	it('stores nothing that ties the issuance to the session or account', async () => {
		const e = env();
		const db = e.AUTH_DB as unknown as FakeD1;
		await issue(e, [b64(blind(new Uint8Array(32).fill(7)).blindedElement)]);
		// Issuance writes no token rows at all — only the session-scoped
		// rate-limit window every authenticated route keeps, keyed by a
		// hash of the session token, never the account id.
		expect(db.spentTokens.size).toBe(0);
		for (const key of db.rateLimits.keys()) {
			expect(key).not.toContain('acct-A');
			expect(key).not.toContain(SESSION);
		}
	});

	it('rejects empty, oversized, and malformed batches', async () => {
		const e = env();
		const one = b64(blind(new Uint8Array(32)).blindedElement);
		expect((await issue(e, [])).status).toBe(400);
		expect((await issue(e, Array(TOKEN_MAX_BATCH + 1).fill(one))).status).toBe(400);
		expect((await issue(e, [b64(new Uint8Array(31))])).status).toBe(400);
		// 32 bytes that do not decode to a ristretto255 point.
		expect((await issue(e, [b64(new Uint8Array(32).fill(0xff))])).status).toBe(400);
	});

	it('answers 503 when the token key root is not configured', async () => {
		const res = await issue(env({ signingKey: false }), [
			b64(blind(new Uint8Array(32)).blindedElement)
		]);
		expect(res.status).toBe(503);
	});
});

describe('V0-C1 · GET /api/v0/tokens/key', () => {
	it('serves the key the issuance signs with, without auth', async () => {
		const e = env();
		const keyRes = await tokensKey(event(new Request('http://localhost/api/v0/tokens/key'), e));
		expect(keyRes.status).toBe(200);
		const key = (await keyRes.json()) as { data: { keyId: number; publicKey: string } };
		const issued = (await (
			await issue(e, [b64(blind(new Uint8Array(32)).blindedElement)])
		).json()) as IssueBody;
		expect(key.data).toEqual({ keyId: issued.data.keyId, publicKey: issued.data.publicKey });
	});

	it('answers 503 when the token key root is not configured', async () => {
		const res = await tokensKey(
			event(new Request('http://localhost/api/v0/tokens/key'), env({ signingKey: false }))
		);
		expect(res.status).toBe(503);
	});
});

describe('/api/v2/sessions/self stays Bearer-only', () => {
	it('rejects the removed capability header', async () => {
		const res = await v2SessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', {
					headers: { 'x-vu0-capability': `1:${'a'.repeat(64)}` }
				}),
				env()
			)
		);
		expect(res.status).toBe(401);
	});

	it('still introspects a Bearer session', async () => {
		const res = await v2SessionsSelf(
			event(
				new Request('http://localhost/api/v2/sessions/self', {
					headers: { authorization: `Bearer ${SESSION}` }
				}),
				env()
			)
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});
});
