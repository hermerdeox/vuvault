<!--
  Mobile preview panel. The large iPhone SVG below is realistic content
  (depicting iOS app UI), so its hex literals are the explicit invariants
  exception.
-->

<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow">
			<span class="dot"></span>
			<span data-show="user">Built for your pocket first</span>
			<span data-show="tech">PWA · 100dvh · safe-area inset</span>
		</div>
		<h2 class="section-title">
			<span data-show="user"
				>Touch ID, then <span class="italic-serif">done.</span></span
			>
			<span data-show="tech"
				>Native-grade UX, <span class="italic-serif">web-grade reach.</span></span
			>
		</h2>

		<div class="mobile-wrap">
			<div class="mobile-stage">
				<div class="phone">
					<div class="phone-notch"></div>
					<div class="phone-screen">
						<img
							src="/landing/mobile-mock.svg"
							alt=""
							loading="lazy"
							decoding="async"
							width="360"
							height="780"
						/>
					</div>
				</div>
			</div>

			<div class="mobile-features">
				<div class="mobile-feature">
					<div class="mobile-feature-icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M12 11h.01"/>
							<path d="M3 12c0-5 4-9 9-9s9 4 9 9-4 9-9 9c-2 0-4-.5-5.5-2"/>
							<path d="M12 7c-2 0-3 1-3 3"/>
						</svg>
					</div>
					<div>
						<div class="mobile-feature-title">
							<span data-show="user">Touch ID unlocks instantly</span>
							<span data-show="tech">WebAuthn PRF on platform authenticator</span>
						</div>
						<div class="mobile-feature-body">
							<span data-show="user" data-vp-show="desktop"
								>Your fingerprint or Face ID opens the vault. No master password
								to type. No password to forget.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Fingerprint or Face ID. No master password to type or forget.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								>PRF returns 32 bytes deterministically bound to your passkey.
								HKDF-SHA512 derives the vault key without round-trip to a server.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								>PRF · 32 bytes · HKDF-SHA512 vault-key. No server round-trip.</span
							>
						</div>
					</div>
				</div>
				<div class="mobile-feature">
					<div class="mobile-feature-icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<rect x="3" y="3" width="18" height="18" rx="3"/>
							<line x1="3" y1="9" x2="21" y2="9"/>
							<line x1="9" y1="21" x2="9" y2="9"/>
						</svg>
					</div>
					<div>
						<div class="mobile-feature-title">
							<span class="tier-badge">Tier 2 · 2027</span>
							<span data-show="user">Same vault, every device</span>
							<span data-show="tech">CRDT sync across paired devices</span>
						</div>
						<div class="mobile-feature-body">
							<span data-show="user" data-vp-show="desktop"
								>Tier 2 design: edit on your laptop, see it on your phone.
								Offline edits will merge automatically when you reconnect — no
								conflicts, no lost changes. Today the vault is local-only.</span
							>
							<span data-show="user" data-vp-show="mobile"
								>Tier 2: edits merge automatically across devices. Today
								local-only.</span
							>
							<span data-show="tech" data-vp-show="desktop"
								>Tier 2 design: encrypted CRDT operations under hybrid X25519 +
								ML-KEM-1024 envelopes. Server holds opaque blobs only. Padding
								to hide which item changed is in the Tier 2 spec, not yet
								implemented in <code>vault-codec.ts</code>.</span
							>
							<span data-show="tech" data-vp-show="mobile"
								>Encrypted CRDT ops · hybrid envelope. Server holds opaque
								blobs.</span
							>
						</div>
					</div>
				</div>
				<div class="mobile-feature" data-vp-show="desktop">
					<div class="mobile-feature-icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
							<polyline points="12 6 12 12 16 14"/>
						</svg>
					</div>
					<div>
						<div class="mobile-feature-title">
							<span data-show="user">TOTP codes built in</span>
							<span data-show="tech">RFC 6238 with auto-fill bridge</span>
						</div>
						<div class="mobile-feature-body">
							<span data-show="user"
								>Two-factor codes live next to your passwords. Tap to copy, watch the
								countdown ring fill, ship it before it expires.</span
							>
							<span data-show="tech"
								>Live TOTP per item with 30s countdown ring. iOS/Android autofill bridge
								delivers code without exposing seed to the OS keystore.</span
							>
						</div>
					</div>
				</div>
				<div class="mobile-feature" data-vp-show="desktop">
					<div class="mobile-feature-icon">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							<line x1="22" y1="12" x2="2" y2="12"/>
							<path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
						</svg>
					</div>
					<div>
						<div class="mobile-feature-title">
							<span data-show="user">Audit feed always visible</span>
							<span data-show="tech">Pinned audit-feed footer · always-on</span>
						</div>
						<div class="mobile-feature-body">
							<span data-show="user"
								>Bottom of every screen tells you what's happening: vault size, the
								crypto suite in use, and whether the vault is sealed or unlocked.
								No mystery, no surprises.</span
							>
							<span data-show="tech"
								>Pinned footer surfaces vault size, ZK status (active / sealed),
								active cipher suite, and bundle build hash. The byte counter wires
								up once the Tier 2 sync server ships; until then it reads
								<code>Local-only</code>.</span
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

	.mobile-wrap {
		margin-top: 24px;
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: 48px;
		align-items: center;
	}
	.mobile-stage {
		display: flex;
		justify-content: center;
		align-items: center;
		position: relative;
		min-height: 60dvh;
	}
	.mobile-stage::before {
		content: '';
		position: absolute;
		inset: -10%;
		background: radial-gradient(ellipse at center, var(--accent-faint), transparent 60%);
		filter: blur(30px);
		pointer-events: none;
		z-index: 0;
	}
	.phone {
		position: relative;
		z-index: 1;
		width: 280px;
		aspect-ratio: 9 / 19.5;
		background: var(--bg-elev);
		border-radius: 38px;
		padding: 8px;
		box-shadow: var(--shadow-modal);
		transform: perspective(1800px) rotateY(-10deg) rotateX(2deg);
		transition: transform var(--transition-slow);
	}
	.phone:hover {
		transform: perspective(1800px) rotateY(-5deg) rotateX(1deg);
	}
	.phone-screen {
		width: 100%;
		height: 100%;
		background: var(--bg);
		border-radius: 30px;
		overflow: hidden;
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.phone-notch {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		width: 86px;
		height: 22px;
		background: var(--bg);
		border-radius: 18px;
		z-index: 5;
	}
	.phone-screen svg,
	.phone-screen img {
		display: block;
		width: 100%;
		height: 100%;
	}
	.mobile-features {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.mobile-feature {
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: 14px;
		align-items: flex-start;
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		backdrop-filter: blur(8px);
		transition: var(--transition);
	}
	.mobile-feature:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
		transform: translateX(2px);
	}
	.mobile-feature-icon {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		background: var(--accent-dim);
		border-radius: var(--radius-sm);
		color: var(--accent);
		flex-shrink: 0;
	}
	.mobile-feature-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		margin-bottom: 3px;
		letter-spacing: -0.005em;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.mobile-feature-body {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.mobile-feature-body :global(code) {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text);
	}
	.tier-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: 999px;
	}

	@media (max-width: 64em) {
		.mobile-wrap {
			grid-template-columns: 1fr;
			gap: 24px;
		}
		.phone {
			transform: none;
			width: 240px;
		}
		.mobile-stage {
			min-height: auto;
			padding: 24px 0;
		}
	}
	@media (max-width: 30em) {
		.phone {
			width: 220px;
		}
		.mobile-feature {
			padding: 12px 14px;
			gap: 10px;
		}
		.mobile-feature-title {
			font-size: 13px;
		}
		.mobile-feature-body {
			font-size: 12px;
		}
	}
</style>
