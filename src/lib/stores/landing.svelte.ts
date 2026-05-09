/**
 * Landing pager store — index of the currently active panel.
 *
 * Drives the transform-based pager in src/routes/(landing)/+page.svelte.
 * The Cardinal Rule (no page-level scroll) means the prototype's native
 * scroll-snap is replaced with translateY(-currentPanel * 100dvh).
 */

export const PANEL_IDS = [
	'hero',
	'problem',
	'promise',
	'vault',
	'mobile',
	'documents',
	'stack',
	'compare',
	'pricing',
	'trust',
	'final'
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

class LandingState {
	currentPanel = $state(0);
	panelCount = PANEL_IDS.length;

	next(): void {
		if (this.currentPanel < this.panelCount - 1) this.currentPanel += 1;
	}

	prev(): void {
		if (this.currentPanel > 0) this.currentPanel -= 1;
	}

	goTo(idx: number): void {
		this.currentPanel = Math.max(0, Math.min(this.panelCount - 1, idx));
	}

	first(): void {
		this.currentPanel = 0;
	}

	last(): void {
		this.currentPanel = this.panelCount - 1;
	}
}

export const landing = new LandingState();
