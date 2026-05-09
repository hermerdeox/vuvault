/**
 * Audience store — landing page dual-audience toggle.
 *
 * Drives the [data-audience="user"|"tech"] attribute on documentElement.
 * The CSS in globals.css resolves which [data-show] spans are visible.
 *
 * The initial value is read by the inline script in app.html before first
 * paint to prevent dual-copy flicker. This module is the runtime API for
 * changing it after that.
 */

import { browser } from '$app/environment';

export type Audience = 'user' | 'tech';

const STORAGE_KEY = 'vuvault-audience';
const FADE_MS = 160;

function readInitial(): Audience {
	if (!browser) return 'user';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'user' || stored === 'tech') return stored;
	const attr = document.documentElement.getAttribute('data-audience');
	return attr === 'tech' ? 'tech' : 'user';
}

class AudienceState {
	current = $state<Audience>(readInitial());

	set(next: Audience): void {
		if (this.current === next) return;
		if (browser) {
			document.body.classList.add('aud-fade-out');
			window.setTimeout(() => {
				this.current = next;
				document.documentElement.setAttribute('data-audience', next);
				try {
					localStorage.setItem(STORAGE_KEY, next);
				} catch {
					// ignore (private browsing)
				}
				requestAnimationFrame(() => {
					document.body.classList.remove('aud-fade-out');
				});
			}, FADE_MS);
		} else {
			this.current = next;
		}
	}

	toggle(): void {
		this.set(this.current === 'user' ? 'tech' : 'user');
	}
}

export const audience = new AudienceState();
