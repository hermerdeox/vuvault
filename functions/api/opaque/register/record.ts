/**
 * POST /api/opaque/register/record
 *
 * Body: `{ clientId, requestId, record }` where `record` is the
 *       base64-encoded RFC 9807 registration record bytes.
 *
 * Returns: `{ accountId }` server-allocated UUID for the new account.
 *
 * Side effect: persists the account in D1's `accounts` table and
 * deletes the matching pending registration. Subsequent calls with
 * the same `requestId` fail with 400.
 */

import type { Env } from '../../_shared/env';
import { getServerId, checkRateLimit } from '../../_shared/env';
import { OpaqueServerEngine } from '../../_shared/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '../../_shared/d1-storage';
import { b64decode, jsonError, jsonOk, readJson } from '../../_shared/http';

type Body = { clientId?: string; requestId?: string; record?: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	if (!(await checkRateLimit(env.OPAQUE_REGISTER_LIMITER, `ip:${ip}`))) {
		return jsonError(429, 'rate limit exceeded');
	}

	const body = await readJson<Body>(request);
	if (
		!body ||
		typeof body.clientId !== 'string' ||
		typeof body.requestId !== 'string' ||
		typeof body.record !== 'string'
	) {
		return jsonError(400, 'invalid request body');
	}
	let recordBytes: Uint8Array;
	try {
		recordBytes = b64decode(body.record);
	} catch {
		return jsonError(400, 'invalid record encoding');
	}
	if (body.clientId.length === 0 || body.clientId.length > 256) {
		return jsonError(400, 'invalid clientId');
	}
	if (!/^[0-9a-f]{32}$/.test(body.requestId)) {
		return jsonError(400, 'invalid requestId');
	}

	try {
		const storage = new D1OpaqueStorage(env.AUTH_DB);
		const serverId = getServerId(env);
		const identity = await loadServerIdentity(env.AUTH_DB, serverId);
		const engine = new OpaqueServerEngine(identity, storage);
		const { accountId } = await engine.registerRecord(
			body.clientId,
			body.requestId,
			recordBytes
		);
		return jsonOk({ accountId });
	} catch (err) {
		// 'unknown registration request' on stale or replayed requestId
		const msg = err instanceof Error ? err.message : '';
		if (msg.includes('unknown registration request')) {
			return jsonError(400, 'registration request expired or unknown');
		}
		if (msg.includes('clientId mismatch')) {
			return jsonError(400, 'clientId mismatch');
		}
		if (msg.includes('record length')) {
			return jsonError(400, 'malformed registration record');
		}
		return jsonError(500, 'opaque registration record failed');
	}
};

export const onRequest: PagesFunction<Env> = async () => jsonError(405, 'method not allowed');
