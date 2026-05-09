/**
 * OPAQUE client (RFC 9807) end-to-end tests against the in-process
 * mock server. These prove our facade + transport contract is
 * byte-tight against `@structured-id/opaque`'s wire format, so when
 * the M3 Worker lands and exposes the same operations the existing
 * client code Just Works.
 */

import { describe, expect, it } from 'vitest';
import { register, login } from './opaque-client';
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
