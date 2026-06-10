<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding, type Plan } from '$lib/stores/onboarding.svelte';
	import { IconArrowRight, IconArrowLeft } from '$lib/icons';

	function pick(plan: Plan) {
		onboarding.plan = plan;
	}

	let freeBtn = $state<HTMLButtonElement | null>(null);
	let paidBtn = $state<HTMLButtonElement | null>(null);

	// WAI-ARIA radio-group keyboard contract: arrows move the selection.
	// stopPropagation keeps the wizard's global arrow-key step
	// navigation (+page.svelte) from also firing on the same keypress.
	function handleGroupKey(e: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
		e.preventDefault();
		e.stopPropagation();
		const next: Plan = onboarding.plan === 'free' ? 'paid' : 'free';
		pick(next);
		(next === 'free' ? freeBtn : paidBtn)?.focus();
	}

	const ctaLabel = $derived(
		onboarding.plan === 'free' ? 'Continue with Free' : 'Continue with $25.60 / year'
	);
</script>

<section class="screen">
	<div class="screen-inner wide">
		<Eyebrow>{onboarding.stepLabel('pricing')} · Choose your plan · honest pricing</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Free, or <span class="italic-serif">$25.60 a year.</span>
		</h1>
		<p class="lede">
			Free is genuinely free, forever, on this device. Paid plans fund the roadmap: encrypted
			multi-device sync in Tier 2, MLS sharing and cloud backup in Tier 2+, and FROST recovery
			in Tier 3. No per-user multipliers, no surprise upsells. Cancel anytime.
		</p>

		<div class="grid" role="radiogroup" aria-label="Choose your plan">
			<button
				class="price free"
				class:selected={onboarding.plan === 'free'}
				role="radio"
				aria-checked={onboarding.plan === 'free'}
				aria-label="Free forever plan, $0, local-only"
				tabindex={onboarding.plan === 'free' ? 0 : -1}
				bind:this={freeBtn}
				onkeydown={handleGroupKey}
				onclick={() => pick('free')}
			>
				<div class="label">Free forever</div>
				<div class="amount">$0</div>
				<div class="tag"><span class="italic-serif">Local-only.</span> No subscription.</div>
				<ul class="bullets">
					<li>Unlimited credentials, cards, notes, documents</li>
					<li>Touch ID unlock + Secret Key</li>
					<li>ML-KEM-1024 vault encryption</li>
					<li>Local encrypted storage on this device</li>
					<li>Open-source, self-hostable</li>
				</ul>
			</button>

			<button
				class="price"
				class:selected={onboarding.plan === 'paid'}
				role="radio"
				aria-checked={onboarding.plan === 'paid'}
				aria-label="Unlimited plan, $25.60 per year, roadmap access"
				tabindex={onboarding.plan === 'paid' ? 0 : -1}
				bind:this={paidBtn}
				onkeydown={handleGroupKey}
				onclick={() => pick('paid')}
			>
				<div class="label">Unlimited</div>
				<div class="amount">$25.60<small>/year</small></div>
				<div class="tag"><span class="italic-serif">Roadmap access.</span> Future sync tiers.</div>
				<div class="math">256 bits × $0.10 = honest math</div>
				<ul class="bullets">
					<li>Everything in Free, plus:</li>
					<li>Encrypted multi-device sync planned for Tier 2</li>
					<li>MLS family/team sharing planned for Tier 2+</li>
					<li>Cloud Emergency Kit backup planned for Tier 2+</li>
					<li>FROST t-of-n threshold recovery planned for Tier 3</li>
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
	@media (max-width: 45em) {
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
