/**
 * POST /api/opaque/register/request
 *
 * Body: `{ clientId, request }` where `request` is base64-encoded
 *       OPAQUE registration request bytes.
 * Returns: `{ requestId, response }` where `response` is base64-
 *          encoded OPAQUE registration response bytes for the
 *          client to feed into `RegistrationFinish`.
 *
 * Migrated from `functions/api/opaque/register/request.ts` to a
 * SvelteKit `+server.ts`. Bindings are accessed via
 * `platform.env` (declared in `src/app.d.ts`).
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { getServerId, checkRateLimit } from '$lib/server/api/env';
import { OpaqueServerEngine } from '$lib/server/api/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '$lib/server/api/d1-storage';
import { b64decode, b64encode, jsonError, jsonOk, readJson } from '$lib/server/api/http';

type Body = { clientId?: string; request?: string };

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	if (!(await checkRateLimit(env.OPAQUE_REGISTER_LIMITER, `ip:${ip}`))) {
		return jsonError(429, 'rate limit exceeded');
	}

	const body = await readJson<Body>(request);
	if (!body || typeof body.clientId !== 'string' || typeof body.request !== 'string') {
		return jsonError(400, 'invalid request body');
	}
	let requestBytes: Uint8Array;
	try {
		requestBytes = b64decode(body.request);
	} catch {
		return jsonError(400, 'invalid request encoding');
	}
	if (body.clientId.length === 0 || body.clientId.length > 256) {
		return jsonError(400, 'invalid clientId');
	}

	try {
		const storage = new D1OpaqueStorage(env.AUTH_DB);
		const serverId = getServerId(env);
		const identity = await loadServerIdentity(env.AUTH_DB, serverId);
		const engine = new OpaqueServerEngine(identity, storage);
		const { response, requestId } = await engine.registerRequest(body.clientId, requestBytes);
		return jsonOk({
			requestId,
			response: b64encode(response)
		});
	} catch {
		return jsonError(500, 'opaque registration request failed');
	}
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
