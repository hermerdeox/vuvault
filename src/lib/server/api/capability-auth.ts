/**
 * Capability-based authentication for V2 routes (Vu0 §L09cap).
 *
 * Accepts `X-Vu0-Capability: <epoch_id>:<capability_hex>` and
 * resolves it to a server-side Session-shaped object. The route
 * handlers can use either Bearer-token auth (Vu1) or capability
 * auth (Vu0) — the dual-auth pattern lets clients opt in to V0-C1
 * unlinkability gradually.
 *
 * The capability lookup goes through `capability_index` (migration
 * 0008). When a capability is unknown OR the epoch is unknown OR
 * the AKD is not yet initialized, this function returns null —
 * caller falls back to Bearer-token auth.
 *
 * IMPORTANT V0-C1 invariant:
 *   - The Session returned by this function carries `accountId`
 *     and `token` fields IDENTICAL in shape to the Bearer-token
 *     Session. Downstream code (e.g., rate-limit key derivation,
 *     R2 customMetadata) treats them the same.
 *   - The `token` field is set to the capability_hex so downstream
 *     code doing token-scoped rate limiting still gets a stable
 *     per-capability key (and capabilities rotate per epoch, so
 *     the bucket rotates too — extra unlinkability bonus).
 */

import type { Env } from './env';
import type { Session } from './auth-token';
import { lookupCapability } from './oprf-server';

const HEADER_RE = /^([0-9]+):([0-9a-f]{64})$/i;

/**
 * Parse `X-Vu0-Capability: <epoch_id>:<hex>` and resolve to a
 * Session. Returns null on missing header, malformed value, or
 * unknown capability.
 */
export async function authenticateCapability(
	env: Env,
	capabilityHeader: string | null
): Promise<Session | null> {
	if (!capabilityHeader) return null;
	const match = capabilityHeader.match(HEADER_RE);
	if (!match) return null;
	const epochId = Number.parseInt(match[1]!, 10);
	const capabilityHex = match[2]!.toLowerCase();
	if (!Number.isInteger(epochId) || epochId <= 0) return null;

	const row = await lookupCapability(env.AUTH_DB, epochId, capabilityHex);
	if (!row) return null;

	// The capability auth path does NOT have a finite TTL beyond the
	// epoch boundary; the capability_index row lives until the epoch
	// is pruned (Phase D §"GC policy"). Use Number.MAX_SAFE_INTEGER
	// as the expiry placeholder so the Session.expiresAt field stays
	// truthy and the auth-token caller's epoch < Date.now() check
	// passes vacuously.
	return {
		token: capabilityHex,
		accountId: row.accountId,
		expiresAt: Number.MAX_SAFE_INTEGER,
		sequenceClock: 0
	};
}

/**
 * Convenience wrapper: try Bearer-token auth first, then capability
 * auth. Returns whichever succeeds (or null).
 *
 * Used by V2 routes that accept either auth style. The order of
 * preference (Bearer first) preserves the existing Vu1 fast path —
 * existing clients are unaffected.
 */
export async function authenticateDualAuth(
	env: Env,
	authHeader: string | null,
	capabilityHeader: string | null,
	bearerAuth: (env: Env, header: string | null) => Promise<Session | null>
): Promise<Session | null> {
	const bearer = await bearerAuth(env, authHeader);
	if (bearer) return bearer;
	return authenticateCapability(env, capabilityHeader);
}
