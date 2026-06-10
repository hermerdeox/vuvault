<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { IconArrowRight, IconRefresh } from '$lib/icons';
</script>

<section class="screen">
	<div class="screen-inner">
		<Eyebrow>Setup · 60 seconds · zero accounts created</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Let's set up <span class="italic-serif">your vault.</span>
		</h1>
		<p class="lede">
			No email. No master password. No company holding your stuff. We'll generate a 256-bit Secret
			Key on this device, bind it to Touch ID, and you're done. The only people who will ever
			decrypt your vault are you and your trusted devices.
		</p>

		<div class="cards">
			<div class="card">
				<div class="card-title">No account creation</div>
				<div class="card-body">
					No email, no phone, no name. Your vault is keyed to this device, not to a record on our
					server.
				</div>
			</div>
			<div class="card">
				<div class="card-title">Quantum-safe from day one</div>
				<div class="card-body">
					ML-KEM-1024 hybrid envelope. A vault stolen today stays unreadable in 2032 and beyond.
				</div>
			</div>
			<div class="card">
				<div class="card-title">Verifiable build</div>
				<div class="card-body">
					Bundle hash visible at every unlock. Compare it to the public release log. We can't ship
					a backdoor.
				</div>
			</div>
		</div>

		<div class="cta-row">
			<Button variant="primary" size="lg" onclick={() => onboarding.next()}>
				Begin setup
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
			<Button variant="ghost" href="#restore">
				<IconRefresh size={14} />
				Restore from another device instead
			</Button>
		</div>

		<p class="trust-line">
			Don't take our word for it.
			<a class="trust-link" href="/privacy">
				See the honest Vu Privacy Level
			</a>
			— every claim points to a file path you can read.
		</p>
	</div>
</section>

<style>
	@import './_screen.css';

	.cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 14px;
		margin-bottom: 36px;
	}
	@media (max-width: 45em) {
		.cards {
			grid-template-columns: 1fr;
		}
	}
	.card {
		padding: 18px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.card-title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.card-body {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.trust-line {
		margin-top: 28px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-3);
		line-height: 1.55;
	}
	.trust-link {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
	}
	.trust-link:hover,
	.trust-link:focus-visible {
		text-decoration-style: solid;
	}
	@media (pointer: coarse) {
		.trust-link {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
</style>
