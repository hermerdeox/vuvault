/**
 * Unit tests for `auth-token.ts` — focus on `rotateToken` atomicity
 * and the V1-C2/V1-C3 invariant that the `Session` type no longer
 * carries `deviceId` or `sequenceClock`. Sister coverage lives in
 * `tests/integration/api-routes.spec.ts` (route-level behavior of
 * `/api/v2/sessions/self`).
 */

import { describe, expect, it } from 'vitest';
import { authenticate, rotateToken } from './auth-token';
import type { D1Database } from './d1-storage';

type Row = Record<string, unknown>;

class FakeD1 {
	sessions = new Map<string, Row>();
	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		const firstFn = <T>(args: unknown[]) => this.firstImpl<T>(sql, args);
		const runFn = (args: unknown[]) => this.runImpl(sql, args);
		return {
			_sql: sql,
			_args: [] as unknown[],
			bind(...a: unknown[]) {
				this._args = a;
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
	async batch(statements: Array<{ _sql: string; _args: unknown[] }>) {
		const out = [];
		for (const s of statements) {
			out.push({ success: true, meta: { changes: this.runImpl(s._sql, s._args) } });
		}
		return out;
	}
	private firstImpl<T>(sql: string, args: unknown[]): T | null {
		// V1-C3: authenticate() reads sessions ONLY — no JOIN on accounts
		// for a sequence_clock high-water mark anymore.
		if (sql.startsWith('SELECT token, account_id, expires_at FROM sessions')) {
			const s = this.sessions.get(args[0] as string);
			if (!s) return null;
			return {
				token: s.token,
				account_id: s.account_id,
				expires_at: s.expires_at
			} as T;
		}
		return null;
	}
	private runImpl(sql: string, args: unknown[]): number {
		if (sql.startsWith('INSERT INTO sessions')) {
			this.sessions.set(args[0] as string, {
				token: args[0],
				account_id: args[1],
				expires_at: args[2]
			});
			return 1;
		}
		if (sql.startsWith('DELETE FROM sessions')) {
			return this.sessions.delete(args[0] as string) ? 1 : 0;
		}
		return 0;
	}
}

function seed(db: FakeD1, token: string): void {
	db.sessions.set(token, {
		token,
		account_id: 'acct-1',
		expires_at: Math.floor((Date.now() + 60_000) / 1000)
	});
}

describe('auth-token', () => {
	it('Session carries no deviceId or sequenceClock (V1-C2/V1-C3 type-level invariant)', async () => {
		const db = new FakeD1();
		seed(db, 'a'.repeat(64));
		const session = await authenticate(db as unknown as D1Database, `Bearer ${'a'.repeat(64)}`);
		expect(session).not.toBeNull();
		expect(session).toEqual({
			token: 'a'.repeat(64),
			accountId: 'acct-1',
			expiresAt: expect.any(Number)
		});
		// Explicit: neither correlating field may be present, even as undefined.
		expect(Object.keys(session!)).not.toContain('deviceId');
		expect(Object.keys(session!)).not.toContain('sequenceClock');
	});

	it('rotateToken atomically retires the old token and mints a new one', async () => {
		const db = new FakeD1();
		const oldToken = 'a'.repeat(64);
		seed(db, oldToken);
		const result = await rotateToken(db as unknown as D1Database, oldToken);
		expect(result).not.toBeNull();
		expect(result!.newToken).toMatch(/^[0-9a-f]{64}$/);
		expect(result!.newToken).not.toBe(oldToken);
		expect(result!.expiresAt).toBeGreaterThan(Date.now());
		// Old retired, new present.
		expect(db.sessions.has(oldToken)).toBe(false);
		expect(db.sessions.has(result!.newToken)).toBe(true);
	});

	it('rotateToken returns null for unknown tokens', async () => {
		const db = new FakeD1();
		seed(db, 'a'.repeat(64));
		const result = await rotateToken(db as unknown as D1Database, 'b'.repeat(64));
		expect(result).toBeNull();
		// State unchanged.
		expect(db.sessions.has('a'.repeat(64))).toBe(true);
		expect(db.sessions.size).toBe(1);
	});

	it('rotateToken returns null for expired tokens (and does not mint)', async () => {
		const db = new FakeD1();
		const expired = 'c'.repeat(64);
		db.sessions.set(expired, {
			token: expired,
			account_id: 'acct-1',
			expires_at: Math.floor((Date.now() - 60_000) / 1000)
		});
		const result = await rotateToken(db as unknown as D1Database, expired);
		expect(result).toBeNull();
		// The expired row stays — rotateToken does not garbage-collect.
		// Cleanup is opportunistic (see src/lib/server/api/cleanup.ts).
		expect(db.sessions.size).toBe(1);
	});

	it('newToken format is strict hex (header-injection safe)', async () => {
		// The Next-Token response header carries the rotated token
		// verbatim. If the token format ever drifted to include CR,
		// LF, or other control characters, an attacker could break
		// out of the header into the response body or inject
		// additional headers. We assert the token shape is exactly
		// 64 chars of [0-9a-f] — the same shape SubtleCrypto's
		// randomUUID/getRandomValues + toString(16) produces. The
		// authenticate() regex also accepts [0-9a-fA-F]{64}; both
		// must stay aligned.
		const db = new FakeD1();
		const oldToken = 'a'.repeat(64);
		seed(db, oldToken);
		for (let i = 0; i < 16; i++) {
			const rotated = await rotateToken(db as unknown as D1Database, oldToken);
			if (!rotated) {
				throw new Error('rotateToken returned null mid-loop');
			}
			expect(rotated.newToken).toMatch(/^[0-9a-f]{64}$/);
			// eslint-disable-next-line no-control-regex -- intentional: assert absence of control chars
			expect(rotated.newToken).not.toMatch(/[\x00-\x1f\x7f]/);
			expect(rotated.newToken).not.toContain('\n');
			expect(rotated.newToken).not.toContain('\r');
			// Re-seed for the next iteration.
			db.sessions.clear();
			seed(db, oldToken);
		}
	});
});
