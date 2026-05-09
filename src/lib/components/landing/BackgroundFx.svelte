<!-- Ambient background: grid + two drifting spotlights. Pure decoration,
     pointer-events: none, fixed. Used by the (landing) shell only. -->

<div class="bg-grid" aria-hidden="true"></div>
<div class="bg-spotlight" aria-hidden="true"></div>
<div class="bg-spotlight2" aria-hidden="true"></div>

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
