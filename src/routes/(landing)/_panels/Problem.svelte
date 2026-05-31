<section class="panel">
	<div class="panel-inner">
		<div class="eyebrow">
			<span class="dot"></span>The 2025 password manager won't survive 2030
		</div>
		<h2 class="section-title">
			The threat model changed.<br />
			<span class="muted">The architecture didn't.</span>
		</h2>
		<p class="section-sub">
			<span data-vp-show="desktop"
				>Every mainstream password manager you know was designed in the 2017 threat model.
				None of them ship the cryptography that 2026 actually requires. The numbers are not
				subtle.</span
			>
			<span data-vp-show="mobile"
				>The 2017 threat model. None ship the cryptography 2026 requires.</span
			>
		</p>

		<div class="problem-grid">
			<div class="stat-card">
				<div class="stat-num">16<small>billion</small></div>
				<div class="stat-label">
					<span data-vp-show="desktop"
						>passwords leaked in a single 2025 breach affecting Google, Apple, and
						Facebook accounts.</span
					>
					<span data-vp-show="mobile"
						>passwords leaked in a single 2025 breach.</span
					>
				</div>
				<div class="stat-source">Fox News · June 2025</div>
			</div>
			<div class="stat-card">
				<div class="stat-num">11/11</div>
				<div class="stat-label">
					<span data-vp-show="desktop"
						>major password managers vulnerable to clickjacking autofill theft at DEF
						CON 33.</span
					>
					<span data-vp-show="mobile"
						>password managers vulnerable to clickjacking at DEF CON 33.</span
					>
				</div>
				<div class="stat-source">Tóth · DEF CON 33 · Aug 2025</div>
			</div>
			<div class="stat-card">
				<div class="stat-num">0</div>
				<div class="stat-label">
					<span data-vp-show="desktop"
						>mainstream password managers ship post-quantum encryption. Your vault
						stolen today is decryptable in 2032.</span
					>
					<span data-vp-show="mobile"
						>mainstream managers ship post-quantum. Stolen today, decrypted 2032.</span
					>
				</div>
				<div class="stat-source">FIPS 203 · NIST · Aug 2024</div>
			</div>
		</div>

		<p class="problem-bottom">
			<strong>VuVault is the architecture they have not shipped.</strong>
			<span data-vp-show="desktop"
				>Built from primitives standardized in the last 18 months — OPAQUE,
				ML-KEM, WebAuthn PRF — with FROST and AKD on the Tier 2/3 roadmap.</span
			>
		</p>
	</div>
</section>

<style>
	@import './_landing.css';

	.muted {
		color: var(--text-3);
	}

	.problem-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 20px;
		margin-top: 16px;
		margin-bottom: 24px;
	}
	.stat-card {
		padding: 28px 24px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		gap: 12px;
		backdrop-filter: blur(12px);
		position: relative;
		overflow: hidden;
	}
	.stat-card::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, var(--accent-faint), transparent 60%);
		pointer-events: none;
	}
	.stat-card > * {
		position: relative;
	}
	.stat-num {
		font-size: clamp(36px, 4.5vw, 56px);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1;
		color: var(--text);
		font-feature-settings: 'tnum';
	}
	.stat-num small {
		font-size: 0.4em;
		font-weight: 600;
		color: var(--text-3);
		letter-spacing: 0;
		margin-left: 4px;
	}
	.stat-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		line-height: 1.35;
	}
	.stat-source {
		font-size: 11px;
		color: var(--text-3);
		font-family: var(--font-mono);
		letter-spacing: 0;
		margin-top: auto;
	}

	.problem-bottom {
		text-align: center;
		font-size: 18px;
		color: var(--text-2);
		margin-top: 32px;
		letter-spacing: -0.005em;
	}
	.problem-bottom strong {
		color: var(--text);
		font-weight: 600;
	}

	@media (max-width: 45em) {
		.problem-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 30em) {
		.stat-card {
			padding: 18px 16px;
			gap: 8px;
		}
		.stat-num {
			font-size: clamp(28px, 9vw, 56px);
		}
		.stat-label {
			font-size: 13px;
		}
		.problem-bottom {
			font-size: 14px;
			margin-top: 16px;
		}
	}
</style>
