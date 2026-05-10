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
					<svg viewBox="0 0 1200 750" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
						<rect x="0" y="0" width="1200" height="48" fill="#0a0a0a"/>
						<line x1="0" y1="48" x2="1200" y2="48" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
						<circle cx="20" cy="24" r="6" fill="#ef4444" opacity="0.7"/>
						<circle cx="40" cy="24" r="6" fill="#ffa500" opacity="0.7"/>
						<circle cx="60" cy="24" r="6" fill="#22c55e" opacity="0.7"/>
						<rect x="92" y="14" width="20" height="20" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)"/>
						<text x="102" y="29" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="800" fill="#f5f5f0">V</text>
						<text x="120" y="29" font-family="Instrument Sans, sans-serif" font-size="13" font-weight="700" fill="#fff">VuVault</text>
						<rect x="240" y="12" width="320" height="24" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
						<circle cx="252" cy="24" r="5" fill="none" stroke="#666" stroke-width="1.4"/>
						<line x1="256" y1="28" x2="260" y2="32" stroke="#666" stroke-width="1.4"/>
						<text x="266" y="28" font-family="Instrument Sans, sans-serif" font-size="11" fill="#666">Search vault</text>
						<rect x="540" y="18" width="14" height="12" rx="2" fill="rgba(255,255,255,0.06)"/>
						<text x="547" y="27" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#888">⌘K</text>
						<rect x="950" y="14" width="56" height="20" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
						<text x="978" y="27" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="600" fill="#b8b8b8">+ New</text>
						<rect x="1014" y="14" width="50" height="20" rx="4" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
						<text x="1039" y="27" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="10" font-weight="600" fill="#b8b8b8">Lock</text>
						<rect x="1080" y="14" width="100" height="20" rx="10" fill="rgba(34,197,94,0.12)" stroke="rgba(34,197,94,0.3)"/>
						<circle cx="1092" cy="24" r="3" fill="#22c55e"/>
						<text x="1100" y="28" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="600" fill="#22c55e">UNLOCKED</text>
						<rect x="0" y="48" width="220" height="702" fill="#080808"/>
						<line x1="220" y1="48" x2="220" y2="750" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
						<text x="20" y="80" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#666" letter-spacing="1.5">CATEGORIES</text>
						<g font-family="Instrument Sans, sans-serif" font-size="13">
							<rect x="12" y="92" width="196" height="34" rx="6" fill="rgba(0,212,255,0.08)" stroke="rgba(0,212,255,0.2)"/>
							<rect x="22" y="103" width="14" height="12" rx="2" fill="none" stroke="#00d4ff" stroke-width="1.5"/>
							<line x1="25" y1="106" x2="33" y2="106" stroke="#00d4ff" stroke-width="1.5"/>
							<text x="46" y="113" font-weight="600" fill="#fff">All items</text>
							<text x="196" y="113" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#00d4ff">23</text>
							<rect x="22" y="139" width="14" height="14" rx="2" fill="none" stroke="#888" stroke-width="1.4"/>
							<circle cx="29" cy="146" r="2" fill="#888"/>
							<line x1="29" y1="148" x2="29" y2="151" stroke="#888" stroke-width="1.4"/>
							<text x="46" y="151" fill="#b8b8b8">Logins</text>
							<text x="196" y="151" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">14</text>
							<rect x="12" y="172" width="196" height="32" rx="6" fill="rgba(255,255,255,0.03)"/>
							<rect x="22" y="183" width="16" height="11" rx="1.5" fill="none" stroke="#00d4ff" stroke-width="1.4"/>
							<line x1="22" y1="187" x2="38" y2="187" stroke="#00d4ff" stroke-width="1.4"/>
							<text x="46" y="191" font-weight="600" fill="#fff">Cards</text>
							<text x="196" y="191" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">2</text>
							<rect x="22" y="219" width="14" height="14" rx="2" fill="none" stroke="#888" stroke-width="1.4"/>
							<line x1="26" y1="223" x2="34" y2="223" stroke="#888" stroke-width="1.4"/>
							<line x1="26" y1="227" x2="34" y2="227" stroke="#888" stroke-width="1.4"/>
							<line x1="26" y1="231" x2="32" y2="231" stroke="#888" stroke-width="1.4"/>
							<text x="46" y="231" fill="#b8b8b8">Secure notes</text>
							<text x="196" y="231" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">5</text>
							<rect x="22" y="257" width="14" height="14" rx="2" fill="none" stroke="#888" stroke-width="1.4"/>
							<text x="29" y="268" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#888">$_</text>
							<text x="46" y="269" fill="#b8b8b8">SSH keys</text>
							<text x="196" y="269" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#666">2</text>
						</g>
						<text x="20" y="320" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#666" letter-spacing="1.5">HEALTH</text>
						<g font-family="Instrument Sans, sans-serif" font-size="13">
							<circle cx="29" cy="346" r="6" fill="none" stroke="#ef4444" stroke-width="1.4"/>
							<line x1="29" y1="343" x2="29" y2="346" stroke="#ef4444" stroke-width="1.4"/>
							<circle cx="29" cy="349" r="0.8" fill="#ef4444"/>
							<text x="46" y="350" fill="#b8b8b8">Weak</text>
							<text x="196" y="350" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#ef4444">3</text>
							<circle cx="29" cy="384" r="6" fill="none" stroke="#ffa500" stroke-width="1.4"/>
							<path d="M27 381 L31 384 L27 387" fill="none" stroke="#ffa500" stroke-width="1.4"/>
							<text x="46" y="388" fill="#b8b8b8">Reused</text>
							<text x="196" y="388" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="10" fill="#ffa500">2</text>
						</g>
						<line x1="0" y1="690" x2="220" y2="690" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
						<circle cx="22" cy="715" r="3" fill="#22c55e"/>
						<text x="34" y="719" font-family="Instrument Sans, sans-serif" font-size="10" fill="#b8b8b8">Local · sync 2027</text>
						<text x="22" y="735" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">vault.vu · 12.4 KB</text>
						<rect x="220" y="48" width="320" height="702" fill="#0a0a0a"/>
						<line x1="540" y1="48" x2="540" y2="750" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
						<text x="240" y="80" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#666" letter-spacing="1.5">2 ITEMS · CARDS</text>
						<rect x="232" y="96" width="296" height="74" rx="8" fill="rgba(0,212,255,0.06)" stroke="rgba(0,212,255,0.25)"/>
						<rect x="246" y="112" width="40" height="26" rx="4" fill="#172a5e"/>
						<text x="266" y="129" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="800" font-style="italic" fill="#f5b234">VISA</text>
						<text x="298" y="120" font-family="Instrument Sans, sans-serif" font-size="13" font-weight="600" fill="#fff">Bank of America</text>
						<text x="298" y="138" font-family="JetBrains Mono, monospace" font-size="11" fill="#b8b8b8">•••• •••• •••• 4821</text>
						<text x="298" y="156" font-family="Instrument Sans, sans-serif" font-size="10" fill="#666">Visa Signature · 09/28</text>
						<rect x="232" y="184" width="296" height="74" rx="8" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)"/>
						<rect x="246" y="200" width="40" height="26" rx="4" fill="#c0c0c0" opacity="0.85"/>
						<text x="266" y="217" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="800" fill="#1a1a1a">AMEX</text>
						<text x="298" y="208" font-family="Instrument Sans, sans-serif" font-size="13" font-weight="600" fill="#e8e8e8">American Express</text>
						<text x="298" y="226" font-family="JetBrains Mono, monospace" font-size="11" fill="#888">•••• •••••• 91003</text>
						<text x="298" y="244" font-family="Instrument Sans, sans-serif" font-size="10" fill="#666">Platinum · 11/27</text>
						<rect x="540" y="48" width="660" height="702" fill="#050505"/>
						<text x="572" y="84" font-family="Instrument Sans, sans-serif" font-size="22" font-weight="700" fill="#fff" letter-spacing="-0.5">Bank of America</text>
						<text x="572" y="106" font-family="Instrument Sans, sans-serif" font-size="13" fill="#888">Visa Signature · Personal</text>
						<rect x="990" y="68" width="80" height="28" rx="6" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
						<text x="1030" y="86" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="600" fill="#b8b8b8">Edit</text>
						<rect x="1080" y="68" width="80" height="28" rx="6" fill="rgba(0,212,255,0.1)" stroke="rgba(0,212,255,0.3)"/>
						<text x="1120" y="86" text-anchor="middle" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="600" fill="#00d4ff">Reveal</text>
						<text x="572" y="156" font-family="JetBrains Mono, monospace" font-size="9" fill="#666" letter-spacing="1.2">CARDHOLDER</text>
						<text x="572" y="178" font-family="Instrument Sans, sans-serif" font-size="14" fill="#fff">R LOPEZ</text>
						<text x="572" y="222" font-family="JetBrains Mono, monospace" font-size="9" fill="#666" letter-spacing="1.2">EXPIRY</text>
						<text x="572" y="244" font-family="JetBrains Mono, monospace" font-size="14" fill="#fff">09 / 28</text>
						<text x="572" y="288" font-family="JetBrains Mono, monospace" font-size="9" fill="#666" letter-spacing="1.2">BILLING ADDRESS</text>
						<text x="572" y="310" font-family="Instrument Sans, sans-serif" font-size="13" fill="#e8e8e8">128 Catawba Place</text>
						<text x="572" y="328" font-family="Instrument Sans, sans-serif" font-size="13" fill="#e8e8e8">Greenville, SC 29609</text>
						<text x="572" y="346" font-family="Instrument Sans, sans-serif" font-size="13" fill="#888">United States</text>
						<text x="572" y="390" font-family="JetBrains Mono, monospace" font-size="9" fill="#666" letter-spacing="1.2">NOTES</text>
						<text x="572" y="412" font-family="Instrument Sans, sans-serif" font-size="13" fill="#888">Auto-fill on bofa.com only</text>
						<g transform="translate(852, 156)">
							<rect x="6" y="14" width="296" height="186" rx="14" fill="#000" opacity="0.6"/>
							<defs>
								<linearGradient id="visa-bg" x1="0%" y1="0%" x2="100%" y2="100%">
									<stop offset="0%" stop-color="#0a1f4d"/>
									<stop offset="50%" stop-color="#172a5e"/>
									<stop offset="100%" stop-color="#0a1432"/>
								</linearGradient>
								<linearGradient id="visa-shine" x1="0%" y1="0%" x2="100%" y2="100%">
									<stop offset="0%" stop-color="#ffffff" stop-opacity="0.15"/>
									<stop offset="50%" stop-color="#ffffff" stop-opacity="0"/>
									<stop offset="100%" stop-color="#ffffff" stop-opacity="0.05"/>
								</linearGradient>
								<linearGradient id="chip-grad" x1="0%" y1="0%" x2="100%" y2="100%">
									<stop offset="0%" stop-color="#d4af37"/>
									<stop offset="50%" stop-color="#f4cf57"/>
									<stop offset="100%" stop-color="#a08020"/>
								</linearGradient>
							</defs>
							<rect x="0" y="0" width="296" height="186" rx="14" fill="url(#visa-bg)" stroke="rgba(255,255,255,0.1)"/>
							<rect x="0" y="0" width="296" height="186" rx="14" fill="url(#visa-shine)"/>
							<text x="20" y="32" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="700" fill="#ffffff" opacity="0.95">Bank of America</text>
							<text x="20" y="46" font-family="Instrument Sans, sans-serif" font-size="9" font-weight="500" fill="#ffffff" opacity="0.6">Visa Signature</text>
							<g transform="translate(258, 22)" stroke="#ffffff" stroke-width="1.4" fill="none" opacity="0.85" stroke-linecap="round">
								<path d="M2 4 Q6 0 10 4"/>
								<path d="M0 8 Q6 0 12 8"/>
								<path d="M-2 12 Q6 0 14 12"/>
							</g>
							<g transform="translate(20, 64)">
								<rect x="0" y="0" width="42" height="32" rx="5" fill="url(#chip-grad)" stroke="#8a6f1a" stroke-width="0.5"/>
								<line x1="0" y1="10" x2="42" y2="10" stroke="#8a6f1a" stroke-width="0.5" opacity="0.6"/>
								<line x1="0" y1="22" x2="42" y2="22" stroke="#8a6f1a" stroke-width="0.5" opacity="0.6"/>
								<line x1="14" y1="0" x2="14" y2="32" stroke="#8a6f1a" stroke-width="0.5" opacity="0.6"/>
								<line x1="28" y1="0" x2="28" y2="32" stroke="#8a6f1a" stroke-width="0.5" opacity="0.6"/>
							</g>
							<text x="20" y="124" font-family="JetBrains Mono, monospace" font-size="16" font-weight="600" fill="#ffffff" letter-spacing="2">4147 1234 5678 4821</text>
							<text x="20" y="148" font-family="JetBrains Mono, monospace" font-size="7" fill="#ffffff" opacity="0.6" letter-spacing="1">CARDHOLDER</text>
							<text x="20" y="166" font-family="Instrument Sans, sans-serif" font-size="11" font-weight="600" fill="#ffffff">R LOPEZ</text>
							<text x="200" y="148" font-family="JetBrains Mono, monospace" font-size="7" fill="#ffffff" opacity="0.6" letter-spacing="1">EXPIRES</text>
							<text x="200" y="166" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" fill="#ffffff">09/28</text>
							<text x="276" y="170" text-anchor="end" font-family="Instrument Sans, sans-serif" font-size="18" font-weight="800" font-style="italic" fill="#f5b234">VISA</text>
						</g>
						<line x1="540" y1="690" x2="1200" y2="690" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
						<circle cx="572" cy="715" r="3" fill="#22c55e"/>
						<text x="584" y="719" font-family="Instrument Sans, sans-serif" font-size="10" fill="#b8b8b8">Zero-knowledge active · local-only mode</text>
						<text x="572" y="735" font-family="JetBrains Mono, monospace" font-size="9" fill="#666">AES-256-GCM · ML-KEM-1024 · Argon2id · all decryption local</text>
						<rect x="1014" y="708" width="156" height="22" rx="11" fill="rgba(0,212,255,0.08)" stroke="rgba(0,212,255,0.2)"/>
						<text x="1092" y="722" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" font-weight="600" fill="#00d4ff">CVC AUTO-HIDES IN 28s</text>
					</svg>
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
	.vault-preview-mock svg {
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
