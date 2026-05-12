/**
 * Vault store — runtime state for the unlocked vault.
 *
 * SECURITY: This store holds DECRYPTED items in memory while the vault
 * is unlocked. On lock, this.lock() must zeroize sensitive buffers,
 * clear all items, and tear down the underlying session key.
 *
 * Persistence: mutations call schedulePersist(), which debounces a
 * re-encryption write through `vault-session.saveItems()`. Phase 0
 * makes this write tracked so `lock()` and `flushPersist()` can wait
 * for any in-flight encryption to complete before zeroizing the key.
 */

import { audit } from './audit.svelte';
import {
	saveItems,
	lockSession,
	getVaultByteSize,
	setSyncObserver,
	syncNow as syncNowSession
} from '$lib/services/vault-session';
import { hasSession, isSyncWired } from '$lib/services/sync-client';
import {
	computeVaultHealth,
	type VaultHealth
} from '$lib/health/password-health';
import {
	type ItemKind,
	type VaultItem,
	type VaultItemPayload,
	zeroizeItemSecrets,
	safeAuditLabel
} from '$lib/types/vault-item';
import { onTabMessage, postTabMessage } from '$lib/services/tab-sync';
import { clearClipboard } from '$lib/services/secure-clipboard';

// Re-exported for backward compatibility — older imports of `ItemKind`
// and `VaultItem` from this module continue to work, but new code
// should prefer the canonical source in `$lib/types/vault-item`.
export type { ItemKind, VaultItem };

/**
 * Hard upper bound on the number of items in a single vault. Both an
 * advisory warning at 80% capacity and a hard refusal at 100% protect
 * users from runaway growth that would inflate every persist write
 * (the entire item array re-encrypts on each mutation) and would
 * dwarf the future Milestone 2 sync payload.
 */
export const ITEM_HARD_CAP = 5000;
export const ITEM_WARN_AT = 4000;

export type VaultStatus = 'locked' | 'unlocking' | 'unlocked' | 'error';
export type VaultSyncStatus =
	| 'local-only'
	| 'ready'
	| 'syncing'
	| 'synced'
	| 'failed'
	| 'no-session';

const PERSIST_DEBOUNCE_MS = 500;
const HEALTH_DEBOUNCE_MS = 1000;

/**
 * Capacity error raised when the user tries to add an item that
 * would exceed `ITEM_HARD_CAP`. UI catches this and shows a banner.
 */
export class VaultCapacityError extends Error {
	constructor(public readonly count: number) {
		super(`Vault item limit reached (${count} / ${ITEM_HARD_CAP})`);
		this.name = 'VaultCapacityError';
	}
}

class VaultState {
	status = $state<VaultStatus>('locked');
	items = $state<VaultItem[]>([]);
	selectedId = $state<string | null>(null);
	deviceLabel = $state<string>('');
	revealedField = $state<string | null>(null); // hoisted from VaultDetail for ⌘K access
	syncStatus = $state<VaultSyncStatus>('local-only');
	syncMessage = $state('Sync server not configured.');
	syncing = $state(false);

	// Filter state — moved from VaultSidebar/topbar local state in Phase 1.
	categoryFilter = $state<'all' | ItemKind | 'weak' | 'reused'>('all');
	searchQuery = $state<string>('');

	// Mobile pane switcher — desktop renders all three panes, mobile shows
	// one at a time and uses bottom tabs to switch.
	mobilePane = $state<'sidebar' | 'list' | 'detail'>('list');

	/**
	 * Computed-in-memory password health snapshot. Recomputed asynchronously
	 * after every mutation that affects passwords; never persisted to disk
	 * and never logged in plaintext. Only the `weakIds` / `reusedIds` /
	 * `byId` view of derived booleans + bit estimates is exposed.
	 */
	health = $state<VaultHealth>({
		weakIds: new Set(),
		reusedIds: new Set(),
		weakCount: 0,
		reusedCount: 0,
		byId: new Map()
	});

	count = $derived(this.items.length);
	weakCount = $derived(this.health.weakCount);
	reusedCount = $derived(this.health.reusedCount);
	selected = $derived<VaultItem | null>(
		this.items.find((i) => i.id === this.selectedId) ?? null
	);

	byKind = $derived.by<Record<ItemKind, VaultItem[]>>(() => {
		const out: Record<ItemKind, VaultItem[]> = {
			login: [],
			card: [],
			note: [],
			identity: [],
			ssh: [],
			'crypto-seed': [],
			document: []
		};
		for (const item of this.items) out[item.kind].push(item);
		return out;
	});

	/**
	 * Items after applying the active category filter and search query.
	 * Weak/Reused buckets are driven by the in-memory `health` snapshot,
	 * which is recomputed locally after every mutation that affects
	 * passwords. Plaintext password material never leaves the client.
	 */
	filtered = $derived.by<VaultItem[]>(() => {
		let out: VaultItem[];
		if (this.categoryFilter === 'all') {
			out = this.items;
		} else if (this.categoryFilter === 'weak') {
			out = this.items.filter((i) => this.health.weakIds.has(i.id));
		} else if (this.categoryFilter === 'reused') {
			out = this.items.filter((i) => this.health.reusedIds.has(i.id));
		} else {
			out = this.byKind[this.categoryFilter] ?? [];
		}
		const q = this.searchQuery.trim().toLowerCase();
		if (!q) return out;
		return out.filter((i) => {
			if (i.title.toLowerCase().includes(q)) return true;
			if (i.subtitle?.toLowerCase().includes(q)) return true;
			if (i.kind === 'login') {
				if (i.username?.toLowerCase().includes(q)) return true;
				if (i.url?.toLowerCase().includes(q)) return true;
			}
			return false;
		});
	});

	/**
	 * Set when another tab has reported state-changing activity since
	 * we last persisted. UI surfaces this as a "Vault changed in
	 * another tab — reload to see updates" banner so the user is
	 * never surprised by a stale view.
	 */
	otherTabActivity = $state<null | { kind: 'persisted' | 'wiped'; at: number }>(null);

	loadFromDecrypted(items: VaultItem[]): void {
		this.items = items;
		this.status = 'unlocked';
		this.selectedId = items[0]?.id ?? null;
		this.categoryFilter = 'all';
		this.searchQuery = '';
		this.revealedField = null;
		this.otherTabActivity = null;
		this.refreshSyncState();
		this.subscribeTabSync();
		postTabMessage('unlocked');
		void this.scheduleHealthRecompute();
	}

	private tabUnsubscribe: (() => void) | null = null;

	private subscribeTabSync(): void {
		if (this.tabUnsubscribe) return;
		this.tabUnsubscribe = onTabMessage((msg) => {
			switch (msg.type) {
				case 'locked':
					// Another tab told everyone to lock. Honor it.
					if (this.status === 'unlocked') {
						audit.push('warn', 'Vault locked by another tab');
						void this.lock();
					}
					break;
				case 'wiped':
					// /recover wiped everything. Drop our state and let
					// the route guard send the user to /onboarding.
					if (this.status === 'unlocked') {
						audit.push('danger', 'Vault wiped from another tab');
						void this.lock();
					}
					this.otherTabActivity = { kind: 'wiped', at: msg.at };
					break;
				case 'persisted':
					// Another tab edited the vault. Mark stale so the UI
					// can offer a reload — we deliberately do NOT auto-
					// merge to avoid silent overwrites.
					this.otherTabActivity = { kind: 'persisted', at: msg.at };
					break;
				case 'unlocked':
					// Informational only.
					break;
			}
		});
	}

	private refreshSyncState(): void {
		if (!isSyncWired()) {
			this.syncStatus = 'local-only';
			this.syncMessage = 'Sync server not configured.';
			return;
		}
		if (!hasSession()) {
			this.syncStatus = 'no-session';
			this.syncMessage = 'No active sync session.';
			return;
		}
		this.syncStatus = 'ready';
		this.syncMessage = 'Sync ready.';
	}

	private healthRecomputeToken = 0;
	private healthRecomputeTimer: number | null = null;

	/**
	 * Debounce health computation independently of persistence. Without
	 * this, rapid edits in a 1000-item vault would queue hundreds of
	 * concurrent SHA-384 digests on every keystroke; with it, only the
	 * settled state pays the cost.
	 */
	private scheduleHealthRecompute(): void {
		if (typeof window === 'undefined') {
			void this.runHealthRecompute();
			return;
		}
		if (this.healthRecomputeTimer !== null) {
			clearTimeout(this.healthRecomputeTimer);
		}
		this.healthRecomputeTimer = window.setTimeout(() => {
			this.healthRecomputeTimer = null;
			void this.runHealthRecompute();
		}, HEALTH_DEBOUNCE_MS);
	}

	private async runHealthRecompute(): Promise<void> {
		const token = ++this.healthRecomputeToken;
		const snapshot = this.items.map((i) => ({
			id: i.id,
			password: i.kind === 'login' ? i.password : undefined
		}));
		try {
			const next = await computeVaultHealth(snapshot);
			if (token !== this.healthRecomputeToken) return;
			this.health = next;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			audit.push('danger', `Health recompute failed: ${msg}`);
		}
	}

	private async recomputeHealthNow(): Promise<void> {
		if (this.healthRecomputeTimer !== null) {
			clearTimeout(this.healthRecomputeTimer);
			this.healthRecomputeTimer = null;
		}
		await this.runHealthRecompute();
	}

	private persistTimer: number | null = null;
	private inflightPersist: Promise<void> | null = null;

	private schedulePersist(): void {
		if (typeof window === 'undefined') return;
		if (this.persistTimer !== null) {
			clearTimeout(this.persistTimer);
		}
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			this.inflightPersist = this.persist().finally(() => {
				this.inflightPersist = null;
			});
		}, PERSIST_DEBOUNCE_MS);
	}

	private async persist(): Promise<void> {
		try {
			await saveItems(this.items);
			const bytes = await getVaultByteSize();
			audit.noteVaultSize(bytes);
			audit.push('info', 'Vault persisted', { items: this.items.length });
			// Tell other tabs that the on-disk blob has moved. They
			// surface the "another tab changed the vault" banner.
			postTabMessage('persisted');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			audit.push('danger', `Vault persist failed: ${msg}`);
		}
	}

	/**
	 * Force any pending or in-flight persistence to settle. Returns a
	 * promise that resolves when the on-disk blob reflects the current
	 * in-memory items. Safe to call multiple times.
	 */
	async flushPersist(): Promise<void> {
		if (this.persistTimer !== null) {
			clearTimeout(this.persistTimer);
			this.persistTimer = null;
			// Run the queued persist immediately and remember it.
			this.inflightPersist = this.persist().finally(() => {
				this.inflightPersist = null;
			});
		}
		if (this.inflightPersist) {
			await this.inflightPersist;
		}
	}

	async syncNow(): Promise<void> {
		if (this.syncing) return;

		this.syncing = true;
		this.syncStatus = 'syncing';
		this.syncMessage = 'Syncing vault…';
		audit.push('info', 'Sync started');

		try {
			await this.flushPersist();
			const result = await syncNowSession();
			this.syncMessage = result.message;

			switch (result.status) {
				case 'promoted':
					this.items = result.items;
					if (this.selectedId && !this.items.some((item) => item.id === this.selectedId)) {
						this.selectedId = this.items[0]?.id ?? null;
					} else if (!this.selectedId) {
						this.selectedId = this.items[0]?.id ?? null;
					}
					this.otherTabActivity = null;
					this.syncStatus = 'synced';
					await this.recomputeHealthNow();
					postTabMessage('persisted');
					audit.push('success', result.message, {
						status: result.status,
						seq: result.sequenceClock
					});
					break;
				case 'local-newer':
					this.syncStatus = 'synced';
					audit.lastSyncAt = Date.now();
					audit.push('success', result.message, { status: result.status });
					break;
				case 'not-wired':
					this.syncStatus = 'local-only';
					audit.push('info', result.message, { status: result.status });
					break;
				case 'no-session':
				case 'locked':
					this.syncStatus = 'no-session';
					audit.push('warn', result.message, { status: result.status });
					break;
				case 'failed':
					this.syncStatus = 'failed';
					audit.push('danger', result.message, { status: result.status });
					break;
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Sync failed.';
			this.syncStatus = 'failed';
			this.syncMessage = message;
			audit.push('danger', message, { status: 'failed' });
		} finally {
			this.syncing = false;
		}
	}

	async lock(reason = 'manual'): Promise<void> {
		// Flush any pending writes BEFORE we tear down the session key,
		// otherwise saveItems() throws "no active vault session" mid-flight
		// and edits made within the debounce window vanish.
		try {
			await this.flushPersist();
		} catch {
			// Even if flushing fails, proceed with lock to honor the security
			// contract; the audit feed already recorded the failure.
		}

		// Zeroize EVERY secret-bearing field on every item. The list of
		// fields lives in `SECRET_FIELDS_BY_KIND` (see vault-item.ts);
		// adding a new kind or new sensitive field requires updating
		// that map, which fails closed if missed. Strings are
		// immutable in JS so we drop the reference and rely on GC.
		for (const item of this.items) {
			zeroizeItemSecrets(item);
		}
		this.items = [];
		this.selectedId = null;
		this.revealedField = null;
		this.searchQuery = '';
		this.categoryFilter = 'all';
		this.status = 'locked';
		this.syncing = false;
		this.syncStatus = isSyncWired() ? 'no-session' : 'local-only';
		this.syncMessage = isSyncWired()
			? 'Vault locked. Unlock with OPAQUE to sync.'
			: 'Sync server not configured.';
		// Drop computed health buckets — they reference ids that no longer
		// exist and could leak which credential ids exist if the store is
		// inspected post-lock.
		this.health = {
			weakIds: new Set(),
			reusedIds: new Set(),
			weakCount: 0,
			reusedCount: 0,
			byId: new Map()
		};
		this.healthRecomputeToken++;
		if (this.healthRecomputeTimer !== null) {
			clearTimeout(this.healthRecomputeTimer);
			this.healthRecomputeTimer = null;
		}
		this.otherTabActivity = null;
		if (this.tabUnsubscribe) {
			this.tabUnsubscribe();
			this.tabUnsubscribe = null;
		}
		lockSession();
		await clearClipboard('lock');
		// Broadcast AFTER lockSession so any peer tab that immediately
		// queries `isSessionActive()` sees the new state.
		postTabMessage('locked', reason);
		audit.push('info', reason === 'manual' ? 'Vault locked' : `Vault auto-locked: ${reason}`);
	}

	select(id: string | null): void {
		this.selectedId = id;
		this.revealedField = null;
		// Auto-switch to detail on mobile when an item is picked.
		if (id && typeof window !== 'undefined' && window.innerWidth <= 720) {
			this.mobilePane = 'detail';
		}
	}

	add(item: VaultItemPayload): VaultItem {
		if (this.items.length >= ITEM_HARD_CAP) {
			audit.push('danger', `Item add refused: vault full`, {
				count: this.items.length,
				cap: ITEM_HARD_CAP
			});
			throw new VaultCapacityError(this.items.length);
		}
		const now = Date.now();
		const created = {
			...item,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now
		} as VaultItem;
		this.items = [created, ...this.items];
		// Redact title — audit entries are visible in the runtime feed
		// and could be persisted in the future. Only the kind tells
		// the user what changed without leaking which service was added.
		audit.push('success', `Added ${item.kind}`, safeAuditLabel(created));
		if (this.items.length === ITEM_WARN_AT) {
			audit.push('warn', `Approaching vault item limit`, {
				count: this.items.length,
				cap: ITEM_HARD_CAP
			});
		}
		this.schedulePersist();
		this.scheduleHealthRecompute();
		return created;
	}

	update(id: string, patch: Partial<VaultItem>): void {
		// Cast to a permissive shape for the spread — the discriminated
		// union doesn't widen across kinds, so we trust the caller to
		// patch fields that belong on the matching kind. ItemEditor
		// validates this contract before calling.
		this.items = this.items.map((i) =>
			i.id === id
				? ({ ...i, ...patch, updatedAt: Date.now() } as VaultItem)
				: i
		);
		audit.push('info', 'Item updated', { id });
		this.schedulePersist();
		this.scheduleHealthRecompute();
	}

	remove(id: string): void {
		const removed = this.items.find((i) => i.id === id);
		this.items = this.items.filter((i) => i.id !== id);
		if (this.selectedId === id) this.selectedId = null;
		audit.push('warn', 'Item deleted', { id });
		// If this was a document item with an attached encrypted blob,
		// purge the blob from local Dexie storage (and from the sync
		// server when wired). Fire-and-forget — the vault item itself
		// is the source of truth that this attachment should no longer
		// be referenced, and the periodic GC sweep on next unlock
		// catches any leftovers.
		if (removed && removed.kind === 'document' && removed.docBlobId) {
			const blobId = removed.docBlobId;
			void import('$lib/services/document-blobs')
				.then(({ purgeDocumentBlob }) => purgeDocumentBlob(blobId))
				.catch(() => undefined);
		}
		this.schedulePersist();
		this.scheduleHealthRecompute();
	}
}

// Re-export the canonical secret-field map so other modules can call
// `zeroizeItemSecrets` directly without reaching into the type module.
export {
	zeroizeItemSecrets,
	SECRET_FIELDS_BY_KIND,
	safeAuditLabel
} from '$lib/types/vault-item';
export type {
	LoginItem,
	CardItem,
	NoteItem,
	IdentityItem,
	SshItem,
	CryptoSeedItem,
	DocumentItem
} from '$lib/types/vault-item';

export const vault = new VaultState();

// Wire vault-session sync events into the persistent audit feed.
// This is the bridge: vault-session emits typed callbacks; the
// audit store records them so the footer surfaces "synced 8 KB"
// or "sync failed (network)" without vault-session needing a
// direct dependency on the audit store.
setSyncObserver({
	onPushSuccess: ({ sequenceClock, bytes }) => {
		vault.syncStatus = 'synced';
		vault.syncMessage = 'Vault pushed to sync server.';
		audit.lastSyncAt = Date.now();
		audit.bytesSent += bytes;
		audit.push('success', 'Vault pushed to sync server', {
			seq: sequenceClock,
			bytes
		});
	},
	onPushFailure: ({ reason, message }) => {
		vault.syncStatus = isSyncWired() ? 'failed' : 'local-only';
		vault.syncMessage = message;
		audit.push('warn', 'Sync push failed — local copy retained', {
			reason,
			message
		});
	},
	onPullPromoted: ({ sequenceClock }) => {
		vault.syncStatus = 'synced';
		vault.syncMessage = 'Pulled newer vault from sync server.';
		audit.lastSyncAt = Date.now();
		audit.push('success', 'Pulled newer vault from sync server', {
			seq: sequenceClock
		});
	},
	onPullSkipped: ({ reason }) => {
		// `local-newer` and `not-wired` are quiet steady-state cases —
		// only surface harder errors. The other reasons (`network`,
		// `server`, `pull-crashed`, `remote-decrypt-failed`) ARE
		// worth surfacing.
		if (reason === 'not-wired') {
			vault.syncStatus = 'local-only';
			vault.syncMessage = 'Sync server not configured.';
			return;
		}
		if (reason === 'local-newer') {
			if (isSyncWired() && hasSession()) {
				vault.syncStatus = 'ready';
				vault.syncMessage = 'No newer remote vault found.';
			}
			return;
		}
		vault.syncStatus = 'failed';
		vault.syncMessage = `Sync pull skipped: ${reason}`;
		audit.push('warn', 'Sync pull skipped', { reason });
	}
});
