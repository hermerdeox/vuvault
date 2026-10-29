import { redirect } from '@sveltejs/kit';
import { hasAccount } from '$lib/utils/storage';

// Restore only onto a device with no vault: adopting a server copy
// over an existing local vault would silently replace it. A device
// that wants to replace its vault wipes first (/recover → Start fresh).
export const ssr = false;
export const prerender = false;

export async function load() {
	if (await hasAccount()) {
		throw redirect(307, '/unlock');
	}
	return {};
}
