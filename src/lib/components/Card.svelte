<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		variant?: 'default' | 'elevated' | 'accent';
		padding?: 'sm' | 'md' | 'lg';
		interactive?: boolean;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
	};

	let {
		variant = 'default',
		padding = 'md',
		interactive = false,
		onclick,
		children
	}: Props = $props();
</script>

{#if interactive}
	<button class="card {variant} pad-{padding}" {onclick}>
		{@render children()}
	</button>
{:else}
	<div class="card {variant} pad-{padding}">
		{@render children()}
	</div>
{/if}

<style>
	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: block;
		text-align: left;
		color: inherit;
		font: inherit;
		width: 100%;
		transition: var(--transition);
	}
	button.card {
		cursor: pointer;
	}
	button.card:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
	}
	.card.elevated {
		background: var(--bg-elev);
		box-shadow: var(--shadow-card);
	}
	.card.accent {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 5%, var(--surface));
	}
	.pad-sm {
		padding: 12px 14px;
	}
	.pad-md {
		padding: 18px 20px;
	}
	.pad-lg {
		padding: 24px 28px;
	}
</style>
