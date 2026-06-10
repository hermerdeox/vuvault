/**
 * PWA runtime — service-worker registration + consent-gated updates.
 *
 * Registration is manual (`kit.serviceWorker.register: false`) so the
 * update lifecycle stays under our control:
 *
 *   new deploy → browser installs new worker → it WAITS →
 *   `updateReady` flips → PwaUpdateToast asks the user →
 *   applyUpdate() posts SKIP_WAITING → controllerchange → reload.
 *
 * That consent step is invariant P5 ("no silent updates") for the
 * running session: an open app never swaps builds underneath the
 * user. Consent given in ANY tab speaks for the user in ALL tabs —
 * when the consented worker takes control, every previously
 * controlled tab reloads into the new coherent snapshot (the old
 * snapshot cache is purged on activation, so staying behind would
 * mean torn state). After the last client closes, the platform
 * activates a waiting worker on its own; the next launch boots the
 * new snapshot — consent is a session guarantee, not a cross-launch
 * one.
 */

import { dev, browser } from '$app/environment';

const UPDATE_POLL_MS = 30 * 60 * 1000;
/** After "Later", stay quiet this long before re-offering the update. */
const REPROMPT_SNOOZE_MS = 4 * 60 * 60 * 1000;

class PwaState {
	/** A new, fully-installed snapshot is waiting for consent. */
	updateReady = $state(false);
	/** Version string of the waiting snapshot (best-effort). */
	nextVersion = $state<string | null>(null);
	/** True when running as an installed app (home-screen launch). */
	standalone = $state(false);

	#registration: ServiceWorkerRegistration | null = null;
	#reloading = false;
	#snoozedUntil = 0;

	async init(): Promise<void> {
		if (!browser) return;

		this.standalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			// iOS Safari's pre-standard flag.
			(navigator as { standalone?: boolean }).standalone === true;

		if (dev || !('serviceWorker' in navigator)) return;

		try {
			const reg = await navigator.serviceWorker.register('/service-worker.js', {
				// `updateViaCache: 'none'` — always revalidate the worker
				// script itself against the server, so new releases are
				// DETECTED promptly (applying them still needs consent).
				updateViaCache: 'none'
			});
			this.#registration = reg;

			// Was this page controlled before any update could land? Used
			// to tell a consented-update takeover (reload required) apart
			// from the very first install's clients.claim() (no reload).
			let wasControlled = !!navigator.serviceWorker.controller;

			// A worker that finished installing before this page loaded.
			if (reg.waiting && navigator.serviceWorker.controller) {
				void this.#announce(reg.waiting);
			}

			reg.addEventListener('updatefound', () => {
				const incoming = reg.installing;
				if (!incoming) return;
				incoming.addEventListener('statechange', () => {
					if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
						void this.#announce(incoming);
					}
				});
			});

			// A consented worker taking control means the old snapshot is
			// gone — every previously controlled tab must reload into the
			// new one (consent in one tab is the user's consent; a tab
			// left behind would lazy-load chunks that no longer exist).
			// First-install claim() flips controller from null → set and
			// must NOT reload.
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				if (!wasControlled) {
					wasControlled = true;
					return;
				}
				if (this.#reloading) return;
				this.#reloading = true;
				window.location.reload();
			});

			const recheck = () => {
				void reg.update().catch(() => undefined);
				// A worker that is ALREADY waiting never re-fires
				// updatefound — re-offer it (post-snooze) so a long-lived
				// installed app cannot sit on a stale snapshot forever.
				if (!this.updateReady && reg.waiting && navigator.serviceWorker.controller) {
					if (Date.now() >= this.#snoozedUntil) void this.#announce(reg.waiting);
				}
				// Heal storage-pressure eviction (hash-verified refill).
				reg.active?.postMessage({ type: 'CHECK_SNAPSHOT' });
			};

			// Re-check for new releases periodically and when the app
			// returns to the foreground (installed apps live long).
			setInterval(recheck, UPDATE_POLL_MS);
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') recheck();
			});
		} catch {
			// Registration failure degrades to plain web behavior — never
			// block the app over the offline layer.
		}
	}

	async #announce(worker: ServiceWorker): Promise<void> {
		this.nextVersion = await requestVersion(worker);
		this.updateReady = true;
	}

	/** User consent: activate the waiting snapshot. */
	applyUpdate(): void {
		this.#registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
	}

	dismissUpdate(): void {
		this.updateReady = false;
		this.#snoozedUntil = Date.now() + REPROMPT_SNOOZE_MS;
	}
}

function requestVersion(worker: ServiceWorker): Promise<string | null> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => resolve(null), 1000);
		channel.port1.onmessage = (e) => {
			clearTimeout(timer);
			resolve(typeof e.data?.version === 'string' ? e.data.version : null);
		};
		worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
	});
}

export const pwa = new PwaState();
