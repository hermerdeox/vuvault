<script lang="ts">
	import { landing } from '$lib/stores/landing.svelte';
	import { PRICE } from '$lib/data/pricing';

	function startFree() {
		landing.last();
	}
	function seeItWork() {
		landing.goTo(7); // stack panel (shifted +1 by the Credentials panel insertion)
	}
</script>

<section class="panel hero">
	<div class="panel-inner">
		<div class="eyebrow accent">
			<span class="dot"></span>
			<span data-vp-show="desktop"
				>VuVault · Zero-knowledge password manager · 2030 stack</span
			>
			<span data-vp-show="mobile">Zero-knowledge password manager</span>
		</div>

		<h1 class="hero-headline">
			<span data-show="user"
				>Your passwords. <span class="italic-serif">Untouchable.</span></span
			>
			<span data-show="tech"
				>Mathematical privacy.<br /><span class="italic-serif">Not policy.</span></span
			>
		</h1>

		<p class="hero-sub">
			<span data-show="user" data-vp-show="desktop"
				>Touch ID unlocks your vault. Nothing else needed. Your stuff stays on your
				device. We never see it. Not even with a court order. Not even in 2032.</span
			>
			<span data-show="user" data-vp-show="mobile"
				>Touch ID unlocks your vault. Local-only. We never see it.</span
			>
			<span data-show="tech" data-vp-show="desktop"
				>OPAQUE authentication. ML-KEM-1024 hybrid envelopes. WebAuthn PRF unlock.
				Sigstore + Rekor on every release. The cryptography your incumbents have
				not shipped.</span
			>
			<span data-show="tech" data-vp-show="mobile"
				>OPAQUE · ML-KEM-1024 · WebAuthn PRF · Sigstore Rekor. Cryptography
				incumbents skipped.</span
			>
		</p>

		<div class="hero-ctas">
			<button class="lbtn primary lg" onclick={startFree}>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M5 12h14M12 5l7 7-7 7" />
				</svg>
				Start free · {PRICE}
			</button>
			<button class="lbtn lg" onclick={seeItWork}>
				<span data-show="user">See it work</span>
				<span data-show="tech">Read the architecture</span>
			</button>
		</div>

		<div class="hero-status">
			<span class="status-pill"
				><span class="dot"></span>
				<span data-vp-show="desktop">Same-origin only · no third-party hosts</span>
				<span data-vp-show="mobile">Same-origin only</span>
			</span>
			<span class="status-pill"
				><span class="dot"></span>
				<span data-vp-show="desktop">No analytics tags shipped</span>
				<span data-vp-show="mobile">Zero analytics</span>
			</span>
			<span class="status-pill accent"
				><span class="dot"></span>
				<span data-vp-show="desktop">Crypto runs in your browser, not ours</span>
				<span data-vp-show="mobile">Local-only crypto</span>
			</span>
		</div>

		<div class="hero-disclaimer" data-vp-show="desktop">
			<span data-show="tech">
				Production builds require WebAuthn PRF · demo mode is dev-only and
				gated behind an explicit env flag.
			</span>
		</div>
	</div>

	<div class="hero-down" data-vp-show="desktop">
		<span>Scroll</span>
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			><path d="M12 5v14M5 12l7 7 7-7" /></svg
		>
	</div>

	<div class="hero-swipe" data-vp-show="mobile">
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			><path d="M12 5v14M5 12l7 7 7-7" /></svg
		>
	</div>
</section>

<style>
	@import './_landing.css';

	.hero {
		text-align: center;
		align-items: center;
	}
	.hero-headline {
		font-size: clamp(36px, 9vw, 96px);
		font-weight: 700;
		letter-spacing: -0.04em;
		line-height: 0.96;
		margin-bottom: 28px;
		max-width: 1100px;
	}
	.hero-headline :global(.italic-serif) {
		letter-spacing: -0.02em;
		font-size: 1.05em;
	}
	.hero-sub {
		font-size: clamp(16px, 1.6vw, 20px);
		color: var(--text-2);
		max-width: 680px;
		margin: 0 auto 40px;
		line-height: 1.5;
		letter-spacing: -0.005em;
	}
	.hero-ctas {
		display: flex;
		gap: 12px;
		justify-content: center;
		margin-bottom: 56px;
		flex-wrap: wrap;
	}
	@media (max-width: 30em) {
		.hero {
			justify-content: center;
			padding-top: var(--top-bar-h, 56px);
			padding-bottom: var(--top-bar-h, 56px);
		}
		.hero-headline {
			margin-bottom: 18px;
		}
		.hero-sub {
			margin-bottom: 34px;
		}
		.hero-ctas {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			margin-bottom: 22px;
			margin-inline: auto;
			max-width: 340px;
			width: 100%;
		}
		.hero-ctas :global(.lbtn) {
			flex: 1 1 auto;
			width: 100%;
			min-width: 0;
			justify-content: center;
		}
		.hero-ctas :global(.lbtn.primary) {
			min-height: 56px;
			font-weight: 700;
			box-shadow: 0 14px 34px color-mix(in srgb, var(--brand) 28%, transparent);
			transform: translateY(-1px);
		}
		.hero-ctas :global(.lbtn:not(.primary)) {
			min-height: 46px;
			opacity: 0.82;
		}
		.hero-status {
			gap: 6px;
		}
		.status-pill {
			padding: 6px 10px;
			font-size: 11px;
		}
	}
	.hero-status {
		display: flex;
		gap: 12px;
		justify-content: center;
		flex-wrap: wrap;
	}
	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-2);
		backdrop-filter: blur(10px);
	}
	.status-pill .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--success);
		box-shadow: 0 0 0 0 var(--success);
		animation: pulse 2.4s ease-in-out infinite;
	}
	.status-pill.accent .dot {
		background: var(--accent);
	}

	.hero-disclaimer {
		margin-top: 18px;
		margin-inline: auto;
		text-align: center;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		max-width: 560px;
		line-height: 1.5;
		letter-spacing: 0.01em;
	}
	@keyframes pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 50%, transparent);
		}
		50% {
			box-shadow: 0 0 0 5px transparent;
		}
	}

	.hero-down {
		position: absolute;
		bottom: 28px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 11px;
		font-weight: 600;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		display: flex;
		align-items: center;
		gap: 8px;
		animation: bob 2.6s ease-in-out infinite;
	}
	.hero-swipe {
		margin-top: auto;
		padding-top: 16px;
		display: flex;
		justify-content: center;
		color: var(--text-3);
		opacity: 0.5;
		animation: bob 2.6s ease-in-out infinite;
	}
	@keyframes bob {
		0%,
		100% {
			transform: translate(-50%, 0);
		}
		50% {
			transform: translate(-50%, 4px);
		}
	}
</style>
