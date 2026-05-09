import { redirect } from '@sveltejs/kit';
import { hasAccount } from '$lib/utils/storage';
import { isSessionActive } from '$lib/services/vault-session';
import { vault } from '$lib/stores/vault.svelte';

// Unlock requires WebCrypto, IndexedDB, and a persisted account row to
// re-derive the vault key against. Mirroring the /vault guard pattern
// removes the brief flash of unlock UI before the client-side
// onMount() redirect, and prevents a JS-disabled mid-load bypass.
export const ssr = false;
export const prerender = false;

export async function load() {
	if (!(await hasAccount())) {
		throw redirect(307, '/onboarding');
	}
	// If the vault is already unlocked in this browser context, route
	// straight to /vault rather than asking for the Secret Key again.
	if (isSessionActive() && vault.status === 'unlocked') {
		throw redirect(307, '/vault');
	}
	return {};
}
