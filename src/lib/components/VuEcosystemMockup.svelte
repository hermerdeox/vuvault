<script lang="ts">
	import type { MockupKind } from '$lib/data/vu-ecosystem';

	type Props = {
		kind: MockupKind;
		/** Accent color applied to bars, dots, and outlines. */
		accent: string;
	};

	let { kind, accent }: Props = $props();
</script>

<!--
	Inline mockup previews for the five "Enable" apps. Each mockup is a
	tiny SVG-or-HTML composition that hints at the app's product surface
	without resembling any real third-party UI. Markup is local, static,
	and self-contained — no external assets, no analytics, no network.
-->

<div class="mockup" style="--mockup-accent: {accent};" data-mockup={kind}>
	{#if kind === 'vault'}
		<div class="mockup-screen vault">
			<div class="screen-chrome">
				<span class="dot" style="background: {accent}"></span>
				<span class="screen-title">VuVault · 0 servers</span>
			</div>
			<div class="vault-row">
				<span class="row-icon">A</span>
				<div class="row-text">
					<span class="row-name">amazon.com</span>
					<span class="row-meta">••••••••••••</span>
				</div>
				<span class="row-pill">PQ</span>
			</div>
			<div class="vault-row">
				<span class="row-icon">G</span>
				<div class="row-text">
					<span class="row-name">github.com</span>
					<span class="row-meta">••••••••</span>
				</div>
				<span class="row-pill">PQ</span>
			</div>
			<div class="vault-row">
				<span class="row-icon">F</span>
				<div class="row-text">
					<span class="row-name">figma.com</span>
					<span class="row-meta">••••••••••</span>
				</div>
				<span class="row-pill">PQ</span>
			</div>
		</div>
	{:else if kind === 'blink'}
		<div class="mockup-screen blink">
			<div class="screen-chrome">
				<span class="dot" style="background: {accent}"></span>
				<span class="screen-title">VuBlink · expires 00:24</span>
			</div>
			<div class="blink-frame">
				<div class="blink-photo" aria-hidden="true">
					<svg viewBox="0 0 120 90" xmlns="http://www.w3.org/2000/svg">
						<defs>
							<linearGradient id="blink-sky" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0" stop-color={accent} stop-opacity="0.5" />
								<stop offset="1" stop-color={accent} stop-opacity="0.1" />
							</linearGradient>
						</defs>
						<rect width="120" height="60" fill="url(#blink-sky)" />
						<polygon points="0,60 35,38 60,52 90,30 120,46 120,90 0,90" fill={accent} fill-opacity="0.45" />
						<circle cx="92" cy="22" r="8" fill={accent} fill-opacity="0.85" />
					</svg>
				</div>
				<div class="blink-timer">
					<span class="timer-bar"><span class="timer-fill"></span></span>
					<span class="timer-text">vanishes in 24 s</span>
				</div>
			</div>
		</div>
	{:else if kind === 'journal'}
		<div class="mockup-screen journal">
			<div class="screen-chrome">
				<span class="dot" style="background: {accent}"></span>
				<span class="screen-title">VuJournal · sealed</span>
			</div>
			<div class="journal-entry">
				<span class="entry-date">Tue · 7:14 am</span>
				<span class="entry-title">Morning pages</span>
				<span class="entry-line"></span>
				<span class="entry-line short"></span>
				<span class="entry-line"></span>
			</div>
			<div class="journal-entry">
				<span class="entry-date">Mon · 9:02 pm</span>
				<span class="entry-title">Long walk</span>
				<span class="entry-line"></span>
				<span class="entry-line short"></span>
			</div>
		</div>
	{:else if kind === 'tunnel'}
		<div class="mockup-screen tunnel">
			<div class="screen-chrome">
				<span class="dot" style="background: {accent}"></span>
				<span class="screen-title">VuTunnel · zero logs</span>
			</div>
			<svg class="tunnel-svg" viewBox="0 0 240 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<defs>
					<linearGradient id="tunnel-pipe" x1="0" y1="0" x2="1" y2="0">
						<stop offset="0" stop-color={accent} stop-opacity="0.7" />
						<stop offset="1" stop-color={accent} stop-opacity="0.15" />
					</linearGradient>
				</defs>
				<rect x="10" y="40" width="220" height="20" rx="10" fill="url(#tunnel-pipe)" />
				<circle class="tunnel-packet p1" cx="20" cy="50" r="4" fill={accent} />
				<circle class="tunnel-packet p2" cx="60" cy="50" r="4" fill={accent} />
				<circle class="tunnel-packet p3" cx="100" cy="50" r="4" fill={accent} />
				<circle cx="220" cy="50" r="10" fill="none" stroke={accent} stroke-width="2" />
				<text x="120" y="22" text-anchor="middle" fill="currentColor" font-size="9" font-family="monospace">
					encrypted · forward secret
				</text>
			</svg>
		</div>
	{:else if kind === 'ledger'}
		<div class="mockup-screen ledger">
			<div class="screen-chrome">
				<span class="dot" style="background: {accent}"></span>
				<span class="screen-title">VuLedger · books sealed</span>
			</div>
			<div class="ledger-row head">
				<span>Date</span><span>Memo</span><span>Debit</span><span>Credit</span>
			</div>
			<div class="ledger-row">
				<span>04-21</span><span>Studio rent</span><span class="num">—</span><span class="num">1,200</span>
			</div>
			<div class="ledger-row">
				<span>04-22</span><span>Client A</span><span class="num">2,400</span><span class="num">—</span>
			</div>
			<div class="ledger-row">
				<span>04-25</span><span>Software</span><span class="num">—</span><span class="num">96</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.mockup {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		border-radius: var(--radius-lg, 14px);
		padding: 12px;
		background:
			radial-gradient(
				120% 80% at 10% 0%,
				color-mix(in srgb, var(--mockup-accent) 28%, transparent),
				transparent 70%
			),
			linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25));
		border: 1px solid color-mix(in srgb, var(--mockup-accent) 35%, var(--border, rgba(255, 255, 255, 0.12)));
		box-shadow:
			0 18px 40px rgba(0, 0, 0, 0.4),
			0 0 30px color-mix(in srgb, var(--mockup-accent) 18%, transparent);
		overflow: hidden;
	}

	.mockup-screen {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 11px;
		color: var(--text-2, #b8b8b8);
	}

	.screen-chrome {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-bottom: 8px;
		border-bottom: 1px dashed
			color-mix(in srgb, var(--mockup-accent) 30%, var(--border, rgba(255, 255, 255, 0.1)));
		margin-bottom: 6px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		box-shadow: 0 0 8px color-mix(in srgb, var(--mockup-accent) 60%, transparent);
	}
	.screen-title {
		font-family: var(--font-mono, monospace);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: var(--text-3, #888);
	}

	/* ----- VuVault rows ------------------------------------------ */
	.vault-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
	}
	.row-icon {
		width: 22px;
		height: 22px;
		border-radius: 6px;
		display: grid;
		place-items: center;
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		font-weight: 700;
		color: var(--mockup-accent);
		background: color-mix(in srgb, var(--mockup-accent) 18%, transparent);
		flex-shrink: 0;
	}
	.row-text {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.row-name {
		font-size: 11px;
		font-weight: 600;
		color: var(--text, #fff);
	}
	.row-meta {
		font-size: 10px;
		font-family: var(--font-mono, monospace);
		letter-spacing: 0.1em;
		color: var(--text-3, #888);
	}
	.row-pill {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: 2px 6px;
		border-radius: 999px;
		color: var(--mockup-accent);
		background: color-mix(in srgb, var(--mockup-accent) 14%, transparent);
		border: 1px solid color-mix(in srgb, var(--mockup-accent) 35%, transparent);
		flex-shrink: 0;
	}

	/* ----- VuBlink ----------------------------------------------- */
	.blink-frame {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.blink-photo svg {
		width: 100%;
		height: auto;
		border-radius: 8px;
		display: block;
	}
	.blink-timer {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 10px;
		color: var(--text-2, #b8b8b8);
	}
	.timer-bar {
		flex: 1;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		overflow: hidden;
	}
	.timer-fill {
		display: block;
		height: 100%;
		width: 32%;
		background: var(--mockup-accent);
		animation: timer-drain 9s linear infinite;
	}
	@keyframes timer-drain {
		0% {
			width: 100%;
		}
		100% {
			width: 8%;
		}
	}
	.timer-text {
		font-family: var(--font-mono, monospace);
		color: var(--mockup-accent);
	}

	/* ----- VuJournal --------------------------------------------- */
	.journal-entry {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: 8px;
	}
	.entry-date {
		font-family: var(--font-mono, monospace);
		font-size: 9px;
		color: var(--text-3, #888);
	}
	.entry-title {
		font-size: 11px;
		font-weight: 600;
		color: var(--text, #fff);
	}
	.entry-line {
		display: block;
		height: 5px;
		border-radius: 3px;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--mockup-accent) 30%, transparent),
			rgba(255, 255, 255, 0.08)
		);
	}
	.entry-line.short {
		width: 60%;
	}

	/* ----- VuTunnel ---------------------------------------------- */
	.tunnel-svg {
		width: 100%;
		height: auto;
		display: block;
		color: var(--text-3, #888);
	}
	.tunnel-packet {
		animation: tunnel-flow 2.6s linear infinite;
	}
	.tunnel-packet.p2 {
		animation-delay: -0.9s;
	}
	.tunnel-packet.p3 {
		animation-delay: -1.7s;
	}
	@keyframes tunnel-flow {
		0% {
			transform: translateX(0);
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		85% {
			opacity: 1;
		}
		100% {
			transform: translateX(195px);
			opacity: 0;
		}
	}

	/* ----- VuLedger ---------------------------------------------- */
	.ledger-row {
		display: grid;
		grid-template-columns: 0.7fr 1.4fr 0.6fr 0.6fr;
		gap: 6px;
		font-size: 10px;
		padding: 5px 6px;
		border-radius: 6px;
		color: var(--text-2, #b8b8b8);
	}
	.ledger-row.head {
		font-family: var(--font-mono, monospace);
		font-size: 9px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-3, #888);
		border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
	}
	.ledger-row .num {
		font-family: var(--font-mono, monospace);
		text-align: right;
		color: var(--mockup-accent);
	}
	.ledger-row:nth-child(even) {
		background: rgba(255, 255, 255, 0.03);
	}

	@media (prefers-reduced-motion: reduce) {
		.timer-fill,
		.tunnel-packet {
			animation: none !important;
		}
	}
</style>
