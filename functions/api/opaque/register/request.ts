/**
 * POST /api/opaque/register/request
 *
 * Body: `{ clientId, request }` where `request` is base64-encoded
 *       OPAQUE registration request bytes.
 *
 * Returns: `{ requestId, response }` where `response` is base64-
 *          encoded OPAQUE registration response bytes for the
 *          client to feed into `RegistrationFinish`.
 *
 * The server retains the per-account OPRF secret keyed by
 * `requestId` until the matching `register/record` call completes;
 * it is GC'd after ~30s if the client never finishes.
 */

import type { Env } from '../../_shared/env';
import { getServerId, checkRateLimit } from '../../_shared/env';
import { OpaqueServerEngine } from '../../_shared/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '../../_shared/d1-storage';
import { b64decode, b64encode, jsonError, jsonOk, readJson } from '../../_shared/http';

type Body = { clientId?: string; request?: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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
		// Deliberately opaque error — never leak server-side state to
		// the client. Audit logging happens via Cloudflare WAF.
		return jsonError(500, 'opaque registration request failed');
	}
};

// All other methods land here.
export const onRequest: PagesFunction<Env> = async () => jsonError(405, 'method not allowed');
