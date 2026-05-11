<script lang="ts">
	import { theme } from '$lib/stores/theme.svelte';
</script>

<button
	class="toggle"
	onclick={() => theme.toggle()}
	aria-label="Toggle theme"
>
	<!-- Desktop / tablet renders the full segmented control. -->
	<span class="full">
		<span class="opt" class:active={theme.current === 'modern'}>Modern</span>
		<span class="sep" aria-hidden="true">·</span>
		<span class="opt" class:active={theme.current === 'brutalist'}>Brutalist</span>
	</span>
	<!-- Mobile collapses to a single active label + caret to free up
	     header width on every chrome route. -->
	<span class="compact">
		<span class="compact-label">
			{theme.current === 'modern' ? 'Modern' : 'Brutalist'}
		</span>
		<svg
			class="compact-caret"
			aria-hidden="true"
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
		>
			<path d="M3 4 L5 6 L7 4" />
		</svg>
	</span>
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
	.compact {
		display: none;
		align-items: center;
		gap: 4px;
		color: var(--accent);
	}
	.compact-label {
		font-weight: 700;
	}

	/* Touch viewports: hide the full segmented control, show the
	   compact active-only label. Saves ~80-120 px header width on
	   every chrome route. */
	:global(html[data-vp~='mobile']) .full,
	:global(html[data-vp~='tablet']) .full {
		display: none;
	}
	:global(html[data-vp~='mobile']) .compact,
	:global(html[data-vp~='tablet']) .compact {
		display: inline-flex;
	}
	:global(html[data-vp~='mobile']) .toggle,
	:global(html[data-vp~='tablet']) .toggle {
		min-height: 44px;
		min-width: 44px;
		padding: 0 12px;
	}
</style>
