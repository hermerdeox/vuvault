/**
 * D1-backed `OpaqueStorage` adapter for the production Worker.
 *
 * Maps the engine's storage interface onto the schema in
 * `migrations/0001_init.sql`. Account records persist; pending
 * registration and login state persist for ~30s and are GC'd by
 * either the next request that touches them or the scheduled
 * cleanup trigger (see `cleanup.ts`).
 *
 * The `OpaqueStorage` contract uses `Uint8Array` for keys and blob
 * fields. D1 stores raw bytes via the `BLOB` column type, which the
 * `@cloudflare/workers-types` `D1Database` API surfaces as
 * `ArrayBuffer` on read. We coerce both directions here so the
 * engine can stay binding-agnostic.
 */

import type {
	OpaqueStorage,
	StoredAccount,
	PendingRegistration,
	PendingLogin,
	ServerIdentity
} from './server-opaque';
import { OpaqueServerEngine } from './server-opaque';

// Inline D1 type so this module doesn't drag @cloudflare/workers-types
// into the SvelteKit client bundle. Pages Functions runtime supplies
// the matching `D1Database` shape at request time.
export type D1Database = {
	prepare(query: string): D1PreparedStatement;
};
type D1PreparedStatement = {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T = unknown>(): Promise<T | null>;
	run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
};

function bytes(input: unknown): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (Array.isArray(input) && input.every((b) => Number.isInteger(b))) {
		return new Uint8Array(input as number[]);
	}
	if (input && typeof input === 'object') {
		const maybeBuffer = input as { type?: unknown; data?: unknown };
		if (maybeBuffer.type === 'Buffer' && Array.isArray(maybeBuffer.data)) {
			return new Uint8Array(maybeBuffer.data as number[]);
		}
		const numericEntries = Object.entries(input)
			.filter(([key]) => /^\d+$/.test(key))
			.sort(([a], [b]) => Number(a) - Number(b));
		if (numericEntries.length > 0) {
			return new Uint8Array(numericEntries.map(([, value]) => Number(value)));
		}
	}
	throw new Error('d1-storage: expected Uint8Array or ArrayBuffer, got ' + typeof input);
}

function isAllZero(input: Uint8Array): boolean {
	for (const b of input) {
		if (b !== 0) return false;
	}
	return true;
}

/**
 * Tag used to round-trip Uint8Array fields through JSON.
 * `ServerAkeState` from @structured-id/opaque is a structured
 * record whose fields are typed Uint8Arrays. Naive JSON.stringify
 * lossily flattens those to plain `{0: ..., 1: ...}` objects, which
 * `serverAkeFinish` then fails the MAC verify on. Tag-and-base64
 * preserves byte fidelity.
 */
const U8_TAG = '__u8b64__';
type U8Tag = { [K in typeof U8_TAG]: string };

function jsonReplacer(_key: string, value: unknown): unknown {
	if (value instanceof Uint8Array) {
		let bin = '';
		for (let i = 0; i < value.length; i++) bin += String.fromCharCode(value[i]!);
		return { [U8_TAG]: btoa(bin) };
	}
	return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
	if (value && typeof value === 'object' && U8_TAG in value) {
		const b64 = (value as U8Tag)[U8_TAG];
		const bin = atob(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	return value;
}

function stringifyAkeState(state: unknown): string {
	return JSON.stringify(state, jsonReplacer);
}

function parseAkeState<T>(json: string): T {
	return JSON.parse(json, jsonReviver) as T;
}

/**
 * Pending state TTL — clients that don't finish OPAQUE within this
 * window need to restart. Keep tight; idle pending state is a soft
 * resource leak.
 */
export const PENDING_TTL_MS = 30_000;

export class D1OpaqueStorage implements OpaqueStorage {
	constructor(private readonly db: D1Database) {}

	async getAccount(clientId: string): Promise<StoredAccount | null> {
		const row = await this.db
			.prepare(
				'SELECT account_id, client_public_key, masking_key, envelope_bytes, oprf_secret_key FROM accounts WHERE client_id = ?'
			)
			.bind(clientId)
			.first<{
				account_id: string;
				client_public_key: ArrayBuffer;
				masking_key: ArrayBuffer;
				envelope_bytes: ArrayBuffer;
				oprf_secret_key: ArrayBuffer;
			}>();
		if (!row) return null;
		return {
			accountId: row.account_id,
			clientPublicKey: bytes(row.client_public_key),
			maskingKey: bytes(row.masking_key),
			envelopeBytes: bytes(row.envelope_bytes),
			oprfSecretKey: bytes(row.oprf_secret_key)
		};
	}

	async putAccount(clientId: string, account: StoredAccount): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO accounts
					(account_id, client_id, client_public_key, masking_key, envelope_bytes, oprf_secret_key, registration_record, created_at, last_login_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), NULL)
				 ON CONFLICT(client_id) DO UPDATE SET
				   client_public_key = excluded.client_public_key,
				   masking_key = excluded.masking_key,
				   envelope_bytes = excluded.envelope_bytes,
				   oprf_secret_key = excluded.oprf_secret_key`
			)
			.bind(
				account.accountId,
				clientId,
				account.clientPublicKey,
				account.maskingKey,
				account.envelopeBytes,
				account.oprfSecretKey,
				// `registration_record` is the redundant concatenation
				// stored alongside the parsed fields for parity with the
				// schema docstring. Same bytes the client sent.
				concatRecord(account)
			)
			.run();
	}

	async deleteAccount(clientId: string): Promise<void> {
		await this.db
			.prepare('DELETE FROM accounts WHERE client_id = ?')
			.bind(clientId)
			.run();
	}

	async getPendingRegistration(requestId: string): Promise<PendingRegistration | null> {
		const row = await this.db
			.prepare(
				'SELECT client_id, oprf_secret_key, created_at FROM pending_registrations WHERE request_id = ? AND created_at > ?'
			)
			.bind(requestId, Math.floor((Date.now() - PENDING_TTL_MS) / 1000))
			.first<{ client_id: string; oprf_secret_key: ArrayBuffer; created_at: number }>();
		if (!row) return null;
		return {
			clientId: row.client_id,
			oprfSecretKey: bytes(row.oprf_secret_key),
			createdAt: row.created_at * 1000
		};
	}

	async putPendingRegistration(requestId: string, p: PendingRegistration): Promise<void> {
		await this.db
			.prepare(
				'INSERT INTO pending_registrations (request_id, client_id, oprf_secret_key, created_at) VALUES (?, ?, ?, unixepoch())'
			)
			.bind(requestId, p.clientId, p.oprfSecretKey)
			.run();
	}

	async deletePendingRegistration(requestId: string): Promise<void> {
		await this.db
			.prepare('DELETE FROM pending_registrations WHERE request_id = ?')
			.bind(requestId)
			.run();
	}

	async getPendingLogin(requestId: string): Promise<PendingLogin | null> {
		const row = await this.db
			.prepare(
				'SELECT client_id, ake_state, created_at FROM pending_logins WHERE request_id = ? AND created_at > ?'
			)
			.bind(requestId, Math.floor((Date.now() - PENDING_TTL_MS) / 1000))
			.first<{ client_id: string; ake_state: string; created_at: number }>();
		if (!row) return null;
		// `ake_state` is JSON-serialized because ServerAkeState is a
		// structured record from `@structured-id/opaque`. Storing it
		// opaquely as JSON keeps the engine indifferent to its shape.
		// Tag-and-base64 round-trip on Uint8Array fields so the MAC
		// verify on the next KE3 actually succeeds.
		return {
			clientId: row.client_id,
			state: parseAkeState(row.ake_state),
			createdAt: row.created_at * 1000
		};
	}

	async putPendingLogin(requestId: string, p: PendingLogin): Promise<void> {
		await this.db
			.prepare(
				'INSERT INTO pending_logins (request_id, client_id, ake_state, created_at) VALUES (?, ?, ?, unixepoch())'
			)
			.bind(requestId, p.clientId, stringifyAkeState(p.state))
			.run();
	}

	async deletePendingLogin(requestId: string): Promise<void> {
		await this.db
			.prepare('DELETE FROM pending_logins WHERE request_id = ?')
			.bind(requestId)
			.run();
	}
}

function concatRecord(a: StoredAccount): Uint8Array {
	const total = a.clientPublicKey.length + a.maskingKey.length + a.envelopeBytes.length;
	const out = new Uint8Array(total);
	out.set(a.clientPublicKey, 0);
	out.set(a.maskingKey, a.clientPublicKey.length);
	out.set(a.envelopeBytes, a.clientPublicKey.length + a.maskingKey.length);
	return out;
}

/**
 * Load the long-lived OPAQUE server identity from D1. Cache once
 * per request handler — the keypair is fixed per deploy.
 */
export async function loadServerIdentity(
	db: D1Database,
	serverId: string,
	serverPublicKey: Uint8Array | null = null
): Promise<ServerIdentity> {
	const row = await db
		.prepare('SELECT oprf_seed FROM server_identity WHERE id = 1')
		.first<{ oprf_seed: ArrayBuffer }>();
	if (!row) {
		throw new Error(
			'd1-storage: server_identity not seeded. Run seed_server_identity.sql.'
		);
	}
	// The OPRF seed IS our server identity entropy. Use it as the
	// long-lived secret key (32 bytes); derive the public key once.
	const serverSecretKey = bytes(row.oprf_seed);
	if (serverSecretKey.length !== 32) {
		throw new Error('d1-storage: server_identity.oprf_seed must be exactly 32 bytes');
	}
	// All-zero guard runs BEFORE the `serverPublicKey` early return so
	// a future caller that supplies a public key cannot smuggle in a
	// degenerate secret. Today the production handlers never pass that
	// argument, but the guard is the security-critical line — keep it
	// unconditional.
	if (isAllZero(serverSecretKey)) {
		throw new Error('d1-storage: server_identity.oprf_seed must not be all zero');
	}
	if (serverPublicKey) {
		return { serverId, serverSecretKey, serverPublicKey };
	}
	return {
		serverId,
		serverSecretKey,
		serverPublicKey: OpaqueServerEngine.publicKeyFromServerSecretKey(serverSecretKey)
	};
}
