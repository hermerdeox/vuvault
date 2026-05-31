/**
 * POST /api/opaque/register/record
 *
 * Body: `{ clientId, requestId, record }` where `record` is the
 *       base64-encoded RFC 9807 registration record bytes.
 * Returns: `{ accountId }` server-allocated UUID for the new account.
 *
 * Migrated from `functions/api/opaque/register/record.ts`.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { getServerId } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { OpaqueServerEngine } from '$lib/server/api/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '$lib/server/api/d1-storage';
import { maybeSweep } from '$lib/server/api/cleanup';
import { b64decode, jsonError, jsonOk, readJson } from '$lib/server/api/http';

type Body = { clientId?: string; requestId?: string; record?: string };

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.OPAQUE_REGISTER, `ip:${ip}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

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
		const { accountId } = await engine.registerRecord(body.clientId, body.requestId, recordBytes);
		void maybeSweep(env.AUTH_DB).catch(() => undefined);
		return jsonOk({ accountId });
	} catch (err) {
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

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
