<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		accent?: boolean;
		children: Snippet;
	};

	let { accent = false, children }: Props = $props();
</script>

<div class="eyebrow" class:accent>
	<span class="dot" aria-hidden="true"></span>
	{@render children()}
</div>

<style>
	.eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-2);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.eyebrow.accent {
		border-color: var(--line-strong);
		color: var(--accent);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
		flex-shrink: 0;
	}
</style>
