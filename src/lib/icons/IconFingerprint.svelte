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
	<path d="M12 11h.01"/><path d="M9 9c0-1 1-2 3-2s3 1 3 2"/><path d="M7 11c0-2 2-4 5-4s5 2 5 4"/><path d="M5 13c0-3 3-6 7-6s7 3 7 6"/><path d="M9 16c0-1 1-2 3-2s3 1 3 2"/><path d="M11 19v1"/><path d="M13 19v1"/>
</svg>
