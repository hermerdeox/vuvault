/**
 * V1-C1 / V1-C3 — rate-limit key derivation for the v2 surface.
 *
 * V1-C1 says: the server must not store a per-account inventory of
 * activity. The rate_limits table (`migrations/0003_rate_limits.sql`)
 * is the most leaky place — every bucket has a `bucket TEXT` column
 * that an authorized auditor can read. If we keyed by `account:<id>`
 * for v2 routes, the rate_limits table would directly leak
 * (accountId, last-active timestamp) tuples — a per-user activity
 * inventory.
 *
 * To close that surface, v2 routes derive the rate-limit key from
 * the SESSION TOKEN (not the account id) via a one-way hash. The
 * resulting bucket name is unlinkable to the account from D1
 * inspection alone: an auditor with bucket = `session:abcdef…`
 * cannot map it back to any account without ALSO having the
 * session token (which only the client has).
 *
 * Why hash the token instead of using it directly:
 *   - The full token (64 hex) is the auth credential. Embedding it
 *     in the rate-limit table verbatim would mean a D1 row leak is
 *     a session-token leak — and the rate-limit table is intended
 *     to be read by ops dashboards, abuse-investigation tools, etc.
 *   - SHA-256 is fast (~µs in WebCrypto) and the truncation to
 *     12 hex chars (48 bits) gives ample bucket uniqueness even at
 *     millions of sessions.
 *
 * Trade-off vs. account-scoped keys:
 *   - A single account with multiple concurrent sessions gets
 *     independent rate windows. This is acceptable because account
 *     creation is itself rate-limited at registration, so the
 *     amplification factor is bounded.
 */

export const V2_RATE_LIMIT_PREFIX = 'session';

/**
 * Compute the v2 rate-limit bucket key for a given session token.
 *
 * Returns `session:<12-hex>` where the hex is the leading 6 bytes of
 * SHA-256(token). The full token never leaves this function.
 */
export async function v2RateLimitKey(sessionToken: string): Promise<string> {
	const data = new TextEncoder().encode(sessionToken);
	const digest = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (let i = 0; i < 6; i++) {
		hex += bytes[i]!.toString(16).padStart(2, '0');
	}
	return `${V2_RATE_LIMIT_PREFIX}:${hex}`;
}
