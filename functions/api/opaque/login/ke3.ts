/**
 * POST /api/opaque/login/ke3
 *
 * Body: `{ clientId, requestId, ke3, deviceId? }` where `ke3` is the
 *       base64-encoded RFC 9807 KE3 bytes.
 *
 * Returns: `{ accountId, token, expiresAt, sequenceClock }` —
 *          a bearer token + the monotonic sequence-clock the client
 *          needs to exceed on its next blob upload.
 *
 * Mints a fresh session token on success and updates the account's
 * `last_login_at`. Wrong-password rejection (MAC mismatch) returns
 * 401 with no information about whether the clientId existed.
 */

import type { Env } from '../../_shared/env';
import { getServerId, checkRateLimit } from '../../_shared/env';
import { OpaqueServerEngine } from '../../_shared/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '../../_shared/d1-storage';
import { b64decode, jsonError, jsonOk, readJson } from '../../_shared/http';

type Body = { clientId?: string; requestId?: string; ke3?: string; deviceId?: string };

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

function newToken(): string {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	if (!(await checkRateLimit(env.OPAQUE_LOGIN_LIMITER, `ip:${ip}`))) {
		return jsonError(429, 'rate limit exceeded');
	}

	const body = await readJson<Body>(request);
	if (
		!body ||
		typeof body.clientId !== 'string' ||
		typeof body.requestId !== 'string' ||
		typeof body.ke3 !== 'string'
	) {
		return jsonError(400, 'invalid request body');
	}
	let ke3Bytes: Uint8Array;
	try {
		ke3Bytes = b64decode(body.ke3);
	} catch {
		return jsonError(400, 'invalid ke3 encoding');
	}
	if (body.clientId.length === 0 || body.clientId.length > 256) {
		return jsonError(400, 'invalid clientId');
	}
	if (!/^[0-9a-f]{32}$/.test(body.requestId)) {
		return jsonError(400, 'invalid requestId');
	}
	const deviceId =
		typeof body.deviceId === 'string' && body.deviceId.length > 0
			? body.deviceId.slice(0, 256)
			: 'unknown';

	try {
		const storage = new D1OpaqueStorage(env.AUTH_DB);
		const serverId = getServerId(env);
		const identity = await loadServerIdentity(env.AUTH_DB, serverId);
		const engine = new OpaqueServerEngine(identity, storage);
		const { accountId } = await engine.loginKE3(
			body.clientId,
			body.requestId,
			ke3Bytes
		);

		// Mint a fresh session token. The sequence_clock starts at the
		// current account high-water mark so monotonic upload ordering
		// is preserved across logins. We read it here in the same
		// transaction shape as the upload handler.
		const token = newToken();
		const expiresAt = Date.now() + SESSION_TTL_MS;
		const lastClock = await env.AUTH_DB
			.prepare(
				`SELECT COALESCE(MAX(sequence_clock), 0) AS clock
				 FROM sessions WHERE account_id = ?`
			)
			.bind(accountId)
			.first<{ clock: number }>();
		const sequenceClock = (lastClock?.clock ?? 0) + 0;

		await env.AUTH_DB
			.prepare(
				`INSERT INTO sessions (token, account_id, device_id, expires_at, sequence_clock, created_at)
				 VALUES (?, ?, ?, ?, ?, unixepoch())`
			)
			.bind(token, accountId, deviceId, Math.floor(expiresAt / 1000), sequenceClock)
			.run();

		await env.AUTH_DB
			.prepare('UPDATE accounts SET last_login_at = unixepoch() WHERE account_id = ?')
			.bind(accountId)
			.run();

		return jsonOk({
			accountId,
			token,
			expiresAt,
			sequenceClock
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : '';
		if (msg.includes('unknown login request')) {
			return jsonError(400, 'login request expired or unknown');
		}
		if (msg.includes('clientId mismatch')) {
			return jsonError(400, 'clientId mismatch');
		}
		// `serverAkeFinish` throws on MAC mismatch — wrong password.
		// 401 is the documented status for that case.
		return jsonError(401, 'authentication failed');
	}
};

export const onRequest: PagesFunction<Env> = async () => jsonError(405, 'method not allowed');
