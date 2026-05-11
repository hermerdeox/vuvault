<!--
  Vault interior preview panel. The large SVG below depicts a realistic
  vault UI mockup (Visa card, sidebar, item list, detail pane). Per the
  invariants in CURSOR_PROMPT.md, hex literals inside this realistic-content
  SVG are the explicit exception to the no-hex rule.
-->
<script lang="ts">
	import { viewport } from '$lib/stores/viewport.svelte';
</script>

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow accent">
			<span class="dot"></span>
			<span data-show="user">Inside the vault</span>
			<span data-show="tech">UI rendered from a real session</span>
		</div>
		<h2 class="section-title">
			<span data-show="user"
				>The most polished vault<br />you've ever <span class="italic-serif">used.</span
				></span
			>
			<span data-show="tech"
				>No screenshots. <span class="italic-serif">Live SVG.</span></span
			>
		</h2>

		<div class="vault-preview-wrap">
			<div class="mock-stage">
				<div class="vault-preview-glow" aria-hidden="true"></div>
				{#if !viewport.isMobile}
				<div
					class="vault-preview-mock"
					role="img"
					aria-label="VuVault interior — sidebar with categories, item list, and credit card detail view"
				>
					<img
						src="/landing/vault-mock.svg"
						alt=""
						loading="lazy"
						decoding="async"
						width="1200"
						height="750"
					/>
				</div>
				{:else}
				<!-- Mobile substitute: a small redacted-card chip we can render
				     at 320×200 without rotating, instead of the 1200×750 SVG. -->
				<div class="vault-preview-mini" role="img" aria-label="VuVault credit card item — redacted">
					<div class="vault-preview-mini-row">
						<span class="vault-preview-mini-bank">Bank of America</span>
						<span class="vault-preview-mini-pill"><span class="dot"></span>UNLOCKED</span>
					</div>
					<div class="vault-preview-mini-chip" aria-hidden="true"></div>
					<div class="vault-preview-mini-num">•••• •••• •••• 4821</div>
					<div class="vault-preview-mini-row">
						<span>R LOPEZ</span>
						<span>09 / 28</span>
					</div>
				</div>
				{/if}
			</div>

			<div class="vault-callouts">
				<div class="vault-callout">
					<div class="vault-callout-num">01</div>
					<div>
						<div class="vault-callout-title">
							<span data-show="user">Photoreal cards</span>
							<span data-show="tech">Hyperreal SVG card mocks</span>
						</div>
						<div class="vault-callout-body">
							<span data-show="user" data-vp-show="desktop"
								>Your saved cards look like the real thing — chip, contactless,
								full colors. Tap to flip and see the CVC for 30 seconds, then it
								auto-hides.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Photoreal cards. Tap to reveal the CVC for 30s, then it
								auto-hides.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								>Each card is a parametric SVG with network-specific gradients
								(Visa navy, Amex platinum), ISO 7816 chip detail, contactless
								mark, and emboss-shadowed JetBrains Mono numerals.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								>Parametric SVG · network gradients · ISO 7816 chip detail.</span
							>
						</div>
					</div>
				</div>
				<div class="vault-callout">
					<div class="vault-callout-num">02</div>
					<div>
						<div class="vault-callout-title">
							<span data-show="user"
								><span class="italic-serif">Three-pane</span> by design</span
							>
							<span data-show="tech">No page-level scroll · Cardinal Rule</span>
						</div>
						<div class="vault-callout-body">
							<span data-show="user" data-vp-show="desktop"
								>Categories on the left, items in the middle, details on the
								right. Everything is one click away. No menus, no hidden flows.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Categories, items, details. One click each. No hidden menus.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								>Viewport-locked layout, <code>100dvh</code> root, no body scroll.
								Every panel sized to fit; only the item list scrolls internally.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								><code>100dvh</code> root · no body scroll · only the list
								scrolls.</span
							>
						</div>
					</div>
				</div>
				<div class="vault-callout">
					<div class="vault-callout-num">03</div>
					<div>
						<div class="vault-callout-title">
							<span data-show="user"
								>Status you can <span class="italic-serif">read.</span></span
							>
							<span data-show="tech">Audit-feed pinned to footer</span>
						</div>
						<div class="vault-callout-body">
							<span data-show="user" data-vp-show="desktop"
								>The footer always tells you what's happening. Local-only today,
								sync arrives in Tier 2. No mystery.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>The footer always tells you what's happening. No mystery.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								>Persistent audit-feed: vault size, ZK status (active / sealed),
								active crypto suite, build hash. The byte counter wires up once the
								Tier 2 sync server ships — until then the footer reads
								<code>Local-only</code>.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								>Audit-feed: vault size · ZK status · suite · build hash.</span
							>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.vault-preview-wrap {
		margin-top: 28px;
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 40px;
		align-items: center;
	}
	.mock-stage {
		position: relative;
	}
	.vault-preview-mock {
		position: relative;
		background: var(--paper);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-lg);
		padding: 0;
		overflow: hidden;
		aspect-ratio: 16 / 10;
		box-shadow: var(--shadow-card);
		transform: perspective(1800px) rotateY(-6deg) rotateX(2deg);
		transition: transform var(--transition-slow);
	}
	.vault-preview-mock:hover {
		transform: perspective(1800px) rotateY(-3deg) rotateX(1deg);
	}
	.vault-preview-mock svg,
	.vault-preview-mock img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.vault-preview-glow {
		position: absolute;
		inset: -40px;
		background: radial-gradient(circle at 30% 50%, var(--accent-faint), transparent 60%);
		pointer-events: none;
		filter: blur(40px);
		z-index: -1;
	}
	.vault-callouts {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.vault-callout {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 14px;
		padding: 18px 0;
		border-bottom: 1px dashed var(--border);
	}
	.vault-callout:last-child {
		border-bottom: none;
	}
	.vault-callout-num {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.06em;
		padding-top: 1px;
	}
	.vault-callout-title {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		margin-bottom: 4px;
	}
	.vault-callout-title :global(.italic-serif) {
		font-size: 1.05em;
	}
	.vault-callout-body {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.vault-callout-body :global(code) {
		font-family: var(--font-mono);
		font-size: 11px;
	}

	/* Lightweight mobile substitute for the 1200×750 SVG mock — a
	   320×200 redacted Visa card. Only mounted when viewport.isMobile
	   is true (see the {:else} branch above), so we don't need a
	   defensive `display: none` baseline. */
	.vault-preview-mini {
		width: 100%;
		max-width: 340px;
		margin: 8px auto 4px;
		padding: 18px 18px 16px;
		aspect-ratio: 16 / 10;
		background: linear-gradient(
			135deg,
			color-mix(in srgb, var(--accent) 14%, var(--paper)),
			var(--paper) 65%
		);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		font-family: var(--font-mono);
		color: var(--text-2);
	}
	.vault-preview-mini-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		letter-spacing: 0.04em;
	}
	.vault-preview-mini-bank {
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.005em;
	}
	.vault-preview-mini-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
		border-radius: 999px;
	}
	.vault-preview-mini-pill .dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--success);
	}
	.vault-preview-mini-chip {
		width: 36px;
		height: 28px;
		border-radius: 4px;
		background: linear-gradient(135deg, #d4af37, #f4cf57 50%, #a08020);
		opacity: 0.95;
	}
	.vault-preview-mini-num {
		font-size: 16px;
		font-weight: 600;
		letter-spacing: 2px;
		color: var(--text);
	}

	@media (max-width: 64em) {
		.vault-preview-wrap {
			grid-template-columns: 1fr;
			gap: 24px;
		}
		.vault-preview-mock {
			transform: none;
			aspect-ratio: 16 / 11;
		}
	}
	@media (max-width: 30em) {
		.vault-callouts {
			gap: 8px;
		}
		.vault-callout {
			padding: 12px 0;
		}
		.vault-callout-title {
			font-size: 14px;
		}
		.vault-callout-body {
			font-size: 12px;
		}
	}
</style>
