/**
 * Viewport store — runtime API for the `<html data-vp>` attribute.
 *
 * The attribute itself is set by the inline FOUC script in `app.html`
 * before first paint and updated on `resize` / `orientationchange` /
 * `visualViewport.resize`. CSS already reacts via
 * `[data-vp~='mobile']` selectors and the `[data-vp-show]` content-
 * reduction pattern in `globals.css`.
 *
 * This module exposes the same data as a Svelte 5 rune-backed `$state`
 * object so components that need to *not render* a heavy element
 * (BackgroundFx spotlights, the 1200×750 vault SVG mock, the iPad SVG
 * in the Documents panel) can branch with `{#if !viewport.isMobile}`
 * instead of paying the cost of building and mounting the DOM only to
 * hide it via CSS.
 *
 * Source of truth is the `data-vp` attribute, kept in sync via a
 * MutationObserver — this guarantees the store agrees with whatever the
 * inline script computed (including its preference for
 * `visualViewport.height` over the lying `window.innerHeight`).
 */

import { browser } from '$app/environment';

export type ViewportSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type ViewportClass = 'mobile' | 'tablet' | 'desktop';

interface ViewportSnapshot {
	tokens: string;
	size: ViewportSize;
	klass: ViewportClass;
	short: boolean;
}

function parseTokens(tokens: string): ViewportSnapshot {
	const set = new Set(tokens.split(/\s+/).filter(Boolean));
	const size: ViewportSize = set.has('xs')
		? 'xs'
		: set.has('sm')
			? 'sm'
			: set.has('md')
				? 'md'
				: set.has('xl')
					? 'xl'
					: 'lg';
	const klass: ViewportClass = set.has('mobile')
		? 'mobile'
		: set.has('tablet')
			? 'tablet'
			: 'desktop';
	return { tokens, size, klass, short: set.has('short') };
}

function readInitial(): ViewportSnapshot {
	if (!browser) return parseTokens('lg desktop');
	return parseTokens(document.documentElement.getAttribute('data-vp') ?? 'lg desktop');
}

class ViewportState {
	private snap = $state<ViewportSnapshot>(readInitial());
	private observer: MutationObserver | null = null;

	constructor() {
		if (!browser) return;
		// MutationObserver on `<html>` keeps the store in lockstep
		// with the inline script's writes; we deliberately do NOT
		// own the matchMedia / visualViewport listeners here so the
		// inline script remains the single source of truth and there
		// is exactly one resize hot path.
		this.observer = new MutationObserver((records) => {
			for (const r of records) {
				if (r.type === 'attributes' && r.attributeName === 'data-vp') {
					const next = document.documentElement.getAttribute('data-vp') ?? 'lg desktop';
					if (next !== this.snap.tokens) this.snap = parseTokens(next);
				}
			}
		});
		this.observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-vp']
		});
	}

	get tokens(): string {
		return this.snap.tokens;
	}
	get size(): ViewportSize {
		return this.snap.size;
	}
	get klass(): ViewportClass {
		return this.snap.klass;
	}
	get isShort(): boolean {
		return this.snap.short;
	}
	get isMobile(): boolean {
		return this.snap.klass === 'mobile';
	}
	get isTablet(): boolean {
		return this.snap.klass === 'tablet';
	}
	get isDesktop(): boolean {
		return this.snap.klass === 'desktop';
	}
	get isXs(): boolean {
		return this.snap.size === 'xs';
	}
}

export const viewport = new ViewportState();
