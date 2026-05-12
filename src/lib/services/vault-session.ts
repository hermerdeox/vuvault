/**
 * Vault session — orchestrates seal / open against Dexie + AES-GCM.
 *
 * Two on-disk formats coexist:
 *
 *   formatVersion 1 (Milestone 1):
 *     vaultKey = HKDF-SHA512(prfOutput ‖ secretKey [‖ mpk?], deviceSalt, "vuvault-vault-key-v1")
 *     blob     = AES-256-GCM(vaultKey, nonce, plaintext, aad=70 bytes)
 *     header   = empty
 *
 *   formatVersion 2 (Milestone 2):
 *     vaultKey = HKDF-SHA512(prfOutput ‖ secretKey [‖ mpk?] [‖ opaqueExp?],
 *                            deviceSalt, "vuvault-vault-key-v1")
 *     aesKey   = crypto.getRandomValues(32)
 *     wrapped  = wrapAesKey(vaultKey, deviceSalt, aesKey)  -> hybrid envelope
 *     blob     = AES-256-GCM(aesKey, nonce, plaintext, aad)
 *     header   = serializeWrappedKey(wrapped)              -> 1660 bytes
 *
 * The HKDF info string is intentionally `vuvault-vault-key-v1` for both
 * versions — see `src/lib/crypto/derive.ts`. The `formatVersion` byte is
 * bound in AAD instead, which keeps the v1→v2 in-place upgrade path
 * decryptable while still authenticating the format choice.
 *
 * The v2 AAD layout adds the SHA-384 of `header` so the wrapped key
 * cannot be swapped between accounts without breaking decrypt.
 *
 * Format dispatch happens at unlock time off `account.formatVersion`.
 * On the first `saveItems` call after a v1 unlock, we transparently
 * upgrade the on-disk blob to v2 (re-derive the v2 vaultKey from the
 * same factors, generate a fresh AES key, re-encrypt, and bump
 * `account.formatVersion` to 2 in the same atomic transaction).
 *
 * `prfOutput` comes from one of two sources, decided at provisioning
 * time and persisted as `account.authMode`:
 *
 *   production: WebAuthn PRF eval against the user's passkey (32 bytes
 *               returned by the authenticator). Cannot be reproduced
 *               without the original platform authenticator.
 *
 *   demo:       deterministic stand-in derived from the persisted
 *               credentialId + deviceSalt via HMAC-SHA512. Lets the
 *               scaffold demo run on browsers without WebAuthn PRF.
 *               Clearly weaker — security falls to the Secret Key alone
 *               + same-device assumption. Surfaced in UI as such.
 *
 * `vaultKey` and `aesKey` live in module-local closures (not in any
 * Svelte store) so they don't appear in reactive snapshots or DevTools
 * state inspectors. `lockSession()` zeroizes both.
 */

import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { sha384, sha512 } from '@noble/hashes/sha2';
import { deriveVaultKey, generateDeviceSalt } from '$lib/crypto/derive';
import { evaluatePRF } from '$lib/crypto/webauthn-prf';
import { serializeItems, deserializeItems } from '$lib/crypto/vault-codec';
import {
	wrapAesKey,
	unwrapAesKey,
	serializeWrappedKey,
	deserializeWrappedKey
} from './vault-envelope';
import {
	getAccount,
	getVault,
	getDocumentBlob,
	listDocumentBlobIds,
	saveAccountAndVault,
	saveVault,
	saveExistingAccountAndVault,
	saveDocumentBlob,
	type AccountRecord,
	type AuthMode
} from '$lib/utils/storage';
import { isDemoAuthEnabled } from '$lib/utils/env';
import {
	openRecoveryEnvelope,
	sealRecoveryEnvelope,
	type RecoveryEnvelopeSealed
} from '$lib/crypto/recovery-envelope';
import {
	uploadBlob,
	fetchBlob,
	hasSession,
	isSyncWired,
	setSessionToken
} from './sync-client';
import type { VaultItem } from '$lib/stores/vault.svelte';

/** The format version we emit for newly-provisioned vaults. */
export const PROVISION_FORMAT_VERSION = 2;
/** All format versions this build can decrypt. */
export const SUPPORTED_FORMAT_VERSIONS = new Set([1, 2]);

const PRF_OUTPUT_LEN = 32;
const SECRET_KEY_LEN = 32;
const DEVICE_SALT_LEN = 16;
const AES_NONCE_LEN = 12;
const AES_KEY_LEN = 32;

let vaultKey: Uint8Array | null = null;
let aesKey: Uint8Array | null = null; // v2 only; null for v1 sessions
let activeAuthMode: AuthMode | null = null;
let activeFormatVersion: number | null = null;

/**
 * Monotonic per-session sequence clock. Initialized to 0 on
 * `openVault()`; bumped to `serverHigh + 1` whenever a successful
 * pull tells us the server has a higher value; bumped on every
 * push so re-uploads from the same session strictly increase.
 *
 * The Worker rejects any upload whose `sequenceClock <= server's
 * stored clock`, so this matches the server-side CRDT merge rule.
 *
 * Reset to 0 on `lockSession()`.
 */
let sequenceClock = 0;

/**
 * `BlobBytes` is the on-the-wire shape of a v2 vault upload. The
 * three components match `vault.header / .nonce / .ciphertext` from
 * `storage.ts`. Helpers to convert to/from the base64 wire format
 * the sync client expects.
 */
type BlobBytes = {
	header: Uint8Array;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
};

function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Sync observer — caller-provided callbacks invoked when sync
 * push/pull operations complete or fail. The vault store wires
 * these to `audit.push(...)` calls; tests leave them as no-ops.
 *
 * Decoupling is deliberate: vault-session has no direct dependency
 * on the audit store. That keeps `vault-session.test.ts`'s
 * fake-indexeddb harness from needing Svelte runes context.
 */
export type SyncObserver = {
	onPushSuccess?(info: { sequenceClock: number; bytes: number }): void;
	onPushFailure?(info: { reason: string; message: string }): void;
	onPullPromoted?(info: { sequenceClock: number }): void;
	onPullSkipped?(info: { reason: string }): void;
};

export type SyncNowResult =
	| { status: 'not-wired'; message: string }
	| { status: 'no-session'; message: string }
	| { status: 'locked'; message: string }
	| { status: 'local-newer'; message: string }
	| { status: 'promoted'; message: string; sequenceClock: number; items: VaultItem[] }
	| { status: 'failed'; message: string };

let syncObserver: SyncObserver = {};

export function setSyncObserver(observer: SyncObserver): void {
	syncObserver = observer ?? {};
}

function blobBytesSize(blob: BlobBytes): number {
	return blob.header.length + blob.nonce.length + blob.ciphertext.length;
}

/**
 * Push the just-saved blob to the sync server. Fire-and-forget at
 * the call site (caller does not await this); failures are logged
 * to the observer and never propagate. Strictly bumps the local
 * sequence clock on success.
 */
async function pushBlobToServer(blob: BlobBytes): Promise<void> {
	if (!isSyncWired() || !hasSession()) return;
	const next = sequenceClock + 1;
	const result = await uploadBlob({
		op: 'blob-upload',
		accountId: '', // Worker derives from session token; field unused.
		deviceId: '', // ditto
		sequenceClock: next,
		header: bytesToBase64(blob.header),
		nonce: bytesToBase64(blob.nonce),
		ciphertext: bytesToBase64(blob.ciphertext),
		updatedAt: Date.now(),
		formatVersion: 2
	});
	if (!result.ok) {
		syncObserver.onPushFailure?.({ reason: result.reason, message: result.message });
		return;
	}
	sequenceClock = result.value.sequenceClock;
	syncObserver.onPushSuccess?.({
		sequenceClock: result.value.sequenceClock,
		bytes: blobBytesSize(blob)
	});
}

/**
 * Pull the latest blob from the server and, if its sequence clock
 * exceeds our local one, return it for the caller to decrypt and
 * promote. Returns `null` when there's no remote progress to
 * adopt — the local copy stays authoritative.
 */
async function pullBlobFromServer(): Promise<BlobBytes | null> {
	if (!isSyncWired() || !hasSession()) {
		syncObserver.onPullSkipped?.({ reason: 'not-wired' });
		return null;
	}
	const result = await fetchBlob({
		op: 'blob-fetch',
		accountId: '',
		deviceId: ''
	});
	if (!result.ok) {
		// 404 (no blob) is the common "first launch on a fresh
		// device" path — treat as skipped, not error.
		syncObserver.onPullSkipped?.({ reason: result.reason });
		return null;
	}
	const remoteClock = result.value.sequenceClock;
	if (remoteClock <= sequenceClock) {
		syncObserver.onPullSkipped?.({ reason: 'local-newer' });
		return null;
	}
	syncObserver.onPullPromoted?.({ sequenceClock: remoteClock });
	sequenceClock = remoteClock;
	return {
		header: base64ToBytes(result.value.header),
		nonce: base64ToBytes(result.value.nonce),
		ciphertext: base64ToBytes(result.value.ciphertext)
	};
}

export async function syncNow(): Promise<SyncNowResult> {
	if (!isSyncWired()) {
		return { status: 'not-wired', message: 'Sync server not configured.' };
	}
	if (!hasSession()) {
		return { status: 'no-session', message: 'No active sync session. Unlock with OPAQUE to sync.' };
	}
	if (!vaultKey || !aesKey) {
		return { status: 'locked', message: 'Vault must be unlocked before syncing.' };
	}
	const account = await getAccount();
	if (!account) return { status: 'failed', message: 'Account row missing.' };
	if (account.formatVersion !== PROVISION_FORMAT_VERSION) {
		return {
			status: 'failed',
			message: 'Sync requires a formatVersion 2 vault. Save once to upgrade.'
		};
	}
	try {
		const localVault = await getVault();
		if (localVault) {
			await pushBlobToServer({
				header: localVault.header,
				nonce: localVault.nonce,
				ciphertext: localVault.ciphertext
			});
		}
		const remote = await pullBlobFromServer();
		if (!remote) {
			return { status: 'local-newer', message: 'No newer remote vault found.' };
		}
		const remoteAad = makeAad(
			account.formatVersion,
			account.authMode,
			account.deviceSalt,
			account.credentialId,
			remote.header
		);
		const remoteWrapped = deserializeWrappedKey(remote.header);
		const remoteAesKey = unwrapAesKey(vaultKey, account.deviceSalt, remoteWrapped);
		try {
			const remotePlaintext = openBlob(remoteAesKey, remote.nonce, remote.ciphertext, remoteAad);
			const remoteItems = deserializeItems(remotePlaintext);
			await saveVault({
				header: remote.header,
				nonce: remote.nonce,
				ciphertext: remote.ciphertext,
				updatedAt: Date.now()
			});
			const previousAesKey = aesKey;
			aesKey = remoteAesKey;
			if (previousAesKey && previousAesKey !== remoteAesKey) zeroize(previousAesKey);
			return {
				status: 'promoted',
				message: 'Pulled newer vault from sync server.',
				sequenceClock,
				items: remoteItems
			};
		} catch (err) {
			zeroize(remoteAesKey);
			throw err;
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Sync failed.';
		syncObserver.onPullSkipped?.({ reason: 'sync-now-failed' });
		return { status: 'failed', message };
	}
}

function zeroize(buf: Uint8Array | null): void {
	if (buf) buf.fill(0);
}

const AAD_DOMAIN = new TextEncoder().encode('vuvault-vault-aad-v1');
const AUTH_MODE_TAG: Record<AuthMode, number> = {
	production: 0x01,
	demo: 0x02
};

/**
 * Build associated-data bytes that MUST be present at both seal and
 * open time. v1 binds:
 *   domain ‖ versionByte ‖ authModeByte ‖ deviceSalt(16) ‖ SHA-384(credentialId)[0..32]
 *
 * v2 additionally appends SHA-384(header)[0..32] so the wrapped AES
 * key cannot be silently swapped between accounts.
 */
function makeAad(
	formatVersion: number,
	authMode: AuthMode,
	deviceSalt: Uint8Array,
	credentialId: ArrayBuffer,
	header: Uint8Array
): Uint8Array {
	const credBytes = new Uint8Array(credentialId);
	const credDigest = sha384(credBytes).slice(0, 32);
	const v2HeaderDigest = formatVersion >= 2 ? sha384(header).slice(0, 32) : null;

	const len =
		AAD_DOMAIN.length +
		1 +
		1 +
		deviceSalt.length +
		credDigest.length +
		(v2HeaderDigest ? v2HeaderDigest.length : 0);
	const out = new Uint8Array(len);
	let off = 0;
	out.set(AAD_DOMAIN, off);
	off += AAD_DOMAIN.length;
	out[off++] = formatVersion & 0xff;
	out[off++] = AUTH_MODE_TAG[authMode];
	out.set(deviceSalt, off);
	off += deviceSalt.length;
	out.set(credDigest, off);
	off += credDigest.length;
	if (v2HeaderDigest) {
		out.set(v2HeaderDigest, off);
	}
	return out;
}

function sealBlob(
	key: Uint8Array,
	plaintext: Uint8Array,
	aad: Uint8Array
): { nonce: Uint8Array; ciphertext: Uint8Array } {
	const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN));
	const ciphertext = gcm(key, nonce, aad).encrypt(plaintext);
	return { nonce, ciphertext };
}

function openBlob(
	key: Uint8Array,
	nonce: Uint8Array,
	ciphertext: Uint8Array,
	aad: Uint8Array
): Uint8Array {
	return gcm(key, nonce, aad).decrypt(ciphertext);
}

// -----------------------------------------------------------------------------
// Document blob crypto
// -----------------------------------------------------------------------------
//
// Documents live in their own Dexie table (`documentBlobs`) so a single
// multi-megabyte file doesn't force re-encryption of every other vault
// item on each persist. The seal uses the SAME session AES key as the
// rest of the vault — losing the document blob to a server-side breach
// doesn't help the attacker because they still need PRF + Secret Key
// (+ optional MPK + OPAQUE) to derive that key.
//
// The AAD domain is distinct (`vuvault-doc-aad-v1`) so a document blob
// cannot be silently replayed as a whole-vault blob, and is bound to:
//   domain ‖ blobId(utf8) ‖ deviceSaltDigest(32) ‖ credDigest(32)
//
// `blobId` is the random UUID assigned to the document at upload time,
// which is also the Dexie primary key and the R2 object key suffix.

const DOC_AAD_DOMAIN = new TextEncoder().encode('vuvault-doc-aad-v1');

function makeDocAad(
	blobId: string,
	deviceSalt: Uint8Array,
	credentialId: ArrayBuffer
): Uint8Array {
	const idBytes = new TextEncoder().encode(blobId);
	const credBytes = new Uint8Array(credentialId);
	const credDigest = sha384(credBytes).slice(0, 32);
	const saltDigest = sha384(deviceSalt).slice(0, 32);
	const len =
		DOC_AAD_DOMAIN.length +
		2 +
		idBytes.length +
		saltDigest.length +
		credDigest.length;
	const out = new Uint8Array(len);
	let off = 0;
	out.set(DOC_AAD_DOMAIN, off);
	off += DOC_AAD_DOMAIN.length;
	// Length-prefix the blob id so the AAD remains unambiguous if a
	// future migration changes the id format.
	out[off++] = (idBytes.length >>> 8) & 0xff;
	out[off++] = idBytes.length & 0xff;
	out.set(idBytes, off);
	off += idBytes.length;
	out.set(saltDigest, off);
	off += saltDigest.length;
	out.set(credDigest, off);
	return out;
}

export type SealedDocument = {
	blobId: string;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
	size: number;
	sha256Hex: string;
};

/**
 * Encrypt a document's plaintext bytes under the active session AES
 * key with a document-scoped AAD. Returns the seal envelope plus a
 * SHA-256 of the plaintext for integrity display. Requires the vault
 * to be unlocked — fails closed otherwise.
 */
export async function sealDocument(
	plaintext: Uint8Array,
	opts: { blobId?: string } = {}
): Promise<SealedDocument> {
	if (!aesKey) {
		throw new Error('sealDocument: vault must be unlocked first');
	}
	const account = await getAccount();
	if (!account) {
		throw new Error('sealDocument: account row missing');
	}
	const blobId = opts.blobId ?? crypto.randomUUID();
	const aad = makeDocAad(blobId, account.deviceSalt, account.credentialId);
	const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN));
	const ciphertext = gcm(aesKey, nonce, aad).encrypt(plaintext);
	const digest = sha256(plaintext);
	let hex = '';
	for (const b of digest) hex += b.toString(16).padStart(2, '0');
	return {
		blobId,
		nonce,
		ciphertext,
		size: plaintext.length,
		sha256Hex: hex
	};
}

/**
 * Decrypt a previously sealed document. Throws on AES-GCM auth
 * failure (wrong vault, tampered blob, mismatched blobId AAD, etc.).
 */
export async function openDocument(input: {
	blobId: string;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
}): Promise<Uint8Array> {
	if (!aesKey) {
		throw new Error('openDocument: vault must be unlocked first');
	}
	const account = await getAccount();
	if (!account) {
		throw new Error('openDocument: account row missing');
	}
	const aad = makeDocAad(input.blobId, account.deviceSalt, account.credentialId);
	return gcm(aesKey, input.nonce, aad).decrypt(input.ciphertext);
}

/** Public hex SHA-256 helper for parity tests / UI integrity hashes. */
export function sha256Hex(bytes: Uint8Array): string {
	const digest = sha256(bytes);
	let hex = '';
	for (const b of digest) hex += b.toString(16).padStart(2, '0');
	return hex;
}

/**
 * Derive a stable per-account "demo PRF" stand-in from data already
 * on this device. NOT zero-knowledge — present for scaffold demos
 * only. Clearly tagged via account.authMode = 'demo'.
 */
function deriveDemoPrfOutput(
	credentialId: ArrayBuffer,
	deviceSalt: Uint8Array
): Uint8Array {
	const credBytes = new Uint8Array(credentialId);
	return hmac(sha512, deviceSalt, credBytes).slice(0, PRF_OUTPUT_LEN);
}

/**
 * Resolve the PRF output for the current account at unlock time.
 * Production: real WebAuthn PRF (fail-closed if unavailable).
 * Demo: deterministic re-derivation.
 */
async function resolvePrfOutput(account: AccountRecord): Promise<Uint8Array> {
	if (account.authMode === 'demo') {
		return deriveDemoPrfOutput(account.credentialId, account.deviceSalt);
	}
	const out = await evaluatePRF({
		credentialId: account.credentialId,
		salt: account.deviceSalt
	});
	if (!out) {
		throw new Error(
			'Authenticator did not return a PRF output. ' +
				'Use the same device that registered this vault, or recover via your Emergency Kit.'
		);
	}
	if (out.length !== PRF_OUTPUT_LEN) {
		throw new Error(`PRF output has unexpected length ${out.length}`);
	}
	return out;
}

export type ProvisionInput = {
	deviceLabel: string;
	secretKey: Uint8Array;
	credentialId: ArrayBuffer;
	credentialPublicKey: ArrayBuffer;
	authMode: AuthMode;
	prfOutput: Uint8Array | null; // ignored when authMode = 'demo'
	deviceSalt: Uint8Array; // shared between PRF eval and HKDF
	plan?: 'free' | 'paid';
	/**
	 * Optional OPAQUE export key from a successful registration. When
	 * present, the v2 vaultKey is derived with this third factor; the
	 * caller is responsible for re-running OPAQUE login on every
	 * unlock to re-derive the same export key.
	 */
	opaqueExportKey?: Uint8Array;
	/**
	 * Optional Argon2id-derived master-password key (32 bytes). When
	 * present, the v2 vaultKey includes this in the HKDF IKM and the
	 * persisted account row records `masterPasswordEnabled = true`.
	 */
	masterPasswordKey?: Uint8Array;
};

export type ProvisionResult = {
	deviceSalt: Uint8Array;
	accountCreatedAt: number;
	formatVersion: number;
};

export { generateDeviceSalt };

/**
 * Provision a fresh vault. Always emits format v2: derives the v2
 * vaultKey, generates a fresh AES key, wraps it under the hybrid
 * envelope, AES-GCM-encrypts an empty items array, and persists
 * account + vault rows atomically.
 */
export async function provisionVault(opts: ProvisionInput): Promise<ProvisionResult> {
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`Secret Key must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}
	if (opts.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(`Device salt must be ${DEVICE_SALT_LEN} bytes`);
	}
	if (opts.authMode === 'demo' && !isDemoAuthEnabled()) {
		throw new Error(
			'Demo auth mode is disabled in this build. Re-register on a device with WebAuthn PRF support.'
		);
	}

	let prf: Uint8Array;
	if (opts.authMode === 'demo') {
		prf = deriveDemoPrfOutput(opts.credentialId, opts.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			throw new Error(
				`Production provisioning requires a real ${PRF_OUTPUT_LEN}-byte PRF output`
			);
		}
		prf = opts.prfOutput;
	}

	const newVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: opts.deviceSalt,
		masterPasswordKey: opts.masterPasswordKey,
		opaqueExportKey: opts.opaqueExportKey,
		version: 2
	});

	const newAesKey = crypto.getRandomValues(new Uint8Array(AES_KEY_LEN));
	let header: Uint8Array;
	let nonce: Uint8Array;
	let ciphertext: Uint8Array;
	try {
		const wrapped = wrapAesKey(newVaultKey, opts.deviceSalt, newAesKey);
		header = serializeWrappedKey(wrapped);
		const plaintext = serializeItems([]);
		const aad = makeAad(
			PROVISION_FORMAT_VERSION,
			opts.authMode,
			opts.deviceSalt,
			opts.credentialId,
			header
		);
		const sealed = sealBlob(newAesKey, plaintext, aad);
		nonce = sealed.nonce;
		ciphertext = sealed.ciphertext;
	} catch (err) {
		// Always zero the key material we derived if the seal pipeline
		// blows up part-way through.
		zeroize(newVaultKey);
		zeroize(newAesKey);
		zeroize(prf);
		throw err;
	}

	const now = Date.now();
	try {
		await saveAccountAndVault(
			{
				deviceLabel: opts.deviceLabel,
				deviceSalt: opts.deviceSalt,
				credentialId: opts.credentialId,
				credentialPublicKey: opts.credentialPublicKey,
				authMode: opts.authMode,
				formatVersion: PROVISION_FORMAT_VERSION,
				createdAt: now,
				plan: opts.plan ?? 'free'
			},
			{ header, nonce, ciphertext, updatedAt: now }
		);
	} catch (err) {
		zeroize(newVaultKey);
		zeroize(newAesKey);
		zeroize(prf);
		throw err;
	}

	if (opts.authMode === 'demo') {
		zeroize(prf);
	}

	vaultKey = newVaultKey;
	aesKey = newAesKey;
	activeAuthMode = opts.authMode;
	activeFormatVersion = PROVISION_FORMAT_VERSION;
	return {
		deviceSalt: opts.deviceSalt,
		accountCreatedAt: now,
		formatVersion: PROVISION_FORMAT_VERSION
	};
}

export type OpenInput = {
	secretKey: Uint8Array;
	/**
	 * Optional already-evaluated PRF output. Used by trusted-device quick
	 * unlock so a single Touch ID ceremony can both unseal the cached
	 * Secret Key and open the vault.
	 */
	prfOutput?: Uint8Array;
	/**
	 * Optional OPAQUE export key. Required when re-opening a v2 vault
	 * that was provisioned with one. Callers without an OPAQUE export
	 * key for an OPAQUE-enrolled account will get an authenticated
	 * decrypt failure.
	 */
	opaqueExportKey?: Uint8Array;
	/**
	 * Optional Argon2id-derived master-password key. Required when
	 * `account.masterPasswordEnabled === true`. Same fail-closed
	 * behavior as `opaqueExportKey` — wrong / missing key yields an
	 * AES-GCM authentication failure, never a misleading silent
	 * success.
	 */
	masterPasswordKey?: Uint8Array;
};

export type RecoveryOpenInput = {
	secretKey: Uint8Array;
	recoveryPassword: string;
	envelope: RecoveryEnvelopeSealed;
};

export type RecoveryRebindInput = {
	secretKey: Uint8Array;
	credentialId: ArrayBuffer;
	credentialPublicKey: ArrayBuffer;
	authMode: AuthMode;
	prfOutput: Uint8Array | null;
	deviceSalt: Uint8Array;
};

/**
 * Open the persisted vault. Dispatches on `account.formatVersion`:
 *
 *   v1 → derive v1 vaultKey, decrypt blob with AES-GCM(vaultKey).
 *   v2 → derive v2 vaultKey, unwrap header → aesKey, decrypt blob.
 */
export async function openVault(opts: OpenInput): Promise<VaultItem[]> {
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`Secret Key must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}

	const account = await getAccount();
	if (!account) throw new Error('No account found');
	if (!SUPPORTED_FORMAT_VERSIONS.has(account.formatVersion)) {
		throw new Error(
			`Unsupported vault formatVersion ${account.formatVersion}. ` +
				'Update the app or reinstall to the version that wrote this vault.'
		);
	}
	const vaultRow = await getVault();
	if (!vaultRow) throw new Error('No vault found');

	const prfOutput = opts.prfOutput ?? (await resolvePrfOutput(account));
	if (prfOutput.length !== PRF_OUTPUT_LEN) {
		throw new Error(`PRF output has unexpected length ${prfOutput.length}`);
	}

	const v = account.formatVersion as 1 | 2;
	if (account.masterPasswordEnabled && !opts.masterPasswordKey) {
		if (!opts.prfOutput) zeroize(prfOutput);
		throw new Error(
			'This vault has a master password — provide it before unlocking.'
		);
	}
	const newVaultKey = deriveVaultKey({
		prfOutput,
		secretKey: opts.secretKey,
		deviceSalt: account.deviceSalt,
		masterPasswordKey: opts.masterPasswordKey,
		opaqueExportKey: v === 2 ? opts.opaqueExportKey : undefined,
		version: v
	});

	const aad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		vaultRow.header
	);

	let plaintext: Uint8Array;
	let newAesKey: Uint8Array | null = null;
	try {
		if (v === 1) {
			plaintext = openBlob(newVaultKey, vaultRow.nonce, vaultRow.ciphertext, aad);
		} else {
			const wrapped = deserializeWrappedKey(vaultRow.header);
			newAesKey = unwrapAesKey(newVaultKey, account.deviceSalt, wrapped);
			plaintext = openBlob(newAesKey, vaultRow.nonce, vaultRow.ciphertext, aad);
		}
	} catch (err) {
		zeroize(newVaultKey);
		if (newAesKey) zeroize(newAesKey);
		if (!opts.prfOutput) zeroize(prfOutput);
		throw new Error(
			'Vault decryption failed. Check your Secret Key and that you are on the registered device.',
			{ cause: err }
		);
	}

	if (!opts.prfOutput) zeroize(prfOutput);
	vaultKey = newVaultKey;
	aesKey = newAesKey;
	activeAuthMode = account.authMode;
	activeFormatVersion = account.formatVersion;
	sequenceClock = 0;

	// Race the local read against a server pull. If the remote has a
	// strictly higher sequence clock, decrypt that blob with the
	// current vaultKey + aesKey, persist locally, and return its
	// items. Otherwise the local plaintext wins. Pull failures
	// (offline, server down, no remote blob yet) drop us to local.
	let items = deserializeItems(plaintext);
	if (account.authMode === 'production' && v === 2) {
		try {
			const remote = await pullBlobFromServer();
			if (remote && newAesKey) {
				const remoteAad = makeAad(
					account.formatVersion,
					account.authMode,
					account.deviceSalt,
					account.credentialId,
					remote.header
				);
				try {
					const remotePlaintext = openBlob(
						newAesKey,
						remote.nonce,
						remote.ciphertext,
						remoteAad
					);
					const remoteItems = deserializeItems(remotePlaintext);
					await saveVault({
						header: remote.header,
						nonce: remote.nonce,
						ciphertext: remote.ciphertext,
						updatedAt: Date.now()
					});
					items = remoteItems;
				} catch {
					// Remote blob couldn't be decrypted with our local
					// keys — likely produced by a different account or
					// a tampered AAD. Local wins and the observer was
					// already notified by pullBlobFromServer.
					syncObserver.onPullSkipped?.({ reason: 'remote-decrypt-failed' });
				}
			}
		} catch {
			// Pull threw — treat exactly like a soft failure.
			syncObserver.onPullSkipped?.({ reason: 'pull-crashed' });
		}
	}

	return items;
}

export async function sealActiveRecoveryEnvelope(opts: {
	secretKey: Uint8Array;
	recoveryPassword: string;
}): Promise<RecoveryEnvelopeSealed> {
	if (!aesKey) {
		throw new Error('sealActiveRecoveryEnvelope: vault must be unlocked first');
	}
	const account = await getAccount();
	if (!account) throw new Error('sealActiveRecoveryEnvelope: account row missing');
	return sealRecoveryEnvelope({
		aesKey,
		secretKey: opts.secretKey,
		recoveryPassword: opts.recoveryPassword,
		context: {
			deviceSalt: account.deviceSalt,
			credentialId: account.credentialId,
			formatVersion: account.formatVersion,
			authMode: account.authMode
		}
	});
}

export async function openVaultWithRecoveryEnvelope(
	opts: RecoveryOpenInput
): Promise<VaultItem[]> {
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(
			`Secret Key must be ${SECRET_KEY_LEN} bytes (got ${opts.secretKey.length})`
		);
	}
	const account = await getAccount();
	if (!account) throw new Error('No account found');
	if (account.formatVersion !== PROVISION_FORMAT_VERSION) {
		throw new Error('Recovery Envelope requires a formatVersion 2 vault.');
	}
	const vaultRow = await getVault();
	if (!vaultRow) throw new Error('No vault found');

	const recoveredAesKey = await openRecoveryEnvelope({
		envelope: opts.envelope,
		secretKey: opts.secretKey,
		recoveryPassword: opts.recoveryPassword,
		context: {
			deviceSalt: account.deviceSalt,
			credentialId: account.credentialId,
			formatVersion: account.formatVersion,
			authMode: account.authMode
		}
	});

	const aad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		vaultRow.header
	);
	try {
		const plaintext = openBlob(recoveredAesKey, vaultRow.nonce, vaultRow.ciphertext, aad);
		const items = deserializeItems(plaintext);
		zeroize(vaultKey);
		zeroize(aesKey);
		vaultKey = null;
		aesKey = recoveredAesKey;
		activeAuthMode = account.authMode;
		activeFormatVersion = account.formatVersion;
		sequenceClock = 0;
		return items;
	} catch (err) {
		zeroize(recoveredAesKey);
		throw new Error('Recovery Envelope opened, but vault decryption failed.', {
			cause: err
		});
	}
}

export async function rebindRecoveredVault(opts: RecoveryRebindInput): Promise<void> {
	if (!aesKey) {
		throw new Error('rebindRecoveredVault: recovery session must be open first');
	}
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(`rebindRecoveredVault: secretKey must be ${SECRET_KEY_LEN} bytes`);
	}
	if (opts.deviceSalt.length !== DEVICE_SALT_LEN) {
		throw new Error(`rebindRecoveredVault: deviceSalt must be ${DEVICE_SALT_LEN} bytes`);
	}
	const previousAccount = await getAccount();
	if (!previousAccount) throw new Error('rebindRecoveredVault: account row missing');
	const vaultRow = await getVault();
	if (!vaultRow) throw new Error('rebindRecoveredVault: vault row missing');
	const oldAesKey = aesKey;
	const oldDocAadInputs = {
		deviceSalt: previousAccount.deviceSalt,
		credentialId: previousAccount.credentialId
	};

	let prf: Uint8Array;
	if (opts.authMode === 'demo') {
		prf = deriveDemoPrfOutput(opts.credentialId, opts.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			throw new Error('rebindRecoveredVault: production rebind requires PRF output');
		}
		prf = opts.prfOutput;
	}

	const nextVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: opts.deviceSalt,
		version: 2
	});
	const wrapped = wrapAesKey(nextVaultKey, opts.deviceSalt, oldAesKey);
	const header = serializeWrappedKey(wrapped);
	const aad = makeAad(
		PROVISION_FORMAT_VERSION,
		opts.authMode,
		opts.deviceSalt,
		opts.credentialId,
		header
	);
	const plaintext = openBlob(
		oldAesKey,
		vaultRow.nonce,
		vaultRow.ciphertext,
		makeAad(
			previousAccount.formatVersion,
			previousAccount.authMode,
			previousAccount.deviceSalt,
			previousAccount.credentialId,
			vaultRow.header
		)
	);
	const sealed = sealBlob(oldAesKey, plaintext, aad);
	const now = Date.now();
	const nextAccount: Omit<AccountRecord, 'id'> = {
		deviceLabel: previousAccount.deviceLabel,
		deviceSalt: opts.deviceSalt,
		credentialId: opts.credentialId,
		credentialPublicKey: opts.credentialPublicKey,
		authMode: opts.authMode,
		formatVersion: PROVISION_FORMAT_VERSION,
		createdAt: previousAccount.createdAt,
		plan: previousAccount.plan,
		masterPasswordEnabled: false,
		opaqueState: 'none'
	};

	await saveAccountAndVault(nextAccount, {
		header,
		nonce: sealed.nonce,
		ciphertext: sealed.ciphertext,
		updatedAt: now
	});

	const ids = await listDocumentBlobIds();
	for (const id of ids) {
		const doc = await getDocumentBlob(id);
		if (!doc) continue;
		const plaintextDoc = gcm(
			oldAesKey,
			doc.nonce,
			makeDocAad(id, oldDocAadInputs.deviceSalt, oldDocAadInputs.credentialId)
		).decrypt(doc.ciphertext);
		const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_LEN));
		const ciphertext = gcm(
			oldAesKey,
			nonce,
			makeDocAad(id, opts.deviceSalt, opts.credentialId)
		).encrypt(plaintextDoc);
		await saveDocumentBlob({
			...doc,
			nonce,
			ciphertext
		});
		zeroize(plaintextDoc);
	}

	zeroize(vaultKey);
	vaultKey = nextVaultKey;
	aesKey = oldAesKey;
	activeAuthMode = opts.authMode;
	activeFormatVersion = PROVISION_FORMAT_VERSION;
	if (opts.authMode === 'demo') zeroize(prf);
}

/**
 * Re-seal the items list and persist it. Called by the vault store
 * after every mutation (debounced). Transparent v1 → v2 upgrade
 * happens here on the first save after a v1 unlock.
 */
export async function saveItems(items: VaultItem[]): Promise<void> {
	if (!vaultKey) {
		throw new Error('saveItems: no active vault session');
	}
	const account = await getAccount();
	if (!account) throw new Error('saveItems: account row missing');

	const targetVersion = PROVISION_FORMAT_VERSION; // always upgrade-on-write to v2
	const upgrading = account.formatVersion !== targetVersion;
	const plaintext = serializeItems(items);

	// `targetVersion` is fixed to v2 in this build. Earlier prototypes
	// kept a v1 write branch here; that's now dead code. If a future
	// milestone adds v3, this is the call site that branches on it.

	// v2 path: rotate / fresh AES key, re-wrap, re-seal.
	let activeAesKey = aesKey;
	if (upgrading || !activeAesKey) {
		// First save after a v1 unlock (or recovery path): generate a
		// fresh AES key and adopt v2 going forward.
		activeAesKey = crypto.getRandomValues(new Uint8Array(AES_KEY_LEN));
	}
	const wrapped = wrapAesKey(vaultKey, account.deviceSalt, activeAesKey);
	const header = serializeWrappedKey(wrapped);
	const aad = makeAad(
		targetVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		header
	);
	const sealed = sealBlob(activeAesKey, plaintext, aad);
	zeroize(plaintext);
	const writtenBlob: BlobBytes = {
		header,
		nonce: sealed.nonce,
		ciphertext: sealed.ciphertext
	};
	const updatedAt = Date.now();
	if (upgrading) {
		const nextAccount: AccountRecord = {
			...account,
			formatVersion: targetVersion
		};
		await saveExistingAccountAndVault(nextAccount, {
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt
		});
		activeFormatVersion = targetVersion;
	} else {
		await saveVault({
			header,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			updatedAt
		});
	}
	// Fire-and-forget upload to the sync server. The local Dexie
	// write is the source of truth; if upload fails (network down,
	// rate-limited, etc.) the observer logs and we move on. The
	// next saveItems call retries with a higher sequence clock.
	void pushBlobToServer(writtenBlob).catch((err) => {
		syncObserver.onPushFailure?.({
			reason: 'unhandled',
			message: err instanceof Error ? err.message : 'sync push crashed'
		});
	});
	aesKey = activeAesKey;
}

export type RotateAuthInput = {
	/** Re-evaluated PRF output (or demo stand-in) for the active account. */
	prfOutput: Uint8Array | null;
	/** The user's Secret Key, freshly decoded for this rotation. */
	secretKey: Uint8Array;
	/**
	 * New master-password key, or `undefined` to leave unchanged, or
	 * `null` to explicitly disable a previously-enabled master
	 * password.
	 */
	masterPasswordKey?: Uint8Array | null;
	/**
	 * If `masterPasswordKey` is being set, the salt + Argon2id params
	 * to persist on the account row. Required when enabling.
	 */
	masterPasswordSalt?: Uint8Array;
	masterPasswordParams?: import('$lib/utils/storage').Argon2idStoredParams;
	/**
	 * New OPAQUE export key, or `undefined` to leave unchanged, or
	 * `null` to disable a previous OPAQUE enrolment.
	 */
	opaqueExportKey?: Uint8Array | null;
	opaqueAccountId?: string;
	opaqueServerId?: string;
	opaqueClientId?: string;
};

/**
 * Rotate the authentication factors on an unlocked vault. Re-derives
 * the v2 vaultKey under the new factor set, generates a fresh AES key,
 * re-encrypts the entire item list, and updates `account` + `vault`
 * atomically. The module-scope `vaultKey` / `aesKey` are swapped so
 * subsequent `saveItems` calls use the new factors.
 *
 * The CALLER must provide:
 *   - a fresh `prfOutput` (production: re-evaluate WebAuthn PRF;
 *     demo: re-derive deterministically)
 *   - the user's `secretKey` (decoded freshly from input)
 *
 * Without those two we can't re-derive vaultKey at all, so this
 * function refuses to proceed if either is missing.
 */
export async function rotateAuth(opts: RotateAuthInput): Promise<void> {
	if (!isSessionActive() || !vaultKey) {
		throw new Error('rotateAuth: vault must be unlocked first');
	}
	if (opts.secretKey.length !== SECRET_KEY_LEN) {
		throw new Error(`rotateAuth: secretKey must be ${SECRET_KEY_LEN} bytes`);
	}

	const account = await getAccount();
	if (!account) throw new Error('rotateAuth: account row missing');

	let prf: Uint8Array;
	if (account.authMode === 'demo') {
		prf = deriveDemoPrfOutput(account.credentialId, account.deviceSalt);
	} else {
		if (!opts.prfOutput || opts.prfOutput.length !== PRF_OUTPUT_LEN) {
			throw new Error('rotateAuth: production rotation requires fresh PRF output');
		}
		prf = opts.prfOutput;
	}

	// Decide the next factor configuration:
	//   undefined → keep current value
	//   null      → disable (clear from account row)
	//   Uint8Array → enable / replace
	const nextMasterPasswordKey =
		opts.masterPasswordKey === undefined
			? undefined // unchanged — re-derive WITHOUT MPK input means "current"
			: opts.masterPasswordKey;
	const nextOpaqueExportKey =
		opts.opaqueExportKey === undefined ? undefined : opts.opaqueExportKey;

	if (nextMasterPasswordKey instanceof Uint8Array) {
		if (!opts.masterPasswordSalt || opts.masterPasswordSalt.length === 0) {
			throw new Error(
				'rotateAuth: enabling master password requires a fresh salt'
			);
		}
		if (
			!opts.masterPasswordParams ||
			opts.masterPasswordParams.tagLength !== 32
		) {
			throw new Error('rotateAuth: masterPasswordParams.tagLength must be 32');
		}
	}

	// To preserve the current MPK (when unchanged), we'd need it cached.
	// Today we don't cache it. Be explicit: rotateAuth requires the
	// caller to pass null/undefined/Uint8Array intentionally, and
	// `undefined` means "the rotation does not involve MPK at all"
	// (current state is preserved). The same applies to
	// opaqueExportKey. If the account currently has MPK enabled and
	// the caller passes `undefined` for the MPK, we refuse — the
	// caller would otherwise silently produce a vault that can't be
	// unlocked.
	if (
		account.masterPasswordEnabled &&
		nextMasterPasswordKey === undefined
	) {
		throw new Error(
			'rotateAuth: account has a master password — supply it (or pass null to disable)'
		);
	}
	if (
		account.opaqueState === 'enrolled' &&
		nextOpaqueExportKey === undefined
	) {
		throw new Error(
			'rotateAuth: account has OPAQUE enrolment — supply export key (or pass null to disable)'
		);
	}

	const newVaultKey = deriveVaultKey({
		prfOutput: prf,
		secretKey: opts.secretKey,
		deviceSalt: account.deviceSalt,
		masterPasswordKey:
			nextMasterPasswordKey instanceof Uint8Array
				? nextMasterPasswordKey
				: undefined,
		opaqueExportKey:
			nextOpaqueExportKey instanceof Uint8Array
				? nextOpaqueExportKey
				: undefined,
		version: 2
	});

	// Decrypt the current items with the OLD aesKey, then re-encrypt
	// with a fresh AES key wrapped under the NEW vaultKey.
	const currentRow = await getVault();
	if (!currentRow) throw new Error('rotateAuth: vault row missing');
	if (!aesKey) {
		throw new Error('rotateAuth: in-memory AES key missing — re-unlock first');
	}
	const oldAad = makeAad(
		account.formatVersion,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		currentRow.header
	);
	const plaintext = openBlob(aesKey, currentRow.nonce, currentRow.ciphertext, oldAad);

	const newAesKey = crypto.getRandomValues(new Uint8Array(AES_KEY_LEN));
	const wrapped = wrapAesKey(newVaultKey, account.deviceSalt, newAesKey);
	const newHeader = serializeWrappedKey(wrapped);
	const newAad = makeAad(
		PROVISION_FORMAT_VERSION,
		account.authMode,
		account.deviceSalt,
		account.credentialId,
		newHeader
	);
	const sealed = sealBlob(newAesKey, plaintext, newAad);
	zeroize(plaintext);

	const now = Date.now();
	void now;
	const nextAccount: Omit<AccountRecord, 'id'> = {
		deviceLabel: account.deviceLabel,
		deviceSalt: account.deviceSalt,
		credentialId: account.credentialId,
		credentialPublicKey: account.credentialPublicKey,
		authMode: account.authMode,
		formatVersion: PROVISION_FORMAT_VERSION,
		createdAt: account.createdAt,
		plan: account.plan,

		// Carry-over OR override based on the rotation request.
		masterPasswordEnabled:
			nextMasterPasswordKey === null
				? false
				: nextMasterPasswordKey instanceof Uint8Array
					? true
					: account.masterPasswordEnabled,
		masterPasswordSalt:
			nextMasterPasswordKey === null
				? undefined
				: nextMasterPasswordKey instanceof Uint8Array
					? opts.masterPasswordSalt
					: account.masterPasswordSalt,
		masterPasswordParams:
			nextMasterPasswordKey === null
				? undefined
				: nextMasterPasswordKey instanceof Uint8Array
					? opts.masterPasswordParams
					: account.masterPasswordParams,

		opaqueState:
			nextOpaqueExportKey === null
				? 'none'
				: nextOpaqueExportKey instanceof Uint8Array
					? 'enrolled'
					: account.opaqueState ?? 'none',
		opaqueAccountId:
			nextOpaqueExportKey === null
				? undefined
				: nextOpaqueExportKey instanceof Uint8Array
					? opts.opaqueAccountId
					: account.opaqueAccountId,
		opaqueServerId:
			nextOpaqueExportKey === null
				? undefined
				: nextOpaqueExportKey instanceof Uint8Array
					? opts.opaqueServerId
					: account.opaqueServerId,
		opaqueClientId:
			nextOpaqueExportKey === null
				? undefined
				: nextOpaqueExportKey instanceof Uint8Array
					? opts.opaqueClientId
					: account.opaqueClientId
	};

	await saveAccountAndVault(nextAccount, {
		header: newHeader,
		nonce: sealed.nonce,
		ciphertext: sealed.ciphertext,
		updatedAt: Date.now()
	});

	zeroize(vaultKey);
	zeroize(aesKey);
	vaultKey = newVaultKey;
	aesKey = newAesKey;
	if (account.authMode === 'demo') zeroize(prf);
}

export function lockSession(): void {
	zeroize(vaultKey);
	zeroize(aesKey);
	setSessionToken(null);
	vaultKey = null;
	aesKey = null;
	activeAuthMode = null;
	activeFormatVersion = null;
	sequenceClock = 0;
}

export function isSessionActive(): boolean {
	return vaultKey !== null;
}

export function currentAuthMode(): AuthMode | null {
	return activeAuthMode;
}

export function currentFormatVersion(): number | null {
	return activeFormatVersion;
}

export async function loadAccount(): Promise<AccountRecord | undefined> {
	return getAccount();
}

/**
 * Approximate ciphertext size for the audit footer. Never exposes
 * plaintext bytes — just the encrypted blob length.
 */
export async function getVaultByteSize(): Promise<number> {
	const row = await getVault();
	return row ? row.header.length + row.nonce.length + row.ciphertext.length : 0;
}
