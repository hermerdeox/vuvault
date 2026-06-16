/**
 * OPAQUE client (RFC 9807) end-to-end tests against the in-process
 * mock server. These prove our facade + transport contract is
 * byte-tight against `@structured-id/opaque`'s wire format, so when
 * the M3 Worker lands and exposes the same operations the existing
 * client code Just Works.
 */

import { describe, expect, it } from 'vitest';
import {
	register,
	login,
	loginWithRetry,
	classifyOpaqueError,
	OpaqueServerError,
	type OpaqueTransport
} from './opaque-client';
import { MockOpaqueServer } from './mock-opaque-server';

const SERVER_ID = 'vuvault.test';

describe('OPAQUE client + mock server round-trip', () => {
	it('register then login derives matching export keys', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		const password = 'correct-horse-battery-staple-vault';
		const clientId = 'alice@vuvault.test';

		const reg = await register({
			serverId: SERVER_ID,
			clientId,
			password,
			transport
		});
		expect(reg.exportKey).toHaveLength(64);
		expect(reg.accountId).toMatch(/^[0-9a-f]{32}$/);

		const log = await login({
			serverId: SERVER_ID,
			clientId,
			password,
			transport
		});

		expect(log.accountId).toBe(reg.accountId);
		// The export key is the same value derived from registration —
		// this is what we'll fold into the HKDF chain on every unlock.
		expect(Buffer.from(log.exportKey).equals(Buffer.from(reg.exportKey))).toBe(
			true
		);
		expect(log.sessionKey).toHaveLength(64);
	});

	it('login with the wrong password fails before the server sees KE3', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		const clientId = 'bob@vuvault.test';
		await register({
			serverId: SERVER_ID,
			clientId,
			password: 'right-password',
			transport
		});
		await expect(
			login({
				serverId: SERVER_ID,
				clientId,
				password: 'wrong-password',
				transport
			})
		).rejects.toThrow();
	});

	it('login against an unknown clientId rejects at the transport layer', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		await expect(
			login({
				serverId: SERVER_ID,
				clientId: 'never-registered',
				password: 'x',
				transport
			})
		).rejects.toThrow(/unknown clientId/);
	});

	it('stable export key across multiple successful logins', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		const password = 'stable-password';
		const clientId = 'carol';
		const reg = await register({
			serverId: SERVER_ID,
			clientId,
			password,
			transport
		});
		const a = await login({ serverId: SERVER_ID, clientId, password, transport });
		const b = await login({ serverId: SERVER_ID, clientId, password, transport });
		expect(Buffer.from(a.exportKey).equals(Buffer.from(reg.exportKey))).toBe(
			true
		);
		expect(Buffer.from(b.exportKey).equals(Buffer.from(reg.exportKey))).toBe(
			true
		);
		// Session keys are derived from a fresh AKE each login — must
		// differ between runs.
		expect(Buffer.from(a.sessionKey).equals(Buffer.from(b.sessionKey))).toBe(
			false
		);
	});
});

describe('classifyOpaqueError', () => {
	it('treats a 401 server rejection as a wrong credential', () => {
		expect(classifyOpaqueError(new OpaqueServerError(401, 'authentication failed'))).toBe(
			'wrong-credential'
		);
	});

	it('treats a client-side envelope/MAC failure as a wrong credential', () => {
		// The library throws these plain Errors (not OpaqueServerError) when
		// the Secret Key is wrong, before the server ever sees KE3.
		expect(
			classifyOpaqueError(
				new Error('Envelope recovery failed: invalid auth tag (wrong password?)')
			)
		).toBe('wrong-credential');
		expect(classifyOpaqueError(new Error('AKE failed: invalid server MAC'))).toBe(
			'wrong-credential'
		);
	});

	it('treats 429 as rate-limited', () => {
		expect(classifyOpaqueError(new OpaqueServerError(429, 'rate limit exceeded'))).toBe(
			'rate-limited'
		);
	});

	it('treats network (code 0) and 5xx as transient/unavailable', () => {
		expect(classifyOpaqueError(new OpaqueServerError(0, 'Failed to fetch'))).toBe('unavailable');
		expect(classifyOpaqueError(new OpaqueServerError(500, 'opaque login ke1 failed'))).toBe(
			'unavailable'
		);
		expect(classifyOpaqueError(new OpaqueServerError(503, 'rate limiter unavailable'))).toBe(
			'unavailable'
		);
	});

	it('treats a 4xx handshake error as unknown, not a wrong key', () => {
		// Regression guard: a 500/handshake fault must NEVER be misread as a
		// wrong key — that would burn unlock attempts toward the lockout.
		expect(
			classifyOpaqueError(new OpaqueServerError(400, 'login request expired or unknown'))
		).toBe('unknown');
	});
});

describe('loginWithRetry', () => {
	const noSleep = () => Promise.resolve();

	/** Wrap a transport so loginKE1 throws `code` for its first `failTimes` calls. */
	function flakyLoginKE1(inner: OpaqueTransport, failTimes: number, code: number) {
		let calls = 0;
		const transport: OpaqueTransport = {
			...inner,
			loginKE1: async (clientId, ke1) => {
				if (calls++ < failTimes) throw new OpaqueServerError(code, 'transient');
				return inner.loginKE1(clientId, ke1);
			}
		};
		return { transport, ke1Calls: () => calls };
	}

	it('retries a transient 5xx and then succeeds', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		const clientId = 'retry-alice';
		const password = 'pw';
		const reg = await register({ serverId: SERVER_ID, clientId, password, transport });
		const flaky = flakyLoginKE1(transport, 2, 503); // fail twice, then succeed
		const log = await loginWithRetry(
			{ serverId: SERVER_ID, clientId, password, transport: flaky.transport },
			{ retries: 3, backoffMs: 0, sleep: noSleep }
		);
		expect(Buffer.from(log.exportKey).equals(Buffer.from(reg.exportKey))).toBe(true);
		expect(flaky.ke1Calls()).toBe(3); // two failures + one success
	});

	it('gives up after exhausting retries on a persistent 5xx', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		const clientId = 'retry-carol';
		await register({ serverId: SERVER_ID, clientId, password: 'pw', transport });
		const flaky = flakyLoginKE1(transport, Infinity, 500);
		await expect(
			loginWithRetry(
				{ serverId: SERVER_ID, clientId, password: 'pw', transport: flaky.transport },
				{ retries: 2, backoffMs: 0, sleep: noSleep }
			)
		).rejects.toThrow();
		expect(flaky.ke1Calls()).toBe(3); // initial attempt + 2 retries
	});

	it('does not retry a wrong password (one handshake, then fails fast)', async () => {
		const server = new MockOpaqueServer(SERVER_ID);
		const transport = server.asTransport();
		const clientId = 'retry-bob';
		await register({ serverId: SERVER_ID, clientId, password: 'right', transport });
		let ke1Calls = 0;
		const counting: OpaqueTransport = {
			...transport,
			loginKE1: (cid, ke1) => {
				ke1Calls++;
				return transport.loginKE1(cid, ke1);
			}
		};
		await expect(
			loginWithRetry(
				{ serverId: SERVER_ID, clientId, password: 'wrong', transport: counting },
				{ retries: 3, backoffMs: 0, sleep: noSleep }
			)
		).rejects.toThrow();
		// Wrong password fails client-side at loginFinish after a single KE1;
		// the classifier marks it wrong-credential, so there is no retry.
		expect(ke1Calls).toBe(1);
	});
});
