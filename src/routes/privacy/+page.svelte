<script lang="ts">
	/**
	 * /privacy — the honest Vu Privacy Level, as a viewport-fitting deck.
	 *
	 * The Cardinal Rule (globals.css) keeps html/body at overflow:hidden,
	 * so a long document here simply got cut off at the first screen.
	 * This page is now five panels that each fit the viewport, paged the
	 * way the landing is: on desktop a translateY track driven by tabs,
	 * keys and wheel; on phones/tablets the `.stage` is a native
	 * scroll-snap scroller (the only thing that scrolls). Dense lists
	 * (evidence, threats) are bounded inside their panel on desktop and
	 * flow naturally in snap mode.
	 */
	import { onMount } from 'svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { IconArrowLeft, IconArrowRight, IconCheck, IconShield, IconTerminal } from '$lib/icons';
	import { viewport } from '$lib/stores/viewport.svelte';
	import {
		PRIVACY_LEVELS,
		EVIDENCE,
		THREATS,
		CURRENT_LEVEL,
		currentLevel,
		evidenceStats,
		type Status
	} from '$lib/data/privacy-level';

	const here = currentLevel();
	const stats = evidenceStats();

	const SECTIONS = [
		{ id: 'level', num: '00', tab: 'Level' },
		{ id: 'ladder', num: '01', tab: 'Ladder' },
		{ id: 'evidence', num: '02', tab: 'Evidence' },
		{ id: 'threats', num: '03', tab: 'Threats' },
		{ id: 'references', num: '04', tab: 'References' }
	] as const;

	let current = $state(0);
	let hydrated = $state(false);
	let stageEl = $state<HTMLElement | null>(null);

	// Phones/tablets hand control to native scroll-snap on .stage, as the
	// landing does: the JS pager fights iOS momentum scrolling.
	const useNativeSnap = $derived(viewport.isMobile || viewport.isTablet);

	function goTo(i: number) {
		const idx = Math.max(0, Math.min(SECTIONS.length - 1, i));
		current = idx;
		const id = SECTIONS[idx]!.id;
		if (useNativeSnap) {
			// Tabs are a jump control: land instantly, so the active-tab
			// observer does not flicker through the panels in between.
			// 'instant' overrides the stage's CSS scroll-behavior: smooth
			// ('auto' would defer to it and animate).
			document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
			return;
		}
		// The panel that held focus is about to go inert; keep focus in the
		// tablist so a keyboard user never lands on <body>.
		queueMicrotask(() =>
			document.getElementById(`tab-${id}`)?.focus({ preventScroll: true })
		);
	}

	/**
	 * Mark a scroller's overflow edges as data attributes so CSS can fade
	 * the edge that still has content behind it (tab strip, bounded lists).
	 */
	function scrollEdges(node: HTMLElement, axis: 'x' | 'y') {
		const update = () => {
			const start = axis === 'x' ? node.scrollLeft : node.scrollTop;
			const max =
				axis === 'x'
					? node.scrollWidth - node.clientWidth
					: node.scrollHeight - node.clientHeight;
			node.dataset.overflowStart = String(start > 1);
			node.dataset.overflowEnd = String(max - start > 1);
		};
		update();
		node.addEventListener('scroll', update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(node);
		const mo = new MutationObserver(update);
		mo.observe(node, { childList: true, subtree: true, characterData: true });
		return {
			destroy() {
				node.removeEventListener('scroll', update);
				ro.disconnect();
				mo.disconnect();
			}
		};
	}
	const next = () => goTo(current + 1);
	const prev = () => goTo(current - 1);

	let wheelLockedUntil = 0;
	function onKeydown(e: KeyboardEvent) {
		if (useNativeSnap) return;
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (['ArrowDown', 'ArrowRight', 'PageDown', 'j', 'J'].includes(e.key)) {
			e.preventDefault();
			next();
		} else if (['ArrowUp', 'ArrowLeft', 'PageUp', 'k', 'K'].includes(e.key)) {
			e.preventDefault();
			prev();
		} else if (e.key === 'Home') {
			e.preventDefault();
			goTo(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			goTo(SECTIONS.length - 1);
		}
	}
	function onWheel(e: WheelEvent) {
		if (useNativeSnap) return;
		const now = performance.now();
		if (now < wheelLockedUntil) return;
		const dy = e.deltaY;
		if (Math.abs(dy) < 12) return;
		// A bounded list inside a panel owns the wheel while it can scroll;
		// tabs and keys page past it.
		const scroller = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-scroll]');
		if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) return;
		wheelLockedUntil = now + 600;
		if (dy > 0) next();
		else prev();
	}

	// Snap mode: keep the active tab in step with what the user scrolled to.
	onMount(() => {
		hydrated = true;
		if (!stageEl || typeof IntersectionObserver === 'undefined') return;
		const slots = [...stageEl.querySelectorAll<HTMLElement>('.slot')];
		const io = new IntersectionObserver(
			(entries) => {
				if (!useNativeSnap) return;
				for (const en of entries) {
					if (en.isIntersecting && en.intersectionRatio >= 0.5) {
						const i = slots.indexOf(en.target as HTMLElement);
						if (i >= 0) current = i;
					}
				}
			},
			{ root: stageEl, threshold: [0.5] }
		);
		for (const s of slots) io.observe(s);
		return () => io.disconnect();
	});

	const trackTransform = $derived(useNativeSnap ? 'none' : `translateY(${-current * 100}%)`);

	// Narrow strips scroll: keep the active tab in view when it changes.
	$effect(() => {
		const id = SECTIONS[current]!.id;
		if (!hydrated) return;
		document
			.getElementById(`tab-${id}`)
			?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' });
	});
	// In snap mode every panel is in flow (and live); on desktop only the
	// current one is reachable — the rest are inert and off the a11y tree.
	const isActive = (i: number) => useNativeSnap || current === i;

	// Ladder: which level's full text is open (defaults to today's).
	let openLevel = $state<number>(CURRENT_LEVEL);
	const openLevelRow = $derived(PRIVACY_LEVELS.find((l) => l.id === openLevel) ?? here);

	// Evidence: status filter.
	let filter = $state<'all' | Status>('all');
	const filtered = $derived(filter === 'all' ? EVIDENCE : EVIDENCE.filter((r) => r.status === filter));
	const statusLabel = (s: Status) => (s === 'shipped' ? 'Shipped' : s === 'partial' ? 'Partial' : 'Pending');
	const filterLabel = $derived(filter === 'all' ? 'matching' : statusLabel(filter).toLowerCase());
	const defendedCount = THREATS.filter((t) => t.defended).length;
</script>

<svelte:head>
	<title>Privacy level — VuVault</title>
	<meta
		name="description"
		content="Honest, code-tied snapshot of the privacy guarantees VuVault holds today, what is partial, and what is still pending."
	/>
</svelte:head>

<svelte:window onkeydown={onKeydown} onwheel={onWheel} />

<div class="page" data-hydrated={hydrated}>
	<header class="topbar">
		<a class="back" href="/" aria-label="Back to landing">
			<IconArrowLeft size={14} stroke={2} />
		</a>
		<BrandMark showPill="Privacy" />
		<div class="right">
			<ThemeToggle />
		</div>
	</header>

	<div class="tabs" aria-label="Privacy sections" role="tablist" use:scrollEdges={'x'}>
		{#each SECTIONS as s, i (s.id)}
			<button
				class="tab"
				class:active={current === i}
				role="tab"
				id={`tab-${s.id}`}
				aria-selected={current === i}
				aria-controls={s.id}
				tabindex={current === i ? 0 : -1}
				onclick={() => goTo(i)}
			>
				<span class="tab-num">{s.num}</span>
				<span class="tab-label">{s.tab}</span>
			</button>
		{/each}
		<div class="tabs-hint" aria-hidden="true">J / K · ↑ ↓</div>
	</div>

	<main class="stage" class:native-snap={useNativeSnap} bind:this={stageEl} aria-label="Privacy level">
		<div class="track" style:transform={trackTransform}>
			<!-- 00 · Level ------------------------------------------------ -->
			<div
				id="level"
				class="slot"
				role="tabpanel"
				aria-labelledby="tab-level"
				aria-hidden={!isActive(0)}
				inert={!isActive(0)}
			>
				<div class="panel hero">
					<Eyebrow accent>Vu Privacy Level · honest snapshot</Eyebrow>
					<h1>
						<span class="badge-large" data-testid="privacy-level-current">Vu Level {CURRENT_LEVEL}</span>
						<span class="italic-serif">{here.headline}.</span>
					</h1>
					<p class="lede">
						The truth source for every privacy claim the app makes. The badge in the audit
						footer reads from the same data module, and a regression test fails CI if the
						in-app claim drifts from the shipped reality.
					</p>
					<div class="hero-grid">
						<div class="counters" data-testid="evidence-counters" role="group" aria-label="Evidence counts">
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
						<div class="holds">
							<div class="holds-head">
								<IconShield size={12} stroke={2} />
								What holds today · {here.when}
							</div>
							<p class="holds-body">{here.summary}</p>
							<button class="holds-more" onclick={() => goTo(1)}>
								Full text in the ladder <IconArrowRight size={11} stroke={2.2} />
							</button>
						</div>
					</div>
					<div class="cta-row">
						<button class="lbtn primary" onclick={() => goTo(1)}>
							Read the ladder <IconArrowRight size={13} stroke={2.2} />
						</button>
						<button class="lbtn" onclick={() => goTo(2)}>Evidence map</button>
						<button class="lbtn" onclick={() => goTo(3)}>Threat model</button>
					</div>
				</div>
			</div>

			<!-- 01 · Ladder ----------------------------------------------- -->
			<div
				id="ladder"
				class="slot"
				role="tabpanel"
				aria-labelledby="tab-ladder"
				aria-hidden={!isActive(1)}
				inert={!isActive(1)}
			>
				<div class="panel">
					<header class="sect-head">
						<div class="sect-num">§ 01 — The Vu Privacy ladder</div>
						<h2 class="sect-title">Five levels, exhaustively defined.</h2>
						<p class="sect-sub">
							Lower is stronger. A level is promoted only when every claim in its evidence
							table has shipped and is exercised by a test. Pick a level to read it.
						</p>
					</header>
					<div class="ladder-strip" role="group" aria-label="Privacy levels">
						{#each PRIVACY_LEVELS as lvl (lvl.id)}
							<button
								class="lvl"
								class:lvl-current={lvl.id === CURRENT_LEVEL}
								class:lvl-open={lvl.id === openLevel}
								data-testid={`privacy-level-${lvl.id}`}
								aria-pressed={lvl.id === openLevel}
								onclick={() => (openLevel = lvl.id)}
							>
								<div class="lvl-id">{lvl.short}</div>
								<div class="lvl-headline">{lvl.headline}</div>
								{#if lvl.id === CURRENT_LEVEL}
									<div class="lvl-marker">Shipped today</div>
								{:else}
									<div class="lvl-when">{lvl.when}</div>
								{/if}
							</button>
						{/each}
					</div>
					<article class="lvl-detail" aria-live="polite">
						<div class="lvl-detail-head">
							<span class="lvl-detail-id" class:is-current={openLevelRow.id === CURRENT_LEVEL}
								>{openLevelRow.short}</span
							>
							<span class="lvl-detail-headline">{openLevelRow.headline}</span>
							<span class="lvl-detail-when">{openLevelRow.when}</span>
						</div>
						<p class="lvl-detail-summary" data-scroll use:scrollEdges={'y'}>{openLevelRow.summary}</p>
					</article>
				</div>
			</div>

			<!-- 02 · Evidence --------------------------------------------- -->
			<div
				id="evidence"
				class="slot"
				role="tabpanel"
				aria-labelledby="tab-evidence"
				aria-hidden={!isActive(2)}
				inert={!isActive(2)}
			>
				<div class="panel">
					<header class="sect-head compact">
						<div class="sect-num">§ 02 — Evidence map</div>
						<h2 class="sect-title">Every claim points to code.</h2>
						<p class="sect-sub">
							Each row links a claim to the file that substantiates it, or the milestone that
							will. If the file moves, the row moves in the same commit.
						</p>
					</header>
					<div class="chips" role="group" aria-label="Filter by status">
						<button class="chip" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
							All <span class="chip-n">{EVIDENCE.length}</span>
						</button>
						<button
							class="chip chip-shipped"
							class:active={filter === 'shipped'}
							onclick={() => (filter = 'shipped')}
						>
							Shipped <span class="chip-n">{stats.shipped}</span>
						</button>
						<button
							class="chip chip-partial"
							class:active={filter === 'partial'}
							onclick={() => (filter = 'partial')}
						>
							Partial <span class="chip-n">{stats.partial}</span>
						</button>
						<button
							class="chip chip-pending"
							class:active={filter === 'pending'}
							onclick={() => (filter = 'pending')}
						>
							Pending <span class="chip-n">{stats.pending}</span>
						</button>
					</div>
					<div class="list evidence-list" data-scroll data-testid="evidence-list" use:scrollEdges={'y'}>
						{#if filtered.length === 0}
							<div class="empty">
								No {filterLabel} claims. Nothing on this page sits in that state today.
							</div>
						{/if}
						{#each filtered as row (row.id)}
							<article class="ev">
								<div class="ev-id">{row.id}</div>
								<div class="ev-body">
									<div class="ev-claim">{row.claim}</div>
									<div class="ev-evidence"><IconTerminal size={10} stroke={2} />{row.evidence}</div>
								</div>
								<div class="pill status-{row.status}">{statusLabel(row.status)}</div>
							</article>
						{/each}
					</div>
				</div>
			</div>

			<!-- 03 · Threats ---------------------------------------------- -->
			<div
				id="threats"
				class="slot"
				role="tabpanel"
				aria-labelledby="tab-threats"
				aria-hidden={!isActive(3)}
				inert={!isActive(3)}
			>
				<div class="panel">
					<header class="sect-head compact">
						<div class="sect-num">§ 03 — Threat model · {defendedCount} defended · {THREATS.length - defendedCount} out of scope</div>
						<h2 class="sect-title">What we defend against, and what we don't.</h2>
						<p class="sect-sub">
							Cryptography does not solve consent and cannot defeat persistent endpoint
							malware. These limits are deliberate and stated up front.
						</p>
					</header>
					<div class="list threat-grid" data-scroll use:scrollEdges={'y'}>
						{#each THREATS as t (t.id)}
							<article class="threat" class:threat-undef={!t.defended}>
								<div class="threat-top">
									<span class="threat-id">{t.id}</span>
									<span class="pill" class:flag-good={t.defended} class:flag-out={!t.defended}>
										{#if t.defended}<IconCheck size={10} stroke={2.5} />{/if}
										{t.defended ? 'Defended' : 'Out of scope'}
									</span>
								</div>
								<div class="threat-name">{t.threat}</div>
								<div class="threat-how">{t.how}</div>
							</article>
						{/each}
					</div>
				</div>
			</div>

			<!-- 04 · References ------------------------------------------- -->
			<div
				id="references"
				class="slot"
				role="tabpanel"
				aria-labelledby="tab-references"
				aria-hidden={!isActive(4)}
				inert={!isActive(4)}
			>
				<div class="panel">
					<header class="sect-head">
						<div class="sect-num">§ 04 — References</div>
						<h2 class="sect-title">Read more, verify yourself.</h2>
						<p class="sect-sub">
							This page is generated from <code>src/lib/data/privacy-level.ts</code>. The deeper
							companions live in the repository:
						</p>
					</header>
					<ul class="refs">
						<li>
							<strong>docs/PRIVACY-LEVEL.md</strong>
							<span>Long-form expansion of this page, with citations and dated change notes.</span>
						</li>
						<li>
							<strong>docs/SECURITY.md</strong>
							<span>Explicit zero-knowledge scope, threat model, and bug-bounty range.</span>
						</li>
						<li>
							<strong>docs/ARCHITECTURE.md</strong>
							<span>The 18-layer stack, four shipping tiers, and what each layer defends against.</span>
						</li>
						<li>
							<strong>docs/ROADMAP.md</strong>
							<span>What is shipped today, what is pending, and when each piece is targeted.</span>
						</li>
						<li>
							<strong>tests/e2e/full-workflow.spec.ts</strong>
							<span>Inspects IndexedDB programmatically to assert no plaintext leaks past the encryption boundary.</span>
						</li>
					</ul>
					<div class="cta-row">
						<a class="lbtn primary" href="/onboarding">Set up a vault <IconArrowRight size={13} stroke={2.2} /></a>
						<a class="lbtn" href="/">Back to landing</a>
					</div>
				</div>
			</div>
		</div>
	</main>
</div>

<style>
	/* ---------- shell: fixed to the viewport, only .stage scrolls -------- */
	.page {
		height: 100dvh;
		display: grid;
		grid-template-rows: calc(var(--header-h) + var(--safe-top, 0px)) auto minmax(0, 1fr);
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

	/* ---------- section tabs ---------- */
	.tabs {
		display: flex;
		align-items: stretch;
		gap: 2px;
		padding: 0 max(16px, env(safe-area-inset-left, 0px)) 0 max(16px, env(safe-area-inset-left, 0px));
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		overflow-x: auto;
		scrollbar-width: none;
		z-index: 9;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 0 14px;
		min-height: 44px;
		border: none;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: var(--text-3);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: -0.005em;
		white-space: nowrap;
		cursor: pointer;
		transition: var(--transition);
	}
	.tab:hover {
		color: var(--text-2);
	}
	.tab.active {
		color: var(--text);
		border-bottom-color: var(--accent);
	}
	.tab-num {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: var(--text-4);
	}
	.tab.active .tab-num {
		color: var(--accent);
	}
	.tabs-hint {
		margin-left: auto;
		align-self: center;
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.08em;
		color: var(--text-3);
		white-space: nowrap;
		padding-left: 12px;
	}
	/* Fade the edge of the strip that still has tabs behind it. */
	.tabs:global([data-overflow-end='true']) {
		mask-image: linear-gradient(to right, black calc(100% - 40px), transparent);
		-webkit-mask-image: linear-gradient(to right, black calc(100% - 40px), transparent);
	}
	.tabs:global([data-overflow-start='true']) {
		mask-image: linear-gradient(to right, transparent, black 32px);
		-webkit-mask-image: linear-gradient(to right, transparent, black 32px);
	}
	.tabs:global([data-overflow-start='true'][data-overflow-end='true']) {
		mask-image: linear-gradient(to right, transparent, black 32px, black calc(100% - 40px), transparent);
		-webkit-mask-image: linear-gradient(to right, transparent, black 32px, black calc(100% - 40px), transparent);
	}
	@media (max-width: 64em) {
		.tabs-hint {
			display: none;
		}
	}

	/* ---------- stage / track / slots ---------- */
	.stage {
		position: relative;
		min-height: 0;
		overflow: hidden;
	}
	.track {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		transition: transform var(--transition-slow);
		will-change: transform;
	}
	.slot {
		flex: 0 0 100%;
		height: 100%;
		width: 100%;
		position: relative;
		min-height: 0;
	}
	.stage.native-snap {
		overflow-y: auto;
		scroll-snap-type: y proximity;
		-webkit-overflow-scrolling: touch;
		scroll-behavior: smooth;
		overscroll-behavior-y: contain;
	}
	.stage.native-snap .track {
		position: static;
		inset: auto;
		transition: none;
		will-change: auto;
	}
	.stage.native-snap .slot {
		flex: 0 0 auto;
		height: auto;
		min-height: 100%;
		scroll-snap-align: start;
		scroll-snap-stop: normal;
	}
	.stage.native-snap .slot[inert] {
		pointer-events: auto;
	}
	@media (prefers-reduced-motion: reduce) {
		.track {
			transition: none;
		}
		.stage.native-snap {
			scroll-behavior: auto;
		}
	}

	/* ---------- panel: fits its slot ---------- */
	.panel {
		height: 100%;
		max-width: 1040px;
		margin: 0 auto;
		padding: 28px max(24px, env(safe-area-inset-right, 0px)) 28px max(24px, env(safe-area-inset-left, 0px));
		display: flex;
		flex-direction: column;
		gap: 18px;
		min-height: 0;
	}
	.panel > :global(.eyebrow) {
		align-self: flex-start;
	}
	.stage.native-snap .panel {
		height: auto;
		padding-top: 24px;
		padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px));
	}
	.list {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: var(--border-mid) transparent;
		padding-right: 2px;
	}
	/* A bounded list with more rows below fades out instead of cutting a
	   row in half at the panel edge. */
	.list:global([data-overflow-end='true']),
	.lvl-detail-summary:global([data-overflow-end='true']) {
		mask-image: linear-gradient(to bottom, black calc(100% - 36px), transparent);
		-webkit-mask-image: linear-gradient(to bottom, black calc(100% - 36px), transparent);
	}
	.stage.native-snap .list {
		overflow: visible;
		mask-image: none;
		-webkit-mask-image: none;
	}

	/* ---------- hero ---------- */
	.hero {
		justify-content: center;
	}
	.hero h1 {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0;
		font-size: clamp(26px, 3.6vw, 42px);
		line-height: 1.1;
		color: var(--text);
	}
	.hero .italic-serif {
		font-family: var(--font-serif);
		font-style: italic;
		font-weight: 400;
		color: var(--text-2);
	}
	.lede {
		max-width: 66ch;
		font-size: 14px;
		line-height: 1.55;
		color: var(--text-2);
	}
	.badge-large {
		display: inline-block;
		align-self: flex-start;
		padding: 7px 14px;
		font-family: var(--font-mono);
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
		border-radius: var(--radius);
	}
	.hero-grid {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}
	.counters {
		display: grid;
		grid-template-columns: repeat(3, auto);
		gap: 10px;
	}
	.counter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-width: 84px;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 26px;
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
	.holds {
		padding: 14px 16px;
		background: color-mix(in srgb, var(--accent) 4%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
		border-radius: var(--radius);
		min-width: 0;
	}
	.holds-head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
		margin-bottom: 8px;
	}
	.holds-body {
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-2);
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 7;
		line-clamp: 7;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.holds-more {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-top: 10px;
		padding: 0;
		font-family: var(--font-mono);
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--accent);
		cursor: pointer;
		transition: var(--transition);
	}
	.holds-more:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.cta-row {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.lbtn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 9px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text);
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		transition: var(--transition);
		white-space: nowrap;
		cursor: pointer;
		text-decoration: none;
	}
	.lbtn:hover {
		background: var(--surface-hover);
		border-color: var(--border-mid);
	}
	.lbtn.primary {
		background: var(--brand);
		color: var(--bg);
		border-color: var(--brand);
		font-weight: 700;
	}
	@media (pointer: coarse) {
		.lbtn {
			min-height: 44px;
		}
	}

	/* ---------- section heads ---------- */
	.sect-head {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sect-num {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.sect-title {
		font-size: clamp(22px, 2.6vw, 30px);
		line-height: 1.15;
		margin: 0;
		color: var(--text);
		letter-spacing: -0.02em;
	}
	.sect-sub {
		max-width: 70ch;
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--text-2);
		margin: 0;
	}
	.sect-head.compact .sect-sub {
		font-size: 13px;
	}

	/* ---------- ladder ---------- */
	.ladder-strip {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 8px;
	}
	.lvl {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 12px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		text-align: left;
		font: inherit;
		color: inherit;
		cursor: pointer;
		transition: var(--transition);
		min-width: 0;
	}
	.lvl:hover {
		border-color: var(--border-mid);
		background: var(--surface-hover);
	}
	.lvl-open {
		border-color: var(--text-3);
	}
	.lvl-current {
		background: color-mix(in srgb, var(--accent) 4%, var(--surface));
	}
	.lvl-current.lvl-open {
		border-color: color-mix(in srgb, var(--accent) 60%, transparent);
	}
	.lvl-id {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.lvl-current .lvl-id {
		color: var(--accent);
	}
	.lvl-headline {
		font-size: 13px;
		font-weight: 600;
		line-height: 1.3;
		color: var(--text);
	}
	.lvl-when {
		font-family: var(--font-mono);
		font-size: 10px;
		line-height: 1.45;
		color: var(--text-3);
		letter-spacing: 0.04em;
	}
	.lvl-marker,
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}
	.lvl-marker {
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
	}
	.lvl-detail {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		min-height: 0;
	}
	.lvl-detail-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}
	.lvl-detail-id {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.lvl-detail-id.is-current {
		color: var(--accent);
	}
	.lvl-detail-headline {
		font-size: 16px;
		font-weight: 600;
		color: var(--text);
	}
	.lvl-detail-when {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}
	.lvl-detail-summary {
		margin: 0;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--text-2);
		min-height: 0;
		overflow-y: auto;
	}

	/* ---------- evidence ---------- */
	.chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		cursor: pointer;
		transition: var(--transition);
	}
	.chip:hover {
		border-color: var(--border-mid);
		color: var(--text);
	}
	.chip.active {
		color: var(--text);
		border-color: var(--text-3);
	}
	.chip-shipped.active {
		color: var(--success);
		border-color: color-mix(in srgb, var(--success) 45%, transparent);
	}
	.chip-partial.active {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 45%, transparent);
	}
	.chip-n {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
	}
	.evidence-list {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		align-content: start;
	}
	.empty {
		grid-column: 1 / -1;
		padding: 18px 16px;
		font-size: 13px;
		color: var(--text-3);
		border: 1px dashed var(--border-mid);
		border-radius: var(--radius-sm);
	}
	.ev {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr) auto;
		gap: 10px;
		align-items: start;
		padding: 10px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.ev-id {
		font-family: var(--font-mono);
		font-size: 10.5px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.06em;
		padding-top: 2px;
	}
	.ev-body {
		min-width: 0;
	}
	.ev-claim {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.4;
		color: var(--text);
		margin-bottom: 4px;
	}
	.ev-evidence {
		display: flex;
		gap: 5px;
		align-items: flex-start;
		font-family: var(--font-mono);
		font-size: 10.5px;
		color: var(--text-3);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.ev-evidence :global(svg) {
		flex: none;
		margin-top: 3px;
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

	/* ---------- threats ---------- */
	.threat-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		align-content: start;
	}
	.threat {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 10px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		min-width: 0;
	}
	.threat-undef {
		border-style: dashed;
	}
	.threat-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.threat-id {
		font-family: var(--font-mono);
		font-size: 10.5px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}
	.threat-name {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.35;
		color: var(--text);
	}
	.threat-how {
		font-size: 12px;
		color: var(--text-2);
		line-height: 1.45;
	}
	.pill.flag-good {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 12%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 35%, transparent);
	}
	.pill.flag-out {
		color: var(--text-3);
		background: var(--surface);
		border: 1px solid var(--border);
	}

	/* ---------- references ---------- */
	.refs {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
		padding: 0;
		margin: 0;
		list-style: none;
	}
	.refs li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.refs strong {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	code {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--accent);
	}

	/* ---------- short viewports (laptops, landscape phones) ---------- */
	@media (max-height: 44em) {
		.panel {
			padding-top: 16px;
			padding-bottom: 16px;
			gap: 12px;
		}
		.lede,
		.sect-sub {
			display: none;
		}
		.hero h1 {
			font-size: clamp(22px, 3vw, 32px);
		}
		.holds-body {
			-webkit-line-clamp: 4;
			line-clamp: 4;
		}
		.stage.native-snap .lede,
		.stage.native-snap .sect-sub {
			display: block;
		}
	}

	/* ---------- narrow viewports ---------- */
	@media (max-width: 64em) {
		.hero-grid {
			grid-template-columns: 1fr;
		}
		.counters {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.ladder-strip {
			grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		}
		.evidence-list,
		.threat-grid,
		.refs {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 45em) {
		.panel {
			padding-left: max(16px, env(safe-area-inset-left, 0px));
			padding-right: max(16px, env(safe-area-inset-right, 0px));
		}
		.ladder-strip {
			display: flex;
			gap: 8px;
			overflow-x: auto;
			scroll-snap-type: x proximity;
			scroll-padding-inline: 16px;
			scrollbar-width: none;
			margin: 0 -16px;
			padding: 0 16px 4px;
		}
		.ladder-strip::-webkit-scrollbar {
			display: none;
		}
		.lvl {
			flex: 0 0 68%;
			scroll-snap-align: start;
		}
		.tab {
			padding: 0 12px;
		}
	}
	@media (max-width: 30em) {
		.ev {
			grid-template-columns: 34px minmax(0, 1fr) auto;
			gap: 8px;
		}
		.counter {
			min-width: 0;
			padding: 10px 12px;
		}
	}
</style>
