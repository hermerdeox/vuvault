<script lang="ts">
	import { audience, type Audience } from '$lib/stores/audience.svelte';

	function pick(a: Audience) {
		audience.set(a);
	}
</script>

<div class="aud-toggle" role="tablist" aria-label="Audience">
	<button
		class="aud-opt"
		class:active={audience.current === 'user'}
		role="tab"
		aria-selected={audience.current === 'user'}
		onclick={() => pick('user')}
	>
		I just want it safe
	</button>
	<button
		class="aud-opt"
		class:active={audience.current === 'tech'}
		role="tab"
		aria-selected={audience.current === 'tech'}
		onclick={() => pick('tech')}
	>
		Show me the proof
	</button>
</div>

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
</style>
