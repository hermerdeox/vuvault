/**
 * AKD (Auditable Key Directory) — server-side lifecycle.
 *
 * Provides:
 *   - `mintEpoch(env)` — read the current account-handle set, build
 *     a Merkle tree of VRF-derived leaf positions, sign the root,
 *     and persist the (epoch_id, root, vrf_pubkey, signature) tuple
 *     in `akd_epochs`. Persist all leaves to `akd_leaves`.
 *   - `currentEpoch(env)` — return the latest published epoch, or
 *     null if none exists yet.
 *   - `proofFor(env, accountHandle, epochId?)` — return the
 *     inclusion proof for `accountHandle` at the given (or latest)
 *     epoch.
 *
 * VRF construction: see `src/lib/crypto/ed25519-vrf.ts`. The
 * AKD signing key (`env.AKD_SIGNING_KEY_HEX`) doubles as the VRF
 * secret key — same Ed25519 key, used for both signing the root
 * and producing leaf-position VRF outputs. The corresponding
 * `vrf_pubkey_hex` is published per-epoch so clients verify the
 * VRF claim independently of any other published material.
 *
 * Privacy properties:
 *   - The leaf set is the set of CURRENT `account_handle` values
 *     present in the `accounts` table. We do NOT correlate accounts
 *     to leaves by `client_id` or any user-facing identifier.
 *   - `account_handle` is itself an opaque per-account string (set
 *     at registration via HKDF of the OPAQUE export key — see
 *     `accounts.account_handle` column added by migration 0009 in
 *     Phase D when client_id replacement lands). Phase B operates
 *     against the existing `accounts.account_id` as a placeholder
 *     until the migration ships.
 */

import { sha384 } from '@noble/hashes/sha2';
import type { Env } from './env';
import type { D1Database } from './d1-storage';
import {
	vrfProveWithOutput,
	vrfPublicKey,
	hexToBytes,
	bytesToHex,
	VRF_SECRET_LEN
} from '$lib/crypto/ed25519-vrf';
import { ed25519 } from '@noble/curves/ed25519';
import {
	buildMerkleRoot,
	buildInclusionProof,
	type AkdLeaf,
	AKD_HASH_LEN
} from '$lib/crypto/akd-merkle';

export type AkdEpoch = {
	epochId: number;
	rootHex: string;
	vrfPubkeyHex: string;
	signedAt: number;
	signatureHex: string;
	leafCount: number;
};

export type AkdLeafRecord = {
	epochId: number;
	leafPosHex: string;
	leafHashHex: string;
	accountHandle: string;
};

const SIGNATURE_DOMAIN = new TextEncoder().encode('vuvault-akd-epoch-v1');

/**
 * Constant-time string compare for admin token authentication.
 */
export function constantTimeStringEq(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * Verify that the admin token in the request matches the env secret.
 * Returns false (rather than throwing) when env.AKD_ADMIN_TOKEN is
 * unset — that disables the admin route entirely.
 */
export function verifyAdminToken(env: Env, authHeader: string | null): boolean {
	if (!env.AKD_ADMIN_TOKEN) return false;
	if (!authHeader) return false;
	const match = authHeader.match(/^Bearer\s+(.+)$/);
	if (!match) return false;
	return constantTimeStringEq(match[1]!, env.AKD_ADMIN_TOKEN);
}

/**
 * Resolve the AKD signing key from env. Returns null when unset
 * (caller should refuse the operation gracefully). Throws when the
 * key is set but malformed (configuration error).
 */
export function resolveSigningKey(env: Env): Uint8Array | null {
	if (!env.AKD_SIGNING_KEY_HEX) return null;
	const bytes = hexToBytes(env.AKD_SIGNING_KEY_HEX);
	if (bytes.length !== VRF_SECRET_LEN) {
		throw new Error(`AKD_SIGNING_KEY_HEX must decode to ${VRF_SECRET_LEN} bytes`);
	}
	return bytes;
}

/**
 * Derive a per-epoch VRF secret key from the master signing key.
 * The derivation is HKDF-style: SHA-384(epoch_domain || master_sk
 * || epoch_id) truncated to 32 bytes (Ed25519 seed). Per-epoch
 * keys mean a leaked epoch_e secret does NOT compromise other
 * epochs.
 */
export function deriveEpochSigningKey(masterSk: Uint8Array, epochId: number): Uint8Array {
	if (masterSk.length !== VRF_SECRET_LEN) {
		throw new Error(`deriveEpochSigningKey: masterSk must be ${VRF_SECRET_LEN} bytes`);
	}
	const epochBytes = new Uint8Array(8);
	const view = new DataView(epochBytes.buffer);
	view.setBigUint64(0, BigInt(epochId), false);
	const combined = new Uint8Array(SIGNATURE_DOMAIN.length + masterSk.length + epochBytes.length);
	combined.set(SIGNATURE_DOMAIN, 0);
	combined.set(masterSk, SIGNATURE_DOMAIN.length);
	combined.set(epochBytes, SIGNATURE_DOMAIN.length + masterSk.length);
	return sha384(combined).slice(0, VRF_SECRET_LEN);
}

/**
 * List every distinct account_handle currently active. For Phase B
 * groundwork, we treat `accounts.account_id` as the handle (since
 * the `account_handle` column doesn't exist yet — Phase D will
 * introduce it via migration 0009). The Phase D handle-migration
 * keeps the lookup function signature identical.
 */
export async function listAccountHandles(db: D1Database): Promise<string[]> {
	const result = await db
		.prepare(`SELECT account_id AS account_handle FROM accounts ORDER BY account_id`)
		.all<{ account_handle: string }>();
	const rows = result?.results ?? [];
	return rows.map((r) => r.account_handle);
}

/**
 * Get the latest published epoch, or null if none exists.
 */
export async function currentEpoch(env: Env): Promise<AkdEpoch | null> {
	const row = await env.AUTH_DB
		.prepare(
			`SELECT epoch_id, root_hex, vrf_pubkey_hex, signed_at, signature_hex, leaf_count
			 FROM akd_epochs ORDER BY epoch_id DESC LIMIT 1`
		)
		.first<{
			epoch_id: number;
			root_hex: string;
			vrf_pubkey_hex: string;
			signed_at: number;
			signature_hex: string;
			leaf_count: number;
		}>();
	if (!row) return null;
	return {
		epochId: row.epoch_id,
		rootHex: row.root_hex,
		vrfPubkeyHex: row.vrf_pubkey_hex,
		signedAt: row.signed_at,
		signatureHex: row.signature_hex,
		leafCount: row.leaf_count
	};
}

/**
 * Mint a fresh epoch: build the Merkle tree over current account
 * handles' VRF positions, sign the root + vrf_pubkey + signed_at,
 * persist epoch + leaves atomically.
 *
 * Returns the new epoch metadata.
 *
 * Rate guard: caller is responsible for enforcing
 * `AKD_EPOCH_CADENCE_MS` (the route handler checks before calling
 * this function). The function itself is unconditionally mintable
 * to support test scenarios that need rapid succession.
 */
export async function mintEpoch(env: Env): Promise<AkdEpoch> {
	const masterSk = resolveSigningKey(env);
	if (!masterSk) {
		throw new Error('mintEpoch: AKD_SIGNING_KEY_HEX not configured');
	}

	// Determine next epoch id by reading the current max (D1
	// AUTOINCREMENT also handles this on INSERT, but we need the id
	// to derive the per-epoch VRF key BEFORE the INSERT).
	const currentRow = await env.AUTH_DB
		.prepare(`SELECT COALESCE(MAX(epoch_id), 0) AS max_id FROM akd_epochs`)
		.first<{ max_id: number }>();
	const nextEpochId = (currentRow?.max_id ?? 0) + 1;

	// Derive per-epoch VRF key from master + epoch id.
	const epochSk = deriveEpochSigningKey(masterSk, nextEpochId);
	const epochPk = vrfPublicKey(epochSk);

	// Compute leaves: for each active account handle, VRF its
	// handle bytes under the epoch SK; leaf position = SHA-384(VRF
	// output); leaf hash = SHA-384(handle_bytes || epoch_bytes).
	const handles = await listAccountHandles(env.AUTH_DB);
	const leaves: AkdLeaf[] = [];
	const leafMeta: { handle: string; posHex: string; hashHex: string }[] = [];
	const epochBytes = new Uint8Array(8);
	new DataView(epochBytes.buffer).setBigUint64(0, BigInt(nextEpochId), false);
	for (const handle of handles) {
		const handleBytes = new TextEncoder().encode(handle);
		const { output } = vrfProveWithOutput(epochSk, handleBytes);
		const pos = sha384(output);
		const hash = sha384(concatBytes(handleBytes, epochBytes));
		leaves.push({ pos, hash });
		leafMeta.push({
			handle,
			posHex: bytesToHex(pos),
			hashHex: bytesToHex(hash)
		});
	}

	const root = buildMerkleRoot(leaves);
	const rootHex = bytesToHex(root);
	const vrfPubkeyHex = bytesToHex(epochPk);
	const signedAt = Math.floor(Date.now() / 1000);

	// Sign the root + vrf_pubkey + signed_at + epoch_id with the
	// MASTER signing key (not the per-epoch key). This makes the
	// AKD epoch chain auditable: anyone with the published master
	// public key can verify every epoch back to genesis.
	const signedMessage = concatBytes(
		SIGNATURE_DOMAIN,
		root,
		epochPk,
		i64be(signedAt),
		i64be(nextEpochId)
	);
	const signature = ed25519.sign(signedMessage, masterSk);
	const signatureHex = bytesToHex(signature);

	// Persist atomically: insert the epoch row, then all leaf rows.
	const statements = [
		env.AUTH_DB
			.prepare(
				`INSERT INTO akd_epochs (epoch_id, root_hex, vrf_pubkey_hex, signed_at, signature_hex, leaf_count)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind(nextEpochId, rootHex, vrfPubkeyHex, signedAt, signatureHex, leaves.length)
	];
	for (const meta of leafMeta) {
		statements.push(
			env.AUTH_DB
				.prepare(
					`INSERT INTO akd_leaves (epoch_id, leaf_pos_hex, leaf_hash_hex, account_handle)
					 VALUES (?, ?, ?, ?)`
				)
				.bind(nextEpochId, meta.posHex, meta.hashHex, meta.handle)
		);
	}
	await env.AUTH_DB.batch(statements);

	return {
		epochId: nextEpochId,
		rootHex,
		vrfPubkeyHex,
		signedAt,
		signatureHex,
		leafCount: leaves.length
	};
}

/**
 * Build an inclusion proof for `accountHandle` at the given epoch
 * (or the latest, if epochId is null). Returns null if the epoch
 * doesn't exist or the handle has no leaf in it.
 */
export async function proofFor(
	env: Env,
	accountHandle: string,
	epochId?: number
): Promise<{
	epoch: AkdEpoch;
	leafPosHex: string;
	leafHashHex: string;
	siblings: string[];
} | null> {
	const epoch = epochId
		? await getEpoch(env, epochId)
		: await currentEpoch(env);
	if (!epoch) return null;

	// Load every leaf for this epoch, to rebuild the tree and
	// extract the inclusion proof.
	const leafRows = await env.AUTH_DB
		.prepare(
			`SELECT leaf_pos_hex, leaf_hash_hex, account_handle
			 FROM akd_leaves WHERE epoch_id = ?`
		)
		.bind(epoch.epochId)
		.all<{ leaf_pos_hex: string; leaf_hash_hex: string; account_handle: string }>();
	const allLeaves = leafRows?.results ?? [];
	const target = allLeaves.find((r) => r.account_handle === accountHandle);
	if (!target) return null;

	const leaves: AkdLeaf[] = allLeaves.map((r) => ({
		pos: hexToBytes(r.leaf_pos_hex),
		hash: hexToBytes(r.leaf_hash_hex)
	}));
	const targetLeaf: AkdLeaf = {
		pos: hexToBytes(target.leaf_pos_hex),
		hash: hexToBytes(target.leaf_hash_hex)
	};
	const proof = buildInclusionProof(leaves, targetLeaf);
	return {
		epoch,
		leafPosHex: target.leaf_pos_hex,
		leafHashHex: target.leaf_hash_hex,
		siblings: proof.siblings.map((s) => bytesToHex(s))
	};
}

async function getEpoch(env: Env, epochId: number): Promise<AkdEpoch | null> {
	const row = await env.AUTH_DB
		.prepare(
			`SELECT epoch_id, root_hex, vrf_pubkey_hex, signed_at, signature_hex, leaf_count
			 FROM akd_epochs WHERE epoch_id = ?`
		)
		.bind(epochId)
		.first<{
			epoch_id: number;
			root_hex: string;
			vrf_pubkey_hex: string;
			signed_at: number;
			signature_hex: string;
			leaf_count: number;
		}>();
	if (!row) return null;
	return {
		epochId: row.epoch_id,
		rootHex: row.root_hex,
		vrfPubkeyHex: row.vrf_pubkey_hex,
		signedAt: row.signed_at,
		signatureHex: row.signature_hex,
		leafCount: row.leaf_count
	};
}

// Local helpers (kept private to this module — public API stays
// minimal):

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const p of parts) total += p.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

function i64be(n: number): Uint8Array {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setBigUint64(0, BigInt(n), false);
	return out;
}

void AKD_HASH_LEN;
