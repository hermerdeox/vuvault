/**
 * Unit tests for `auth-token.ts` — focus on `rotateToken` atomicity
 * and the V1-C2 invariant that the `Session` type no longer carries
 * `deviceId`. Sister coverage lives in
 * `tests/integration/api-routes.spec.ts` (route-level behavior of
 * `/api/v2/sessions/self`).
 */

import { describe, expect, it } from 'vitest';
import { authenticate, rotateToken, advanceSequenceClock } from './auth-token';
import type { D1Database } from './d1-storage';

type Row = Record<string, unknown>;

class FakeD1 {
	sessions = new Map<string, Row>();
	accounts = new Map<string, Row>();
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
		if (sql.includes('FROM sessions s JOIN accounts a')) {
			const s = this.sessions.get(args[0] as string);
			if (!s) return null;
			const a = this.accounts.get(s.account_id as string);
			return {
				token: s.token,
				account_id: s.account_id,
				expires_at: s.expires_at,
				sequence_clock: Math.max(
					Number(s.sequence_clock ?? 0),
					Number(a?.sequence_clock ?? 0)
				)
			} as T;
		}
		return null;
	}
	private runImpl(sql: string, args: unknown[]): number {
		if (sql.startsWith('INSERT INTO sessions')) {
			this.sessions.set(args[0] as string, {
				token: args[0],
				account_id: args[1],
				expires_at: args[2],
				sequence_clock: args[3]
			});
			return 1;
		}
		if (sql.startsWith('DELETE FROM sessions')) {
			return this.sessions.delete(args[0] as string) ? 1 : 0;
		}
		if (sql.startsWith('UPDATE accounts SET sequence_clock')) {
			const token = args[1] as string;
			const newClock = Number(args[0]);
			const session = this.sessions.get(token);
			if (!session) return 0;
			const account = this.accounts.get(session.account_id as string);
			if (!account || Number(account.sequence_clock ?? 0) >= newClock) return 0;
			account.sequence_clock = newClock;
			return 1;
		}
		if (sql.startsWith('UPDATE sessions SET sequence_clock')) {
			const s = this.sessions.get(args[1] as string);
			if (s) s.sequence_clock = Math.max(Number(s.sequence_clock ?? 0), Number(args[0]));
			return s ? 1 : 0;
		}
		return 0;
	}
}

function seed(db: FakeD1, token: string, clock = 0): void {
	db.accounts.set('acct-1', { account_id: 'acct-1', sequence_clock: clock });
	db.sessions.set(token, {
		token,
		account_id: 'acct-1',
		expires_at: Math.floor((Date.now() + 60_000) / 1000),
		sequence_clock: clock
	});
}

describe('auth-token', () => {
	it('Session has no deviceId field (V1-C2 type-level invariant)', async () => {
		const db = new FakeD1();
		seed(db, 'a'.repeat(64), 7);
		const session = await authenticate(db as unknown as D1Database, `Bearer ${'a'.repeat(64)}`);
		expect(session).not.toBeNull();
		expect(session).toEqual({
			token: 'a'.repeat(64),
			accountId: 'acct-1',
			expiresAt: expect.any(Number),
			sequenceClock: 7
		});
		// Explicit: deviceId MUST NOT be present, even as undefined.
		expect(Object.keys(session!)).not.toContain('deviceId');
	});

	it('rotateToken atomically retires the old token and mints a new one', async () => {
		const db = new FakeD1();
		const oldToken = 'a'.repeat(64);
		seed(db, oldToken, 3);
		const result = await rotateToken(db as unknown as D1Database, oldToken);
		expect(result).not.toBeNull();
		expect(result!.newToken).toMatch(/^[0-9a-f]{64}$/);
		expect(result!.newToken).not.toBe(oldToken);
		expect(result!.sequenceClock).toBe(3);
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
		db.accounts.set('acct-1', { account_id: 'acct-1', sequence_clock: 0 });
		db.sessions.set(expired, {
			token: expired,
			account_id: 'acct-1',
			expires_at: Math.floor((Date.now() - 60_000) / 1000),
			sequence_clock: 0
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
		seed(db, oldToken, 0);
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
			seed(db, oldToken, 0);
		}
	});

	it('rotated tokens preserve sequence_clock continuity', async () => {
		const db = new FakeD1();
		const t = 'a'.repeat(64);
		seed(db, t, 11);
		// Advance via the normal API.
		await advanceSequenceClock(db as unknown as D1Database, t, 17);
		const rotated = await rotateToken(db as unknown as D1Database, t);
		expect(rotated!.sequenceClock).toBe(17);
		// The new session row carries the advanced clock.
		const reauth = await authenticate(
			db as unknown as D1Database,
			`Bearer ${rotated!.newToken}`
		);
		expect(reauth!.sequenceClock).toBe(17);
	});
});
