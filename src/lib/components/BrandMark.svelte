<script lang="ts">
	type Props = {
		size?: number;
		showWordmark?: boolean;
		showPill?: string;
	};

	let { size = 28, showWordmark = true, showPill }: Props = $props();
</script>

<div class="brand" style:--brand-size="{size}px">
	<img
		class="v-mark"
		src="/icons/icon-48.png"
		srcset="/icons/icon-48.png 1x, /icons/icon-96.png 2x, /icons/icon-128.png 3x"
		alt="VuVault"
		width={size}
		height={size}
	/>
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
		border-radius: calc(var(--brand-size, 28px) * 0.22);
		object-fit: contain;
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

	/* At xs viewports the wordmark eats ~80 px next to the V-mark +
	   pill + stepper + theme + audience controls on every chrome
	   route. The V-mark alone is the recognisable brand anchor; the
	   pill (Vault / Setup / etc.) tells the user which route they're
	   on, so we keep the V + pill and drop the wordmark. */
	:global(html[data-vp~='xs']) .wordmark {
		display: none;
	}
</style>
