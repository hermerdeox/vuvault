<script lang="ts">
	import { PRICE_NUM, PRICE_PER, PRICE_MATH, PRICE_MONTHLY_EQUIV } from '$lib/data/pricing';
</script>

<section class="panel pricing">
	<div class="panel-inner">
		<div class="eyebrow accent"><span class="dot"></span>Honest pricing</div>
		<h2 class="section-title">
			$25.60. <span class="italic-serif">A year.</span><br />
			<span class="muted">Every device. Every feature.</span>
		</h2>

		<div class="price-card">
			<div class="price-num">
				{PRICE_NUM}<small>{PRICE_PER}</small>
			</div>
			<div class="price-math">{PRICE_MATH}</div>
			<div class="price-tag">
				<span class="italic-serif">One flat price.</span> Unlimited devices. Every feature.<br
				/>
				No per-user pricing. No tier games. Cancel any time.
			</div>
			<div class="price-bullets">
				<div class="price-bullet">
					{PRICE_MONTHLY_EQUIV}<small>billed yearly</small>
				</div>
				<div class="price-bullet">∞<small>devices</small></div>
				<div class="price-bullet">∞<small>updates</small></div>
			</div>
		</div>

		<div class="price-vs">
			<span data-vp-show="desktop">
				<span>1Password</span> $35.88/yr &nbsp;·&nbsp;
				<span>Dashlane</span> $59.88/yr &nbsp;·&nbsp;
				<span>Proton Pass</span> $47.88/yr &nbsp;·&nbsp;
				<span>NordPass</span> $26.85/yr &nbsp;·&nbsp;
				<span class="us-name">VuVault</span> $25.60/yr
			</span>
			<span data-vp-show="mobile">
				Cheapest among 1Password, Dashlane, Proton — see the table.
			</span>
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.pricing {
		text-align: center;
		align-items: center;
	}
	.muted {
		color: var(--text-3);
	}

	.price-card {
		margin: 32px auto 0;
		padding: 48px 56px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		max-width: 560px;
		backdrop-filter: blur(16px);
		position: relative;
		overflow: hidden;
	}
	.price-card::before {
		content: '';
		position: absolute;
		top: -2px;
		left: 20%;
		right: 20%;
		height: 2px;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
	}
	.price-num {
		font-size: clamp(80px, 12vw, 140px);
		font-weight: 700;
		letter-spacing: -0.05em;
		line-height: 1;
		color: var(--text);
		font-feature-settings: 'tnum';
	}
	.price-num small {
		font-size: 0.18em;
		font-weight: 500;
		color: var(--text-3);
		letter-spacing: -0.01em;
		margin-left: 6px;
	}
	.price-math {
		margin-top: 8px;
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--accent);
		letter-spacing: 0;
	}
	.price-tag {
		margin-top: 24px;
		font-size: 18px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.price-tag :global(.italic-serif) {
		color: var(--text);
		font-size: 1.1em;
	}
	.price-bullets {
		margin-top: 32px;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
		max-width: 540px;
		margin-left: auto;
		margin-right: auto;
	}
	.price-bullet {
		padding: 14px 12px;
		background: var(--surface-strong);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		font-size: 12px;
		font-weight: 600;
		color: var(--text);
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: center;
	}
	.price-bullet small {
		color: var(--text-3);
		font-weight: 400;
		font-size: 11px;
	}
	.price-vs {
		margin-top: 28px;
		font-size: 12px;
		color: var(--text-3);
		font-family: var(--font-mono);
		letter-spacing: 0;
	}
	.price-vs span {
		color: var(--text-2);
	}
	.us-name {
		color: var(--accent);
	}

	@media (max-width: 45em) {
		.price-bullets {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 30em) {
		.price-card {
			padding: 28px 22px;
			margin-top: 18px;
		}
		.price-tag {
			font-size: 14px;
			margin-top: 16px;
		}
		.price-bullets {
			margin-top: 18px;
			gap: 8px;
		}
		.price-bullet {
			padding: 10px 8px;
			font-size: 11px;
		}
		.price-vs {
			margin-top: 18px;
			font-size: 11px;
			line-height: 1.5;
		}
	}
</style>
