<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow accent">
			<span class="dot"></span>
			<span data-show="user">What VuVault gives you</span>
			<span data-show="tech">What VuVault ships that they can't claim</span>
		</div>
		<h2 class="section-title">
			<span data-show="user"
				>Three things, <span class="italic-serif">no asterisks.</span></span
			>
			<span data-show="tech"
				>Three sentences, <span class="italic-serif">all defensible.</span></span
			>
		</h2>

		<div class="promise-grid">
			<!-- USER MODE -->
			<div class="promise-card" data-show="user">
				<div class="promise-num">01 / 03</div>
				<div class="promise-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path
							d="M12 11h.01M7 13c0 1 1 4 5 4s5-3 5-4M12 2a10 10 0 0110 10v0a10 10 0 01-10 10v0a10 10 0 01-10-10v0A10 10 0 0112 2z"
						/><path d="M9 9c0-1 0-2 3-2s3 1 3 2" /></svg
					>
				</div>
				<div class="promise-title">
					Touch ID is <span class="italic-serif">enough.</span>
				</div>
				<div class="promise-body">
					<span data-vp-show="desktop"
						>No master password to memorize. Your fingerprint or Face ID unlocks the
						vault directly. The same passkey that proves who you are also unlocks what
						you have.</span
					>
					<span data-vp-show="mobile"
						>No master password. Your fingerprint unlocks the vault directly.</span
					>
				</div>
				<div class="promise-spec">webauthn-prf · zero passwords typed</div>
			</div>

			<div class="promise-card" data-show="user">
				<div class="promise-num">02 / 03</div>
				<div class="promise-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						><rect x="3" y="11" width="18" height="11" rx="2" /><path
							d="M7 11V7a5 5 0 0110 0v4"
						/></svg
					>
				</div>
				<div class="promise-title">
					Architecturally <span class="italic-serif">untouchable.</span>
				</div>
				<div class="promise-body">
					<span data-vp-show="desktop"
						>Your vault is encrypted on your device. The server only ever sees an
						opaque blob. Nobody can read it — not us, not a court order, not a future
						quantum computer in 2032. Mathematical, not promised.</span
					>
					<span data-vp-show="mobile"
						>Encrypted on your device. The server sees only an opaque blob — even in
						2032.</span
					>
				</div>
				<div class="promise-spec">level 0 · zero-knowledge by construction</div>
			</div>

			<div class="promise-card" data-show="user">
				<div class="promise-num">03 / 03</div>
				<div class="promise-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path
							d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
						/></svg
					>
				</div>
				<div class="promise-title">
					$25.60 a year. <span class="italic-serif">All in.</span>
				</div>
				<div class="promise-body">
					<span data-vp-show="desktop"
						>One flat price. Every device. Every feature. No per-user multipliers. No
						tiers. Compare 1Password $35.88, Dashlane $59.88, Proton Pass $47.88 — and
						most charge per seat. We don't.</span
					>
					<span data-vp-show="mobile"
						>One price. Every device. Every feature. No tiers. No per-seat.</span
					>
				</div>
				<div class="promise-spec">256 bits × $0.10 = honest math</div>
			</div>

			<!-- TECH MODE -->
			<div class="promise-card" data-show="tech">
				<div class="promise-num">01 / 03</div>
				<div class="promise-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg
					>
				</div>
				<div class="promise-title">
					Server <span class="italic-serif">never</span> sees your password.
				</div>
				<div class="promise-body">
					<span data-vp-show="desktop"
						>Authentication via OPAQUE (RFC 9807, July 2025). The server learns no
						information about the password — not plaintext, not a hash, not even
						during registration. Mathematically proven against pre-computation attacks
						upon server compromise.</span
					>
					<span data-vp-show="mobile"
						>OPAQUE (RFC 9807). Server learns nothing — no plaintext, no hash, ever.</span
					>
				</div>
				<div class="promise-spec">RFC 9807 · OPAQUE-3DH · Argon2id KDF</div>
			</div>

			<div class="promise-card" data-show="tech">
				<div class="promise-num">02 / 03</div>
				<div class="promise-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						><circle cx="12" cy="12" r="10" /><path
							d="M2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20"
						/></svg
					>
				</div>
				<div class="promise-title">
					Hybrid <span class="italic-serif">post-quantum</span> envelope.
				</div>
				<div class="promise-body">
					<span data-vp-show="desktop"
						>Vault encrypted under <code>ML-KEM-1024 + X25519</code> hybrid KEM with
						<code>AES-256-GCM</code>. Resistant to harvest-now-decrypt-later by
						construction. Sub-millisecond cryptographic overhead — matches X25519
						performance, no perceptible cost.</span
					>
					<span data-vp-show="mobile"
						><code>ML-KEM-1024 + X25519</code> hybrid + <code>AES-256-GCM</code>.
						Sub-ms overhead.</span
					>
				</div>
				<div class="promise-spec">FIPS 203 · ML-KEM-1024 · 256-bit security</div>
			</div>

			<div class="promise-card" data-show="tech">
				<div class="promise-num">03 / 03</div>
				<div class="promise-icon">
					<svg
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
						><path
							d="M12 11h.01M9 9c0-1 0-2 3-2s3 1 3 2M3 12a9 9 0 0118 0v0a9 9 0 01-18 0v0z"
						/></svg
					>
				</div>
				<div class="promise-title">
					PRF unlock + <span class="italic-serif">256-bit</span> Secret Key.
				</div>
				<div class="promise-body">
					<span data-vp-show="desktop"
						>Vault key = <code>HKDF(WebAuthn-PRF(passkey, salt) ‖ SecretKey)</code>.
						The Secret Key is 256 bits of true random, generated client-side, never
						transmitted. Even with a complete server compromise + Argon2id break,
						attackers face 256 unbreakable bits.</span
					>
					<span data-vp-show="mobile"
						>Vault key = <code>HKDF(PRF ‖ SecretKey)</code>. 256 bits, never
						transmitted.</span
					>
				</div>
				<div class="promise-spec">webauthn-prf · hkdf-sha512 · x25519 + ml-kem-1024 · aes-256-gcm</div>
			</div>
		</div>
	</div>
</section>

<style>
	@import './_landing.css';

	.promise-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-top: 24px;
	}
	.promise-card {
		padding: 32px 28px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 14px;
		backdrop-filter: blur(12px);
		position: relative;
		overflow: hidden;
		min-height: 320px;
	}
	.promise-card::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--accent), transparent);
		opacity: 0.5;
	}
	.promise-num {
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		letter-spacing: 0.1em;
	}
	.promise-icon {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		background: var(--accent-dim);
		border-radius: var(--radius);
		color: var(--accent);
		margin-bottom: 4px;
	}
	.promise-title {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.15;
		color: var(--text);
	}
	.promise-title :global(.italic-serif) {
		font-size: 1.05em;
	}
	.promise-body {
		font-size: 14px;
		color: var(--text-2);
		line-height: 1.55;
		letter-spacing: -0.005em;
	}
	.promise-body :global(code) {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 1px 6px;
		background: var(--surface-strong);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		color: var(--text);
		letter-spacing: 0;
	}
	.promise-spec {
		margin-top: auto;
		padding-top: 14px;
		border-top: 1px dashed var(--border-mid);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		letter-spacing: 0;
	}

	@media (max-width: 45em) {
		.promise-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 30em) {
		.promise-card {
			padding: 20px 18px;
			gap: 10px;
			min-height: 0;
		}
		.promise-title {
			font-size: 18px;
		}
		.promise-body {
			font-size: 13px;
		}
		.promise-spec {
			padding-top: 10px;
			font-size: 10px;
		}
	}
</style>
