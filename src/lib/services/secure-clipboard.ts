import { audit } from '$lib/stores/audit.svelte';

export const CLIPBOARD_CLEAR_MS = 60_000;

let clearTimer: number | null = null;

function clearScheduledTimer(): void {
	if (clearTimer !== null) {
		clearTimeout(clearTimer);
	}
	clearTimer = null;
}

export async function clearClipboard(label = 'clipboard'): Promise<void> {
	clearScheduledTimer();
	if (typeof navigator === 'undefined' || !navigator.clipboard) return;
	try {
		await navigator.clipboard.writeText('');
	} catch {
		audit.push('warn', `Clipboard clear rejected for ${label}`);
	}
}

export async function copySecretToClipboard(
	label: string,
	value: string | undefined,
	options: { ttlMs?: number } = {}
): Promise<boolean> {
	if (!value) {
		audit.push('warn', `No ${label} to copy`);
		return false;
	}
	if (typeof navigator === 'undefined' || !navigator.clipboard) {
		audit.push('warn', `Clipboard unavailable for ${label}`);
		return false;
	}

	try {
		await navigator.clipboard.writeText(value);
	} catch {
		audit.push('warn', `Clipboard write rejected for ${label}`);
		return false;
	}

	const ttlMs = options.ttlMs ?? CLIPBOARD_CLEAR_MS;
	audit.push('success', `Copied ${label}`, { clears: `${Math.round(ttlMs / 1000)}s` });
	clearScheduledTimer();
	clearTimer = setTimeout(() => {
		void clearClipboard(label);
	}, ttlMs) as unknown as number;
	return true;
}
