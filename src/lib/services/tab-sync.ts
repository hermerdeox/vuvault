/**
 * Multi-tab coordination for the unlocked vault.
 *
 * Why this exists: the vault store is a module-level singleton, but
 * the IndexedDB it persists to is shared across all tabs in the same
 * browser profile. Without coordination:
 *
 *   1. Tab A unlocks, edits an item, persists. Tab B (still showing a
 *      stale unlocked vault) overwrites with its older snapshot on the
 *      next save. Edits silently disappear.
 *   2. Tab A locks. Tab B keeps a live `vaultKey` and decrypted
 *      items in memory — defeating the lock UX.
 *   3. Tab A starts a fresh provisioning flow. Tab B's running session
 *      now points to a vault that no longer exists.
 *
 * The channel pattern: every tab posts a single `tab-sync` message on
 * key state transitions (unlock, persist, lock, wipe). Other tabs
 * react in their own event loop. This is best-effort — `BroadcastChannel`
 * is not guaranteed delivery — but it covers the realistic
 * "user clicks Lock in tab A while editing in tab B" case.
 *
 * For Milestone 2, this same module will gain server-driven push
 * messages from the OPAQUE-authenticated sync server.
 */

const CHANNEL_NAME = 'vuvault-tabs-v1';

export type TabMessage =
	| { type: 'unlocked'; tabId: string; at: number }
	| { type: 'locked'; tabId: string; at: number; reason?: string }
	| { type: 'persisted'; tabId: string; at: number }
	| { type: 'wiped'; tabId: string; at: number };

export type TabHandler = (msg: TabMessage) => void;

let channel: BroadcastChannel | null = null;
const tabId = crypto.randomUUID();
const handlers = new Set<TabHandler>();
const STORAGE_KEY = 'vuvault-tab-sync-v1';

function notify(msg: TabMessage): void {
	if (!msg || msg.tabId === tabId) return;
	for (const h of handlers) {
		try {
			h(msg);
		} catch {
			// Handlers are best-effort. A misbehaving subscriber
			// shouldn't break the channel for everyone else.
		}
	}
}

function ensureChannel(): BroadcastChannel | null {
	if (typeof BroadcastChannel === 'undefined') return null;
	if (channel) return channel;
	try {
		channel = new BroadcastChannel(CHANNEL_NAME);
		channel.onmessage = (e: MessageEvent<TabMessage>) => {
			notify(e.data);
		};
	} catch {
		channel = null;
	}
	return channel;
}

/**
 * Post a message to all OTHER tabs. The current tab never sees its own
 * messages.
 */
export function postTabMessage(type: TabMessage['type'], reason?: string): void {
	const ch = ensureChannel();
	const msg: TabMessage = { type, tabId, at: Date.now(), reason } as TabMessage;
	try {
		ch?.postMessage(msg);
	} catch {
		// Channel was closed; recreate next time.
		channel = null;
	}
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
		} catch {
			// localStorage may be unavailable in private/locked-down contexts.
		}
	}
}

/**
 * Subscribe to messages from other tabs. Returns an unsubscribe fn.
 * Safe to call before `ensureChannel` has set up the channel — the
 * handler is added to a set that the channel reads when constructed.
 */
export function onTabMessage(handler: TabHandler): () => void {
	ensureChannel();
	handlers.add(handler);
	if (typeof window !== 'undefined') {
		window.addEventListener('storage', onStorage);
	}
	return () => handlers.delete(handler);
}

function onStorage(event: StorageEvent): void {
	if (event.key !== STORAGE_KEY || !event.newValue) return;
	try {
		notify(JSON.parse(event.newValue) as TabMessage);
	} catch {
		// Ignore malformed cross-tab storage messages.
	}
}

export function getThisTabId(): string {
	return tabId;
}

/**
 * Tear down the channel. Called from tests or when the user navigates
 * away from a vault-bearing route.
 */
export function disposeTabChannel(): void {
	if (channel) {
		try {
			channel.close();
		} catch {
			// already closed
		}
		channel = null;
	}
	if (typeof window !== 'undefined') {
		window.removeEventListener('storage', onStorage);
	}
	handlers.clear();
}
