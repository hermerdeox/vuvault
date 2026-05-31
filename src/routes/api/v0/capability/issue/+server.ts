/**
 * POST /api/v0/capability/issue — VOPRF blind-evaluation step.
 *
 * Two-call flow:
 *
 *   1. POST with `{ blindedElement: base64-32 }`:
 *      Server returns `{ epoch_id, evaluatedElement, proof,
 *      publicKey }`. The client finalizes the VOPRF protocol
 *      locally and derives its capability handle (32 bytes).
 *
 *   2. POST with `{ commit: { epoch_id, capability_hex } }`:
 *      Server records the (epoch, capability_hex) → account_id
 *      mapping in `capability_index`. The capability becomes
 *      usable on V2 routes via the `X-Vu0-Capability` header.
 *
 * Auth: requires a valid Bearer token (from OPAQUE login). The
 * route does NOT accept capability auth — capabilities cannot
 * mint other capabilities, since that would create a linkage
 * chain back to the OPAQUE handshake.
 *
 * Rate limit: session-scoped (the v2-rate-limit-key derives the
 * bucket from the session token hash, so capability minting does
 * not introduce a per-account rate-limit row).
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { authenticate } from '$lib/server/api/auth-token';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';
import {
	jsonError,
	jsonOk,
	readJson,
	b64decode,
	b64encode
} from '$lib/server/api/http';
import { issueOprfEvaluation, recordCapability } from '$lib/server/api/oprf-server';

type Body =
	| { blindedElement?: string }
	| { commit?: { epoch_id?: number; capability_hex?: string } };

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (!session) return jsonError(401, 'unauthorized');

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const body = await readJson<Body>(request);
	if (!body) return jsonError(400, 'invalid request body');

	// Mode 1: blind-eval. body.blindedElement is a 32-byte
	// Ristretto255 point in base64.
	const evalBody = body as { blindedElement?: string };
	if (typeof evalBody.blindedElement === 'string') {
		let pointBytes: Uint8Array;
		try {
			pointBytes = b64decode(evalBody.blindedElement);
		} catch {
			return jsonError(400, 'invalid blindedElement encoding');
		}
		if (pointBytes.length !== 32) {
			return jsonError(400, 'blindedElement must be 32 bytes');
		}
		try {
			const result = await issueOprfEvaluation(env, pointBytes);
			if (!result) {
				return jsonError(404, 'no AKD epoch published');
			}
			return jsonOk({
				epoch_id: result.epochId,
				evaluatedElement: b64encode(result.evaluatedElement),
				proof: b64encode(result.proof),
				publicKey: b64encode(result.publicKeyBytes)
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : '';
			if (msg.includes('AKD_SIGNING_KEY_HEX')) {
				return jsonError(503, 'akd signing key not configured');
			}
			return jsonError(503, 'capability issue failed');
		}
	}

	// Mode 2: commit. body.commit is { epoch_id, capability_hex }.
	const commitBody = body as {
		commit?: { epoch_id?: number; capability_hex?: string };
	};
	if (commitBody.commit && typeof commitBody.commit === 'object') {
		const c = commitBody.commit;
		if (
			!Number.isInteger(c.epoch_id) ||
			c.epoch_id! <= 0 ||
			typeof c.capability_hex !== 'string' ||
			!/^[0-9a-f]{64}$/i.test(c.capability_hex)
		) {
			return jsonError(400, 'invalid commit payload');
		}
		try {
			await recordCapability(
				env.AUTH_DB,
				c.epoch_id!,
				c.capability_hex,
				session.accountId
			);
			return jsonOk({ committed: true });
		} catch {
			return jsonError(503, 'capability commit failed');
		}
	}

	return jsonError(400, 'invalid request body');
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
