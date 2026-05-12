<script lang="ts">
	import { audience, type Audience } from '$lib/stores/audience.svelte';

	function pick(a: Audience) {
		audience.set(a);
	}
</script>

<!-- Desktop / tablet: full two-pill segmented control. -->
<div class="aud-toggle full" role="group" aria-label="Audience">
	<button
		class="aud-opt"
		class:active={audience.current === 'user'}
		type="button"
		aria-pressed={audience.current === 'user'}
		onclick={() => pick('user')}
	>
		I just want it safe
	</button>
	<button
		class="aud-opt"
		class:active={audience.current === 'tech'}
		type="button"
		aria-pressed={audience.current === 'tech'}
		onclick={() => pick('tech')}
	>
		Show me the proof
	</button>
</div>

<!-- Mobile: single toggle button that flips on tap. ~280px wide
     two-pill chrome on 360px viewports was eating most of the topbar
     row; one short pill leaves space for Start-free + ThemeToggle. -->
<button
	class="aud-compact"
	type="button"
	aria-label={`Audience: ${audience.current === 'user' ? 'plain language' : 'technical proof'} (tap to switch)`}
	aria-pressed={audience.current === 'tech'}
	onclick={() => pick(audience.current === 'user' ? 'tech' : 'user')}
>
	<span class="aud-compact-icon" aria-hidden="true">
		{audience.current === 'user' ? '◐' : '◑'}
	</span>
	<span class="aud-compact-label">
		{audience.current === 'user' ? 'Plain' : 'Technical'}
	</span>
</button>

<style>
	.aud-toggle {
		display: flex;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 3px;
		background: var(--surface);
	}
	.aud-opt {
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-3);
		border-radius: var(--radius-sm);
		transition: var(--transition);
		letter-spacing: -0.005em;
		white-space: nowrap;
	}
	.aud-opt:hover {
		color: var(--text-2);
	}
	.aud-opt.active {
		background: var(--surface-strong);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--border);
	}

	.aud-compact {
		display: none;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
	}
	.aud-compact-icon {
		font-size: 14px;
		color: var(--accent);
	}
	.aud-compact:hover {
		background: var(--surface-hover);
	}

	:global(html[data-vp~='mobile']) .full,
	:global(html[data-vp~='tablet']) .full {
		display: none;
	}
	:global(html[data-vp~='mobile']) .aud-compact,
	:global(html[data-vp~='tablet']) .aud-compact {
		display: inline-flex;
	}
</style>
