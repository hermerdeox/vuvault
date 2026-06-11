<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { landing } from '$lib/stores/landing.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';

	function startFree() {
		// Desktop: straight to the login page (/unlock routes new
		// visitors on to onboarding). Mobile keeps the in-page tour —
		// the final panel carries the full pitch before commitment.
		if (viewport.isDesktop) {
			void goto(resolve('/unlock'));
			return;
		}
		landing.last();
	}
	function seeItWork() {
		landing.goTo(7); // stack panel (shifted +1 by the Credentials panel insertion)
	}
</script>

<section class="panel hero">
	<svg
		class="hero-safe"
		data-vp-show="desktop"
		aria-hidden="true"
		viewBox="0 0 400 400"
		fill="none"
		stroke="currentColor"
		stroke-linecap="round"
	>
		<!-- body + door frame -->
		<rect x="8" y="8" width="384" height="384" rx="20" stroke-width="2" />
		<rect x="34" y="34" width="332" height="332" rx="12" stroke-width="1.5" />
		<!-- feet -->
		<path d="M78 392v14h40v-14" stroke-width="1.5" />
		<path d="M282 392v14h40v-14" stroke-width="1.5" />
		<!-- corner bolts -->
		<circle cx="62" cy="62" r="7" stroke-width="1.5" />
		<circle cx="338" cy="62" r="7" stroke-width="1.5" />
		<circle cx="62" cy="338" r="7" stroke-width="1.5" />
		<circle cx="338" cy="338" r="7" stroke-width="1.5" />
		<!-- combination dial -->
		<circle cx="200" cy="200" r="78" stroke-width="2" />
		<circle cx="200" cy="200" r="60" stroke-width="1.5" />
		<circle cx="200" cy="200" r="7" stroke-width="1.5" />
		<g stroke-width="1">
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(0 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(30 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(60 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(90 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(120 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(150 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(180 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(210 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(240 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(270 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(300 200 200)" />
			<line x1="200" y1="126" x2="200" y2="136" transform="rotate(330 200 200)" />
		</g>
		<!-- spoke wheel -->
		<g class="safe-wheel" stroke-width="1.5">
			<g transform="rotate(0 200 200)">
				<line x1="200" y1="193" x2="200" y2="152" />
				<circle cx="200" cy="147" r="5" />
			</g>
			<g transform="rotate(120 200 200)">
				<line x1="200" y1="193" x2="200" y2="152" />
				<circle cx="200" cy="147" r="5" />
			</g>
			<g transform="rotate(240 200 200)">
				<line x1="200" y1="193" x2="200" y2="152" />
				<circle cx="200" cy="147" r="5" />
			</g>
		</g>
		<!-- handle bar -->
		<line x1="318" y1="158" x2="318" y2="242" stroke-width="2" />
		<line x1="296" y1="200" x2="311" y2="200" stroke-width="1.5" />
	</svg>

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
				Open Your Vault
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
	.hero-safe {
		position: absolute;
		left: var(--safe-left, 0px);
		top: 50%;
		transform: translate(-50%, -50%);
		width: clamp(280px, 30vw, 560px);
		height: auto;
		color: var(--text-3);
		opacity: 0.28;
		pointer-events: none;
		user-select: none;
		animation: safe-slide 1.6s cubic-bezier(0.22, 1, 0.36, 1) 0.4s both;
	}
	.hero-safe :global(.safe-wheel) {
		transform-box: view-box;
		transform-origin: 200px 200px;
		animation: safe-wheel-turn 2s cubic-bezier(0.3, 1.15, 0.5, 1) 0.55s both;
	}
	@keyframes safe-slide {
		from {
			transform: translate(-104%, -50%);
		}
		to {
			transform: translate(-50%, -50%);
		}
	}
	@keyframes safe-wheel-turn {
		from {
			transform: rotate(-240deg);
		}
		to {
			transform: rotate(0deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hero-safe,
		.hero-safe :global(.safe-wheel) {
			animation: none;
		}
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
			padding-top: calc(var(--top-bar-h, 56px) + var(--safe-top, 0px));
			padding-bottom: calc(var(--top-bar-h, 56px) + var(--safe-bottom, 0px));
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
		/* Stay above the home-indicator gesture zone on island iPhones. */
		bottom: calc(28px + var(--safe-bottom, 0px));
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
