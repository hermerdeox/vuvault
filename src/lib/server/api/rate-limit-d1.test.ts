/**
 * Unit tests for the D1-backed sliding-window rate limiter, with
 * particular focus on the fail-open / fail-closed mode toggle that
 * `OPAQUE_RATE_LIMIT_MODE` controls.
 *
 * The pre-fix code path always returned 503 on D1 errors regardless
 * of mode. These tests lock down the contract that:
 *
 *   - Fail-closed (production default): D1 error -> 503.
 *   - Fail-open (preview / local-dev): D1 error -> { ok: true }.
 *   - Either mode: under quota -> ok, over quota -> 429.
 *
 * Mode resolution is also tested at the env layer to ensure that a
 * missing / malformed env var defaults to fail-closed (the safer
 * choice).
 */

import { describe, expect, it } from 'vitest';
import {
	applyRateLimit,
	applyRateLimitWithDb,
	RATE_LIMITS
} from './rate-limit-d1';
import { getRateLimitMode, type Env } from './env';
import type { D1Database } from './d1-storage';

class FakeD1 {
	rateLimits = new Map<string, number>();
	throwOnInsert = false;
	throwOnSelect = false;

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
		if (this.throwOnSelect) throw new Error('D1 unavailable');
		if (sql.startsWith('SELECT count FROM rate_limits')) {
			const key = `${args[0] as string}:${args[1] as number}`;
			return { count: this.rateLimits.get(key) ?? 0 } as T;
		}
		return null;
	}

	private runImpl(sql: string, args: unknown[]): number {
		if (this.throwOnInsert) throw new Error('D1 unavailable');
		if (sql.startsWith('INSERT INTO rate_limits')) {
			const key = `${args[0] as string}:${args[1] as number}`;
			this.rateLimits.set(key, (this.rateLimits.get(key) ?? 0) + 1);
			return 1;
		}
		return 0;
	}
}

function asDb(fake: FakeD1): D1Database {
	return fake as unknown as D1Database;
}

function envWith(
	db: FakeD1,
	mode?: 'fail-open' | 'fail-closed' | string
): Env {
	return {
		AUTH_DB: asDb(db),
		VAULT_BLOBS: {} as Env['VAULT_BLOBS'],
		OPAQUE_RATE_LIMIT_MODE: mode as 'fail-open' | 'fail-closed' | undefined
	};
}

describe('rate-limit-d1 · applyRateLimit', () => {
	it('allows requests under the configured limit', async () => {
		const db = new FakeD1();
		const result = await applyRateLimit(envWith(db), RATE_LIMITS.OPAQUE_LOGIN, 'ip:1.1.1.1');
		expect(result.ok).toBe(true);
	});

	it('returns 429 once the request count exceeds the configured limit', async () => {
		const db = new FakeD1();
		// OPAQUE_REGISTER allows 10 per 60s. Hammer it.
		for (let i = 0; i < 10; i++) {
			const r = await applyRateLimit(envWith(db), RATE_LIMITS.OPAQUE_REGISTER, 'ip:abuser');
			expect(r.ok).toBe(true);
		}
		const breaker = await applyRateLimit(envWith(db), RATE_LIMITS.OPAQUE_REGISTER, 'ip:abuser');
		expect(breaker.ok).toBe(false);
		if (!breaker.ok) {
			expect(breaker.status).toBe(429);
			expect(breaker.message).toMatch(/rate limit/i);
		}
	});

	it('fails closed (503) when D1 errors and mode is unset', async () => {
		const db = new FakeD1();
		db.throwOnInsert = true;
		const result = await applyRateLimit(envWith(db), RATE_LIMITS.BLOB, 'account:a');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(503);
		}
	});

	it('fails closed (503) when D1 errors and mode is explicitly fail-closed', async () => {
		const db = new FakeD1();
		db.throwOnInsert = true;
		const result = await applyRateLimit(
			envWith(db, 'fail-closed'),
			RATE_LIMITS.BLOB,
			'account:a'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(503);
		}
	});

	it('fails open ({ ok: true }) when D1 errors and mode is fail-open', async () => {
		const db = new FakeD1();
		db.throwOnInsert = true;
		const result = await applyRateLimit(
			envWith(db, 'fail-open'),
			RATE_LIMITS.BLOB,
			'account:a'
		);
		expect(result.ok).toBe(true);
	});

	it('treats unknown mode values as fail-closed (safer default)', async () => {
		const db = new FakeD1();
		db.throwOnInsert = true;
		const result = await applyRateLimit(
			envWith(db, 'maybe-open'),
			RATE_LIMITS.BLOB,
			'account:a'
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(503);
		}
	});
});

describe('rate-limit-d1 · applyRateLimitWithDb (low-level)', () => {
	it('respects an explicitly-passed mode regardless of env', async () => {
		const db = new FakeD1();
		db.throwOnInsert = true;
		const result = await applyRateLimitWithDb(
			asDb(db),
			RATE_LIMITS.BLOB,
			'account:a',
			'fail-open'
		);
		expect(result.ok).toBe(true);
	});
});

describe('env · getRateLimitMode', () => {
	it('returns fail-closed when the env var is missing', () => {
		expect(getRateLimitMode({} as Env)).toBe('fail-closed');
	});

	it('returns fail-open when the env var is exactly "fail-open"', () => {
		expect(getRateLimitMode({ OPAQUE_RATE_LIMIT_MODE: 'fail-open' } as Env)).toBe('fail-open');
	});

	it('returns fail-closed when the env var is "fail-closed"', () => {
		expect(
			getRateLimitMode({ OPAQUE_RATE_LIMIT_MODE: 'fail-closed' } as Env)
		).toBe('fail-closed');
	});

	it('returns fail-closed for any other value (typo / accidental)', () => {
		expect(
			getRateLimitMode({ OPAQUE_RATE_LIMIT_MODE: 'open' } as unknown as Env)
		).toBe('fail-closed');
		expect(
			getRateLimitMode({ OPAQUE_RATE_LIMIT_MODE: 'true' } as unknown as Env)
		).toBe('fail-closed');
	});
});
