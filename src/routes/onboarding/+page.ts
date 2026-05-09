import { redirect } from '@sveltejs/kit';
import { hasAccount } from '$lib/utils/storage';
import { isSessionActive } from '$lib/services/vault-session';
import { vault } from '$lib/stores/vault.svelte';

// Onboarding requires WebCrypto, WebAuthn, and IndexedDB — all client-only.
export const ssr = false;
export const prerender = false;

/**
 * Reentry guard. If a user navigates to /onboarding after they have
 * already provisioned a vault (stale bookmark, accidental click on a
 * "Get started" button), running the wizard again would call
 * `provisionVault()` and overwrite the singleton account+vault rows
 * in IndexedDB — silently destroying the existing vault.
 *
 * Redirect targets:
 *   - the live unlocked vault, if a session key is still in memory;
 *   - the unlock screen, if an account exists but isn't unlocked;
 *   - otherwise let the user proceed with onboarding.
 *
 * The same redirect is repeated client-side (defense in depth) by
 * the unlock route's load() so a console-driven goto cannot bypass
 * either guard.
 */
export async function load() {
	if (await hasAccount()) {
		if (isSessionActive() && vault.status === 'unlocked') {
			throw redirect(307, '/vault');
		}
		throw redirect(307, '/unlock');
	}
	return {};
}
