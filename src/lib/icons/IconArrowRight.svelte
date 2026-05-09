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
	<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
</svg>
