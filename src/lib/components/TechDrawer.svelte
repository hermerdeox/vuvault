<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title?: string;
		children: Snippet;
		open?: boolean;
	};

	let { title = 'What happens technically', children, open = false }: Props = $props();
	let expanded = $state(open);
</script>

<details class="drawer" open={expanded} ontoggle={(e) => (expanded = (e.currentTarget as HTMLDetailsElement).open)}>
	<summary class="summary">
		<span class="chevron" class:open={expanded} aria-hidden="true">
			<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
				<polyline points="6 9 12 15 18 9" />
			</svg>
		</span>
		<span class="title">{title}</span>
	</summary>
	<div class="body">
		{@render children()}
	</div>
</details>

<style>
	.drawer {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}
	.summary {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		list-style: none;
		user-select: none;
	}
	.summary::-webkit-details-marker {
		display: none;
	}
	.summary:hover {
		color: var(--text-2);
	}
	.chevron {
		display: inline-flex;
		transition: transform 200ms ease;
	}
	.chevron.open {
		transform: rotate(180deg);
	}
	.body {
		padding: 12px 14px 14px 14px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.55;
	}
	:global(.drawer .body code) {
		font-family: var(--font-mono);
		font-size: 11px;
		background: var(--bg-elev);
		padding: 1px 5px;
		border-radius: var(--radius-xs);
		color: var(--accent);
	}
</style>
