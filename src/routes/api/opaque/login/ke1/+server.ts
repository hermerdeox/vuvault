/**
 * POST /api/opaque/login/ke1
 *
 * Body: `{ clientId, ke1 }` where `ke1` is base64-encoded KE1 bytes.
 * Returns: `{ requestId, ke2 }` with `ke2` base64-encoded.
 *
 * Migrated from `functions/api/opaque/login/ke1.ts`.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { getServerId, checkRateLimit } from '$lib/server/api/env';
import { OpaqueServerEngine } from '$lib/server/api/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '$lib/server/api/d1-storage';
import { b64decode, b64encode, jsonError, jsonOk, readJson } from '$lib/server/api/http';

type Body = { clientId?: string; ke1?: string };

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	if (!(await checkRateLimit(env.OPAQUE_LOGIN_LIMITER, `ip:${ip}`))) {
		return jsonError(429, 'rate limit exceeded');
	}

	const body = await readJson<Body>(request);
	if (!body || typeof body.clientId !== 'string' || typeof body.ke1 !== 'string') {
		return jsonError(400, 'invalid request body');
	}
	let ke1Bytes: Uint8Array;
	try {
		ke1Bytes = b64decode(body.ke1);
	} catch {
		return jsonError(400, 'invalid ke1 encoding');
	}
	if (body.clientId.length === 0 || body.clientId.length > 256) {
		return jsonError(400, 'invalid clientId');
	}

	try {
		const storage = new D1OpaqueStorage(env.AUTH_DB);
		const serverId = getServerId(env);
		const identity = await loadServerIdentity(env.AUTH_DB, serverId);
		const engine = new OpaqueServerEngine(identity, storage);
		const { ke2, requestId } = await engine.loginKE1(body.clientId, ke1Bytes);
		return jsonOk({
			requestId,
			ke2: b64encode(ke2)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : '';
		if (msg.includes('unknown clientId')) {
			// Account-existence oracle is documented as out-of-scope of
			// the ZK claim. Surface a stable 401 so timing/error-shape
			// don't add a side channel on top.
			return jsonError(401, 'unknown clientId');
		}
		if (msg.includes('KE1 length')) {
			return jsonError(400, 'malformed ke1');
		}
		return jsonError(500, 'opaque login ke1 failed');
	}
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
