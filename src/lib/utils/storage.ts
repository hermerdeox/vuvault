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
}

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

/**
 * Encrypted document file blob row. Stored separately from the
 * whole-vault blob so a single multi-megabyte document does not
 * force re-encryption of every other item on each persist. The
 * server (when sync is wired) sees only `ciphertext` + the routing
 * `id`. AES-GCM happens client-side in `vault-session.ts` using the
 * active session AES key with a document-specific AAD domain.
 */
export interface DocumentBlobRecord {
	/** UUID v4 — referenced by `DocumentItem.docBlobId`. */
	id: string;
	/** 12-byte AES-GCM nonce, generated at seal time. */
	nonce: Uint8Array;
	/** Encrypted file bytes. AAD-bound to the active vault session. */
	ciphertext: Uint8Array;
	/** Plaintext byte length at the time of upload (informational). */
	size: number;
	/** Lowercase hex SHA-256 of the plaintext (integrity display). */
	sha256: string;
	createdAt: number;
}

class VuVaultDB extends Dexie {
	account!: Table<AccountRecord, 'singleton'>;
	vault!: Table<VaultBlob, 'singleton'>;
	quickUnlock!: Table<QuickUnlockRecord, 'singleton'>;
	recoveryEnvelope!: Table<RecoveryEnvelopeRecord, 'singleton'>;
	audit!: Table<AuditPersisted, string>;
	documentBlobs!: Table<DocumentBlobRecord, string>;

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
 * Atomic provision: account row + vault row written together. Either
 * both land or neither does; prevents the partial-state where
 * `account.count() > 0` but no decryptable blob exists.
 */
export async function saveAccountAndVault(
	account: Omit<AccountRecord, 'id'>,
	blob: Omit<VaultBlob, 'id'>
): Promise<void> {
	await db.transaction('rw', db.account, db.vault, async () => {
		await db.account.put({ id: 'singleton', ...account });
		await db.vault.put({ id: 'singleton', ...blob });
	});
}

export async function clearAll(): Promise<void> {
	await db.transaction(
		'rw',
		[
			db.account,
			db.vault,
			db.quickUnlock,
			db.recoveryEnvelope,
			db.audit,
			db.documentBlobs
		],
		async () => {
			await db.account.clear();
			await db.vault.clear();
			await db.quickUnlock.clear();
			await db.recoveryEnvelope.clear();
			await db.audit.clear();
			await db.documentBlobs.clear();
		}
	);
}

// --- Document blob helpers ---------------------------------------------------

/**
 * Strict validator for a document blob row. Throws on anything
 * malformed; never returns a partially populated record.
 */
export function validateDocumentBlobRow(rec: unknown): asserts rec is DocumentBlobRecord {
	if (!rec || typeof rec !== 'object') {
		throw new Error('Document blob row is not an object');
	}
	const r = rec as Record<string, unknown>;
	if (typeof r.id !== 'string' || !r.id) {
		throw new Error('DocumentBlob.id must be a non-empty string');
	}
	if (!isUint8Array(r.nonce) || r.nonce.length !== AES_NONCE_LEN) {
		throw new Error(`DocumentBlob.nonce must be ${AES_NONCE_LEN} bytes`);
	}
	if (!isUint8Array(r.ciphertext) || r.ciphertext.length === 0) {
		throw new Error('DocumentBlob.ciphertext must be a non-empty Uint8Array');
	}
	if (typeof r.size !== 'number' || r.size < 0) {
		throw new Error('DocumentBlob.size must be a non-negative number');
	}
	if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) {
		throw new Error('DocumentBlob.sha256 must be a lowercase hex SHA-256');
	}
	if (typeof r.createdAt !== 'number' || r.createdAt <= 0) {
		throw new Error('DocumentBlob.createdAt must be a positive timestamp');
	}
}

export async function getDocumentBlob(
	id: string
): Promise<DocumentBlobRecord | undefined> {
	const row = await db.documentBlobs.get(id);
	if (!row) return undefined;
	validateDocumentBlobRow(row);
	return row;
}

export async function saveDocumentBlob(rec: DocumentBlobRecord): Promise<void> {
	validateDocumentBlobRow(rec);
	await db.documentBlobs.put(rec);
}

export async function deleteDocumentBlob(id: string): Promise<void> {
	await db.documentBlobs.delete(id);
}

export async function listDocumentBlobIds(): Promise<string[]> {
	const rows = await db.documentBlobs.toCollection().primaryKeys();
	return rows as string[];
}
