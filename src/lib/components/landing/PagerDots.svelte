<script lang="ts">
	import { landing, PANEL_IDS } from '$lib/stores/landing.svelte';

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
</script>

<nav class="pager" aria-label="Sections">
	{#each PANEL_IDS as id, i (id)}
		<button
			class="pager-dot"
			class:active={landing.currentPanel === i}
			data-label={labels[id]}
			aria-label={labels[id]}
			aria-current={landing.currentPanel === i ? 'page' : undefined}
			onclick={() => landing.goTo(i)}
		></button>
	{/each}
</nav>

<style>
	.pager {
		position: fixed;
		right: 24px;
		top: 50%;
		transform: translateY(-50%);
		z-index: 40;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.pager-dot {
		width: 8px;
		height: 8px;
		padding: 0;
		border-radius: 50%;
		background: var(--border-mid);
		transition: var(--transition);
		position: relative;
		cursor: pointer;
		border: none;
	}
	.pager-dot::after {
		content: attr(data-label);
		position: absolute;
		right: 16px;
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
	.pager-dot:hover::after {
		opacity: 1;
	}
	.pager-dot:hover {
		background: var(--text-2);
	}
	.pager-dot.active {
		background: var(--accent);
	}

	@media (max-width: 1100px) {
		.pager {
			right: 14px;
		}
		.pager-dot::after {
			display: none;
		}
	}
</style>
