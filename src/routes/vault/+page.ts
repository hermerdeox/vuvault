import { redirect } from '@sveltejs/kit';
import { hasAccount } from '$lib/utils/storage';
import { isSessionActive } from '$lib/services/vault-session';
import { vault } from '$lib/stores/vault.svelte';

// Vault requires WebCrypto, IndexedDB, and the unlocked vault key in memory.
export const ssr = false;
export const prerender = false;

export async function load() {
	if (!(await hasAccount())) {
		throw redirect(307, '/onboarding');
	}
	if (!isSessionActive() || vault.status !== 'unlocked') {
		throw redirect(307, '/unlock');
	}
	return {};
}
