import {
	getAccount,
	getRecoveryEnvelope,
	saveRecoveryEnvelope,
	deleteRecoveryEnvelope,
	type RecoveryEnvelopeRecord
} from '$lib/utils/storage';
import {
	sealActiveRecoveryEnvelope,
	openVaultWithRecoveryEnvelope
} from './vault-session';
import {
	deserializeRecoveryEnvelope,
	serializeRecoveryEnvelope,
	type RecoveryEnvelopeSealed,
	type RecoveryEnvelopeSerializable
} from '$lib/crypto/recovery-envelope';
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

export async function enableRecoveryEnvelope(input: {
	secretKey: Uint8Array;
	recoveryPassword: string;
}): Promise<RecoveryEnvelopeRecord> {
	assertRecoveryPasswordPolicy(input.recoveryPassword, { secretKey: input.secretKey });
	const existing = await getRecoveryEnvelope();
	const sealed = await sealActiveRecoveryEnvelope(input);
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
	return { id: 'singleton', ...record };
}

export async function disableRecoveryEnvelope(): Promise<void> {
	await deleteRecoveryEnvelope();
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
