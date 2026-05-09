<script lang="ts">
	import { landing } from '$lib/stores/landing.svelte';
	import { PRICE } from '$lib/data/pricing';

	function startFree() {
		landing.last();
	}
	function seeItWork() {
		landing.goTo(6); // stack panel
	}
</script>

<section class="panel hero">
	<div class="panel-inner">
		<div class="eyebrow accent">
			<span class="dot"></span>
			VuVault · Zero-knowledge password manager · 2030 stack
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
			<span data-show="user"
				>Touch ID unlocks your vault. Nothing else needed. Your stuff stays on your
				device. We never see it. Not even with a court order. Not even in 2032.</span
			>
			<span data-show="tech"
				>OPAQUE authentication. ML-KEM-1024 hybrid envelopes. WebAuthn PRF unlock.
				Verifiable transparency log. The cryptography your incumbents have not shipped.</span
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
				><span class="dot"></span>Same-origin only · no third-party hosts</span
			>
			<span class="status-pill"><span class="dot"></span>No analytics tags shipped</span>
			<span class="status-pill accent"
				><span class="dot"></span>Crypto runs in your browser, not ours</span
			>
		</div>

		<div class="hero-disclaimer">
			<span data-show="tech">
				Production builds require WebAuthn PRF · demo mode is dev-only and
				gated behind an explicit env flag.
			</span>
		</div>
	</div>

	<div class="hero-down">
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
</section>

<style>
	@import './_landing.css';

	.hero {
		text-align: center;
		align-items: center;
	}
	.hero-headline {
		font-size: clamp(48px, 8vw, 96px);
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
