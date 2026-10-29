import {
	getAccount,
	getRecoveryEnvelope,
	saveRecoveryEnvelope,
	deleteRecoveryEnvelope,
	type RecoveryEnvelopeRecord
} from '$lib/utils/storage';
import {
	sealActiveRecoveryEnvelope,
	openVaultWithRecoveryEnvelope,
	installRestoreRoot,
	disableServerRestore,
	hasRestoreRootInMemory
} from './vault-session';
import { isSyncWired } from './sync-client';
import {
	deserializeRecoveryEnvelope,
	serializeRecoveryEnvelope,
	deriveRecoveryMaterial,
	recoveryArgonSalt,
	zeroizeRecoveryMaterial,
	type RecoveryEnvelopeSealed,
	type RecoveryEnvelopeSerializable,
	type RecoveryMaterial
} from '$lib/crypto/recovery-envelope';
import { RESTORE_ROOT_PARAMS } from '$lib/crypto/restore-record';
import { assertRecoveryPasswordPolicy } from '$lib/security/recovery-password-policy';

export type RecoveryEnvelopeExport = RecoveryEnvelopeSerializable & {
	createdAt?: number;
	rotatedAt?: number;
};

function recordToSealed(record: RecoveryEnvelopeRecord): RecoveryEnvelopeSealed {
	return {
		version: record.version,
		salt: record.salt,
		params: record.params,
		nonce: record.nonce,
		ciphertext: record.ciphertext
	};
}

export async function hasRecoveryEnvelope(): Promise<boolean> {
	try {
		const record = await getRecoveryEnvelope();
		return Boolean(record?.enabled);
	} catch {
		return false;
	}
}

/**
 * Stretch the Recovery Password once for both recovery mechanisms:
 * the local envelope and the server-side restore records. The salt is
 * a function of the Secret Key (`recoveryArgonSalt`) so a fresh device
 * with only Secret Key + Recovery Password reproduces the same root.
 */
export async function deriveRecoveryMaterialFor(input: {
	secretKey: Uint8Array;
	recoveryPassword: string;
}): Promise<RecoveryMaterial> {
	return deriveRecoveryMaterial({
		secretKey: input.secretKey,
		recoveryPassword: input.recoveryPassword,
		salt: recoveryArgonSalt(input.secretKey),
		params: RESTORE_ROOT_PARAMS
	});
}

export type EnableRecoveryResult = {
	envelope: RecoveryEnvelopeRecord;
	/** What happened to new-device restore: skipped when sync is not wired. */
	serverRestore: 'installed' | 'unchanged' | 'rotated' | 'skipped';
};

/**
 * Enable (or rotate) local recovery AND — when sync is wired — new-
 * device restore, from one Recovery Password stretch. Callers that
 * already hold the material (the restore flow derives it to find the
 * record) pass it in to skip the second stretch; ownership stays with
 * the caller.
 */
export async function enableRecoveryEnvelope(input: {
	secretKey: Uint8Array;
	recoveryPassword: string;
	material?: RecoveryMaterial;
}): Promise<RecoveryEnvelopeRecord> {
	const result = await enableRecovery(input);
	return result.envelope;
}

export async function enableRecovery(input: {
	secretKey: Uint8Array;
	recoveryPassword: string;
	material?: RecoveryMaterial;
}): Promise<EnableRecoveryResult> {
	assertRecoveryPasswordPolicy(input.recoveryPassword, { secretKey: input.secretKey });
	const ownMaterial = input.material ? null : await deriveRecoveryMaterialFor(input);
	const material = input.material ?? ownMaterial!;
	try {
		const existing = await getRecoveryEnvelope();
		const sealed = await sealActiveRecoveryEnvelope({
			secretKey: input.secretKey,
			recoveryPassword: input.recoveryPassword,
			material
		});
		const now = Date.now();
		const record = {
			version: sealed.version,
			enabled: true,
			salt: sealed.salt,
			params: sealed.params,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext,
			createdAt: existing?.createdAt ?? now,
			rotatedAt: existing ? now : undefined
		};
		await saveRecoveryEnvelope(record);
		let serverRestore: EnableRecoveryResult['serverRestore'] = 'skipped';
		if (isSyncWired()) {
			serverRestore = await installRestoreRoot(material.restoreRoot);
		}
		return { envelope: { id: 'singleton', ...record }, serverRestore };
	} finally {
		zeroizeRecoveryMaterial(ownMaterial);
	}
}

export async function disableRecoveryEnvelope(): Promise<void> {
	await disableServerRestore();
	await deleteRecoveryEnvelope();
}

/**
 * Whether this account can be restored onto a new device from the sync
 * server: the root is on the account row (and, while unlocked, in
 * memory so records keep being published).
 */
export async function hasServerRestore(): Promise<boolean> {
	const account = await getAccount();
	if (!account?.restoreRootCiphertext) return false;
	return hasRestoreRootInMemory();
}

export async function exportRecoveryEnvelope(): Promise<RecoveryEnvelopeExport | null> {
	const record = await getRecoveryEnvelope();
	if (!record?.enabled) return null;
	return {
		...serializeRecoveryEnvelope(recordToSealed(record)),
		createdAt: record.createdAt,
		rotatedAt: record.rotatedAt
	};
}

export async function openWithRecovery(input: {
	secretKey: Uint8Array;
	recoveryPassword: string;
	exportedEnvelope?: RecoveryEnvelopeSerializable | null;
}) {
	const local = input.exportedEnvelope ? null : await getRecoveryEnvelope();
	const envelope = input.exportedEnvelope
		? deserializeRecoveryEnvelope(input.exportedEnvelope)
		: local?.enabled
			? recordToSealed(local)
			: null;
	if (!envelope) {
		throw new Error('No Recovery Envelope is available on this device or .vukey file.');
	}
	return openVaultWithRecoveryEnvelope({
		secretKey: input.secretKey,
		recoveryPassword: input.recoveryPassword,
		envelope
	});
}

export async function recoverySummary(): Promise<{
	enabled: boolean;
	createdAt?: number;
	rotatedAt?: number;
}> {
	const account = await getAccount();
	if (!account) return { enabled: false };
	const record = await getRecoveryEnvelope();
	return {
		enabled: Boolean(record?.enabled),
		createdAt: record?.createdAt,
		rotatedAt: record?.rotatedAt
	};
}
