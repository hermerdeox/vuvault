/**
 * Vault key derivation — Layer L02 of the blueprint.
 *
 * One stable HKDF info string across all formatVersions. The
 * authoritative version distinction lives in the AES-GCM AAD
 * (vault-session.ts::makeAad), which already authenticates the
 * `formatVersion` byte.
 *
 * vault_key = HKDF-SHA512(
 *   ikm  = prfOutput ‖ secretKey [‖ masterPasswordKey] [‖ opaqueExportKey],
 *   salt = deviceSalt,
 *   info = 'vuvault-vault-key-v1',
 *   L    = 32
 * )
 *
 * The optional `opaqueExportKey` is only honored when the caller
 * passes `version: 2`. v1 callers never include OPAQUE material —
 * which is what makes the transparent v1 → v2 upgrade in saveItems
 * work: an account with no MPK and no OPAQUE enrolment derives the
 * SAME vaultKey under both versions, so the wrapped-AES-key envelope
 * we produce on first v2 save can be unwrapped on every subsequent
 * unlock without re-deriving anything.
 *
 * Optional inputs:
 *   - masterPasswordKey: 32 bytes from Argon2id (RFC 9106), opt-in
 *     third factor.
 *   - opaqueExportKey: 32+ bytes from a successful OPAQUE login
 *     (RFC 9807). VuVault uses the leading 32 bytes when present.
 *
 * The order of optional inputs is FIXED — masterPasswordKey first,
 * then opaqueExportKey. Any reordering would silently change the
 * derived key for existing accounts.
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';

export const VAULT_KEY_INFO = 'vuvault-vault-key-v1';
/** Aliased for source-level clarity; both expand to the same string. */
export const VAULT_KEY_INFO_V1 = VAULT_KEY_INFO;
export const VAULT_KEY_INFO_V2 = VAULT_KEY_INFO;

export const PRF_OUTPUT_LEN = 32;
export const SECRET_KEY_LEN = 32;
export const DEVICE_SALT_LEN = 16;
export const VAULT_KEY_LEN = 32;
/** Number of bytes consumed from `opaqueExportKey`. */
export const OPAQUE_EXPORT_KEY_USE = 32;

export type DeriveVersion = 1 | 2;

export type DeriveOpts = {
	prfOutput: Uint8Array; // 32 bytes from WebAuthn PRF (or demo derivation)
	secretKey: Uint8Array; // 32 bytes (Crockford-decoded)
	deviceSalt: Uint8Array; // 16 bytes, persisted in IndexedDB
	masterPasswordKey?: Uint8Array; // 32 bytes from Argon2id, optional
	/**
	 * Opaque export key from an OPAQUE login (RFC 9807). Only honored
	 * when `version === 2`. Must be at least 32 bytes; we slice the
	 * leading 32 bytes for IKM.
	 */
	opaqueExportKey?: Uint8Array;
	/**
	 * Derivation chain version. Defaults to 1 for backward
	 * compatibility — Milestone 1 vaults call `deriveVaultKey()`
	 * without this field and continue to work.
	 */
	version?: DeriveVersion;
};

export function deriveVaultKey(opts: DeriveOpts): Uint8Array {
	const version: DeriveVersion = opts.version ?? 1;
	if (opts.prfOutput.length !== PRF_OUTPUT_LEN) {
		throw new Error(
			`deriveVaultKey: prfOutput must be ${PRF_OUTPUT_LEN} bytes (got ${opts.prfOutput.length})`
		);
	}
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`deriveVaultKey: secretKey must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}
	if (opts.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(
			`deriveVaultKey: deviceSalt must be ${DEVICE_SALT_LEN} bytes (got ${opts.deviceSalt.length})`
		);
	}
	if (opts.masterPasswordKey && opts.masterPasswordKey.length !== 32) {
		throw new Error(
			`deriveVaultKey: masterPasswordKey, if present, must be 32 bytes (got ${opts.masterPasswordKey.length})`
		);
	}
	if (opts.opaqueExportKey) {
		if (version !== 2) {
			throw new Error(
				'deriveVaultKey: opaqueExportKey is only supported when version=2'
			);
		}
		if (opts.opaqueExportKey.length < OPAQUE_EXPORT_KEY_USE) {
			throw new Error(
				`deriveVaultKey: opaqueExportKey must be at least ${OPAQUE_EXPORT_KEY_USE} bytes (got ${opts.opaqueExportKey.length})`
			);
		}
	}

	const opaqueSlice =
		version === 2 && opts.opaqueExportKey
			? opts.opaqueExportKey.subarray(0, OPAQUE_EXPORT_KEY_USE)
			: undefined;

	const ikmLen =
		opts.prfOutput.length +
		opts.secretKey.length +
		(opts.masterPasswordKey?.length ?? 0) +
		(opaqueSlice?.length ?? 0);
	const ikm = new Uint8Array(ikmLen);
	let off = 0;
	ikm.set(opts.prfOutput, off);
	off += opts.prfOutput.length;
	ikm.set(opts.secretKey, off);
	off += opts.secretKey.length;
	if (opts.masterPasswordKey) {
		ikm.set(opts.masterPasswordKey, off);
		off += opts.masterPasswordKey.length;
	}
	if (opaqueSlice) {
		ikm.set(opaqueSlice, off);
	}

	// `info` is the same across versions — the formatVersion byte in
	// the AES-GCM AAD is the authoritative version-binding mechanism.
	// The version parameter here only gates what extra IKM material is
	// admitted, so an account with neither MPK nor OPAQUE produces the
	// same vaultKey under v1 and v2 — that's the property that makes
	// the v1 → v2 on-save upgrade transparent.
	const out = hkdf(sha512, ikm, opts.deviceSalt, VAULT_KEY_INFO, VAULT_KEY_LEN);
	// Best-effort: zero the IKM concatenation buffer. Doesn't reach
	// the underlying inputs (they belong to the caller) but keeps the
	// merged buffer from sitting in memory.
	ikm.fill(0);
	return out;
}

export function generateDeviceSalt(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(DEVICE_SALT_LEN));
}
