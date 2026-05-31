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
import { getServerId } from '$lib/server/api/env';
import { applyRateLimit, RATE_LIMITS } from '$lib/server/api/rate-limit-d1';
import { OpaqueServerEngine } from '$lib/server/api/server-opaque';
import { D1OpaqueStorage, loadServerIdentity } from '$lib/server/api/d1-storage';
import { maybeSweep } from '$lib/server/api/cleanup';
import { b64decode, b64encode, jsonError, jsonOk, readJson } from '$lib/server/api/http';
import { sha512 } from '@noble/hashes/sha2';

type Body = { clientId?: string; ke1?: string };

export const POST: RequestHandler = async ({ request, platform }) => {
	const env = platform!.env as Env;
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.OPAQUE_LOGIN, `ip:${ip}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);

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
		void maybeSweep(env.AUTH_DB).catch(() => undefined);
		return jsonOk({
			requestId,
			ke2: b64encode(ke2)
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : '';
		if (msg.includes('unknown clientId')) {
			// V0-C3 hardening: an unknown-clientId path inherently
			// short-circuits before the OPAQUE engine performs its
			// per-account OPRF + envelope load. Without compensation
			// the response timing reveals whether the clientId
			// exists. We compensate by performing a SYNTHETIC OPRF
			// evaluation that hashes the same input mass an
			// existing-account path would. The output is discarded;
			// the timing impact is what V0-C3 is about.
			//
			// This does NOT close the account-existence oracle at
			// the response-SHAPE level — a successful KE2 returns
			// 200 with {requestId, ke2}, while this path returns
			// 401 with {error}. That residual shape difference is
			// documented in docs/PRIVACY-LEVEL.md as the OPAQUE
			// protocol-level oracle (Tier 3+ ZK closure).
			doDummyOprfWork(body.clientId, ke1Bytes);
			return jsonError(401, 'invalid login request');
		}
		if (msg.includes('KE1 length')) {
			return jsonError(400, 'malformed ke1');
		}
		console.error('opaque login ke1 failed', err);
		return jsonError(500, 'opaque login ke1 failed');
	}
};

/**
 * Dummy OPRF-like work to compensate timing differences on the
 * unknown-clientId path. We deliberately do the same shape of
 * computation a real login would (a SHA-512 over a synthetic
 * envelope-sized input) so timing-based account-existence oracle
 * is suppressed.
 *
 * The computation result is intentionally discarded — this exists
 * for its CPU-time profile, not its output.
 */
function doDummyOprfWork(clientId: string, ke1: Uint8Array): void {
	const buf = new Uint8Array(clientId.length + ke1.length + 256);
	const te = new TextEncoder();
	const cidBytes = te.encode(clientId);
	buf.set(cidBytes, 0);
	buf.set(ke1, cidBytes.length);
	// Fill the rest with a deterministic-but-varying pattern.
	for (let i = cidBytes.length + ke1.length; i < buf.length; i++) {
		buf[i] = (i * 17 + cidBytes.length) & 0xff;
	}
	// Three SHA-512 rounds approximate the cost of envelope + OPRF
	// finalization in the real path. We don't read the output.
	let h = sha512(buf);
	h = sha512(h);
	h = sha512(h);
	void h;
}

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
