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
 * That consent step is invariant P5 ("no silent updates") made real:
 * the running snapshot never changes under the user's feet.
 */

import { dev, browser } from '$app/environment';

const UPDATE_POLL_MS = 30 * 60 * 1000;

class PwaState {
	/** A new, fully-installed snapshot is waiting for consent. */
	updateReady = $state(false);
	/** Version string of the waiting snapshot (best-effort). */
	nextVersion = $state<string | null>(null);
	/** True when running as an installed app (home-screen launch). */
	standalone = $state(false);

	#registration: ServiceWorkerRegistration | null = null;
	#reloading = false;
	#consented = false;

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

			// Reload exactly once when the user-CONSENTED worker takes
			// control, landing the page in the new coherent snapshot.
			// First-install claim() also fires controllerchange — that
			// one must NOT reload (no consent was asked, nothing visible
			// changes; the snapshot simply starts serving).
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				if (!this.#consented || this.#reloading) return;
				this.#reloading = true;
				window.location.reload();
			});

			// Re-check for new releases periodically and when the app
			// returns to the foreground (installed apps live long).
			setInterval(() => void reg.update().catch(() => undefined), UPDATE_POLL_MS);
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') {
					void reg.update().catch(() => undefined);
				}
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
		this.#consented = true;
		this.#registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
	}

	dismissUpdate(): void {
		this.updateReady = false;
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
