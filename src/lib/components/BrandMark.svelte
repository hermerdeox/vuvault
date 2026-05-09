<script lang="ts">
	type Props = {
		size?: number;
		showWordmark?: boolean;
		showPill?: string;
	};

	let { size = 28, showWordmark = true, showPill }: Props = $props();
</script>

<div class="brand" style:--brand-size="{size}px">
	<span class="v-mark">V</span>
	{#if showWordmark}
		<span class="wordmark">VuVault</span>
	{/if}
	{#if showPill}
		<span class="pill">{showPill}</span>
	{/if}
</div>

<style>
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.02em;
	}
	.v-mark {
		width: var(--brand-size, 28px);
		height: var(--brand-size, 28px);
		display: grid;
		place-items: center;
		background: var(--surface-hover);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-weight: 800;
		font-size: calc(var(--brand-size, 28px) * 0.5);
		color: var(--brand);
	}
	.pill {
		margin-left: 6px;
		padding: 3px 7px;
		font-size: 10px;
		font-weight: 600;
		color: var(--text-3);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
</style>
