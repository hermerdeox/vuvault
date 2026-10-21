/**
 * POST /api/v0/tokens/issue — blind-evaluate a batch of anonymous
 * request tokens (V0-C1; see `src/lib/server/api/anon-tokens.ts`).
 *
 *   body:     { blinded: base64[] }            1..TOKEN_MAX_BATCH points
 *   response: { keyId, publicKey, evaluated: base64[], proofs: base64[] }
 *
 * Auth: requires the Bearer token from OPAQUE login — issuance is the
 * one step that is allowed to know who is asking, because blinding
 * keeps it from recognizing the tokens later. The handler stores
 * nothing about the request beyond the session-scoped rate-limit
 * window that every authenticated route already keeps.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { authenticate } from '$lib/server/api/auth-token';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';
import { jsonError, jsonOk, readJson, b64decode, b64encode } from '$lib/server/api/http';
import {
	issueTokens,
	TOKEN_MAX_BATCH,
	TOKEN_ELEMENT_LEN
} from '$lib/server/api/anon-tokens';

type Body = { blinded?: unknown };

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.TOKEN_ISSUE, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const body = await readJson<Body>(request);
	if (
		!body ||
		!Array.isArray(body.blinded) ||
		body.blinded.length === 0 ||
		body.blinded.length > TOKEN_MAX_BATCH
	) {
		return jsonError(400, 'invalid request body');
	}
	const blinded: Uint8Array[] = [];
	for (const entry of body.blinded) {
		if (typeof entry !== 'string') return jsonError(400, 'invalid blinded element');
		let bytes: Uint8Array;
		try {
			bytes = b64decode(entry);
		} catch {
			return jsonError(400, 'invalid blinded element');
		}
		if (bytes.length !== TOKEN_ELEMENT_LEN) return jsonError(400, 'invalid blinded element');
		blinded.push(bytes);
	}

	let issued;
	try {
		issued = issueTokens(env, blinded);
	} catch {
		// An off-curve point makes the blind evaluation throw.
		return jsonError(400, 'invalid blinded element');
	}
	if (!issued) return jsonError(503, 'token issuance not configured');

	return jsonOk({
		keyId: issued.keyId,
		publicKey: b64encode(issued.publicKey),
		evaluated: issued.evaluated.map(b64encode),
		proofs: issued.proofs.map(b64encode)
	});
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
