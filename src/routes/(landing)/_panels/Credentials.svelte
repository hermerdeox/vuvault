<!--
  Credentials preview panel. Sits immediately before the credit-card
  Vault panel and shifts the subject from "polished card" to "the core
  job of a credential vault": logins, masked passwords, TOTP, and the
  reveal-TTL / clipboard-clear safety affordances that the product
  actually enforces in `src/routes/vault/VaultDetail.svelte`.

  The mock is built from pure HTML/CSS — no /landing/*.svg asset, no
  runtime vault state, no screenshot. The visual chrome matches the
  existing Vault.svelte panel (1.4fr / 1fr grid, perspective tilt,
  numbered callouts, audit-feed footer). Realistic-content hex
  literals (favicon chips) are the standard invariants exception used
  throughout the other _panels/* mocks.
-->
<script lang="ts">
	import { viewport } from '$lib/stores/viewport.svelte';
</script>

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow accent">
			<span class="dot"></span>
			<span data-show="user">The credential vault</span>
			<span data-show="tech">UI rendered from real product code</span>
		</div>
		<h2 class="section-title">
			<span data-show="user"
				>Your credentials,<br /><span class="italic-serif">masked by default.</span></span
			>
			<span data-show="tech"
				>No screenshots. <span class="italic-serif">No DOM secrets.</span></span
			>
		</h2>

		<div class="cred-wrap">
			<div class="mock-stage">
				<div class="cred-glow" aria-hidden="true"></div>
				{#if !viewport.isMobile}
					<div
						class="cred-mock"
						role="img"
						aria-label="VuVault credential preview — masked password with reveal, copy, and live TOTP"
					>
						<div class="cm-titlebar">
							<div class="cm-traffic" aria-hidden="true">
								<span></span><span></span><span></span>
							</div>
							<div class="cm-app">
								<span class="cm-brand-v">V</span>
								<span class="cm-brand-name">VuVault</span>
							</div>
							<div class="cm-search">
								<svg
									width="11"
									height="11"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
								</svg>
								<span>Search the vault…</span>
								<span class="cm-kbd">⌘K</span>
							</div>
							<div class="cm-chip">
								<span class="dot"></span>UNLOCKED
							</div>
						</div>

						<div class="cm-body">
							<aside class="cm-sidebar">
								<div class="cm-heading">Categories</div>
								<div class="cm-row">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
									</svg>
									<span>All items</span><span class="cm-count">42</span>
								</div>
								<div class="cm-row active">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<circle cx="8" cy="15" r="4" /><path d="M10.85 12.15L19 4M18 5l3 3M15 8l3 3" />
									</svg>
									<span>Logins</span><span class="cm-count">31</span>
								</div>
								<div class="cm-row">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<rect x="2" y="5" width="20" height="14" rx="2" /><line
											x1="2"
											y1="10"
											x2="22"
											y2="10"
										/>
									</svg>
									<span>Cards</span><span class="cm-count">7</span>
								</div>
								<div class="cm-row">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline
											points="14 2 14 8 20 8"
										/>
									</svg>
									<span>Secure notes</span><span class="cm-count">3</span>
								</div>
								<div class="cm-row">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
									</svg>
									<span>SSH keys</span><span class="cm-count">1</span>
								</div>
								<div class="cm-heading cm-heading-spaced">Health</div>
								<div class="cm-row">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
									</svg>
									<span>Weak</span><span class="cm-count">0</span>
								</div>
								<div class="cm-row">
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="1.6"
										stroke-linecap="round"
										stroke-linejoin="round"
									>
										<polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
									</svg>
									<span>Reused</span><span class="cm-count">0</span>
								</div>
							</aside>

							<div class="cm-list">
								<div class="cm-list-header">
									<span>Logins</span><span class="cm-list-count">31</span>
								</div>
								<div class="cm-item">
									<div class="cm-ico chip-gh">G</div>
									<div class="cm-item-info">
										<div class="cm-item-title">github.com</div>
										<div class="cm-item-sub">rlopez</div>
									</div>
								</div>
								<div class="cm-item selected">
									<div class="cm-ico chip-fm">F</div>
									<div class="cm-item-info">
										<div class="cm-item-title">Fastmail</div>
										<div class="cm-item-sub">rachel@lopez.dev</div>
									</div>
									<div class="cm-fav">★</div>
								</div>
								<div class="cm-item">
									<div class="cm-ico chip-no">N</div>
									<div class="cm-item-info">
										<div class="cm-item-title">Notion</div>
										<div class="cm-item-sub">rachel@lopez.dev</div>
									</div>
								</div>
								<div class="cm-item">
									<div class="cm-ico chip-li">L</div>
									<div class="cm-item-info">
										<div class="cm-item-title">Linear</div>
										<div class="cm-item-sub">rl</div>
									</div>
								</div>
								<div class="cm-item">
									<div class="cm-ico chip-st">S</div>
									<div class="cm-item-info">
										<div class="cm-item-title">Stripe</div>
										<div class="cm-item-sub">accounts@lopez.dev</div>
									</div>
								</div>
							</div>

							<div class="cm-detail">
								<div class="cm-kind">LOGIN</div>
								<div class="cm-title">Fastmail</div>
								<div class="cm-sub">Personal · synced today</div>

								<div class="cm-field">
									<div class="cm-key">Website</div>
									<div class="cm-field-row">
										<span class="cm-value link">fastmail.com</span>
										<span class="cm-ico-btn" aria-hidden="true">
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<rect x="9" y="9" width="12" height="12" rx="2" /><path
													d="M5 15V5a2 2 0 012-2h10"
												/>
											</svg>
										</span>
									</div>
								</div>

								<div class="cm-field">
									<div class="cm-key">Username</div>
									<div class="cm-field-row">
										<span class="cm-value">rachel@lopez.dev</span>
										<span class="cm-ico-btn" aria-hidden="true">
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<rect x="9" y="9" width="12" height="12" rx="2" /><path
													d="M5 15V5a2 2 0 012-2h10"
												/>
											</svg>
										</span>
									</div>
								</div>

								<div class="cm-field">
									<div class="cm-key">Password</div>
									<div class="cm-field-row">
										<span class="cm-value mono">••••••••••••••••</span>
										<span class="cm-ico-btn" aria-hidden="true">
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<path
													d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"
												/><circle cx="12" cy="12" r="3" />
											</svg>
										</span>
										<span class="cm-ico-btn" aria-hidden="true">
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<rect x="9" y="9" width="12" height="12" rx="2" /><path
													d="M5 15V5a2 2 0 012-2h10"
												/>
											</svg>
										</span>
									</div>
									<div class="cm-hint">Auto-hides in 30 seconds</div>
								</div>

								<div class="cm-field">
									<div class="cm-key">2FA · TOTP</div>
									<div class="cm-field-row totp">
										<svg
											width="11"
											height="11"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="1.8"
											stroke-linecap="round"
											stroke-linejoin="round"
											class="cm-totp-clock"
										>
											<circle cx="12" cy="12" r="10" /><polyline
												points="12 6 12 12 16 14"
											/>
										</svg>
										<span class="cm-totp-code">748 219</span>
										<span class="cm-totp-ttl">19s</span>
										<span class="cm-ico-btn" aria-hidden="true">
											<svg
												width="11"
												height="11"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											>
												<rect x="9" y="9" width="12" height="12" rx="2" /><path
													d="M5 15V5a2 2 0 012-2h10"
												/>
											</svg>
										</span>
									</div>
								</div>
							</div>
						</div>

						<div class="cm-footer">
							<span class="cm-foot-pill"><span class="dot"></span>ZK active</span>
							<span class="cm-foot-meta"
								>vault.local · 42 items · 1.2 MB · ML-KEM-1024 · AES-256-GCM</span
							>
							<span class="cm-foot-build">a3f8…e2c1</span>
						</div>
					</div>
				{:else}
					<!-- Compact mobile substitute. Keeps the same proof beats —
					     masked password, TTL hint, live TOTP, ZK pill — without
					     mounting the 3-pane mock at 360px. -->
					<div
						class="cred-mini"
						role="img"
						aria-label="Fastmail login — password masked with live TOTP"
					>
						<div class="cred-mini-row">
							<span class="cred-mini-title">Fastmail</span>
							<span class="cred-mini-pill"><span class="dot"></span>UNLOCKED</span>
						</div>
						<div class="cred-mini-user">rachel@lopez.dev</div>
						<div class="cred-mini-pw">••••••••••••••••</div>
						<div class="cred-mini-hint">Auto-hides in 30 seconds</div>
						<div class="cred-mini-row footer">
							<span class="cred-mini-totp">748 219</span>
							<span class="cred-mini-ttl">19s · ZK active</span>
						</div>
					</div>
				{/if}
			</div>

			<div class="cred-callouts">
				<div class="cred-callout">
					<div class="cred-callout-num">01</div>
					<div>
						<div class="cred-callout-title">
							<span data-show="user">Credentials first</span>
							<span data-show="tech">Login · TOTP · SSH · seeds</span>
						</div>
						<div class="cred-callout-body">
							<span data-show="user" data-vp-show="desktop"
								>Logins, secure notes, identities, SSH keys, crypto seeds — every
								kind of secret lives in the same encrypted bucket. One unlock,
								one keyring, one place to look.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Logins, notes, SSH keys, seeds — one encrypted vault.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								>Seven discriminated <code>ItemKind</code> variants share the
								same hybrid envelope. Field-level masking is enforced before
								render — secret strings never appear in the DOM until you tap
								reveal.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								>Seven <code>ItemKind</code> variants · one envelope · masked-before-render.</span
							>
						</div>
					</div>
				</div>
				<div class="cred-callout">
					<div class="cred-callout-num">02</div>
					<div>
						<div class="cred-callout-title">
							<span data-show="user"
								>Reveal only <span class="italic-serif">on purpose.</span></span
							>
							<span data-show="tech">30s reveal TTL · 60s clipboard clear</span>
						</div>
						<div class="cred-callout-body">
							<span data-show="user" data-vp-show="desktop"
								>Passwords stay masked. Tap the eye to read for 30 seconds, then
								the field re-hides on its own. Copy and we wipe the clipboard 60
								seconds later — no shoulder surfing, no lingering paste
								buffers.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Reveal for 30s, then auto-hide. Clipboard wipes 60s after copy.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								><code>REVEAL_TTL_MS = 30_000</code> in
								<code>VaultDetail.svelte</code>; clipboard auto-clears via
								<code>setTimeout(60_000)</code> regardless of
								<code>clipboard-read</code> permission. Every reveal is
								audit-logged locally.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								><code>REVEAL_TTL_MS = 30_000</code> · unconditional 60s clipboard clear.</span
							>
						</div>
					</div>
				</div>
				<div class="cred-callout">
					<div class="cred-callout-num">03</div>
					<div>
						<div class="cred-callout-title">
							<span data-show="user"
								>Safety you can <span class="italic-serif">read.</span></span
							>
							<span data-show="tech">Local health · opaque sync state</span>
						</div>
						<div class="cred-callout-body">
							<span data-show="user" data-vp-show="desktop"
								>The vault calls out weak and reused passwords before anyone
								else sees them. The check runs entirely on your device — your
								passwords never leave it to be graded.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Weak and reused checks run on-device. Nothing leaves.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								><code>password-health.ts</code> scores entropy and reuse
								in-memory; the server only ever observes
								<code>(deviceId, sequenceClock, ciphertext)</code>. Footer
								surfaces ZK state, suite, and build hash — proof, not
								policy.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								>In-memory entropy/reuse check · server sees only ciphertext + clock.</span
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

	/* ---------- layout: mirrors Vault.svelte's 1.4fr / 1fr grid ---------- */
	.cred-wrap {
		margin-top: 28px;
		display: grid;
		grid-template-columns: 1.4fr 1fr;
		gap: 40px;
		align-items: center;
	}
	.mock-stage {
		position: relative;
	}
	.cred-glow {
		position: absolute;
		inset: -40px;
		background: radial-gradient(circle at 30% 50%, var(--accent-faint), transparent 60%);
		pointer-events: none;
		filter: blur(40px);
		z-index: -1;
	}

	/* ---------- vault window mock ---------- */
	.cred-mock {
		position: relative;
		background: var(--paper);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-lg);
		overflow: hidden;
		aspect-ratio: 16 / 10;
		box-shadow: var(--shadow-card);
		transform: perspective(1800px) rotateY(-6deg) rotateX(2deg);
		transition: transform var(--transition-slow);
		display: grid;
		grid-template-rows: 38px 1fr 30px;
		font-family: var(--font-sans);
		color: var(--text);
	}
	.cred-mock:hover {
		transform: perspective(1800px) rotateY(-3deg) rotateX(1deg);
	}

	/* titlebar */
	.cm-titlebar {
		display: grid;
		grid-template-columns: auto auto 1fr auto;
		align-items: center;
		gap: 14px;
		padding: 0 12px;
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(8px);
	}
	.cm-traffic {
		display: inline-flex;
		gap: 6px;
	}
	.cm-traffic span {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--border-mid);
	}
	.cm-traffic span:nth-child(1) {
		background: #ff5f57;
	}
	.cm-traffic span:nth-child(2) {
		background: #febc2e;
	}
	.cm-traffic span:nth-child(3) {
		background: #28c840;
	}
	.cm-app {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.cm-brand-v {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 4px;
		background: var(--surface-hover);
		border: 1px solid var(--border);
		font-size: 9px;
		color: var(--brand);
	}
	.cm-brand-name {
		color: var(--text);
	}
	.cm-search {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 240px;
		justify-self: center;
		padding: 4px 8px;
		font-size: 10px;
		color: var(--text-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.cm-search span:first-of-type {
		flex: 1;
	}
	.cm-kbd {
		padding: 1px 4px;
		font-family: var(--font-mono);
		font-size: 8px;
		color: var(--text-2);
		background: var(--surface-strong);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
	}
	.cm-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 7px;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
		border-radius: 999px;
	}
	.cm-chip .dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--success);
	}

	/* 3-pane body */
	.cm-body {
		display: grid;
		grid-template-columns: 22% 28% 1fr;
		min-height: 0;
		overflow: hidden;
	}

	/* sidebar */
	.cm-sidebar {
		padding: 10px 8px;
		border-right: 1px solid var(--border);
		background: var(--bg-elev);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.cm-heading {
		padding: 2px 8px 6px;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.cm-heading-spaced {
		margin-top: 10px;
	}
	.cm-row {
		display: grid;
		grid-template-columns: 12px 1fr auto;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		font-size: 11px;
		color: var(--text-2);
		border: 1px solid transparent;
	}
	.cm-row svg {
		color: var(--text-3);
	}
	.cm-row.active {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
	}
	.cm-row.active svg {
		color: var(--accent);
	}
	.cm-count {
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-3);
	}
	.cm-row.active .cm-count {
		color: var(--accent);
	}

	/* list */
	.cm-list {
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
	}
	.cm-list-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		border-bottom: 1px dashed var(--border);
	}
	.cm-list-count {
		color: var(--text-3);
	}
	.cm-item {
		display: grid;
		grid-template-columns: 22px 1fr auto;
		align-items: center;
		gap: 8px;
		padding: 7px 8px;
		margin: 3px 6px;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		min-width: 0;
	}
	.cm-item.selected {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.cm-ico {
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		border-radius: var(--radius-xs);
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text);
		letter-spacing: 0;
	}
	/* Realistic favicon chips. Hex literals here are the
	   realistic-content invariants exception, same as the other mocks. */
	.chip-gh {
		background: linear-gradient(135deg, #2b2b2b, #181818);
		color: #ffffff;
	}
	.chip-fm {
		background: linear-gradient(135deg, #2563eb, #0ea5e9);
		color: #ffffff;
	}
	.chip-no {
		background: #f5f5f5;
		color: #1a1a1a;
	}
	.chip-li {
		background: linear-gradient(135deg, #5e6ad2, #8b95f0);
		color: #ffffff;
	}
	.chip-st {
		background: linear-gradient(135deg, #635bff, #4f47cc);
		color: #ffffff;
	}
	.cm-item-info {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.cm-item-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cm-item-sub {
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cm-fav {
		font-size: 10px;
		color: var(--warn);
	}

	/* detail */
	.cm-detail {
		padding: 14px 16px;
		background: var(--bg-elev);
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		overflow: hidden;
	}
	.cm-kind {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.12em;
	}
	.cm-title {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text);
		line-height: 1.1;
	}
	.cm-sub {
		font-size: 10px;
		color: var(--text-3);
		margin-bottom: 4px;
	}
	.cm-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.cm-key {
		font-family: var(--font-mono);
		font-size: 8px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.cm-field-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.cm-value {
		flex: 1;
		font-size: 11px;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cm-value.link {
		color: var(--accent);
	}
	.cm-value.mono {
		font-family: var(--font-mono);
		letter-spacing: 0.06em;
	}
	.cm-ico-btn {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-xs);
		color: var(--text-3);
	}
	.cm-hint {
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--warn);
		letter-spacing: 0;
	}
	.cm-field-row.totp {
		gap: 8px;
	}
	.cm-totp-clock {
		color: var(--accent);
	}
	.cm-totp-code {
		flex: 1;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.18em;
	}
	.cm-totp-ttl {
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-3);
	}

	/* audit footer */
	.cm-footer {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 0 12px;
		border-top: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-3);
		letter-spacing: 0;
	}
	.cm-foot-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 7px;
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
		border-radius: 999px;
	}
	.cm-foot-pill .dot {
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--success);
	}
	.cm-foot-meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cm-foot-build {
		color: var(--accent);
	}

	/* ---------- right column: numbered callouts ---------- */
	.cred-callouts {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.cred-callout {
		display: grid;
		grid-template-columns: 28px 1fr;
		gap: 14px;
		padding: 18px 0;
		border-bottom: 1px dashed var(--border);
	}
	.cred-callout:last-child {
		border-bottom: none;
	}
	.cred-callout-num {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.06em;
		padding-top: 1px;
	}
	.cred-callout-title {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		margin-bottom: 4px;
	}
	.cred-callout-title :global(.italic-serif) {
		font-size: 1.05em;
	}
	.cred-callout-body {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.cred-callout-body :global(code) {
		font-family: var(--font-mono);
		font-size: 11px;
	}

	/* ---------- compact mobile substitute ---------- */
	.cred-mini {
		width: 100%;
		max-width: 340px;
		margin: 8px auto 4px;
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-family: var(--font-sans);
	}
	.cred-mini-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.cred-mini-row.footer {
		margin-top: 4px;
		padding-top: 8px;
		border-top: 1px dashed var(--border);
	}
	.cred-mini-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.005em;
	}
	.cred-mini-pill {
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
	.cred-mini-pill .dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--success);
	}
	.cred-mini-user {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-2);
	}
	.cred-mini-pw {
		font-family: var(--font-mono);
		font-size: 16px;
		font-weight: 600;
		letter-spacing: 0.16em;
		color: var(--text);
	}
	.cred-mini-hint {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--warn);
	}
	.cred-mini-totp {
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.18em;
		color: var(--accent);
	}
	.cred-mini-ttl {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
	}

	/* ---------- responsive parity with Vault.svelte ---------- */
	@media (max-width: 64em) {
		.cred-wrap {
			grid-template-columns: 1fr;
			gap: 24px;
		}
		.cred-mock {
			transform: none;
			aspect-ratio: 16 / 11;
		}
	}
	@media (max-width: 45em) {
		.cm-body {
			grid-template-columns: 28% 32% 1fr;
		}
	}
	@media (max-width: 30em) {
		.cred-callouts {
			gap: 8px;
		}
		.cred-callout {
			padding: 12px 0;
		}
		.cred-callout-title {
			font-size: 14px;
		}
		.cred-callout-body {
			font-size: 12px;
		}
	}
</style>
