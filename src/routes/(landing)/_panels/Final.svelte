<script lang="ts">
	import { goto } from '$app/navigation';
	import { PRICE } from '$lib/data/pricing';

	function startFree() {
		goto('/onboarding');
	}
</script>

<section class="panel final">
	<div class="final-inner">
		<div class="eyebrow accent"><span class="dot"></span>Ready when you are</div>
		<h2 class="final-headline">
			<span data-show="user"
				>Your data. <span class="italic-serif">Your device.</span><br />Your control.</span
			>
			<span data-show="tech"
				>Untouchable by <span class="italic-serif">construction.</span><br />Verifiable by
				anyone.</span
			>
		</h2>
		<p class="final-sub">
			<span data-show="user" data-vp-show="desktop"
				>Get the password manager that 2030 actually needs. Today, for {PRICE}.</span
			>
			<span data-show="user" data-vp-show="mobile">
				The password manager 2030 needs. {PRICE}.
			</span>
			<span data-show="tech" data-vp-show="desktop"
				>Read the whitepaper, audit the source, deploy the server. Or just use it — {PRICE}.</span
			>
			<span data-show="tech" data-vp-show="mobile">
				Read it, audit it, deploy it. Or use it — {PRICE}.
			</span>
		</p>
		<div class="final-ctas">
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
					><path d="M5 12h14M12 5l7 7-7 7" /></svg
				>
				Get VuVault — {PRICE}
			</button>
			<a href="/blueprint" class="lbtn lg">
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline
						points="14 2 14 8 20 8"
					/></svg
				>
				Read the blueprint
			</a>
		</div>
	</div>

	<div class="final-foot">
		<div class="brand">
			<img
				class="v-mark"
				src="/icons/icon-48.png"
				srcset="/icons/icon-48.png 1x, /icons/icon-96.png 2x, /icons/icon-128.png 3x"
				alt="VuVault"
				width="28"
				height="28"
			/>
			<span>VuVault</span>
		</div>
		<div class="final-foot-links">
			<a href="/blueprint">Whitepaper</a>
			<a
				href="https://github.com/vuvault"
				rel="noreferrer noopener"
				target="_blank">GitHub</a
			>
			<a href="/blueprint">Architecture</a>
			<a href="/recover">Recover</a>
		</div>
		<div class="final-foot-tagline">Your data. Your device. Your control.</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.final {
		text-align: center;
		align-items: center;
		justify-content: space-between;
	}
	.final-inner {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		flex: 1;
		width: 100%;
	}
	.final-headline {
		font-size: clamp(28px, 8vw, 72px);
		font-weight: 700;
		letter-spacing: -0.035em;
		line-height: 1;
		margin-bottom: 24px;
		max-width: 900px;
	}
	.final-sub {
		font-size: 18px;
		color: var(--text-2);
		max-width: 540px;
		margin: 0 auto 36px;
		line-height: 1.5;
	}
	.final-ctas {
		display: flex;
		gap: 12px;
		justify-content: center;
		flex-wrap: wrap;
		margin-bottom: 56px;
	}
	.final-foot {
		width: 100%;
		max-width: 1200px;
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 24px;
		align-items: center;
		padding-top: 24px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--text-3);
		text-align: left;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 15px;
		letter-spacing: -0.02em;
		color: var(--text);
	}
	.v-mark {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		object-fit: contain;
	}
	.final-foot-links {
		display: flex;
		gap: 24px;
		justify-content: center;
		flex-wrap: wrap;
	}
	.final-foot-links a {
		color: var(--text-2);
		font-weight: 500;
		transition: var(--transition);
	}
	.final-foot-links a:hover {
		color: var(--text);
	}
	.final-foot-tagline {
		font-style: italic;
		font-family: var(--font-serif);
		font-size: 13px;
		color: var(--text-2);
	}

	@media (max-width: 45em) {
		.final-foot {
			grid-template-columns: 1fr;
			text-align: center;
			gap: 14px;
			/* iOS PWAs / Safari home-indicator: the Final panel is the
			   bottom snap target, so its foot is what sits over the
			   indicator. Push it above the safe area with a max() floor
			   so unnotched browsers keep the original padding. */
			padding-bottom: max(0px, env(safe-area-inset-bottom, 0px));
		}
		.final-foot-links a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			padding: 4px 8px;
		}
	}
	@media (max-width: 30em) {
		.final-sub {
			font-size: 14px;
			margin-bottom: 24px;
		}
		.final-ctas {
			margin-bottom: 32px;
			width: 100%;
		}
		.final-ctas :global(.lbtn) {
			flex: 1 1 auto;
			justify-content: center;
		}
		.final-foot-links {
			gap: 14px;
			font-size: 12px;
		}
	}
</style>
