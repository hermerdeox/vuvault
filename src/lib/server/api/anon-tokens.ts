/**
 * Anonymous single-use request tokens — V0-C1 (unlinkable routing).
 *
 * Replaces the §L09cap capability handles, which the server recorded
 * against `account_id` at issuance and could therefore always map back
 * to the account. These tokens follow the Privacy Pass shape (RFC 9576
 * architecture, privately verifiable VOPRF issuance) on top of the RFC
 * 9497 implementation in `$lib/crypto/voprf`:
 *
 *   Issue  — Bearer-authenticated `POST /api/v0/tokens/issue`. The
 *            client sends blinded random inputs; the server
 *            blind-evaluates each under the current window key and
 *            returns a DLEQ proof per element. NOTHING about the
 *            issuance is stored: no row ties a token to the session or
 *            account that asked for it.
 *   Redeem — `X-Vu0-Token: v1.<keyId>.<input b64>.<output b64>` on the
 *            v2 blob / inventory routes, with no session attached. The
 *            server recomputes PRF(sk, input), compares in constant
 *            time, and records SHA-256(input) in `anon_tokens_spent`
 *            so each token works exactly once.
 *
 * Blinding means the server cannot match a redeemed input to any
 * blinded element it evaluated, so a redemption reveals nothing about
 * which account it came from beyond the key window it was issued in.
 *
 * Keys rotate per UTC day; a token stays redeemable for its own window
 * and the following one, so a token minted just before midnight still
 * works. Secrets derive from the AKD master key (`AKD_SIGNING_KEY_HEX`)
 * under a token-specific domain — the same single-root pattern the AKD
 * VRF keys use.
 *
 * Residuals (documented, NOT closed here):
 *   - Key consistency. The operator could hand different clients
 *     different keys to partition them. The client pins the key from
 *     the public `GET /api/v0/tokens/key`, but that endpoint is served
 *     by the same operator; anchoring each window key in the AKD log is
 *     the fix.
 *   - Network metadata. IP address and the timing between issuance and
 *     redemption remain visible at the edge.
 */

import { sha256 } from '@noble/hashes/sha2';
import type { Env } from './env';
import { resolveSigningKey } from './akd-server';
import { b64decode, jsonError } from './http';
import { applyRateLimit, RATE_LIMITS } from './rate-limit-d1';
import {
	publicKey as voprfPublicKey,
	blindEvaluate,
	evaluate as voprfEvaluate,
	deriveSecretKey,
	VOPRF_POINT_LEN,
	VOPRF_OUTPUT_LEN
} from '$lib/crypto/voprf';

/** Key-rotation window (one UTC day). */
export const TOKEN_KEY_WINDOW_SECS = 24 * 60 * 60;
/** Random token input length the client blinds. */
export const TOKEN_INPUT_LEN = 32;
/** Upper bound on blinded elements per issuance request. */
export const TOKEN_MAX_BATCH = 32;
/** Header the v2 routes read the token from. */
export const TOKEN_HEADER = 'x-vu0-token';

const TOKEN_KEY_DOMAIN = new TextEncoder().encode('vuvault-anon-token-key-v1');
const TOKEN_HEADER_RE = /^v1\.(\d{1,10})\.([A-Za-z0-9+/=]{1,128})\.([A-Za-z0-9+/=]{1,128})$/;

/** Probability that a redemption also sweeps expired spent-token rows. */
const SPENT_GC_PROBABILITY = 0.02;

export function currentKeyId(nowMs: number = Date.now()): number {
	return Math.floor(nowMs / 1000 / TOKEN_KEY_WINDOW_SECS);
}

/** Derive the window's VOPRF secret from the AKD master key. */
export function deriveTokenSecret(masterSk: Uint8Array, keyId: number): Uint8Array {
	const idBytes = new Uint8Array(8);
	new DataView(idBytes.buffer).setBigUint64(0, BigInt(keyId), false);
	const seed = new Uint8Array(TOKEN_KEY_DOMAIN.length + masterSk.length + idBytes.length);
	seed.set(TOKEN_KEY_DOMAIN, 0);
	seed.set(masterSk, TOKEN_KEY_DOMAIN.length);
	seed.set(idBytes, TOKEN_KEY_DOMAIN.length + masterSk.length);
	return deriveSecretKey(seed);
}

/** `{ sk, pk }` for a window, or null when the master key is not configured. */
export function tokenKeyPair(
	env: Env,
	keyId: number
): { secretKey: Uint8Array; publicKey: Uint8Array } | null {
	const masterSk = resolveSigningKey(env);
	if (!masterSk) return null;
	const secretKey = deriveTokenSecret(masterSk, keyId);
	return { secretKey, publicKey: voprfPublicKey(secretKey) };
}

/**
 * Blind-evaluate a batch under the current window key. Returns null when
 * the master key is not configured (the route maps that to 503).
 */
export function issueTokens(
	env: Env,
	blinded: Uint8Array[]
): {
	keyId: number;
	publicKey: Uint8Array;
	evaluated: Uint8Array[];
	proofs: Uint8Array[];
} | null {
	const keyId = currentKeyId();
	const keys = tokenKeyPair(env, keyId);
	if (!keys) return null;
	const evaluated: Uint8Array[] = [];
	const proofs: Uint8Array[] = [];
	for (const element of blinded) {
		const out = blindEvaluate(keys.secretKey, keys.publicKey, element);
		evaluated.push(out.evaluatedElement);
		proofs.push(out.proof);
	}
	return { keyId, publicKey: keys.publicKey, evaluated, proofs };
}

export function parseTokenHeader(
	value: string | null
): { keyId: number; input: Uint8Array; output: Uint8Array } | null {
	if (!value) return null;
	const m = TOKEN_HEADER_RE.exec(value.trim());
	if (!m) return null;
	let input: Uint8Array;
	let output: Uint8Array;
	try {
		input = b64decode(m[2]!);
		output = b64decode(m[3]!);
	} catch {
		return null;
	}
	if (input.length !== TOKEN_INPUT_LEN || output.length !== VOPRF_OUTPUT_LEN) return null;
	return { keyId: Number(m[1]), input, output };
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let acc = 0;
	for (let i = 0; i < a.length; i++) acc |= a[i]! ^ b[i]!;
	return acc === 0;
}

function toHex(bytes: Uint8Array): string {
	let hex = '';
	for (const b of bytes) hex += b.toString(16).padStart(2, '0');
	return hex;
}

/**
 * Verify and spend a token. True only when the PRF output matches AND
 * this is the token's first use. The spent row carries the input hash
 * and key window — nothing that identifies a session or account.
 */
export async function redeemToken(env: Env, headerValue: string | null): Promise<boolean> {
	const token = parseTokenHeader(headerValue);
	if (!token) return false;
	const nowKey = currentKeyId();
	if (token.keyId !== nowKey && token.keyId !== nowKey - 1) return false;
	const keys = tokenKeyPair(env, token.keyId);
	if (!keys) return false;
	const expected = voprfEvaluate(keys.secretKey, token.input);
	if (!constantTimeEqual(expected, token.output)) return false;

	const result = await env.AUTH_DB
		.prepare(
			`INSERT INTO anon_tokens_spent (token_hash, key_id, spent_at)
			 VALUES (?, ?, unixepoch())
			 ON CONFLICT(token_hash) DO NOTHING`
		)
		.bind(toHex(sha256(token.input)), token.keyId)
		.run();
	if (Math.random() < SPENT_GC_PROBABILITY) {
		void sweepSpentTokens(env, nowKey).catch(() => undefined);
	}
	return (result.meta?.changes ?? 0) === 1;
}

/**
 * Drop spent rows for windows that can no longer redeem: once a key is
 * outside the redeemable pair, its tokens fail the key check before the
 * spent table is consulted, so the replay record is dead weight.
 */
export async function sweepSpentTokens(env: Env, nowKey: number = currentKeyId()): Promise<void> {
	await env.AUTH_DB
		.prepare(`DELETE FROM anon_tokens_spent WHERE key_id < ?`)
		.bind(nowKey - 1)
		.run();
}

/**
 * Route guard for the token-only v2 routes. Returns a 401 response when
 * the request carries no valid unspent token, or null to proceed. A
 * Bearer session token is deliberately NOT accepted here: these routes
 * must never see anything that resolves to an account.
 */
export async function requireAnonToken(env: Env, request: Request): Promise<Response | null> {
	try {
		if (await redeemToken(env, request.headers.get(TOKEN_HEADER))) return null;
	} catch {
		return jsonError(503, 'token verification unavailable');
	}
	return jsonError(401, 'invalid token');
}

/**
 * Entry guard for every v2 blob / inventory handler: rate-limit by
 * network origin first — cheap, and it bounds the PRF work an
 * unauthenticated caller can trigger — then spend one anonymous token.
 * The edge already sees the IP, so keying on it adds no new correlator.
 */
export async function requireV2Access(env: Env, request: Request): Promise<Response | null> {
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	const rateLimit = await applyRateLimit(env, RATE_LIMITS.BLOB, `ip:${ip}`);
	if (!rateLimit.ok) return jsonError(rateLimit.status, rateLimit.message);
	return requireAnonToken(env, request);
}

export { VOPRF_POINT_LEN as TOKEN_ELEMENT_LEN };
