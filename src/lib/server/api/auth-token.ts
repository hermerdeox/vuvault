/**
 * Bearer-token authentication for the sync surface.
 *
 * Tokens are minted by `src/routes/api/opaque/login/ke3/+server.ts`
 * on successful OPAQUE KE3 and persist in the `sessions` table until
 * `expires_at`. Every authenticated op revalidates against D1; we
 * never trust the client.
 *
 * Vu1 / V1-C2 contract (post `migrations/0004_metadata_minimization.sql`):
 *
 *   - `Session` does NOT include a device identifier. The schema no
 *     longer carries `sessions.device_id`. See
 *     `docs/VU-LEVEL-MIGRATION-MAP.md` V1-C2 and
 *     `docs/TIER2-ARCHITECTURE.md` §L08 session-mint redesign.
 *   - `accounts.last_login_at` is removed; we do not bump it on KE3.
 *   - `rotateToken()` mints a fresh token and atomically retires the
 *     previous one. Routes that want unlinkable per-request handles
 *     (L08 Option ii groundwork) call this and emit the new token
 *     via the `Next-Token` response header. Phase 2 ships the
 *     primitive; Phase 4+ may wire it into every authenticated
 *     route.
 */

import type { D1Database } from './d1-storage';

export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export type Session = {
	token: string;
	accountId: string;
	expiresAt: number; // ms
};

function newTokenString(): string {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function authenticate(
	db: D1Database,
	authHeader: string | null
): Promise<Session | null> {
	if (!authHeader) return null;
	const match = authHeader.match(/^Bearer\s+([0-9a-fA-F]{64})$/);
	if (!match) return null;
	const token = match[1]!;
	const row = await db
		.prepare(`SELECT token, account_id, expires_at FROM sessions WHERE token = ?`)
		.bind(token)
		.first<{
			token: string;
			account_id: string;
			expires_at: number;
		}>();
	if (!row) return null;
	const expiresAtMs = row.expires_at * 1000;
	if (expiresAtMs < Date.now()) return null;
	return {
		token: row.token,
		accountId: row.account_id,
		expiresAt: expiresAtMs
	};
}

/**
 * Rotate a bearer token. Atomically inserts a freshly minted token
 * row carrying the SAME account binding, then deletes the old token
 * row. Returns the new token + new expiry.
 *
 * Returns `null` if the old token is unknown or already expired.
 *
 * The atomicity is provided by D1's `batch()` semantics: the two
 * statements either both apply or neither does, so an interleaved
 * authenticated request can never observe the gap. (D1 batch is a
 * single SQLite transaction.)
 *
 * Phase 2: only `/api/v2/sessions/self` exercises this. Phase 4+ may
 * extend rotation to /api/v2/blobs/* and /api/v2/inv/* per the
 * L08 Option (ii) design in `docs/TIER2-ARCHITECTURE.md`.
 */
export async function rotateToken(
	db: D1Database,
	oldToken: string
): Promise<{ newToken: string; expiresAt: number } | null> {
	const existing = await authenticate(db, `Bearer ${oldToken}`);
	if (!existing) return null;
	const fresh = newTokenString();
	const expiresAtMs = Date.now() + SESSION_TTL_MS;
	const expiresAtSec = Math.floor(expiresAtMs / 1000);
	// Atomic two-statement batch: insert new, delete old. D1's batch
	// is a SQLite transaction, so a concurrent reader either sees
	// (old only) or (new only), never both nor neither.
	await db.batch([
		db
			.prepare(
				`INSERT INTO sessions (token, account_id, expires_at, created_at)
				 VALUES (?, ?, ?, unixepoch())`
			)
			.bind(fresh, existing.accountId, expiresAtSec),
		db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(oldToken)
	]);
	return { newToken: fresh, expiresAt: expiresAtMs };
}
