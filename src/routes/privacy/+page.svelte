<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { IconArrowLeft } from '$lib/icons';
	import {
		PRIVACY_LEVELS,
		EVIDENCE,
		THREATS,
		CURRENT_LEVEL,
		currentLevel,
		evidenceStats
	} from '$lib/data/privacy-level';

	const here = currentLevel();
	const stats = evidenceStats();
</script>

<svelte:head>
	<title>Privacy level — VuVault</title>
	<meta
		name="description"
		content="Honest, code-tied snapshot of the privacy guarantees VuVault holds today, what is partial, and what is still pending."
	/>
</svelte:head>

<div class="page">
	<header class="topbar">
		<a class="back" href="/" aria-label="Back to landing">
			<IconArrowLeft size={14} stroke={2} />
		</a>
		<BrandMark showPill="Privacy" />
		<div class="right">
			<ThemeToggle />
		</div>
	</header>

	<main class="content">
		<section class="hero">
			<Eyebrow accent>Vu Privacy Level · honest snapshot</Eyebrow>
			<h1>
				<span class="badge-large" data-testid="privacy-level-current"
					>Vu Level {CURRENT_LEVEL}</span
				>
				<span class="italic-serif">— {here.headline}.</span>
			</h1>
			<p class="lede">
				This page is the truth source for every privacy claim the app
				makes. The badge in the audit footer reads from the same data
				module, and a regression test fails CI if the in-app claim
				drifts from the shipped reality.
			</p>
			<div class="counters" data-testid="evidence-counters">
				<div class="counter">
					<div class="count count-shipped">{stats.shipped}</div>
					<div class="count-label">Shipped</div>
				</div>
				<div class="counter">
					<div class="count count-partial">{stats.partial}</div>
					<div class="count-label">Partial</div>
				</div>
				<div class="counter">
					<div class="count count-pending">{stats.pending}</div>
					<div class="count-label">Pending</div>
				</div>
			</div>
		</section>

		<section class="ladder">
			<header class="sect-head">
				<div class="sect-num">§ 01 — The Vu Privacy ladder</div>
				<h2 class="sect-title">Five levels, exhaustively defined.</h2>
				<p class="sect-sub">
					Each level is fixed by which guarantees hold. We will not
					promote a level number unless every claim in its evidence
					table has actually shipped and is exercised by a test.
				</p>
			</header>
			<div class="ladder-grid">
				{#each PRIVACY_LEVELS as lvl (lvl.id)}
					<article
						class="lvl"
						class:lvl-current={lvl.id === CURRENT_LEVEL}
						data-testid={`privacy-level-${lvl.id}`}
					>
						<div class="lvl-id">{lvl.short}</div>
						<div class="lvl-headline">{lvl.headline}</div>
						<div class="lvl-when">{lvl.when}</div>
						<div class="lvl-summary">{lvl.summary}</div>
						{#if lvl.id === CURRENT_LEVEL}
							<div class="lvl-marker">Shipped today</div>
						{/if}
					</article>
				{/each}
			</div>
		</section>

		<section class="evidence">
			<header class="sect-head">
				<div class="sect-num">§ 02 — Evidence map</div>
				<h2 class="sect-title">Every claim points to code.</h2>
				<p class="sect-sub">
					Each row links a privacy claim to the file path that
					substantiates it (or the milestone that will). If the file
					moves, the row gets updated in the same commit.
				</p>
			</header>
			<div class="evidence-list">
				{#each EVIDENCE as row (row.id)}
					<article class="ev">
						<div class="ev-id">{row.id}</div>
						<div class="ev-body">
							<div class="ev-claim">{row.claim}</div>
							<div class="ev-evidence">{row.evidence}</div>
						</div>
						<div class="ev-status status-{row.status}">
							{row.status === 'shipped'
								? 'Shipped'
								: row.status === 'partial'
									? 'Partial'
									: 'Pending'}
						</div>
					</article>
				{/each}
			</div>
		</section>

		<section class="threats">
			<header class="sect-head">
				<div class="sect-num">§ 03 — Threat model</div>
				<h2 class="sect-title">What we defend against, and what we don't.</h2>
				<p class="sect-sub">
					Cryptography does not solve consent and cannot defeat
					persistent endpoint malware. These limits are deliberate
					and stated up-front.
				</p>
			</header>
			<div class="threat-grid">
				{#each THREATS as t (t.id)}
					<article class="threat" class:threat-undef={!t.defended}>
						<div class="threat-id">{t.id}</div>
						<div class="threat-body">
							<div class="threat-name">{t.threat}</div>
							<div class="threat-how">{t.how}</div>
						</div>
						<div class="threat-flag" class:flag-good={t.defended}>
							{t.defended ? 'Defended' : 'Out of scope'}
						</div>
					</article>
				{/each}
			</div>
		</section>

		<section class="references">
			<header class="sect-head">
				<div class="sect-num">§ 04 — References</div>
				<h2 class="sect-title">Read more, verify yourself.</h2>
				<p class="sect-sub">
					This page is generated from
					<code>src/lib/data/privacy-level.ts</code>. The deeper
					companions:
				</p>
			</header>
			<ul class="refs">
				<li>
					<strong>docs/PRIVACY-LEVEL.md</strong> — long-form expansion
					of this page, with citations.
				</li>
				<li>
					<strong>docs/SECURITY.md</strong> — explicit zero-knowledge
					scope, threat model, and bug-bounty range.
				</li>
				<li>
					<strong>docs/ARCHITECTURE.md</strong> — the 18-layer stack,
					four shipping tiers, and what each layer defends against.
				</li>
				<li>
					<strong>docs/ROADMAP.md</strong> — what is shipped today,
					what is pending, and when each piece is targeted.
				</li>
				<li>
					<strong>tests/e2e/full-workflow.spec.ts</strong> —
					programmatically inspects IndexedDB to assert no plaintext
					substring leaks past the encryption boundary.
				</li>
			</ul>
		</section>
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
		display: grid;
		grid-template-rows: calc(var(--header-h) + var(--safe-top, 0px)) 1fr;
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
		position: sticky;
		top: 0;
		z-index: 10;
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
		justify-content: flex-end;
		align-items: center;
	}

	.content {
		max-width: 980px;
		margin: 0 auto;
		padding: 48px 24px 96px;
		display: flex;
		flex-direction: column;
		gap: 56px;
	}
	:global(html[data-vp~='mobile']) .content {
		padding: 32px 16px 80px;
		gap: 40px;
	}

	.hero h1 {
		font-size: clamp(28px, 4vw, 44px);
		line-height: 1.12;
		margin: 12px 0 16px;
		color: var(--text);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.hero .italic-serif {
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--text-2);
		font-weight: 400;
	}
	.lede {
		max-width: 70ch;
		font-size: 15px;
		line-height: 1.6;
		color: var(--text-2);
	}

	.badge-large {
		display: inline-block;
		align-self: flex-start;
		padding: 8px 16px;
		font-family: var(--font-mono);
		font-size: 14px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius);
	}

	.counters {
		display: flex;
		gap: 24px;
		margin-top: 24px;
		flex-wrap: wrap;
	}
	.counter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-width: 96px;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 28px;
		font-weight: 700;
		line-height: 1;
	}
	.count-shipped {
		color: var(--success);
	}
	.count-partial {
		color: var(--warn);
	}
	.count-pending {
		color: var(--text-3);
	}
	.count-label {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.sect-head {
		margin-bottom: 20px;
	}
	.sect-num {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		margin-bottom: 8px;
	}
	.sect-title {
		font-size: clamp(22px, 3vw, 30px);
		line-height: 1.2;
		margin: 0 0 10px;
		color: var(--text);
	}
	.sect-sub {
		max-width: 70ch;
		font-size: 14px;
		line-height: 1.6;
		color: var(--text-2);
	}

	.ladder-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px;
	}
	.lvl {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		position: relative;
	}
	.lvl-current {
		border-color: color-mix(in srgb, var(--accent) 50%, transparent);
		background: color-mix(in srgb, var(--accent) 4%, var(--surface));
	}
	.lvl-id {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.lvl-current .lvl-id {
		color: var(--accent);
	}
	.lvl-headline {
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
	}
	.lvl-when {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}
	.lvl-summary {
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-2);
	}
	.lvl-marker {
		align-self: flex-start;
		margin-top: 6px;
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.evidence-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ev {
		display: grid;
		grid-template-columns: 56px 1fr auto;
		gap: 12px;
		align-items: start;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.ev-id {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}
	.ev-claim {
		font-size: 14px;
		font-weight: 500;
		color: var(--text);
		margin-bottom: 4px;
	}
	.ev-evidence {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.ev-status,
	.threat-flag {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		padding: 3px 8px;
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}
	.status-shipped {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
	}
	.status-partial {
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
	}
	.status-pending {
		color: var(--text-3);
		background: var(--surface);
		border: 1px solid var(--border);
	}

	.threat-grid {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.threat {
		display: grid;
		grid-template-columns: 56px 1fr auto;
		gap: 12px;
		align-items: start;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.threat-id {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}
	.threat-name {
		font-size: 14px;
		font-weight: 500;
		color: var(--text);
		margin-bottom: 4px;
	}
	.threat-how {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.threat-flag.flag-good {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
	}
	.threat-flag:not(.flag-good) {
		color: var(--text-3);
		background: var(--surface);
		border: 1px solid var(--border);
	}

	.refs {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0;
		margin: 0;
		list-style: none;
	}
	.refs li {
		padding: 10px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.55;
	}
	.refs strong {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text);
		margin-right: 8px;
	}
	code {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--accent);
	}

	@media (max-width: 30em) {
		.ev,
		.threat {
			grid-template-columns: 1fr;
		}
		.ev-status,
		.threat-flag {
			justify-self: start;
		}
	}
</style>
