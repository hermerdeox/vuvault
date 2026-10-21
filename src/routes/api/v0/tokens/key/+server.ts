/**
 * GET /api/v0/tokens/key — the current anonymous-token key window and
 * its public key (V0-C1; see `src/lib/server/api/anon-tokens.ts`).
 *
 * Public and unauthenticated so the client can fetch it without a
 * session and pin it before issuance: an issue response signed under
 * any other key is rejected. It returns the same value to every caller
 * within a window.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { jsonError, jsonOk, b64encode } from '$lib/server/api/http';
import { currentKeyId, tokenKeyPair } from '$lib/server/api/anon-tokens';

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform!.env as Env;
	const keyId = currentKeyId();
	let keys;
	try {
		keys = tokenKeyPair(env, keyId);
	} catch {
		return jsonError(503, 'token key unavailable');
	}
	if (!keys) return jsonError(503, 'token issuance not configured');
	return jsonOk({ keyId, publicKey: b64encode(keys.publicKey) });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
