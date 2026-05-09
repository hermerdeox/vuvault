<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding, type Plan } from '$lib/stores/onboarding.svelte';
	import { IconArrowRight, IconArrowLeft } from '$lib/icons';

	function pick(plan: Plan) {
		onboarding.plan = plan;
	}

	const ctaLabel = $derived(
		onboarding.plan === 'free' ? 'Continue with Free' : 'Continue with $25.60 / year'
	);
</script>

<section class="screen">
	<div class="screen-inner wide">
		<Eyebrow>Step 6 of 7 · Choose your plan · honest pricing</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Free, or <span class="italic-serif">$25.60 a year.</span>
		</h1>
		<p class="lede">
			Free is genuinely free, forever, on this device. $25.60 a year unlocks encrypted multi-device
			sync, family sharing via MLS, and the Emergency Kit cloud backup. One flat price. No tiers,
			no per-user multipliers, no upsells. Cancel anytime.
		</p>

		<div class="grid">
			<button
				class="price free"
				class:selected={onboarding.plan === 'free'}
				onclick={() => pick('free')}
			>
				<div class="label">Free forever</div>
				<div class="amount">$0</div>
				<div class="tag"><span class="italic-serif">Local-only.</span> No subscription.</div>
				<ul class="bullets">
					<li>Unlimited credentials, cards, notes, documents</li>
					<li>Touch ID unlock + Secret Key</li>
					<li>ML-KEM-1024 vault encryption</li>
					<li>Bring-your-own-storage sync (R2, S3)</li>
					<li>Open-source, self-hostable</li>
				</ul>
			</button>

			<button
				class="price"
				class:selected={onboarding.plan === 'paid'}
				onclick={() => pick('paid')}
			>
				<div class="label">Unlimited</div>
				<div class="amount">$25.60<small>/year</small></div>
				<div class="tag"><span class="italic-serif">Sync everywhere.</span> All features.</div>
				<div class="math">256 bits × $0.10 = honest math</div>
				<ul class="bullets">
					<li>Everything in Free, plus:</li>
					<li>Encrypted sync across all devices</li>
					<li>MLS family/team sharing</li>
					<li>Cloud Emergency Kit backup</li>
					<li>FROST t-of-n threshold recovery</li>
					<li>Priority support, no upsells</li>
				</ul>
			</button>
		</div>

		<div class="cta-row">
			<Button variant="ghost" onclick={() => onboarding.prev()}>
				<IconArrowLeft size={14} />
				Back
			</Button>
			<Button variant="primary" size="lg" onclick={() => onboarding.next()}>
				{ctaLabel}
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
		</div>
	</div>
</section>

<style>
	@import './_screen.css';

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-bottom: 20px;
	}
	@media (max-width: 720px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	.price {
		padding: 24px 22px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 10px;
		cursor: pointer;
		transition: var(--transition);
		position: relative;
		text-align: left;
		color: inherit;
		font: inherit;
	}
	.price:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
	}
	.price.selected {
		border-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 6%, var(--surface));
	}
	.price.selected::before {
		content: '';
		position: absolute;
		top: -1px;
		left: 16px;
		right: 16px;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
	}

	.label {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 700;
	}
	.price.selected .label {
		color: var(--accent);
	}
	.amount {
		font-size: 36px;
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1;
	}
	.amount small {
		font-size: 0.4em;
		font-weight: 500;
		color: var(--text-3);
		letter-spacing: -0.005em;
		margin-left: 4px;
	}
	.price.free .amount {
		color: var(--success);
	}
	.tag {
		font-size: 13px;
		color: var(--text);
		font-weight: 500;
	}
	.math {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--accent);
	}
	.bullets {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
		padding: 0;
	}
	.bullets li {
		font-size: 12px;
		color: var(--text-2);
		display: flex;
		align-items: flex-start;
		gap: 8px;
		line-height: 1.4;
	}
	.bullets li::before {
		content: '→';
		color: var(--accent);
		font-weight: 700;
		flex-shrink: 0;
	}
	.price.free .bullets li::before {
		color: var(--success);
	}
</style>
