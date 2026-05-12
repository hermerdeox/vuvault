import type { VaultStatus } from '$lib/stores/vault.svelte';

export const IDLE_LOCK_MS = 5 * 60 * 1000;
export const HIDDEN_LOCK_MS = 30 * 1000;

export type AutoLockReason = 'idle' | 'hidden' | 'pagehide';

export type AutoLockController = {
	destroy(): void;
};

export function createAutoLockController(input: {
	getStatus: () => VaultStatus;
	lock: (reason: AutoLockReason) => void | Promise<void>;
	idleMs?: number;
	hiddenMs?: number;
}): AutoLockController {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return { destroy: () => undefined };
	}

	const idleMs = input.idleMs ?? IDLE_LOCK_MS;
	const hiddenMs = input.hiddenMs ?? HIDDEN_LOCK_MS;
	let idleTimer: number | null = null;
	let hiddenTimer: number | null = null;
	let destroyed = false;
	let locking = false;

	function clearTimer(timer: number | null): void {
		if (timer !== null) window.clearTimeout(timer);
	}

	function clearTimers(): void {
		clearTimer(idleTimer);
		clearTimer(hiddenTimer);
		idleTimer = null;
		hiddenTimer = null;
	}

	async function lock(reason: AutoLockReason): Promise<void> {
		if (destroyed || locking || input.getStatus() !== 'unlocked') return;
		locking = true;
		clearTimers();
		try {
			await input.lock(reason);
		} finally {
			locking = false;
		}
	}

	function scheduleIdle(): void {
		clearTimer(idleTimer);
		idleTimer = null;
		if (destroyed || input.getStatus() !== 'unlocked') return;
		idleTimer = window.setTimeout(() => {
			void lock('idle');
		}, idleMs);
	}

	function scheduleHidden(): void {
		clearTimer(hiddenTimer);
		hiddenTimer = null;
		if (destroyed || input.getStatus() !== 'unlocked' || document.visibilityState !== 'hidden') return;
		hiddenTimer = window.setTimeout(() => {
			void lock('hidden');
		}, hiddenMs);
	}

	function onActivity(): void {
		if (document.visibilityState === 'visible') scheduleIdle();
	}

	function onVisibility(): void {
		if (document.visibilityState === 'hidden') {
			scheduleHidden();
		} else {
			clearTimer(hiddenTimer);
			hiddenTimer = null;
			scheduleIdle();
		}
	}

	function onPageHide(): void {
		void lock('pagehide');
	}

	const activityEvents = ['pointerdown', 'mousemove', 'keydown', 'touchstart', 'scroll'] as const;
	for (const event of activityEvents) {
		window.addEventListener(event, onActivity, { passive: true });
	}
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', onPageHide);
	window.addEventListener('freeze', onPageHide);
	scheduleIdle();
	scheduleHidden();

	return {
		destroy() {
			destroyed = true;
			clearTimers();
			for (const event of activityEvents) {
				window.removeEventListener(event, onActivity);
			}
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
			window.removeEventListener('freeze', onPageHide);
		}
	};
}
