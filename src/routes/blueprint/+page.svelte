<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { IconArrowLeft } from '$lib/icons';
	import { resolve } from '$app/paths';

	/**
	 * Public architectural blueprint.
	 *
	 * Everything on this page is deliberately limited to open,
	 * published standards and the externally observable shape of the
	 * system. No roadmap dates, no internal milestones, no library or
	 * vendor selections, no infrastructure topology. The security
	 * argument must survive full disclosure of this page — and it
	 * does, because none of it is secret: it is math, not obscurity.
	 */

	type Principle = {
		id: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
		title: string;
		body: string;
		status: 'shipped' | 'in-design';
	};

	type Domain = {
		id: string;
		title: string;
		standard: string;
		body: string;
		defends: string[];
		tone: 'green' | 'cyan' | 'amber' | 'purple';
	};

	type ThreatRow = {
		adversary: string;
		capability: string;
		outcome: string;
	};

	const principles: Principle[] = [
		{
			id: 'P1',
			title: 'Server cannot read user data.',
			body: 'Mathematical, not policy. The wire only ever carries opaque ciphertext; decryption keys exist solely on the device.',
			status: 'shipped'
		},
		{
			id: 'P2',
			title: 'Server cannot infer user data.',
			body: 'Metadata is treated as data. The shape, count, and cadence of what you store should reveal nothing.',
			status: 'in-design'
		},
		{
			id: 'P3',
			title: 'Resistant to harvest-now-decrypt-later.',
			body: 'Hybrid post-quantum encryption from day one. Traffic recorded today must stay sealed against future quantum computers.',
			status: 'shipped'
		},
		{
			id: 'P4',
			title: 'Verifiable by anyone.',
			body: 'Open source, signed releases in a public transparency log, verifiable in the page itself. No trust required.',
			status: 'shipped'
		},
		{
			id: 'P5',
			title: 'No silent updates.',
			body: 'The code you run is the code that was published. The bundle hash is visible at unlock and checked against the release manifest.',
			status: 'shipped'
		}
	];

	const domains: Domain[] = [
		{
			id: 'A1',
			title: 'Authentication',
			standard: 'OPAQUE · RFC 9807',
			body: 'Login uses an augmented PAKE. Your master secret never leaves the device — not at registration, not at login, not hashed, not at all. The server ends up with a verifier it cannot reverse and cannot reuse, so there is no password database to steal.',
			defends: ['Server-side credential theft', 'Phishing-resistant login', 'Credential stuffing'],
			tone: 'green'
		},
		{
			id: 'A2',
			title: 'Key hierarchy',
			standard: 'WebAuthn PRF · HKDF',
			body: 'Vault keys are derived on-device from hardware-backed authenticator output, expanded through a one-way key schedule with strict domain separation. Every derived key has exactly one job; compromise of one context never cascades into another.',
			defends: ['Master secret compromise', 'Cross-context key reuse', 'Key exfiltration'],
			tone: 'green'
		},
		{
			id: 'A3',
			title: 'Encryption envelopes',
			standard: 'Hybrid KEM · FIPS 203 · AEAD',
			body: 'Every record is sealed in an authenticated envelope keyed by a hybrid of elliptic-curve and ML-KEM-1024 post-quantum key encapsulation. Breaking the envelope requires breaking both. Known-answer tests pin the cryptography to published test vectors on every build.',
			defends: ['Harvest-now-decrypt-later', 'Cipher downgrade', 'Ciphertext tampering'],
			tone: 'cyan'
		},
		{
			id: 'A4',
			title: 'Storage model',
			standard: 'Local-first · ciphertext-only sync',
			body: 'The vault lives on your device and is usable with zero network access. When sync is enabled, the server stores opaque encrypted blobs — it cannot distinguish a password from a passport, and the end-to-end test suite asserts no plaintext ever crosses the boundary.',
			defends: ['Server breach', 'Subpoena of stored data', 'Insider access'],
			tone: 'cyan'
		},
		{
			id: 'A5',
			title: 'Transport & origin',
			standard: 'Same-origin · zero third parties',
			body: 'The application is served from a single origin with no third-party hosts, no analytics tags, and no embedded trackers. All cryptography executes in your browser; what leaves the device is ciphertext addressed to our own endpoints, nothing else.',
			defends: ['Third-party script compromise', 'Traffic analysis surface', 'Tracking'],
			tone: 'amber'
		},
		{
			id: 'A6',
			title: 'Supply chain integrity',
			standard: 'Reproducible builds · Sigstore + Rekor',
			body: 'Releases are built reproducibly, signed keylessly, and recorded in a public append-only transparency log. The running page can verify its own bundle hash against the published manifest, so a tampered or targeted build is detectable by the person it targets.',
			defends: ['Build-system compromise', 'Targeted backdoor', 'Silent substitution'],
			tone: 'purple'
		}
	];

	const threatModel: ThreatRow[] = [
		{
			adversary: 'Our own servers, fully compromised',
			capability: 'Reads every byte we store and every request we receive',
			outcome: 'Obtains ciphertext and an irreversible authentication verifier. No keys, no plaintext.'
		},
		{
			adversary: 'Network observer',
			capability: 'Records all traffic between you and us, indefinitely',
			outcome: 'Sees encrypted envelopes on a single origin. Hybrid post-quantum sealing keeps recordings worthless even against a future quantum computer.'
		},
		{
			adversary: 'Malicious or coerced release',
			capability: 'Attempts to ship you altered code',
			outcome: 'Must forge a reproducible build and a public transparency-log entry, and still defeats the in-page bundle-hash check. Tampering is evident, not silent.'
		},
		{
			adversary: 'Thief with your locked device',
			capability: 'Full physical access to the hardware',
			outcome: 'Faces hardware-backed unlock and memory-hard key derivation. The vault does not open without you.'
		},
		{
			adversary: 'Court order served on us',
			capability: 'Compels us to hand over everything we have',
			outcome: 'We comply — and hand over ciphertext we are mathematically unable to read. That is the point.'
		}
	];
</script>

<svelte:head>
	<title>Architectural blueprint — VuVault</title>
	<meta
		name="description"
		content="The VuVault architecture: open standards, client-side cryptography, zero knowledge by construction."
	/>
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
			<Eyebrow accent>Open standards · Client-side cryptography · Zero knowledge</Eyebrow>
			<h1>
				The architectural blueprint.<br />
				<span class="italic-serif">Math, not obscurity.</span>
			</h1>
			<p class="lede">
				This page describes the shape of the system: what runs where, which published standards
				it is built on, and what each layer is designed to survive. It is deliberately complete
				on principles and deliberately silent on implementation internals — a security model
				that depends on you not reading this page would not be a security model.
			</p>
		</section>

		<section class="principles">
			<header class="sect-head">
				<div class="sect-num">§ 01 — Invariants</div>
				<h2 class="sect-title">Five non-negotiable invariants.</h2>
				<p class="sect-sub">
					Every layer is checked against these five before it ships. If a feature breaks one,
					it does not ship — even if a competitor offers it, even if it's convenient.
				</p>
			</header>
			<div class="principle-grid">
				{#each principles as p (p.id)}
					<article class="principle">
						<div class="principle-id">{p.id}</div>
						<div class="principle-title">{p.title}</div>
						<div class="principle-body">{p.body}</div>
						<div class="principle-status status-{p.status}">
							{p.status === 'shipped' ? 'Shipped' : 'In design'}
						</div>
					</article>
				{/each}
			</div>
		</section>

		<section class="domains">
			<header class="sect-head">
				<div class="sect-num">§ 02 — Architecture</div>
				<h2 class="sect-title">Six layers, all in your browser.</h2>
				<p class="sect-sub">
					Each layer is built on an open, published standard — the same primitives anyone can
					read, audit, and reimplement. The composition is the architecture; none of it relies
					on a secret.
				</p>
			</header>
			<div class="domain-grid">
				{#each domains as d (d.id)}
					<article class="domain" data-tone={d.tone}>
						<div class="domain-top">
							<span class="domain-id">{d.id}</span>
							<span class="domain-std">{d.standard}</span>
						</div>
						<h3 class="domain-title">{d.title}</h3>
						<p class="domain-body">{d.body}</p>
						<div class="defends">
							{#each d.defends as t (t)}
								<span class="defend">{t}</span>
							{/each}
						</div>
					</article>
				{/each}
			</div>
		</section>

		<section class="threats-sect">
			<header class="sect-head">
				<div class="sect-num">§ 03 — Threat model</div>
				<h2 class="sect-title">Assume the worst. Then check the math.</h2>
				<p class="sect-sub">
					The design question for every adversary is the same: with everything they can take,
					what do they actually get?
				</p>
			</header>
			<div class="threat-rows">
				{#each threatModel as row (row.adversary)}
					<article class="threat-row">
						<div class="threat-adversary">{row.adversary}</div>
						<div class="threat-capability">{row.capability}</div>
						<div class="threat-outcome">{row.outcome}</div>
					</article>
				{/each}
			</div>
		</section>

		<section class="omitted">
			<header class="sect-head">
				<div class="sect-num">§ 04 — What this page omits</div>
				<h2 class="sect-title">Deliberately.</h2>
			</header>
			<p class="omitted-body">
				You will not find release schedules, internal milestones, infrastructure topology, or
				dependency selections here. Those change; the invariants do not. What we do publish is
				stronger than any of it: the source, a software bill of materials, signed reproducible
				releases in a public transparency log, and a verifier that runs in the page you are
				reading. Verify, don't trust.
			</p>
		</section>
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

	.sect-head {
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

	.principles {
		margin-bottom: 56px;
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
	.principle-status.status-shipped {
		color: var(--success);
		background: var(--success-dim);
		border-color: color-mix(in srgb, var(--success) 35%, transparent);
	}
	.principle-status.status-in-design {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
	}

	.domains {
		margin-bottom: 56px;
	}
	.domain-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
	}
	@media (max-width: 45em) {
		.domain-grid {
			grid-template-columns: 1fr;
		}
	}
	.domain {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 20px 22px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		border-left: 3px solid var(--tone, var(--accent));
		transition: var(--transition);
	}
	.domain:hover {
		border-color: var(--border-mid);
		border-left-color: var(--tone, var(--accent));
	}
	.domain[data-tone='green'] {
		--tone: var(--success);
	}
	.domain[data-tone='cyan'] {
		--tone: var(--accent);
	}
	.domain[data-tone='amber'] {
		--tone: var(--warn);
	}
	.domain[data-tone='purple'] {
		--tone: color-mix(in srgb, var(--accent) 50%, var(--danger));
	}
	.domain-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.domain-id {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--tone, var(--accent));
		letter-spacing: 0.1em;
	}
	.domain-std {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		text-align: right;
	}
	.domain-title {
		font-size: 17px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.domain-body {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.55;
		flex: 1;
	}
	.defends {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.defend {
		padding: 3px 8px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		font-size: 11px;
		color: var(--text-2);
	}

	.threats-sect {
		margin-bottom: 56px;
	}
	.threat-rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.threat-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1.4fr;
		gap: 16px;
		padding: 16px 18px;
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
	}
	.threat-row:hover {
		border-color: var(--border-mid);
	}
	@media (max-width: 45em) {
		.threat-row {
			grid-template-columns: 1fr;
			gap: 6px;
		}
	}
	.threat-adversary {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.threat-capability {
		font-size: 12px;
		color: var(--text-3);
		line-height: 1.5;
	}
	.threat-outcome {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}

	.omitted {
		padding: 24px 28px;
		background: var(--surface);
		border: 1px dashed var(--border-mid);
		border-radius: var(--radius-lg);
	}
	@media (max-width: 30em) {
		.omitted {
			padding: 16px 14px;
		}
	}
	.omitted-body {
		font-size: 14px;
		color: var(--text-2);
		line-height: 1.6;
		max-width: 760px;
	}
</style>
