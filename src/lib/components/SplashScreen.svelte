<script lang="ts">
	import type { Attachment } from 'svelte/attachments';

	interface Props {
		visible: boolean;
		onComplete?: () => void;
	}

	let { visible, onComplete }: Props = $props();

	let show = $state(true);
	let fading = $state(false);

	$effect(() => {
		if (visible) {
			show = true;
			fading = false;
		} else if (show) {
			fading = true;
			const timeout = setTimeout(() => {
				show = false;
				fading = false;
				onComplete?.();
			}, 400);
			return () => clearTimeout(timeout);
		}
	});

	const lottieAttach: Attachment = (container) => {
		let animation: any = null;
		let destroyed = false;

		(async () => {
			const lottie = (await import('lottie-web')).default;
			if (destroyed) return;

			animation = lottie.loadAnimation({
				container,
				renderer: 'svg',
				loop: false,
				autoplay: true,
				path: '/lottie/vuvault-splash.json'
			});
		})();

		return () => {
			destroyed = true;
			animation?.destroy();
		};
	};
</script>

{#if show}
	<div class="splash" class:fading>
		<div class="content">
			<div class="animation" {@attach lottieAttach}></div>
			<p class="brand">VuVault</p>
			<p class="loader">
				<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
			</p>
		</div>
	</div>
{/if}

<style>
	.splash {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #020610;
		opacity: 1;
		transition: opacity 400ms ease;
	}

	.splash.fading {
		opacity: 0;
	}

	.content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	.animation {
		width: 256px;
		height: 256px;
	}

	.brand {
		margin: 0;
		color: #fff;
		font-weight: 900;
		font-size: 28px;
		letter-spacing: -0.03em;
		user-select: none;
	}

	.loader {
		margin: 8px 0 0;
		font-family: monospace;
		font-size: 11px;
		color: #556688;
		user-select: none;
	}

	.dot {
		animation: pulse 1.4s infinite ease-in-out;
	}

	.dot:nth-child(2) {
		animation-delay: 0.2s;
	}

	.dot:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes pulse {
		0%, 80%, 100% {
			opacity: 0.3;
		}
		40% {
			opacity: 1;
		}
	}
</style>
