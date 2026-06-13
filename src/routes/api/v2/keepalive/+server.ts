/**
 * V2 keep-alive route — GC heartbeat for live blob references.
 *
 *   POST /api/v2/keepalive   body: { blobIds: string[] }  -> { touched }
 *
 * Refreshes `last_seen_at` for each named blob reference WITHOUT
 * transferring the blob bytes, so a client can cheaply re-assert that
 * its current vault + document blobs are still live. Without this, a
 * document blob the owner has not opened in the GC window ages out of
 * `blob_references` and gets collected by `r2-gc.ts` while still
 * referenced by the encrypted inventory.
 *
 * Privacy / threat-model (V1-C1 / V1-C3):
 *   - The body carries only global, account-free blob UUIDs — the same
 *     identifiers the client already holds in its encrypted inventory
 *     and already GETs/PUTs under this session token. Grouping them in
 *     one request reveals no more than the per-token correlation the
 *     existing blob routes already permit; the rate-limit key is the
 *     hashed session token, never an account id.
 *   - UPDATE-only: an unknown UUID is a silent no-op, so the route
 *     cannot be used to mint references to blobs R2 does not hold.
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { jsonError, jsonOk, readJson } from '$lib/server/api/http';
import { authenticate } from '$lib/server/api/auth-token';
import { authenticateCapability } from '$lib/server/api/capability-auth';
import { maybeGcV2, touchV2BlobReferences } from '$lib/server/api/r2-gc';
import { v2RateLimitKey } from '$lib/server/api/v2-rate-limit-key';

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Upper bound on a single batch. A vault's live set is one whole-vault
// blob plus its document blobs; 256 is comfortably beyond any realistic
// attachment count while bounding the per-request D1 work.
const MAX_KEEPALIVE_IDS = 256;

async function resolveSession(env: Env, request: Request) {
	const bearer = await authenticate(env.AUTH_DB, request.headers.get('authorization'));
	if (bearer) return bearer;
	return authenticateCapability(env, request.headers.get('x-vu0-capability'));
}

type KeepAliveBody = {
	blobIds?: unknown;
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const session = await resolveSession(env, request);
	if (!session) return jsonError(401, 'unauthorized');

	const rlKey = await v2RateLimitKey(session.token);
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, rlKey);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

	const body = await readJson<KeepAliveBody>(request);
	if (!body || !Array.isArray(body.blobIds)) {
		return jsonError(400, 'invalid request body');
	}

	const ids = Array.from(
		new Set(
			body.blobIds.filter(
				(id): id is string => typeof id === 'string' && UUID_RE.test(id)
			)
		)
	).slice(0, MAX_KEEPALIVE_IDS);

	const touched = await touchV2BlobReferences(env, ids);
	void maybeGcV2(env).catch(() => undefined);

	return jsonOk({ touched });
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
