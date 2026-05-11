/**
 * Discriminated union for vault items.
 *
 * Each kind declares ONLY the fields it owns. There is no `[k: string]:
 * unknown` escape hatch, so:
 *   - `item.sshKeyBody` is only typed when `item.kind === 'ssh'`
 *   - typos in property names are compile errors, not silent undefined
 *   - the codec can validate per-kind shapes structurally
 *   - lock() can iterate `secretFieldsFor(kind)` to zeroize every
 *     secret-bearing field generically
 *
 * The `ItemBase` type captures the fields every item shares; each
 * variant intersects it with its own fields. `VaultItem` is the union
 * across all kinds.
 *
 * IMPORTANT for future schema changes: when you add a new kind or a
 * new secret-bearing field, also update the `SECRET_FIELDS_BY_KIND`
 * map below so the lock() zeroization stays exhaustive.
 */

export type ItemKind =
	| 'login'
	| 'card'
	| 'note'
	| 'identity'
	| 'ssh'
	| 'crypto-seed'
	| 'document';

export interface ItemBase {
	id: string;
	kind: ItemKind;
	title: string;
	subtitle?: string;
	createdAt: number;
	updatedAt: number;
	favorite?: boolean;
	tags?: string[];
}

export interface LoginItem extends ItemBase {
	kind: 'login';
	url?: string;
	username?: string;
	password?: string;
	totpSeed?: string;
}

export interface CardItem extends ItemBase {
	kind: 'card';
	cardholder?: string;
	cardNumber?: string;
	cardExpiry?: string;
	cardCvc?: string;
}

export interface NoteItem extends ItemBase {
	kind: 'note';
	noteBody?: string;
}

export interface IdentityItem extends ItemBase {
	kind: 'identity';
	identityName?: string;
	identityEmail?: string;
	identityPhone?: string;
	identityAddress?: string;
}

export interface SshItem extends ItemBase {
	kind: 'ssh';
	sshKeyBody?: string;
	sshPassphrase?: string;
}

export interface CryptoSeedItem extends ItemBase {
	kind: 'crypto-seed';
	seedPhrase?: string;
}

export interface DocumentItem extends ItemBase {
	kind: 'document';
	docDescription?: string;
	docExternalRef?: string;
	/**
	 * Stable identifier for the encrypted file blob in the local
	 * `documentBlobs` Dexie table and (when sync is wired) the
	 * `vaults/<accountId>/documents/<docBlobId>.bin` R2 object.
	 * UUID v4. Absent when the document is metadata-only.
	 */
	docBlobId?: string;
	/** Original file name; treated as untrusted display text. */
	docFileName?: string;
	/** MIME type as declared by the browser at upload time. */
	docMimeType?: string;
	/** Plaintext size in bytes (reported by the local File at upload). */
	docSize?: number;
	/** Lowercase hex SHA-256 of the plaintext bytes for integrity display. */
	docSha256?: string;
	/** Whether the encrypted blob has been pushed to the sync server. */
	docRemote?: boolean;
}

export type VaultItem =
	| LoginItem
	| CardItem
	| NoteItem
	| IdentityItem
	| SshItem
	| CryptoSeedItem
	| DocumentItem;

/**
 * Distributive `Omit` so the type system applies the omission to each
 * member of the union individually. The built-in `Omit<VaultItem, ...>`
 * collapses to a synthetic intersection that loses the discriminator,
 * which makes `kind: 'login'` fail to narrow into `LoginItem` shape.
 */
export type DistributiveOmit<T, K extends keyof VaultItem> = T extends VaultItem
	? Omit<T, K>
	: never;

/**
 * The shape ItemEditor returns from `buildPayload()` and `vault.add()`
 * accepts. Discriminated union members keep their own field sets.
 */
export type VaultItemPayload = DistributiveOmit<
	VaultItem,
	'id' | 'createdAt' | 'updatedAt'
>;

/**
 * Per-kind enumeration of fields whose plaintext should be wiped when
 * the vault locks. Used by `vault.lock()` to zeroize every secret
 * generically — adding a new field requires adding it here OR
 * declaring it on a new kind interface, both of which surface the
 * intent at code-review time.
 *
 * Cardholder name and expiry are deliberately listed because PCI DSS
 * 3.4.1 considers all PAN fields (including supplementary cardholder
 * data) sensitive at rest.
 */
export const SECRET_FIELDS_BY_KIND: {
	[K in ItemKind]: ReadonlyArray<keyof Extract<VaultItem, { kind: K }>>;
} = {
	login: ['password', 'totpSeed', 'username'],
	card: ['cardNumber', 'cardCvc', 'cardExpiry', 'cardholder'],
	note: ['noteBody'],
	identity: ['identityEmail', 'identityPhone', 'identityAddress'],
	ssh: ['sshKeyBody', 'sshPassphrase'],
	'crypto-seed': ['seedPhrase'],
	document: ['docDescription', 'docExternalRef']
};

/**
 * Best-effort zeroization for one item's secret fields. JS strings are
 * immutable so we cannot wipe the underlying bytes — we replace the
 * field reference with an empty string and rely on GC to reclaim the
 * old value. Documented limitation; mitigated for binary fields by
 * using `Uint8Array` wherever possible elsewhere in the crypto layer.
 */
export function zeroizeItemSecrets(item: VaultItem): void {
	const fields = SECRET_FIELDS_BY_KIND[item.kind];
	for (const field of fields) {
		const target = item as unknown as Record<string, unknown>;
		if (typeof target[field] === 'string') {
			target[field] = '';
		}
	}
}

export function isLogin(item: VaultItem): item is LoginItem {
	return item.kind === 'login';
}
export function isCard(item: VaultItem): item is CardItem {
	return item.kind === 'card';
}
export function isNote(item: VaultItem): item is NoteItem {
	return item.kind === 'note';
}
export function isIdentity(item: VaultItem): item is IdentityItem {
	return item.kind === 'identity';
}
export function isSsh(item: VaultItem): item is SshItem {
	return item.kind === 'ssh';
}
export function isCryptoSeed(item: VaultItem): item is CryptoSeedItem {
	return item.kind === 'crypto-seed';
}
export function isDocument(item: VaultItem): item is DocumentItem {
	return item.kind === 'document';
}

/**
 * Build a redacted, plaintext-free snapshot of an item suitable for
 * the audit feed and any non-confidential UI label. Includes only
 * id, kind, and a non-secret summary; deliberately omits title to
 * avoid leaking which services the user has credentials for.
 */
export function safeAuditLabel(item: { id: string; kind: ItemKind }): {
	id: string;
	kind: ItemKind;
} {
	return { id: item.id, kind: item.kind };
}
