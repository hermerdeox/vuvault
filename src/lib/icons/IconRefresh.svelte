<script lang="ts">
	type Props = {
		size?: number | string;
		stroke?: number;
		title?: string;
	};
	let { size = 18, stroke = 1.6, title = '' }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={title ? 'img' : 'presentation'}
	aria-label={title || undefined}
	aria-hidden={!title}
>
	<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>
</svg>
