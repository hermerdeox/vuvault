/**
 * Vault codec — single owner of plaintext ↔ blob conversion.
 *
 * Format v1:
 *   byte 0:        0x01  (version prefix)
 *   bytes 1..end:  UTF-8 JSON of VaultItem[]
 *
 * A future format bump increments the version byte. Decoders inspect
 * the first byte and dispatch to the appropriate parser. Centralizing
 * the format here means a format change touches one file.
 *
 * The codec validates per-kind item shapes before returning them so a
 * tampered or corrupted blob can't smuggle weird types into the
 * runtime vault store. We trust the discriminated union as the source
 * of truth — any field outside `kind`'s declared schema is dropped
 * during deserialization rather than silently passed through.
 */

import {
	type ItemKind,
	type VaultItem,
	type LoginItem,
	type CardItem,
	type NoteItem,
	type IdentityItem,
	type SshItem,
	type CryptoSeedItem,
	type DocumentItem
} from '$lib/types/vault-item';

export const VAULT_FORMAT_V1 = 0x01;

const VALID_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>([
	'login',
	'card',
	'note',
	'identity',
	'ssh',
	'crypto-seed',
	'document'
]);

export function serializeItems(items: VaultItem[]): Uint8Array {
	const json = JSON.stringify(items);
	const utf8 = new TextEncoder().encode(json);
	const out = new Uint8Array(1 + utf8.length);
	out[0] = VAULT_FORMAT_V1;
	out.set(utf8, 1);
	return out;
}

export function deserializeItems(bytes: Uint8Array): VaultItem[] {
	if (bytes.length < 1) {
		throw new Error('vault-codec: empty payload');
	}
	const version = bytes[0];
	if (version !== VAULT_FORMAT_V1) {
		throw new Error(`vault-codec: unsupported version 0x${version!.toString(16)}`);
	}
	const utf8 = bytes.subarray(1);
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(utf8));
	} catch (err) {
		throw new Error(`vault-codec: payload is not valid JSON (${(err as Error).message})`, {
			cause: err
		});
	}
	if (!Array.isArray(parsed)) {
		throw new Error('vault-codec: payload is not an array');
	}
	return parsed.map((raw, idx) => validateItem(raw, idx));
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function validateItem(raw: unknown, idx: number): VaultItem {
	if (typeof raw !== 'object' || !raw) {
		throw new Error(`vault-codec: item ${idx} is not an object`);
	}
	const obj = raw as Record<string, unknown>;
	const kind = obj.kind;
	if (typeof kind !== 'string' || !VALID_KINDS.has(kind as ItemKind)) {
		throw new Error(`vault-codec: item ${idx} has unknown kind: ${String(kind)}`);
	}
	if (typeof obj.id !== 'string' || !obj.id) {
		throw new Error(`vault-codec: item ${idx} is missing an id`);
	}
	if (typeof obj.title !== 'string') {
		throw new Error(`vault-codec: item ${idx} title must be a string`);
	}
	if (typeof obj.createdAt !== 'number' || typeof obj.updatedAt !== 'number') {
		throw new Error(`vault-codec: item ${idx} has invalid timestamps`);
	}

	// Common fields shared by every kind. Build the variant explicitly
	// so unrelated fields from a tampered blob are not pass-through.
	const base = {
		id: obj.id,
		kind: kind as ItemKind,
		title: obj.title,
		subtitle: asString(obj.subtitle),
		createdAt: obj.createdAt,
		updatedAt: obj.updatedAt,
		favorite: typeof obj.favorite === 'boolean' ? obj.favorite : undefined,
		tags: Array.isArray(obj.tags)
			? (obj.tags as unknown[]).filter((t): t is string => typeof t === 'string')
			: undefined
	};

	switch (kind as ItemKind) {
		case 'login':
			return {
				...base,
				kind: 'login',
				url: asString(obj.url),
				username: asString(obj.username),
				password: asString(obj.password),
				totpSeed: asString(obj.totpSeed)
			} as LoginItem;
		case 'card':
			return {
				...base,
				kind: 'card',
				cardholder: asString(obj.cardholder),
				cardNumber: asString(obj.cardNumber),
				cardExpiry: asString(obj.cardExpiry),
				cardCvc: asString(obj.cardCvc)
			} as CardItem;
		case 'note':
			return {
				...base,
				kind: 'note',
				noteBody: asString(obj.noteBody)
			} as NoteItem;
		case 'identity':
			return {
				...base,
				kind: 'identity',
				identityName: asString(obj.identityName),
				identityEmail: asString(obj.identityEmail),
				identityPhone: asString(obj.identityPhone),
				identityAddress: asString(obj.identityAddress)
			} as IdentityItem;
		case 'ssh':
			return {
				...base,
				kind: 'ssh',
				sshKeyBody: asString(obj.sshKeyBody),
				sshPassphrase: asString(obj.sshPassphrase)
			} as SshItem;
		case 'crypto-seed':
			return {
				...base,
				kind: 'crypto-seed',
				seedPhrase: asString(obj.seedPhrase)
			} as CryptoSeedItem;
		case 'document':
			return {
				...base,
				kind: 'document',
				docDescription: asString(obj.docDescription),
				docExternalRef: asString(obj.docExternalRef),
				docBlobId: asString(obj.docBlobId),
				docFileName: asString(obj.docFileName),
				docMimeType: asString(obj.docMimeType),
				docSize: typeof obj.docSize === 'number' ? obj.docSize : undefined,
				docSha256: asString(obj.docSha256),
				docRemote: typeof obj.docRemote === 'boolean' ? obj.docRemote : undefined
			} as DocumentItem;
	}
}
