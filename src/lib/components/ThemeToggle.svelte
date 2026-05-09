<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';
</script>

<button class="toggle" onclick={() => theme.toggle()} aria-label="Toggle theme">
	<span class="opt" class:active={theme.current === 'modern'}>Modern</span>
	<span class="sep" aria-hidden="true">·</span>
	<span class="opt" class:active={theme.current === 'brutalist'}>Brutalist</span>
</button>

<style>
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		color: var(--text-3);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		transition: var(--transition);
	}
	.toggle:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
	}
	.opt {
		transition: var(--transition);
	}
	.opt.active {
		color: var(--accent);
	}
	.sep {
		color: var(--text-4);
	}
</style>
