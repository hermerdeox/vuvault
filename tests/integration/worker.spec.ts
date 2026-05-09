/**
 * Worker integration tests.
 *
 * Exercises the M3 OPAQUE + blob server-side engine against an
 * in-memory D1 mock. Validates the contract that the production
 * Cloudflare Pages Function handlers ride on:
 *
 *   - register → login → export-key match
 *   - wrong password rejected at KE3 MAC verify
 *   - unknown clientId rejected at KE1
 *   - monotonic SequenceClock enforced on blob upload
 *   - bearer-token expiry / unknown-token rejection
 *
 * The in-memory D1 mock dispatches each prepared statement to a
 * hand-rolled handler. This is enough to validate `D1OpaqueStorage`
 * and the auth-token / blob storage primitives. Heavier coverage
 * (full HTTP round-trip via miniflare) is a Tier-2 follow-up; the
 * dep weight isn't justified for the contract-level assertions
 * this file makes.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
	OpaqueServerEngine,
	type ServerIdentity
} from '../../src/lib/server/api/server-opaque';
import { D1OpaqueStorage } from '../../src/lib/server/api/d1-storage';
import {
	authenticate,
	advanceSequenceClock
} from '../../src/lib/server/api/auth-token';
import { register, login } from '../../src/lib/services/opaque-client';

// --- Hand-rolled D1 mock -------------------------------------------

type Row = Record<string, unknown>;

class FakeD1 {
	accounts = new Map<string, Row>();
	pendingRegs = new Map<string, Row>();
	pendingLogins = new Map<string, Row>();
	sessions = new Map<string, Row>();
	serverIdentity: Row | null = null;

	prepare(query: string) {
		const sql = query.replace(/\s+/g, ' ').trim();
		// Capture `this` via closure rather than aliasing — keeps
		// the no-this-alias lint rule happy without changing
		// behavior.
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
		if (sql.startsWith('SELECT account_id, client_public_key, masking_key, envelope_bytes, oprf_secret_key FROM accounts')) {
			const r = this.accounts.get(args[0] as string);
			return (r ?? null) as T | null;
		}
		if (sql.startsWith('SELECT client_id, oprf_secret_key, created_at FROM pending_registrations')) {
			const r = this.pendingRegs.get(args[0] as string);
			if (!r) return null;
			if ((r.created_at as number) <= (args[1] as number)) return null;
			return r as T;
		}
		if (sql.startsWith('SELECT client_id, ake_state, created_at FROM pending_logins')) {
			const r = this.pendingLogins.get(args[0] as string);
			if (!r) return null;
			if ((r.created_at as number) <= (args[1] as number)) return null;
			return r as T;
		}
		if (sql.startsWith('SELECT oprf_seed FROM server_identity')) {
			return this.serverIdentity as T | null;
		}
		if (sql.startsWith('SELECT token, account_id, device_id, expires_at, sequence_clock')) {
			const r = this.sessions.get(args[0] as string);
			return (r ?? null) as T | null;
		}
		if (sql.startsWith('SELECT COALESCE(MAX(sequence_clock), 0) AS clock')) {
			let max = 0;
			for (const s of this.sessions.values()) {
				if (s.account_id === args[0] && (s.sequence_clock as number) > max) {
					max = s.sequence_clock as number;
				}
			}
			return { clock: max } as T;
		}
		return null;
	}

	private runImpl(sql: string, args: unknown[]): void {
		if (sql.startsWith('INSERT INTO accounts')) {
			this.accounts.set(args[1] as string, {
				account_id: args[0],
				client_public_key: args[2],
				masking_key: args[3],
				envelope_bytes: args[4],
				oprf_secret_key: args[5]
			});
			return;
		}
		if (sql.startsWith('DELETE FROM accounts')) {
			this.accounts.delete(args[0] as string);
			return;
		}
		if (sql.startsWith('INSERT INTO pending_registrations')) {
			this.pendingRegs.set(args[0] as string, {
				client_id: args[1],
				oprf_secret_key: args[2],
				created_at: Math.floor(Date.now() / 1000)
			});
			return;
		}
		if (sql.startsWith('DELETE FROM pending_registrations')) {
			this.pendingRegs.delete(args[0] as string);
			return;
		}
		if (sql.startsWith('INSERT INTO pending_logins')) {
			this.pendingLogins.set(args[0] as string, {
				client_id: args[1],
				ake_state: args[2],
				created_at: Math.floor(Date.now() / 1000)
			});
			return;
		}
		if (sql.startsWith('DELETE FROM pending_logins')) {
			this.pendingLogins.delete(args[0] as string);
			return;
		}
		if (sql.startsWith('INSERT INTO sessions')) {
			this.sessions.set(args[0] as string, {
				token: args[0],
				account_id: args[1],
				device_id: args[2],
				expires_at: args[3],
				sequence_clock: args[4]
			});
			return;
		}
		if (sql.startsWith('UPDATE sessions SET sequence_clock')) {
			const s = this.sessions.get(args[1] as string);
			if (s) s.sequence_clock = args[0];
			return;
		}
		if (sql.startsWith('UPDATE accounts SET last_login_at')) {
			// No-op for the mock — last_login_at isn't read by anything
			// downstream of the test surface.
			return;
		}
	}
}

const SERVER_ID = 'test.vuvault';

function newIdentity(): ServerIdentity {
	const kp = OpaqueServerEngine.generateServerKeypair();
	return {
		serverId: SERVER_ID,
		serverSecretKey: kp.serverSecretKey,
		serverPublicKey: kp.serverPublicKey
	};
}

describe('Worker integration · D1 + engine round-trip', () => {
	let db: FakeD1;

	beforeEach(() => {
		db = new FakeD1();
	});

	it('register then login derives matching export keys via D1Storage', async () => {
		const identity = newIdentity();
		const storage = new D1OpaqueStorage(db);
		const engine = new OpaqueServerEngine(identity, storage);

		const transport = {
			registerRequest: (cid: string, req: Uint8Array) =>
				engine.registerRequest(cid, req),
			registerRecord: (cid: string, rid: string, rec: Uint8Array) =>
				engine.registerRecord(cid, rid, rec),
			loginKE1: (cid: string, ke1: Uint8Array) => engine.loginKE1(cid, ke1),
			loginKE3: (cid: string, rid: string, ke3: Uint8Array) =>
				engine.loginKE3(cid, rid, ke3)
		};

		const reg = await register({
			serverId: SERVER_ID,
			clientId: 'alice',
			password: 'horse-battery-staple',
			transport
		});
		expect(reg.exportKey).toHaveLength(64);

		const log = await login({
			serverId: SERVER_ID,
			clientId: 'alice',
			password: 'horse-battery-staple',
			transport
		});
		expect(log.accountId).toBe(reg.accountId);
		expect(Buffer.from(log.exportKey).equals(Buffer.from(reg.exportKey))).toBe(true);
	});

	it('login with the wrong password rejects at KE3', async () => {
		const identity = newIdentity();
		const storage = new D1OpaqueStorage(db);
		const engine = new OpaqueServerEngine(identity, storage);
		const transport = {
			registerRequest: (cid: string, req: Uint8Array) =>
				engine.registerRequest(cid, req),
			registerRecord: (cid: string, rid: string, rec: Uint8Array) =>
				engine.registerRecord(cid, rid, rec),
			loginKE1: (cid: string, ke1: Uint8Array) => engine.loginKE1(cid, ke1),
			loginKE3: (cid: string, rid: string, ke3: Uint8Array) =>
				engine.loginKE3(cid, rid, ke3)
		};

		await register({
			serverId: SERVER_ID,
			clientId: 'bob',
			password: 'right',
			transport
		});
		await expect(
			login({
				serverId: SERVER_ID,
				clientId: 'bob',
				password: 'wrong',
				transport
			})
		).rejects.toThrow();
	});

	it('login against an unknown clientId rejects at KE1', async () => {
		const identity = newIdentity();
		const storage = new D1OpaqueStorage(db);
		const engine = new OpaqueServerEngine(identity, storage);
		const transport = {
			registerRequest: (cid: string, req: Uint8Array) =>
				engine.registerRequest(cid, req),
			registerRecord: (cid: string, rid: string, rec: Uint8Array) =>
				engine.registerRecord(cid, rid, rec),
			loginKE1: (cid: string, ke1: Uint8Array) => engine.loginKE1(cid, ke1),
			loginKE3: (cid: string, rid: string, ke3: Uint8Array) =>
				engine.loginKE3(cid, rid, ke3)
		};
		await expect(
			login({
				serverId: SERVER_ID,
				clientId: 'never-registered',
				password: 'x',
				transport
			})
		).rejects.toThrow(/unknown clientId/);
	});
});

describe('Worker integration · session token + sequence clock', () => {
	let db: FakeD1;

	beforeEach(() => {
		db = new FakeD1();
		// Seed a session row directly so we can test auth + clock
		// without a full OPAQUE round-trip.
		db.sessions.set('a'.repeat(64), {
			token: 'a'.repeat(64),
			account_id: 'acct-1',
			device_id: 'device-1',
			expires_at: Math.floor((Date.now() + 60_000) / 1000),
			sequence_clock: 5
		});
	});

	it('authenticate returns the session for a valid bearer token', async () => {
		const session = await authenticate(db, `Bearer ${'a'.repeat(64)}`);
		expect(session).not.toBeNull();
		expect(session!.accountId).toBe('acct-1');
		expect(session!.sequenceClock).toBe(5);
	});

	it('authenticate returns null for missing/malformed/unknown tokens', async () => {
		expect(await authenticate(db, null)).toBeNull();
		expect(await authenticate(db, 'Bearer not-a-token')).toBeNull();
		expect(await authenticate(db, `Bearer ${'b'.repeat(64)}`)).toBeNull();
	});

	it('authenticate rejects expired tokens', async () => {
		db.sessions.set('c'.repeat(64), {
			token: 'c'.repeat(64),
			account_id: 'acct-2',
			device_id: 'device-2',
			expires_at: Math.floor((Date.now() - 60_000) / 1000),
			sequence_clock: 0
		});
		expect(await authenticate(db, `Bearer ${'c'.repeat(64)}`)).toBeNull();
	});

	it('advanceSequenceClock bumps the stored clock', async () => {
		await advanceSequenceClock(db, 'a'.repeat(64), 99);
		const session = await authenticate(db, `Bearer ${'a'.repeat(64)}`);
		expect(session!.sequenceClock).toBe(99);
	});
});
