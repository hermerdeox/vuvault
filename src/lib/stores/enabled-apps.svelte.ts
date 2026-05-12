/**
 * Vu Ecosystem — per-app "enabled" flag persisted to localStorage.
 *
 * Used by the launcher's Enable button: once a user enables an app
 * with a mockup, the mockup stays revealed on subsequent visits
 * instead of asking for the cinematic activation animation again.
 *
 * No network calls, no analytics. The store wraps a Svelte 5
 * `SvelteSet` so additions/removals trigger reactivity in any
 * `.svelte` component that reads via `enabledApps.has(...)`.
 */

import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';

const STORAGE_KEY = 'vuvault:ecosystem-enabled';

function readInitial(): SvelteSet<string> {
	const set = new SvelteSet<string>();
	if (!browser) return set;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return set;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return set;
		// Tolerate corrupt payloads gracefully — drop non-string entries
		// rather than rejecting the whole set and losing prior state.
		for (const entry of parsed) {
			if (typeof entry === 'string') set.add(entry);
		}
		return set;
	} catch {
		return set;
	}
}

function persist(set: SvelteSet<string>): void {
	if (!browser) return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
	} catch {
		/* private-mode / quota: silently ignore */
	}
}

class EnabledApps {
	private set: SvelteSet<string> = readInitial();

	has(name: string): boolean {
		return this.set.has(name);
	}

	enable(name: string): void {
		if (this.set.has(name)) return;
		this.set.add(name);
		persist(this.set);
	}

	disable(name: string): void {
		if (!this.set.has(name)) return;
		this.set.delete(name);
		persist(this.set);
	}

	get size(): number {
		return this.set.size;
	}

	clear(): void {
		if (this.set.size === 0) return;
		this.set.clear();
		persist(this.set);
	}
}

export const enabledApps = new EnabledApps();
