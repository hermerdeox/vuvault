<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { IconArrowLeft } from '$lib/icons';
	import { resolve } from '$app/paths';

	type Layer = {
		id: string;
		title: string;
		standard: string;
		threats: string[];
		risk: 1 | 2 | 3 | 4 | 5;
	};
	type Tier = {
		id: 'q3-2026' | '2027' | '2028' | '2029-2030';
		label: string;
		when: string;
		tone: 'green' | 'cyan' | 'amber' | 'purple';
		blurb: string;
		layers: Layer[];
	};

	/**
	 * The Five Non-Negotiable Invariants — canonical statement of what
	 * the VuVault stack is required to hold. Ported verbatim from the
	 * prototype blueprint at `docs/prototypes/blueprint.html` lines
	 * 864–899 (the closest "VU 0 Promise" analogue in the codebase).
	 *
	 * `status` is a self-assessed verdict against the current ship:
	 *   - 'held'    — the invariant is mechanically substantiated today
	 *   - 'partial' — held in part / behind a bounded gap (called out)
	 *   - 'pending' — designed for, not yet shipped (Tier 2+ dependency)
	 *
	 * The verdict for each one is grounded in concrete file/line
	 * citations from the docs/CHECKPOINT-ANALYSIS.md audit.
	 */
	type Invariant = {
		id: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
		title: string;
		body: string;
		status: 'held' | 'partial' | 'pending';
		statusNote: string;
	};

	const principles: Invariant[] = [
		{
			id: 'P1',
			title: 'Server cannot read user data.',
			body: 'Mathematical, not policy. The wire only carries opaque ciphertext.',
			// M3 ciphertext sync shipped — OPAQUE registration/login + R2
			// blob upload + per-document blob endpoints all hold
			// ciphertext only. Production deploy refuses to ship
			// without the m3-sync-e2e CI artifact. ZK end-to-end is
			// asserted by tests/e2e/full-workflow.spec.ts (IDB
			// inspection refuses any plaintext substring leak).
			status: 'held',
			statusNote: 'M3 D1/R2 sync shipped · ciphertext-only · E2E IDB inspection asserts no plaintext leak'
		},
		{
			id: 'P2',
			title: 'Server cannot infer user data.',
			body: 'No metadata leaks: not which item changed, not how many items exist.',
			// Padding to fixed buckets is in the Tier 2 spec, not yet
			// in vault-codec.ts (see SECURITY.md ZK-scope #3 update).
			status: 'pending',
			statusNote: 'Bucketed padding lives in the Tier 2 spec — not yet wired'
		},
		{
			id: 'P3',
			title: 'Resistant to harvest-now-decrypt-later.',
			body: 'Hybrid post-quantum encryption from day one. FIPS 203.',
			// Hybrid X25519 + ML-KEM-1024 is shipped end-to-end and
			// KAT-locked under `npm run test:fips`.
			status: 'held',
			statusNote: 'Hybrid X25519 + ML-KEM-1024 shipped · KAT-locked in CI'
		},
		{
			id: 'P4',
			title: 'Verifiable by anyone.',
			body: 'Reproducible builds, transparency log, open source. No trust required.',
			// SHA-384 manifest + in-page verifier shipped; Sigstore
			// Rekor publishing is wired in the release workflow with
			// pinned cosign installer and OIDC keyless signing on
			// every published artifact. Third-party audit still
			// pending — see Vu Level 1 caveats in /privacy (post the
			// 2026-05-20 scale inversion: lower number = more private).
			status: 'held',
			statusNote: 'SHA-384 manifest + in-page verifier · Sigstore + Rekor keyless on every release'
		},
		{
			id: 'P5',
			title: 'No silent updates.',
			body: 'Bundle hash visible at unlock. SRI on every asset. User-consented updates only.',
			// Bundle hash visible at unlock; SRI on every asset is a CDN /
			// asset-pipeline detail that's covered by the same SHA-384
			// manifest mechanism.
			status: 'held',
			statusNote: 'Bundle hash bound at unlock · SHA-384 per-chunk manifest covers all assets'
		}
	];

	const tiers: Tier[] = [
		{
			id: 'q3-2026',
			label: 'Tier 1 · Production',
			when: 'Q3 2026',
			tone: 'green',
			blurb:
				'Zero research risk. Standards published, libraries audited, paths well-trodden. This is what ships first.',
			layers: [
				{
					id: 'L01',
					title: 'OPAQUE authentication',
					standard: 'RFC 9807 (Jul 2025)',
					threats: ['Server-side credential theft', 'Phishing-vulnerable login'],
					risk: 1
				},
				{
					id: 'L02',
					title: 'PRF + Secret Key vault key derivation',
					standard: 'WebAuthn L3 PRF · HKDF-SHA512',
					threats: ['Master password compromise', 'Cross-site password reuse'],
					risk: 1
				},
				{
					id: 'L03',
					title: 'ML-KEM-1024 hybrid envelope',
					standard: 'FIPS 203 · Aug 2024',
					threats: ['Harvest-now-decrypt-later (quantum)', 'Cipher downgrade'],
					risk: 2
				},
				{
					id: 'L04',
					title: 'XMSS release signatures',
					standard: 'NIST SP 800-208',
					threats: ['Quantum forgery of release signing key'],
					risk: 1
				},
				{
					id: 'L05',
					title: 'Reproducible builds + Sigstore',
					standard: 'SLSA L3 · Rekor transparency log',
					threats: ['Targeted backdoor', 'Build-system compromise'],
					risk: 1
				}
			]
		},
		{
			id: '2027',
			label: 'Tier 2 · Sync & sharing',
			when: '2027',
			tone: 'cyan',
			blurb:
				'Standards mature, but integration complexity is real. Sharing requires multi-party crypto. CRDT sync requires careful key management.',
			layers: [
				{
					id: 'L06',
					title: 'MLS family/team sharing',
					standard: 'RFC 9420 / RFC 9750',
					threats: ['Shared-vault key compromise on member departure'],
					risk: 3
				},
				{
					id: 'L07',
					title: 'Encrypted CRDT sync',
					standard: 'Yjs + HPKE + ML-KEM-768',
					threats: ['Sync-server inspection', 'Replay across devices'],
					risk: 3
				},
				{
					id: 'L08',
					title: 'WebRTC + ECDH device pairing',
					standard: 'Local-first, no server intermediation',
					threats: ['Pairing-time MITM'],
					risk: 2
				},
				{
					id: 'L09',
					title: 'CONIKS-derived AKD log',
					standard: 'WhatsApp-style auditable key directory',
					threats: ['Server impersonating users with fake keys'],
					risk: 3
				},
				{
					id: 'L10',
					title: 'PIR + unbalanced PSI breach checks',
					standard: 'RFC 9497 VOPRF · OPRF-PSI',
					threats: ['Breach-check service learning your passwords'],
					risk: 3
				}
			]
		},
		{
			id: '2028',
			label: 'Tier 3 · Recovery & autonomy',
			when: '2028',
			tone: 'amber',
			blurb:
				'Threshold cryptography and TEEs unlock advanced recovery and agentic patterns. Required for enterprise viability.',
			layers: [
				{
					id: 'L11',
					title: 'FROST t-of-n recovery',
					standard: 'RFC 9591',
					threats: ['Single-point recovery failure', 'Coerced recovery'],
					risk: 3
				},
				{
					id: 'L12',
					title: 'TEE enclaves',
					standard: 'AWS Nitro · Azure Confidential',
					threats: ['Server-side remote attestation gaps'],
					risk: 4
				},
				{
					id: 'L13',
					title: 'Noise-channel agentic autofill',
					standard: 'Noise IK · 1Password+Browserbase pattern',
					threats: ['Agent-credential leakage', 'Browser-extension compromise'],
					risk: 4
				},
				{
					id: 'L14',
					title: 'FN-DSA compact signatures',
					standard: 'FIPS 206 (draft Aug 2025)',
					threats: ['Bandwidth-limited PQ signature deployments'],
					risk: 3
				}
			]
		},
		{
			id: '2029-2030',
			label: 'Tier 4 · Frontier',
			when: '2029–2030',
			tone: 'purple',
			blurb:
				'Research-adjacent. Standards still settling. We track these with prototypes; ship when production-ready libraries land.',
			layers: [
				{
					id: 'L15',
					title: 'zkSNARK selective disclosure',
					standard: 'Groth16 · Plonky3',
					threats: ['Over-disclosure during identity verification'],
					risk: 5
				},
				{
					id: 'L16',
					title: 'drand timelock encryption',
					standard: 'tlock over BLS12-381',
					threats: ['Pre-publication leakage of dead-man releases'],
					risk: 4
				},
				{
					id: 'L17',
					title: 'Threshold stateful HBS (Haystack)',
					standard: 'CIC 2025',
					threats: ['Stateful HBS replay across signing parties'],
					risk: 5
				},
				{
					id: 'L18',
					title: 'Pure-PQ threshold recovery',
					standard: 'RACCOON-style ML-DSA threshold',
					threats: ['Quantum compromise of recovery shares'],
					risk: 5
				}
			]
		}
	];
</script>

<svelte:head>
	<title>Architectural blueprint — VuVault</title>
</svelte:head>

<div class="page">
	<header class="topbar">
		<a class="back" href={resolve('/')}>
			<IconArrowLeft size={14} stroke={2} />
		</a>
		<BrandMark showPill="Blueprint" />
		<div class="right">
			<ThemeToggle />
		</div>
	</header>

	<main class="content">
		<section class="hero">
			<Eyebrow accent>v0.5.0 · 18 layers · 4 shipping tiers</Eyebrow>
			<h1>
				The architectural blueprint.<br />
				<span class="italic-serif">Organized by shippability.</span>
			</h1>
			<p class="lede">
				This document is the canonical map of what VuVault's cryptographic stack looks like, what
				it defends against, and when each piece ships. Tier 1 is on production paths today. Tier
				4 is research-adjacent — we track it, prototype it, and integrate when the standards and
				libraries are ready.
			</p>
		</section>

		<section class="principles">
			<header class="principles-head">
				<div class="sect-num">§ 01 — Design principles</div>
				<h2 class="sect-title">Five non-negotiable invariants.</h2>
				<p class="sect-sub">
					Every layer is checked against these five before it ships. If a feature
					breaks one, it does not ship — even if a competitor offers it, even if it's
					convenient. Status badges below are mechanically self-assessed against the
					current ship.
				</p>
			</header>
			<div class="principle-grid">
				{#each principles as p (p.id)}
					<article class="principle">
						<div class="principle-id">{p.id}</div>
						<div class="principle-title">{p.title}</div>
						<div class="principle-body">{p.body}</div>
						<div class="principle-status status-{p.status}">
							{p.status === 'held'
								? 'Held'
								: p.status === 'partial'
									? 'Partial'
									: 'Pending'}
						</div>
						<div class="principle-note">{p.statusNote}</div>
					</article>
				{/each}
			</div>
		</section>

		{#each tiers as tier (tier.id)}
			<section class="tier" data-tone={tier.tone}>
				<header class="tier-head">
					<div class="tier-when">{tier.when}</div>
					<h2 class="tier-label">{tier.label}</h2>
					<p class="tier-blurb">{tier.blurb}</p>
				</header>

				<div class="layers">
					{#each tier.layers as layer (layer.id)}
						<article class="layer">
							<div class="layer-id">{layer.id}</div>
							<div class="layer-body">
								<div class="layer-title">{layer.title}</div>
								<div class="layer-std">{layer.standard}</div>
								<div class="threats">
									{#each layer.threats as t (t)}
										<span class="threat">{t}</span>
									{/each}
								</div>
							</div>
							<div class="risk" aria-label="Risk meter">
								{#each Array(5) as _, i (i)}
									<span class="dot" class:on={i < layer.risk}></span>
								{/each}
							</div>
						</article>
					{/each}
				</div>
			</section>
		{/each}
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
		max-height: 100dvh;
		display: grid;
		grid-template-rows: var(--header-h) 1fr;
		overflow: hidden;
	}

	.topbar {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 12px;
		padding-top: env(safe-area-inset-top, 0px);
		padding-left: max(24px, env(safe-area-inset-left, 0px));
		padding-right: max(24px, env(safe-area-inset-right, 0px));
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
	}
	.back {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition: var(--transition);
	}
	:global(html[data-vp~='mobile']) .back,
	:global(html[data-vp~='tablet']) .back {
		width: 44px;
		height: 44px;
	}
	.back:hover {
		color: var(--text);
		background: var(--surface);
	}
	.right {
		display: flex;
		align-items: center;
	}

	.content {
		overflow-y: auto;
		padding: clamp(20px, 4vw, 48px) clamp(14px, 4vw, 32px) clamp(48px, 9vw, 96px);
		padding-bottom: max(clamp(48px, 9vw, 96px), env(safe-area-inset-bottom));
		max-width: 1080px;
		width: 100%;
		margin: 0 auto;
	}

	.hero {
		margin-bottom: clamp(28px, 5vw, 56px);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	h1 {
		font-size: clamp(28px, 7vw, 56px);
		font-weight: 700;
		letter-spacing: -0.035em;
		line-height: 1;
	}
	.italic-serif {
		font-family: var(--font-serif);
		font-style: italic;
		font-weight: 400;
		font-size: 1.06em;
	}
	.lede {
		font-size: 16px;
		color: var(--text-2);
		line-height: 1.55;
		max-width: 640px;
	}

	.principles {
		margin-bottom: 56px;
	}
	.principles-head {
		margin-bottom: 20px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sect-num {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		color: var(--accent);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.sect-title {
		font-size: clamp(28px, 3vw, 36px);
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.sect-sub {
		font-size: 15px;
		color: var(--text-2);
		line-height: 1.55;
		max-width: 720px;
	}
	.principle-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 12px;
	}
	@media (max-width: 64em) {
		.principle-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	@media (max-width: 30em) {
		.principle-grid {
			grid-template-columns: 1fr;
		}
	}
	.principle {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.principle-id {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.principle-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text);
		letter-spacing: -0.005em;
	}
	.principle-body {
		font-size: 12px;
		color: var(--text-3);
		line-height: 1.5;
		flex: 1;
	}
	.principle-status {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		padding: 2px 10px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		border-radius: 999px;
		border: 1px solid var(--border-mid);
		color: var(--text-2);
		background: var(--surface);
	}
	.principle-status.status-held {
		color: var(--success);
		background: var(--success-dim);
		border-color: color-mix(in srgb, var(--success) 35%, transparent);
	}
	.principle-status.status-partial {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
	}
	.principle-status.status-pending {
		color: var(--text-3);
		background: var(--surface);
		border-color: var(--border-mid);
	}
	.principle-note {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		line-height: 1.5;
	}

	.tier {
		margin-bottom: 48px;
		padding: 24px 28px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		border-left: 3px solid var(--tone, var(--accent));
	}
	@media (max-width: 30em) {
		.tier {
			margin-bottom: 24px;
			padding: 16px 14px;
		}
	}
	.tier[data-tone='green'] {
		--tone: var(--success);
	}
	.tier[data-tone='cyan'] {
		--tone: var(--accent);
	}
	.tier[data-tone='amber'] {
		--tone: var(--warn);
	}
	.tier[data-tone='purple'] {
		--tone: color-mix(in srgb, var(--accent) 50%, var(--danger));
	}

	.tier-head {
		margin-bottom: 18px;
		padding-bottom: 14px;
		border-bottom: 1px dashed var(--border);
	}
	.tier-when {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--tone, var(--accent));
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.tier-label {
		font-size: 20px;
		font-weight: 700;
		margin: 4px 0 8px;
		letter-spacing: -0.015em;
	}
	@media (max-width: 30em) {
		.tier-label {
			font-size: 17px;
		}
		.tier-blurb {
			font-size: 13px;
		}
	}
	.tier-blurb {
		font-size: 14px;
		color: var(--text-2);
		line-height: 1.5;
		max-width: 720px;
	}

	.layers {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.layer {
		display: grid;
		grid-template-columns: 60px 1fr auto;
		align-items: flex-start;
		gap: 16px;
		padding: 14px 16px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
	}
	/* Extend the slim layout to <=45em so 480-720 px viewports also
	   drop the risk-meter column instead of cramming three columns
	   into 480 px. */
	@media (max-width: 45em) {
		.layer {
			grid-template-columns: 48px 1fr;
			gap: 12px;
			padding: 12px 14px;
		}
		.layer .risk {
			display: none;
		}
	}
	@media (max-width: 30em) {
		.layer {
			grid-template-columns: 40px 1fr;
			gap: 10px;
			padding: 10px 12px;
		}
		.layer-title {
			font-size: 13px;
		}
		.layer-std {
			font-size: 10px;
		}
		.threats {
			gap: 4px;
		}
		.threat {
			font-size: 10px;
			padding: 2px 6px;
		}
	}
	.layer:hover {
		border-color: var(--border-mid);
	}
	.layer-id {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--tone, var(--accent));
		letter-spacing: 0.1em;
		padding-top: 2px;
	}
	.layer-body {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.layer-title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.layer-std {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
	}
	.threats {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 6px;
	}
	.threat {
		padding: 3px 8px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		font-size: 11px;
		color: var(--text-2);
	}

	.risk {
		display: flex;
		gap: 3px;
		padding-top: 4px;
	}
	.risk .dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-4);
	}
	.risk .dot.on {
		background: var(--tone, var(--accent));
	}
</style>
