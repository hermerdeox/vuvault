/**
 * Storage — Dexie + IndexedDB wrapper.
 *
 * Persists the encrypted vault blob plus account metadata locally.
 * The server NEVER sees plaintext — encryption happens locally in
 * `src/lib/services/vault-session.ts` (AES-256-GCM with HKDF-derived key).
 *
 * `authMode` distinguishes a strict WebAuthn-PRF account ('production')
 * from a deterministic-PRF demo account ('demo'). Both are persisted
 * the same way; only the unlock key derivation differs.
 */

import Dexie, { type Table } from 'dexie';

export type AuthMode = 'production' | 'demo';

export type OpaqueState = 'none' | 'enrolled';

export type Argon2idStoredParams = {
	memoryKiB: number;
	iterations: number;
	parallelism: number;
	tagLength: number;
};

export interface AccountRecord {
	id: 'singleton'; // there's exactly one account per browser profile
	deviceLabel: string;
	deviceSalt: Uint8Array; // 16 bytes; PRF salt and HKDF salt
	credentialId: ArrayBuffer; // WebAuthn credential rawId
	credentialPublicKey: ArrayBuffer; // WebAuthn assertion public key
	authMode: AuthMode;
	formatVersion: number; // bumps when crypto/storage schema changes
	createdAt: number;
	plan: 'free' | 'paid';

	// --- Milestone 2 additions (all optional for backward compatibility) ---

	/**
	 * OPAQUE (RFC 9807) enrolment status. 'none' = vault uses only PRF
	 * + Secret Key [+ optional Argon2id master password]. 'enrolled' =
	 * the user is registered with an OPAQUE server and the export key
	 * folds into the HKDF chain. Default for v1 / un-set rows is 'none'.
	 */
	opaqueState?: OpaqueState;
	/** Server-assigned account id from a successful OPAQUE registration. */
	opaqueAccountId?: string;
	/** Server identity that bound the OPAQUE transcript. */
	opaqueServerId?: string;
	/** Client identity (random handle) used for OPAQUE registration. */
	opaqueClientId?: string;

	/**
	 * Whether the user has opted into the Argon2id master-password
	 * third factor. When `true`, unlocks require the master password
	 * in addition to PRF + Secret Key.
	 */
	masterPasswordEnabled?: boolean;
	/** 16-byte salt for the master-password Argon2id derivation. */
	masterPasswordSalt?: Uint8Array;
	/**
	 * Argon2id parameters used at enrolment time. Snapshot per-account
	 * so a future cost-tuning never invalidates an existing vault.
	 */
	masterPasswordParams?: Argon2idStoredParams;

	/**
	 * Vu0 / §L09cap groundwork — `accountSeed` is a 32-byte
	 * cryptographically random secret minted at vault provisioning.
	 * It is the long-term identity that the per-epoch VOPRF
	 * capability handles derive from. Crucially:
	 *
	 *   - Generated client-side; never sent to the server in clear.
	 *   - Recoverable via the Recovery Envelope path (the vault
	 *     AES key opens the encrypted vault, which contains the
	 *     account row including `accountSeed`).
	 *   - Zeroized on `lockSession` — see vault-session.ts.
	 *
	 * Optional at the type level for backward compatibility with
	 * pre-Phase-C accounts; those are backfilled on first
	 * `saveItems` after a Phase C-or-later build is installed.
	 */
	accountSeed?: Uint8Array;

	/**
	 * V0-C1 inventory rotation — the save index of the newest server
	 * inventory this device wrote or adopted. Every save writes its
	 * inventory to a fresh address derived from (vaultKey, deviceSalt,
	 * index), so the device must remember where it is instead of
	 * re-reading a fixed address on every unlock. Reset (absent) when
	 * the vaultKey changes, because the address chain derives from it.
	 */
	inventoryIndex?: number;
	/** Wall-clock ms of the last successful server push; drives stale refresh. */
	inventoryPushedAt?: number;

	/**
	 * New-device restore (`src/lib/crypto/restore-record.ts`). The
	 * restore root — derived from Secret Key + Recovery Password — lets
	 * this device write sealed restore records without the Recovery
	 * Password in hand. It rests here wrapped under the vault data key,
	 * so disk access alone cannot locate or open the records; the
	 * unwrapped root lives only in memory while the vault is unlocked.
	 */
	restoreRootNonce?: Uint8Array; // 12 bytes
	restoreRootCiphertext?: Uint8Array;
	/** UTC day and slot of the most recently reserved record address. */
	restorePointerDay?: number;
	restorePointerSlot?: number;
	/** Inventory index the last SUCCESSFUL record carried (absent = none / failed). */
	restorePointerIndex?: number;
	/**
	 * Addresses (as day/slot coordinates) this device has written under
	 * the current root, so a Recovery Password rotation or a restore
	 * disable can delete them. Pruned past the server's GC window.
	 */
	restorePointers?: RestorePointerCoord[];
}

export type RestorePointerCoord = { day: number; slot: number };
/** Keep coordinates for a little longer than the server's 60-day reference GC. */
export const RESTORE_POINTER_RETAIN_DAYS = 62;
export const RESTORE_POINTER_MAX_TRACKED = 256;

export interface VaultBlob {
	id: 'singleton';
	header: Uint8Array; // reserved for future hybrid envelope use; empty in v1
	nonce: Uint8Array;
	ciphertext: Uint8Array;
	updatedAt: number;
}

export interface QuickUnlockRecord {
	id: 'singleton';
	version: 1;
	enabled: boolean;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
	createdAt: number;
	lastUsedAt?: number;
}

export interface RecoveryEnvelopeRecord {
	id: 'singleton';
	version: 1;
	enabled: boolean;
	salt: Uint8Array;
	params: Argon2idStoredParams;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
	createdAt: number;
	rotatedAt?: number;
}

export interface AuditPersisted {
	id: string;
	at: number;
	level: 'info' | 'success' | 'warn' | 'danger';
	message: string;
	contextJson?: string;
}

class VuVaultDB extends Dexie {
	account!: Table<AccountRecord, 'singleton'>;
	vault!: Table<VaultBlob, 'singleton'>;
	quickUnlock!: Table<QuickUnlockRecord, 'singleton'>;
	recoveryEnvelope!: Table<RecoveryEnvelopeRecord, 'singleton'>;
	audit!: Table<AuditPersisted, string>;

	constructor() {
		super('vuvault');
		// v1 — original schema (no authMode/formatVersion/credentialPublicKey rename)
		this.version(1).stores({
			account: 'id',
			vault: 'id, updatedAt',
			audit: 'id, at'
		});
		// v2 — adds authMode/formatVersion; renames `publicKey` to `credentialPublicKey`.
		// Existing rows are upgraded with safe defaults so unlock continues to work.
		this.version(2)
			.stores({
				account: 'id',
				vault: 'id, updatedAt',
				audit: 'id, at'
			})
			.upgrade(async (tx) => {
				const accounts = tx.table<Record<string, unknown>>('account');
				await accounts.toCollection().modify((rec) => {
					if (!('authMode' in rec)) rec.authMode = 'production';
					if (!('formatVersion' in rec)) rec.formatVersion = 1;
					if (!('credentialPublicKey' in rec) && 'publicKey' in rec) {
						rec.credentialPublicKey = rec.publicKey;
						delete rec.publicKey;
					}
					if (!('credentialPublicKey' in rec)) {
						rec.credentialPublicKey = new ArrayBuffer(0);
					}
				});
			});
		// v3 — adds encrypted document blob storage. Document items in
		// the vault carry a `docBlobId` that points to a row here.
		// Existing accounts continue to work; the table is empty until
		// the user attaches a file.
		this.version(3).stores({
			account: 'id',
			vault: 'id, updatedAt',
			audit: 'id, at',
			documentBlobs: 'id, createdAt'
		});
		// v4 — local trusted-device quick unlock cache. Stores only a
		// Secret-Key ciphertext sealed by WebAuthn PRF; never plaintext.
		this.version(4).stores({
			account: 'id',
			vault: 'id, updatedAt',
			quickUnlock: 'id, enabled, lastUsedAt',
			audit: 'id, at',
			documentBlobs: 'id, createdAt'
		});
		// v5 — local-only Recovery Envelope. Stores an encrypted wrap of
		// the active v2 vault AES key, sealed by Secret Key + Recovery
		// Password. Existing accounts opt in explicitly while unlocked.
		this.version(5).stores({
			account: 'id',
			vault: 'id, updatedAt',
			quickUnlock: 'id, enabled, lastUsedAt',
			recoveryEnvelope: 'id, enabled, createdAt, rotatedAt',
			audit: 'id, at',
			documentBlobs: 'id, createdAt'
		});
		// v6 — file attachments removed. `null` tells Dexie to delete the
		// `documentBlobs` table (and every encrypted file in it) on upgrade.
		// Document items remain as text-only records inside the vault blob.
		this.version(6).stores({
			account: 'id',
			vault: 'id, updatedAt',
			quickUnlock: 'id, enabled, lastUsedAt',
			recoveryEnvelope: 'id, enabled, createdAt, rotatedAt',
			audit: 'id, at',
			documentBlobs: null
		});
	}
}

export const db = new VuVaultDB();

const DEVICE_SALT_LEN = 16;
const AES_NONCE_LEN = 12;
const QUICK_UNLOCK_VERSION = 1;
const RECOVERY_ENVELOPE_VERSION = 1;
/**
 * Format versions this build can decrypt. v1 is the Milestone 1
 * single-AES-key blob (header empty); v2 wraps a fresh AES key under
 * the hybrid X25519 + ML-KEM-1024 envelope, with the wrapped bytes
 * living in `VaultBlob.header`.
 */
// v1: legacy vaultKey-direct AES-GCM (deprecated; read-only).
// v2: AES-key wrap under vaultKey + raw plaintext seal.
// v3: AES-key wrap under vaultKey + V0-C2 bucketed-padding seal
//     (`src/lib/crypto/padding.ts` `padPlaintext`/`unpadPlaintext`).
//     See `PROVISION_FORMAT_VERSION` in `src/lib/services/vault-session.ts`.
const KNOWN_FORMAT_VERSIONS = new Set([1, 2, 3]);

function isUint8Array(v: unknown): v is Uint8Array {
	return v instanceof Uint8Array;
}

function isArrayBuffer(v: unknown): v is ArrayBuffer {
	return v instanceof ArrayBuffer;
}

/**
 * Strict structural validator for an account row read from Dexie. Throws
 * if anything is missing, the wrong type, or the wrong length — never
 * returns a partially populated record.
 *
 * This is the production tripwire that prevents a tampered or partially
 * migrated row from silently unlocking a vault with bogus crypto inputs.
 */
export function validateAccountRow(rec: unknown): asserts rec is AccountRecord {
	if (!rec || typeof rec !== 'object') {
		throw new Error('Account row is not an object');
	}
	const r = rec as Record<string, unknown>;
	if (r.id !== 'singleton') throw new Error("Account row missing id 'singleton'");
	if (typeof r.deviceLabel !== 'string') {
		throw new Error('Account.deviceLabel must be a string');
	}
	if (!isUint8Array(r.deviceSalt) || r.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(`Account.deviceSalt must be ${DEVICE_SALT_LEN} bytes`);
	}
	if (!isArrayBuffer(r.credentialId) || r.credentialId.byteLength === 0) {
		throw new Error('Account.credentialId must be a non-empty ArrayBuffer');
	}
	if (!isArrayBuffer(r.credentialPublicKey)) {
		throw new Error('Account.credentialPublicKey must be an ArrayBuffer');
	}
	if (r.authMode !== 'production' && r.authMode !== 'demo') {
		throw new Error(`Account.authMode must be 'production' or 'demo'`);
	}
	if (typeof r.formatVersion !== 'number' || !KNOWN_FORMAT_VERSIONS.has(r.formatVersion)) {
		throw new Error(`Account.formatVersion is not a known version`);
	}
	if (typeof r.createdAt !== 'number' || r.createdAt <= 0) {
		throw new Error('Account.createdAt must be a positive timestamp');
	}
	if (r.plan !== 'free' && r.plan !== 'paid') {
		throw new Error(`Account.plan must be 'free' or 'paid'`);
	}

	// --- Milestone 2 optional fields ---
	if (
		r.opaqueState !== undefined &&
		r.opaqueState !== 'none' &&
		r.opaqueState !== 'enrolled'
	) {
		throw new Error(`Account.opaqueState must be 'none' or 'enrolled'`);
	}
	if (r.opaqueState === 'enrolled') {
		if (typeof r.opaqueAccountId !== 'string' || !r.opaqueAccountId) {
			throw new Error('Account.opaqueAccountId required when enrolled');
		}
		if (typeof r.opaqueServerId !== 'string' || !r.opaqueServerId) {
			throw new Error('Account.opaqueServerId required when enrolled');
		}
		if (typeof r.opaqueClientId !== 'string' || !r.opaqueClientId) {
			throw new Error('Account.opaqueClientId required when enrolled');
		}
	}
	if (
		r.masterPasswordEnabled !== undefined &&
		typeof r.masterPasswordEnabled !== 'boolean'
	) {
		throw new Error('Account.masterPasswordEnabled must be a boolean');
	}
	if (r.masterPasswordEnabled === true) {
		if (
			!isUint8Array(r.masterPasswordSalt) ||
			r.masterPasswordSalt.length === 0
		) {
			throw new Error('Account.masterPasswordSalt required when MPK enabled');
		}
		const params = r.masterPasswordParams as Argon2idStoredParams | undefined;
		if (
			!params ||
			typeof params.memoryKiB !== 'number' ||
			typeof params.iterations !== 'number' ||
			typeof params.parallelism !== 'number' ||
			typeof params.tagLength !== 'number'
		) {
			throw new Error('Account.masterPasswordParams required when MPK enabled');
		}
	}

	// --- Vu0 §L09cap optional field ---
	if (r.accountSeed !== undefined) {
		if (!isUint8Array(r.accountSeed) || r.accountSeed.length !== 32) {
			throw new Error('Account.accountSeed must be a 32-byte Uint8Array');
		}
	}

	// --- V0-C1 inventory rotation optional fields ---
	if (
		r.inventoryIndex !== undefined &&
		(!Number.isSafeInteger(r.inventoryIndex) || (r.inventoryIndex as number) < 0)
	) {
		throw new Error('Account.inventoryIndex must be a non-negative integer');
	}
	if (
		r.inventoryPushedAt !== undefined &&
		(typeof r.inventoryPushedAt !== 'number' || r.inventoryPushedAt <= 0)
	) {
		throw new Error('Account.inventoryPushedAt must be a positive timestamp');
	}

	// --- new-device restore optional fields ---
	const hasRootNonce = r.restoreRootNonce !== undefined;
	const hasRootCt = r.restoreRootCiphertext !== undefined;
	if (hasRootNonce !== hasRootCt) {
		throw new Error('Account.restoreRootNonce and restoreRootCiphertext must be set together');
	}
	if (hasRootNonce) {
		if (!isUint8Array(r.restoreRootNonce) || r.restoreRootNonce.length !== AES_NONCE_LEN) {
			throw new Error(`Account.restoreRootNonce must be ${AES_NONCE_LEN} bytes`);
		}
		if (!isUint8Array(r.restoreRootCiphertext) || r.restoreRootCiphertext.length === 0) {
			throw new Error('Account.restoreRootCiphertext must be a non-empty Uint8Array');
		}
	}
	for (const field of ['restorePointerDay', 'restorePointerSlot', 'restorePointerIndex'] as const) {
		const v = r[field];
		if (v !== undefined && (!Number.isSafeInteger(v) || (v as number) < 0)) {
			throw new Error(`Account.${field} must be a non-negative integer`);
		}
	}
	if (r.restorePointers !== undefined) {
		if (!Array.isArray(r.restorePointers) || r.restorePointers.length > RESTORE_POINTER_MAX_TRACKED) {
			throw new Error('Account.restorePointers must be a bounded array');
		}
		for (const c of r.restorePointers as unknown[]) {
			const coord = c as Partial<RestorePointerCoord> | null;
			if (
				!coord ||
				!Number.isSafeInteger(coord.day) ||
				(coord.day as number) < 0 ||
				!Number.isSafeInteger(coord.slot) ||
				(coord.slot as number) < 0
			) {
				throw new Error('Account.restorePointers entries must be {day, slot} non-negative integers');
			}
		}
	}
}

/**
 * Strict structural validator for a vault blob row. Same contract as
 * `validateAccountRow` — throws on anything malformed.
 */
export function validateVaultRow(rec: unknown): asserts rec is VaultBlob {
	if (!rec || typeof rec !== 'object') {
		throw new Error('Vault row is not an object');
	}
	const r = rec as Record<string, unknown>;
	if (r.id !== 'singleton') throw new Error("Vault row missing id 'singleton'");
	if (!isUint8Array(r.header)) throw new Error('Vault.header must be Uint8Array');
	if (!isUint8Array(r.nonce) || r.nonce.length !== AES_NONCE_LEN) {
		throw new Error(`Vault.nonce must be ${AES_NONCE_LEN} bytes`);
	}
	if (!isUint8Array(r.ciphertext) || r.ciphertext.length === 0) {
		throw new Error('Vault.ciphertext must be a non-empty Uint8Array');
	}
	if (typeof r.updatedAt !== 'number' || r.updatedAt <= 0) {
		throw new Error('Vault.updatedAt must be a positive timestamp');
	}
}

export function validateQuickUnlockRow(rec: unknown): asserts rec is QuickUnlockRecord {
	if (!rec || typeof rec !== 'object') {
		throw new Error('QuickUnlock row is not an object');
	}
	const r = rec as Record<string, unknown>;
	if (r.id !== 'singleton') throw new Error("QuickUnlock row missing id 'singleton'");
	if (r.version !== QUICK_UNLOCK_VERSION) {
		throw new Error('QuickUnlock.version is not supported');
	}
	if (typeof r.enabled !== 'boolean') {
		throw new Error('QuickUnlock.enabled must be a boolean');
	}
	if (!isUint8Array(r.nonce) || r.nonce.length !== AES_NONCE_LEN) {
		throw new Error(`QuickUnlock.nonce must be ${AES_NONCE_LEN} bytes`);
	}
	if (!isUint8Array(r.ciphertext) || r.ciphertext.length === 0) {
		throw new Error('QuickUnlock.ciphertext must be a non-empty Uint8Array');
	}
	if (typeof r.createdAt !== 'number' || r.createdAt <= 0) {
		throw new Error('QuickUnlock.createdAt must be a positive timestamp');
	}
	if (r.lastUsedAt !== undefined && typeof r.lastUsedAt !== 'number') {
		throw new Error('QuickUnlock.lastUsedAt must be a number');
	}
}

export function validateRecoveryEnvelopeRow(
	rec: unknown
): asserts rec is RecoveryEnvelopeRecord {
	if (!rec || typeof rec !== 'object') {
		throw new Error('RecoveryEnvelope row is not an object');
	}
	const r = rec as Record<string, unknown>;
	if (r.id !== 'singleton') {
		throw new Error("RecoveryEnvelope row missing id 'singleton'");
	}
	if (r.version !== RECOVERY_ENVELOPE_VERSION) {
		throw new Error('RecoveryEnvelope.version is not supported');
	}
	if (typeof r.enabled !== 'boolean') {
		throw new Error('RecoveryEnvelope.enabled must be a boolean');
	}
	if (!isUint8Array(r.salt) || r.salt.length < 16) {
		throw new Error('RecoveryEnvelope.salt must be at least 16 bytes');
	}
	const params = r.params as Argon2idStoredParams | undefined;
	if (
		!params ||
		typeof params.memoryKiB !== 'number' ||
		typeof params.iterations !== 'number' ||
		typeof params.parallelism !== 'number' ||
		typeof params.tagLength !== 'number' ||
		params.tagLength !== 32
	) {
		throw new Error('RecoveryEnvelope.params must be Argon2id params with tagLength=32');
	}
	if (!isUint8Array(r.nonce) || r.nonce.length !== AES_NONCE_LEN) {
		throw new Error(`RecoveryEnvelope.nonce must be ${AES_NONCE_LEN} bytes`);
	}
	if (!isUint8Array(r.ciphertext) || r.ciphertext.length === 0) {
		throw new Error('RecoveryEnvelope.ciphertext must be a non-empty Uint8Array');
	}
	if (typeof r.createdAt !== 'number' || r.createdAt <= 0) {
		throw new Error('RecoveryEnvelope.createdAt must be a positive timestamp');
	}
	if (r.rotatedAt !== undefined && typeof r.rotatedAt !== 'number') {
		throw new Error('RecoveryEnvelope.rotatedAt must be a number');
	}
}

/**
 * Read the singleton account row and validate it. Returns `undefined`
 * only when there is no row at all. Malformed rows throw — callers must
 * route those to `/recover`, never silently to `/vault`.
 */
export async function getAccount(): Promise<AccountRecord | undefined> {
	const row = await db.account.get('singleton');
	if (!row) return undefined;
	validateAccountRow(row);
	return row;
}

/**
 * Honest existence check: a setup is "complete" only when both rows exist
 * AND validate. Prevents the `/vault → /unlock` route guard from sending
 * users to an unlock screen that has nothing to decrypt, or routing them
 * into a vault that would AES-GCM-fail on the first read.
 */
export async function hasAccount(): Promise<boolean> {
	try {
		const [account, vault] = await Promise.all([
			db.account.get('singleton'),
			db.vault.get('singleton')
		]);
		if (!account || !vault) return false;
		validateAccountRow(account);
		validateVaultRow(vault);
		return true;
	} catch {
		// Malformed row — treat as "no account" so the caller can route
		// to /onboarding or /recover. Never expose the underlying error to
		// the route guard, which only needs a boolean.
		return false;
	}
}

export async function saveAccount(rec: Omit<AccountRecord, 'id'>): Promise<void> {
	await db.account.put({ id: 'singleton', ...rec });
}

export async function getVault(): Promise<VaultBlob | undefined> {
	const row = await db.vault.get('singleton');
	if (!row) return undefined;
	validateVaultRow(row);
	return row;
}

export async function getQuickUnlock(): Promise<QuickUnlockRecord | undefined> {
	const row = await db.quickUnlock.get('singleton');
	if (!row) return undefined;
	validateQuickUnlockRow(row);
	return row;
}

export async function getRecoveryEnvelope(): Promise<
	RecoveryEnvelopeRecord | undefined
> {
	const row = await db.recoveryEnvelope.get('singleton');
	if (!row) return undefined;
	validateRecoveryEnvelopeRow(row);
	return row;
}

export async function saveQuickUnlock(
	rec: Omit<QuickUnlockRecord, 'id'>
): Promise<void> {
	await db.quickUnlock.put({ id: 'singleton', ...rec });
}

export async function saveRecoveryEnvelope(
	rec: Omit<RecoveryEnvelopeRecord, 'id'>
): Promise<void> {
	validateRecoveryEnvelopeRow({ id: 'singleton', ...rec });
	await db.recoveryEnvelope.put({ id: 'singleton', ...rec });
}

export async function deleteQuickUnlock(): Promise<void> {
	await db.quickUnlock.delete('singleton');
}

export async function deleteRecoveryEnvelope(): Promise<void> {
	await db.recoveryEnvelope.delete('singleton');
}

export async function saveVault(blob: Omit<VaultBlob, 'id'>): Promise<void> {
	await db.vault.put({ id: 'singleton', ...blob });
}

export async function saveExistingAccountAndVault(
	account: AccountRecord,
	blob: Omit<VaultBlob, 'id'>
): Promise<void> {
	await db.transaction('rw', db.account, db.vault, async () => {
		await db.account.put(account);
		await db.vault.put({ id: 'singleton', ...blob });
	});
}

/**
 * Thrown by `saveAccountAndVault` when a singleton account already
 * exists and the caller did not opt into overwriting it. The fresh-
 * provision path (`provisionVault`) must NEVER clobber an existing
 * vault — a stale onboarding tab, a re-entrant provisioning effect, or
 * a console-driven `goto` that skips the route guard would otherwise
 * silently destroy the user's data. Carries a stable `code` so callers
 * across a dynamic-import boundary can branch without importing the class.
 */
export class AccountExistsError extends Error {
	readonly code = 'account-exists' as const;
	constructor(message = 'A vault already exists on this device.') {
		super(message);
		this.name = 'AccountExistsError';
	}
}

/**
 * Atomic provision: account row + vault row written together. Either
 * both land or neither does; prevents the partial-state where
 * `account.count() > 0` but no decryptable blob exists.
 *
 * Refuses to overwrite an existing account unless `allowOverwrite` is
 * set. The existence check runs INSIDE the read-write transaction, so
 * the check-and-write is atomic: there is no window between "no account
 * exists" and the `put` for a concurrent provision to slip through. The
 * route-level `hasAccount()` guards are advisory UX; this is the
 * authoritative single-writer guarantee. Legitimate overwriters
 * (recovery rebind, auth rotation) pass `{ allowOverwrite: true }`.
 */
export async function saveAccountAndVault(
	account: Omit<AccountRecord, 'id'>,
	blob: Omit<VaultBlob, 'id'>,
	opts: { allowOverwrite?: boolean } = {}
): Promise<void> {
	await db.transaction('rw', db.account, db.vault, async () => {
		if (!opts.allowOverwrite) {
			const existing = await db.account.get('singleton');
			if (existing) {
				throw new AccountExistsError();
			}
		}
		await db.account.put({ id: 'singleton', ...account });
		await db.vault.put({ id: 'singleton', ...blob });
	});
}

/**
 * Record server-sync progress on the account row without rewriting the
 * rest of it. `inventoryIndex` only ever moves forward: two pushes that
 * complete out of order must not rewind the device to an address it has
 * already used (re-writing an address would link the two sessions).
 */
export async function updateAccountSyncState(update: {
	inventoryIndex: number;
	inventoryPushedAt?: number;
}): Promise<void> {
	await db.account
		.where('id')
		.equals('singleton')
		.modify((rec) => {
			rec.inventoryIndex = Math.max(rec.inventoryIndex ?? 0, update.inventoryIndex);
			if (update.inventoryPushedAt !== undefined) {
				rec.inventoryPushedAt = update.inventoryPushedAt;
			}
		});
}

/**
 * Install or clear the wrapped restore root. Clearing (`null`) also
 * forgets every pointer coordinate — the records they name were written
 * under the old root and are the caller's job to delete first.
 * Installing keeps the day/slot reservation so a same-root re-install
 * (passkey rebind on the same device) never reuses an address, but
 * forgets `restorePointerIndex` so the next push writes a fresh record.
 */
export async function setAccountRestoreRoot(
	wrapped: { nonce: Uint8Array; ciphertext: Uint8Array } | null
): Promise<void> {
	await db.account
		.where('id')
		.equals('singleton')
		.modify((rec) => {
			if (wrapped) {
				rec.restoreRootNonce = wrapped.nonce;
				rec.restoreRootCiphertext = wrapped.ciphertext;
				delete rec.restorePointerIndex;
			} else {
				delete rec.restoreRootNonce;
				delete rec.restoreRootCiphertext;
				delete rec.restorePointerDay;
				delete rec.restorePointerSlot;
				delete rec.restorePointerIndex;
				delete rec.restorePointers;
			}
		});
}

/**
 * Reserve a record address (day, slot) BEFORE the upload, so a failed
 * or ambiguous write is never retried at the same address. Clears the
 * success marker until `markRestorePointerWritten` confirms the write.
 */
export async function reserveRestorePointer(coord: RestorePointerCoord): Promise<void> {
	await db.account
		.where('id')
		.equals('singleton')
		.modify((rec) => {
			rec.restorePointerDay = coord.day;
			rec.restorePointerSlot = coord.slot;
			delete rec.restorePointerIndex;
			const keep = (rec.restorePointers ?? []).filter(
				(c) => c.day >= coord.day - RESTORE_POINTER_RETAIN_DAYS
			);
			keep.push({ day: coord.day, slot: coord.slot });
			rec.restorePointers = keep.slice(-RESTORE_POINTER_MAX_TRACKED);
		});
}

export async function markRestorePointerWritten(inventoryIndex: number): Promise<void> {
	await db.account
		.where('id')
		.equals('singleton')
		.modify((rec) => {
			rec.restorePointerIndex = inventoryIndex;
		});
}

export async function clearAll(): Promise<void> {
	await db.transaction(
		'rw',
		[db.account, db.vault, db.quickUnlock, db.recoveryEnvelope, db.audit],
		async () => {
			await db.account.clear();
			await db.vault.clear();
			await db.quickUnlock.clear();
			await db.recoveryEnvelope.clear();
			await db.audit.clear();
		}
	);
}
