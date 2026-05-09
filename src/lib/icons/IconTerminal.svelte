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
	<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
</svg>
