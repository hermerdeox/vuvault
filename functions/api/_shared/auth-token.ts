/**
 * Bearer-token authentication for blob upload/fetch.
 *
 * Tokens are minted by `functions/api/opaque/login/ke3.ts` on
 * successful OPAQUE KE3 and persist in the `sessions` table until
 * `expires_at`. Every blob op revalidates against D1; we never
 * trust the client.
 */

import type { D1Database } from './d1-storage';

export type Session = {
	token: string;
	accountId: string;
	deviceId: string;
	expiresAt: number; // ms
	sequenceClock: number;
};

export async function authenticate(
	db: D1Database,
	authHeader: string | null
): Promise<Session | null> {
	if (!authHeader) return null;
	const match = authHeader.match(/^Bearer\s+([0-9a-fA-F]{64})$/);
	if (!match) return null;
	const token = match[1]!;
	const row = await db
		.prepare(
			`SELECT token, account_id, device_id, expires_at, sequence_clock
			 FROM sessions WHERE token = ?`
		)
		.bind(token)
		.first<{
			token: string;
			account_id: string;
			device_id: string;
			expires_at: number;
			sequence_clock: number;
		}>();
	if (!row) return null;
	const expiresAtMs = row.expires_at * 1000;
	if (expiresAtMs < Date.now()) return null;
	return {
		token: row.token,
		accountId: row.account_id,
		deviceId: row.device_id,
		expiresAt: expiresAtMs,
		sequenceClock: row.sequence_clock
	};
}

/**
 * Bump the sequence clock on a session after a successful upload.
 * The new clock is returned so the client can include it as the
 * lower bound on its next upload.
 */
export async function advanceSequenceClock(
	db: D1Database,
	token: string,
	newClock: number
): Promise<void> {
	await db
		.prepare('UPDATE sessions SET sequence_clock = ? WHERE token = ?')
		.bind(newClock, token)
		.run();
}
