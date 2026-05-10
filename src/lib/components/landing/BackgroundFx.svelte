<!-- Ambient background: grid + two drifting spotlights. Pure decoration,
     pointer-events: none, fixed. Used by the (landing) shell only.

     On mobile/tablet the spotlights are skipped entirely — two 80vmax
     radial gradients animating for 32-44s straight is real GPU pressure
     on a phone, and the effect is invisible on a 360px screen anyway. -->
<script lang="ts">
	import { viewport } from '$lib/stores/viewport.svelte';
</script>

<div class="bg-grid" aria-hidden="true"></div>
{#if !viewport.isMobile && !viewport.isTablet}
	<div class="bg-spotlight" aria-hidden="true"></div>
	<div class="bg-spotlight2" aria-hidden="true"></div>
{/if}

<style>
	.bg-grid,
	.bg-spotlight,
	.bg-spotlight2 {
		position: fixed;
		pointer-events: none;
		z-index: 0;
	}
	.bg-grid {
		inset: 0;
		background-image: linear-gradient(var(--grid-color) 1px, transparent 1px),
			linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
		background-size: 48px 48px;
		mask-image: radial-gradient(ellipse at center, var(--bg) 0%, transparent 75%);
		-webkit-mask-image: radial-gradient(ellipse at center, var(--bg) 0%, transparent 75%);
	}
	/* Lower the grid contrast on mobile so it doesn't compete with copy
	   on a small viewport. Belt-and-braces with the {#if} guard above. */
	:global(html[data-vp~='mobile']) .bg-grid {
		opacity: 0.5;
		background-size: 32px 32px;
	}
	.bg-spotlight,
	.bg-spotlight2 {
		width: 80vmax;
		height: 80vmax;
		border-radius: 50%;
	}
	.bg-spotlight {
		top: -30vmax;
		right: -30vmax;
		background: radial-gradient(circle, var(--spotlight) 0%, transparent 60%);
		animation: drift 32s ease-in-out infinite;
	}
	.bg-spotlight2 {
		bottom: -30vmax;
		left: -30vmax;
		background: radial-gradient(circle, var(--spotlight-2) 0%, transparent 60%);
		animation: drift 44s ease-in-out infinite reverse;
	}
	@keyframes drift {
		0%,
		100% {
			transform: translate(0, 0) scale(1);
		}
		50% {
			transform: translate(-6vw, 4vh) scale(1.05);
		}
	}
</style>
