/**
 * Unit tests for the opportunistic D1 cleanup sweep.
 *
 * Exercises `sweepNow()` (the deterministic entry) against a small
 * in-memory D1 mock that captures the prepared-statement contract
 * for the four DELETE queries cleanup emits. `maybeSweep()` is the
 * sampled wrapper; we don't unit-test the Math.random() coin flip
 * here, only that the deterministic path performs the expected
 * deletes and survives D1 errors.
 */

import { describe, expect, it } from 'vitest';
import { sweepNow } from './cleanup';
import type { D1Database } from './d1-storage';

type Row = Record<string, unknown>;

class FakeD1 {
	pendingRegs = new Map<string, Row>();
	pendingLogins = new Map<string, Row>();
	sessions = new Map<string, Row>();
	rateLimits = new Map<string, Row>();
	failTable: 'none' | 'pending_registrations' | 'pending_logins' | 'sessions' | 'rate_limits' =
		'none';

	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		const runFn = (args: unknown[]) => this.runImpl(sql, args);
		return {
			_args: [] as unknown[],
			bind(...args: unknown[]) {
				this._args = args;
				return this;
			},
			async first<T = unknown>(): Promise<T | null> {
				return null as T | null;
			},
			async run() {
				const changes = runFn(this._args);
				return { success: true, meta: { changes } };
			}
		};
	}

	private runImpl(sql: string, args: unknown[]): number {
		const cutoff = args[0] as number;
		const limit = args[1] as number;
		if (sql.includes('FROM pending_registrations WHERE created_at')) {
			if (this.failTable === 'pending_registrations') {
				throw new Error('D1 unavailable');
			}
			return this.expire(this.pendingRegs, 'created_at', cutoff, limit);
		}
		if (sql.includes('FROM pending_logins WHERE created_at')) {
			if (this.failTable === 'pending_logins') {
				throw new Error('D1 unavailable');
			}
			return this.expire(this.pendingLogins, 'created_at', cutoff, limit);
		}
		if (sql.includes('FROM sessions WHERE expires_at')) {
			if (this.failTable === 'sessions') {
				throw new Error('D1 unavailable');
			}
			return this.expire(this.sessions, 'expires_at', cutoff, limit);
		}
		if (sql.includes('FROM rate_limits WHERE window_start')) {
			if (this.failTable === 'rate_limits') {
				throw new Error('D1 unavailable');
			}
			return this.expire(this.rateLimits, 'window_start', cutoff, limit);
		}
		return 0;
	}

	private expire(
		store: Map<string, Row>,
		field: string,
		cutoff: number,
		limit: number
	): number {
		let deleted = 0;
		for (const [key, row] of store) {
			if (deleted >= limit) break;
			if ((row[field] as number) < cutoff) {
				store.delete(key);
				deleted += 1;
			}
		}
		return deleted;
	}
}

function asDb(fake: FakeD1): D1Database {
	return fake as unknown as D1Database;
}

describe('cleanup · sweepNow', () => {
	it('deletes expired pending registrations, pending logins, sessions, and rate-limit windows', async () => {
		const db = new FakeD1();
		const now = Math.floor(Date.now() / 1000);

		// 30-second pending TTL. Anything older than 30s is expired.
		db.pendingRegs.set('old-reg', { request_id: 'r1', created_at: now - 120 });
		db.pendingRegs.set('fresh-reg', { request_id: 'r2', created_at: now });
		db.pendingLogins.set('old-login', { request_id: 'l1', created_at: now - 120 });
		db.pendingLogins.set('fresh-login', { request_id: 'l2', created_at: now });
		// Sessions store wall-clock expires_at. Past = expired.
		db.sessions.set('expired-session', { token: 's1', expires_at: now - 10 });
		db.sessions.set('live-session', { token: 's2', expires_at: now + 3600 });
		// Rate-limit rows older than ~window+grace are dead.
		db.rateLimits.set('old-window', { bucket: 'r:x', window_start: now - 600 });
		db.rateLimits.set('current-window', { bucket: 'r:x', window_start: now });

		const result = await sweepNow(asDb(db));

		expect(result.pendingRegistrations).toBe(1);
		expect(result.pendingLogins).toBe(1);
		expect(result.sessions).toBe(1);
		expect(result.rateLimits).toBe(1);

		expect(db.pendingRegs.has('old-reg')).toBe(false);
		expect(db.pendingRegs.has('fresh-reg')).toBe(true);
		expect(db.pendingLogins.has('old-login')).toBe(false);
		expect(db.pendingLogins.has('fresh-login')).toBe(true);
		expect(db.sessions.has('expired-session')).toBe(false);
		expect(db.sessions.has('live-session')).toBe(true);
		expect(db.rateLimits.has('old-window')).toBe(false);
		expect(db.rateLimits.has('current-window')).toBe(true);
	});

	it('survives partial D1 failure and still cleans the other tables', async () => {
		const db = new FakeD1();
		const now = Math.floor(Date.now() / 1000);
		db.pendingRegs.set('old-reg', { request_id: 'r1', created_at: now - 120 });
		db.sessions.set('expired-session', { token: 's1', expires_at: now - 10 });
		db.failTable = 'pending_registrations';

		const result = await sweepNow(asDb(db));

		// Failed table returns 0 deletes; other tables still drained.
		expect(result.pendingRegistrations).toBe(0);
		expect(result.sessions).toBe(1);
		expect(db.pendingRegs.has('old-reg')).toBe(true);
		expect(db.sessions.has('expired-session')).toBe(false);
	});

	it('is a no-op when there is nothing expired to delete', async () => {
		const db = new FakeD1();
		const result = await sweepNow(asDb(db));
		expect(result.pendingRegistrations).toBe(0);
		expect(result.pendingLogins).toBe(0);
		expect(result.sessions).toBe(0);
		expect(result.rateLimits).toBe(0);
	});
});
