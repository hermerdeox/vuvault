<script lang="ts">
	import { landing, PANEL_IDS } from '$lib/stores/landing.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';

	const labels: Record<(typeof PANEL_IDS)[number], string> = {
		hero: 'Hero',
		problem: 'The problem',
		promise: 'What you get',
		vault: 'Inside the vault',
		mobile: 'On your phone',
		documents: 'Beyond passwords',
		stack: 'How it works',
		compare: 'vs. incumbents',
		pricing: 'Pricing',
		trust: "Verify, don't trust",
		final: 'Get VuVault'
	};

	// Hide entirely on mobile/tablet — native scroll-snap is the
	// affordance on those viewports, and dots are too small to be
	// useful tap targets even with a 32px hit area wrapper.
	const showPager = $derived(!viewport.isMobile && !viewport.isTablet);
</script>

{#if showPager}
	<nav class="pager" aria-label="Sections">
		{#each PANEL_IDS as id, i (id)}
			<!-- Each visual 8px dot lives inside a 32px hit target so
			     keyboard/pointer/touch users meet WCAG 2.5.5 even on
			     a track that visually looks like 8x8 dots. -->
			<button
				class="pager-hit"
				class:active={landing.currentPanel === i}
				data-label={labels[id]}
				aria-label={labels[id]}
				aria-current={landing.currentPanel === i ? 'page' : undefined}
				onclick={() => landing.goTo(i)}
			>
				<span class="pager-dot" aria-hidden="true"></span>
			</button>
		{/each}
	</nav>
{/if}

<style>
	.pager {
		position: fixed;
		right: 24px;
		top: 50%;
		transform: translateY(-50%);
		z-index: 40;
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.pager-hit {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		padding: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		position: relative;
	}
	.pager-dot {
		display: block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--border-mid);
		transition: var(--transition);
	}
	.pager-hit::after {
		content: attr(data-label);
		position: absolute;
		right: 36px;
		top: 50%;
		transform: translateY(-50%);
		white-space: nowrap;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-3);
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		backdrop-filter: blur(8px);
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		opacity: 0;
		pointer-events: none;
		transition: var(--transition);
		letter-spacing: 0;
	}
	.pager-hit:hover::after,
	.pager-hit:focus-visible::after {
		opacity: 1;
	}
	.pager-hit:hover .pager-dot {
		background: var(--text-2);
	}
	.pager-hit.active .pager-dot {
		background: var(--accent);
	}

	@media (max-width: 64em) {
		.pager {
			right: 6px;
		}
		.pager-hit::after {
			display: none;
		}
	}
</style>
