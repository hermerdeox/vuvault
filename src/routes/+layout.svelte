<script lang="ts">
	import '../app.css';

	type Props = {
		children?: import('svelte').Snippet;
	};

	let { children }: Props = $props();
</script>

<svelte:head>
	<title>VuVault — your data, your device, your control</title>
</svelte:head>

{#if children}
	{@render children()}
{/if}
