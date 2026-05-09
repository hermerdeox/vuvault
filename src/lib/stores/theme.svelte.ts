/**
 * Theme store — VU-MODERN ↔ VU-BRUTALIST parity equals.
 *
 * Theme switching is achieved by setting the [data-theme] attribute
 * on documentElement. The CSS in tokens-modern.css and tokens-brutalist.css
 * is keyed off this attribute. There is NO JavaScript style branching —
 * components must reference CSS custom properties only.
 *
 * The actual reading of localStorage and setting of [data-theme] happens
 * inline in app.html before first paint to prevent FOUC. This store
 * is the runtime API for changing it after that.
 */

import { browser } from '$app/environment';

export type Theme = 'modern' | 'brutalist';

const STORAGE_KEY = 'vuvault-theme';

function readInitial(): Theme {
	if (!browser) return 'modern';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === 'modern' || stored === 'brutalist') return stored;
	const attr = document.documentElement.getAttribute('data-theme');
	return attr === 'brutalist' ? 'brutalist' : 'modern';
}

class ThemeState {
	current = $state<Theme>(readInitial());

	set(theme: Theme): void {
		this.current = theme;
		if (browser) {
			document.documentElement.setAttribute('data-theme', theme);
			try {
				localStorage.setItem(STORAGE_KEY, theme);
			} catch {
				// ignore storage exceptions (private browsing, etc.)
			}
		}
	}

	toggle(): void {
		this.set(this.current === 'modern' ? 'brutalist' : 'modern');
	}
}

export const theme = new ThemeState();
