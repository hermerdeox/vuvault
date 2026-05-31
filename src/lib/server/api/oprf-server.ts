/**
 * Server-side OPRF key lifecycle and capability issuance.
 *
 * Wraps the lower-level VOPRF math (see `src/lib/crypto/voprf.ts`)
 * with the D1-backed key storage and capability-index bookkeeping
 * that the /api/v0/capability/issue route depends on.
 *
 * Key derivation:
 *   - The per-epoch OPRF secret is derived from the AKD master
 *     signing key + epoch_id via the SAME HKDF-style derivation
 *     `akd-server.ts` uses for the per-epoch VRF key. This avoids
 *     introducing a second master secret — the AKD signing key is
 *     the single root of trust for the AKD + OPRF subsystems.
 *   - The derived 32-byte seed is reduced mod ORDER via
 *     `voprf.publicKey()`'s internal scalar reduction; we store the
 *     reduced scalar verbatim in `oprf_secret_keys.oprf_secret_hex`.
 */

import { sha384 } from '@noble/hashes/sha2';
import { ed25519 } from '@noble/curves/ed25519';
import type { Env } from './env';
import type { D1Database } from './d1-storage';
import {
	bytesToHex,
	hexToBytes,
	VRF_SECRET_LEN
} from '$lib/crypto/ed25519-vrf';
import {
	publicKey as voprfPublicKey,
	blindEvaluate,
	VOPRF_POINT_LEN,
	VOPRF_PROOF_LEN
} from '$lib/crypto/voprf';
import { resolveSigningKey, currentEpoch } from './akd-server';

const OPRF_DERIVE_DOMAIN = new TextEncoder().encode('vuvault-akd-oprf-v1');

void ed25519; // imported indirectly via VRF helpers — keep typing honest

/**
 * Derive the OPRF secret for `epochId` from the AKD master key.
 * The master key is the same Ed25519 secret used by `akd-server.ts`.
 */
export function deriveOprfSecret(masterSk: Uint8Array, epochId: number): Uint8Array {
	if (masterSk.length !== VRF_SECRET_LEN) {
		throw new Error(`deriveOprfSecret: masterSk must be ${VRF_SECRET_LEN} bytes`);
	}
	const epochBytes = new Uint8Array(8);
	new DataView(epochBytes.buffer).setBigUint64(0, BigInt(epochId), false);
	const combined = new Uint8Array(
		OPRF_DERIVE_DOMAIN.length + masterSk.length + epochBytes.length
	);
	combined.set(OPRF_DERIVE_DOMAIN, 0);
	combined.set(masterSk, OPRF_DERIVE_DOMAIN.length);
	combined.set(epochBytes, OPRF_DERIVE_DOMAIN.length + masterSk.length);
	// SHA-384 → take first 32 bytes (Ristretto255 scalar size).
	return sha384(combined).slice(0, 32);
}

/**
 * Ensure the `oprf_secret_keys` row exists for the given epoch.
 * Lazy-mints on first access so an admin/publish that pre-dated
 * the OPRF rollout still gets a key on the next capability request.
 *
 * Returns the persisted { secret_hex, pubkey_hex } pair.
 */
export async function ensureOprfKeyForEpoch(
	env: Env,
	epochId: number
): Promise<{ secretHex: string; pubkeyHex: string }> {
	const row = await env.AUTH_DB
		.prepare(
			`SELECT oprf_secret_hex, oprf_pubkey_hex FROM oprf_secret_keys WHERE epoch_id = ?`
		)
		.bind(epochId)
		.first<{ oprf_secret_hex: string; oprf_pubkey_hex: string }>();
	if (row) return { secretHex: row.oprf_secret_hex, pubkeyHex: row.oprf_pubkey_hex };

	const masterSk = resolveSigningKey(env);
	if (!masterSk) {
		throw new Error('ensureOprfKeyForEpoch: AKD_SIGNING_KEY_HEX not configured');
	}
	const secret = deriveOprfSecret(masterSk, epochId);
	const secretHex = bytesToHex(secret);
	const pubkeyHex = bytesToHex(voprfPublicKey(secret));
	const createdAt = Math.floor(Date.now() / 1000);
	try {
		await env.AUTH_DB
			.prepare(
				`INSERT INTO oprf_secret_keys (epoch_id, oprf_secret_hex, oprf_pubkey_hex, created_at)
				 VALUES (?, ?, ?, ?)`
			)
			.bind(epochId, secretHex, pubkeyHex, createdAt)
			.run();
	} catch {
		// On race we just re-read the existing row.
		const reread = await env.AUTH_DB
			.prepare(
				`SELECT oprf_secret_hex, oprf_pubkey_hex FROM oprf_secret_keys WHERE epoch_id = ?`
			)
			.bind(epochId)
			.first<{ oprf_secret_hex: string; oprf_pubkey_hex: string }>();
		if (reread) return { secretHex: reread.oprf_secret_hex, pubkeyHex: reread.oprf_pubkey_hex };
		throw new Error('ensureOprfKeyForEpoch: race-recovery failed');
	}
	return { secretHex, pubkeyHex };
}

/**
 * Issue a VOPRF blind-evaluation under the current epoch's secret.
 *
 * Returns the evaluated element + DLEQ proof + the published
 * pubkey + the epoch id. The caller does NOT learn the secret
 * scalar.
 */
export async function issueOprfEvaluation(
	env: Env,
	blindedElement: Uint8Array
): Promise<{
	epochId: number;
	evaluatedElement: Uint8Array;
	proof: Uint8Array;
	publicKeyBytes: Uint8Array;
} | null> {
	const epoch = await currentEpoch(env);
	if (!epoch) return null;
	const keys = await ensureOprfKeyForEpoch(env, epoch.epochId);
	const sk = hexToBytes(keys.secretHex);
	const pk = hexToBytes(keys.pubkeyHex);
	if (sk.length !== 32 || pk.length !== VOPRF_POINT_LEN) {
		throw new Error('issueOprfEvaluation: malformed stored OPRF keys');
	}
	const { evaluatedElement, proof } = blindEvaluate(sk, pk, blindedElement);
	if (proof.length !== VOPRF_PROOF_LEN) {
		throw new Error('issueOprfEvaluation: proof length mismatch');
	}
	return {
		epochId: epoch.epochId,
		evaluatedElement,
		proof,
		publicKeyBytes: pk
	};
}

/**
 * Record the (epoch, capability_hex) → account_id mapping. Called
 * by the client AFTER it finalizes the VOPRF protocol and computes
 * its capability handle. The server CAN reproduce the capability
 * (it knows sk for this epoch + the unblinded element) but takes
 * the client's submitted hex as authoritative — the client commits
 * to its derived value so subsequent capability-auth lookups match.
 *
 * This call IS authenticated: the request carries the Bearer token
 * issued by OPAQUE login. The session token unambiguously
 * identifies the account; we store account_id verbatim.
 */
export async function recordCapability(
	db: D1Database,
	epochId: number,
	capabilityHex: string,
	accountId: string
): Promise<void> {
	if (!/^[0-9a-f]{64}$/i.test(capabilityHex)) {
		throw new Error('recordCapability: capabilityHex must be 64 hex chars');
	}
	const issuedAt = Math.floor(Date.now() / 1000);
	await db
		.prepare(
			`INSERT INTO capability_index (epoch_id, capability_hex, account_id, issued_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(epoch_id, capability_hex) DO UPDATE SET
				account_id = excluded.account_id,
				issued_at  = excluded.issued_at`
		)
		.bind(epochId, capabilityHex.toLowerCase(), accountId, issuedAt)
		.run();
}

/**
 * Look up the account_id for a (epoch, capability_hex) pair.
 * Returns null if the capability is unknown.
 */
export async function lookupCapability(
	db: D1Database,
	epochId: number,
	capabilityHex: string
): Promise<{ accountId: string; issuedAt: number } | null> {
	const row = await db
		.prepare(
			`SELECT account_id, issued_at FROM capability_index
			 WHERE epoch_id = ? AND capability_hex = ?`
		)
		.bind(epochId, capabilityHex.toLowerCase())
		.first<{ account_id: string; issued_at: number }>();
	if (!row) return null;
	return { accountId: row.account_id, issuedAt: row.issued_at };
}
