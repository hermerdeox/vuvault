<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { IconClose, IconArrowLeft, IconShield, IconCheck } from '$lib/icons';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { enabledApps } from '$lib/stores/enabled-apps.svelte';
	import VuEcosystemMockup from '$lib/components/VuEcosystemMockup.svelte';
	import {
		VU_ECOSYSTEM_CATEGORIES,
		statusLabel,
		findCategoryOf,
		type EcosystemApp,
		type EcosystemCategory
	} from '$lib/data/vu-ecosystem';

	/**
	 * Global Vu Ecosystem launcher.
	 *
	 * Behaviors:
	 *   - Floating bottom-left button. Label is `Vu Ecosystem` when
	 *     closed and `vuteletransport` when the panel is open.
	 *   - Desktop / tablet: a fixed left-side drawer slides in.
	 *   - Mobile: the panel becomes full-viewport, scrollable.
	 *   - Header carries a colorful category strip; cards inherit
	 *     per-category gradients and accent borders.
	 *   - Apps with `mockup` (VuVault + Shipping Next) expose an
	 *     Enable button on their detail view that plays a 1.2s
	 *     cinematic animation, persists `enabled` to localStorage,
	 *     and reveals an inline mockup. Re-opening that app skips
	 *     the animation and shows the mockup straight away.
	 */

	let open = $state(false);
	let selectedAppName = $state<string | null>(null);
	let activeCategoryId = $state<string | null>(null);
	let triggerEl: HTMLButtonElement | null = $state(null);
	let panelEl: HTMLDivElement | null = $state(null);

	// Activation state for the cinematic Enable animation.
	let activating = $state(false);
	let activatedJustNow = $state(false);

	const selected = $derived<EcosystemApp | null>(
		selectedAppName ? (findApp(selectedAppName) ?? null) : null
	);
	const selectedCategory = $derived<EcosystemCategory | null>(
		selectedAppName ? (findCategoryOf(selectedAppName) ?? null) : null
	);
	const buttonLabel = $derived(open ? 'vuteletransport' : 'Vu Ecosystem');
	const isSelectedEnabled = $derived(
		selected ? enabledApps.has(selected.name) : false
	);
	const visibleCategories = $derived<readonly EcosystemCategory[]>(
		activeCategoryId
			? VU_ECOSYSTEM_CATEGORIES.filter((c) => c.id === activeCategoryId)
			: VU_ECOSYSTEM_CATEGORIES
	);

	function findApp(name: string): EcosystemApp | undefined {
		for (const cat of VU_ECOSYSTEM_CATEGORIES) {
			const hit = cat.apps.find((a) => a.name === name);
			if (hit) return hit;
		}
		return undefined;
	}

	function toggleOpen(): void {
		if (open) {
			close();
		} else {
			open = true;
			selectedAppName = null;
			activeCategoryId = null;
			queueFocusInsidePanel();
		}
	}

	function close(): void {
		open = false;
		selectedAppName = null;
		activeCategoryId = null;
		activating = false;
		activatedJustNow = false;
		queueMicrotask(() => triggerEl?.focus());
	}

	function selectApp(name: string): void {
		selectedAppName = name;
		activatedJustNow = false;
		activating = false;
		queueFocusInsidePanel();
	}

	function backToGrid(): void {
		selectedAppName = null;
		activating = false;
		activatedJustNow = false;
		queueFocusInsidePanel();
	}

	function selectCategory(id: string | null): void {
		activeCategoryId = id;
	}

	function queueFocusInsidePanel(): void {
		queueMicrotask(() => {
			panelEl?.focus();
		});
	}

	/**
	 * Cinematic Enable sequence:
	 *   t=0      Enable pressed → activating=true, shield lock animation
	 *   t=400ms  shield "unlocks", particle ring fires
	 *   t=900ms  persisted to localStorage
	 *   t=1200ms activating=false, mockup container slides in
	 *
	 * Reduced-motion users skip the visual sequence; the persistence
	 * + state flip still happen so the mockup reveals.
	 */
	function enableSelected(): void {
		if (!selected || isSelectedEnabled || activating) return;
		const name = selected.name;
		const prefersReduced =
			browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (prefersReduced) {
			enabledApps.enable(name);
			activatedJustNow = true;
			return;
		}

		activating = true;
		// Persist near the climax of the animation so a fast click-away
		// can't desync the visual state from the storage write.
		setTimeout(() => {
			enabledApps.enable(name);
		}, 900);
		setTimeout(() => {
			activating = false;
			activatedJustNow = true;
		}, 1200);
	}

	function onKeydown(e: KeyboardEvent): void {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			if (activating) return;
			close();
			return;
		}
		if (e.key === 'Tab' && panelEl) {
			const focusable = panelEl.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])'
			);
			if (focusable.length === 0) return;
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	function onBackdropClick(e: MouseEvent): void {
		if (e.target === e.currentTarget && !activating) close();
	}

	$effect(() => {
		if (!browser) return;
		if (open) {
			const prev = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = prev;
			};
		}
	});

	onMount(() => {
		void viewport.isMobile;
	});
</script>

<svelte:window onkeydown={onKeydown} />

<button
	bind:this={triggerEl}
	type="button"
	class="trigger"
	class:is-open={open}
	aria-expanded={open}
	aria-controls="vu-ecosystem-panel"
	data-testid="vu-ecosystem-trigger"
	onclick={toggleOpen}
>
	<span class="trigger-dot" aria-hidden="true"></span>
	<span class="trigger-label">{buttonLabel}</span>
</button>

{#if open}
	<div class="backdrop" onclick={onBackdropClick} role="presentation">
		<div
			bind:this={panelEl}
			id="vu-ecosystem-panel"
			class="panel"
			class:is-mobile={viewport.isMobile}
			role="dialog"
			aria-modal="true"
			aria-label="Vu Ecosystem app launcher"
			tabindex="-1"
			data-testid="vu-ecosystem-panel"
		>
			<header class="head">
				<div class="head-left">
					{#if selected && selectedCategory}
						<button
							type="button"
							class="icon-btn"
							onclick={backToGrid}
							aria-label="Back to ecosystem grid"
							data-testid="vu-ecosystem-back"
						>
							<IconArrowLeft size={18} stroke={1.8} />
						</button>
						<div class="head-titles">
							<span
								class="head-eyebrow"
								style="color: {selectedCategory.color.accent}"
							>
								{selectedCategory.label}
							</span>
							<h2 class="head-title">{selected.name}</h2>
						</div>
					{:else}
						<div class="head-titles">
							<span class="head-eyebrow gradient-text">Vu Ecosystem</span>
							<h2 class="head-title">Apps that share the vault's trust floor</h2>
						</div>
					{/if}
				</div>
				<button
					type="button"
					class="icon-btn"
					onclick={close}
					aria-label="Close ecosystem launcher"
					data-testid="vu-ecosystem-close"
				>
					<IconClose size={18} stroke={1.8} />
				</button>
			</header>

			{#if !selected}
				<nav
					class="category-strip"
					aria-label="Filter by category"
					data-testid="vu-ecosystem-strip"
				>
					<button
						type="button"
						class="chip"
						class:active={activeCategoryId === null}
						onclick={() => selectCategory(null)}
						data-testid="vu-eco-chip-all"
					>
						<span class="chip-glyph" aria-hidden="true">All</span>
						<span class="chip-label">All</span>
					</button>
					{#each VU_ECOSYSTEM_CATEGORIES as cat (cat.id)}
						<button
							type="button"
							class="chip"
							class:active={activeCategoryId === cat.id}
							onclick={() => selectCategory(cat.id)}
							data-testid={`vu-eco-chip-${cat.id}`}
							style="
								--chip-accent: {cat.color.accent};
								--chip-from: {cat.color.from};
								--chip-to: {cat.color.to};
							"
						>
							<span class="chip-glyph" aria-hidden="true">{cat.glyph}</span>
							<span class="chip-label">{cat.label}</span>
						</button>
					{/each}
				</nav>
			{/if}

			<div class="body" class:no-scroll={activating}>
				{#if selected && selectedCategory}
					<section
						class="detail"
						data-testid="vu-ecosystem-detail"
						style="
							--detail-accent: {selectedCategory.color.accent};
							--detail-from: {selectedCategory.color.from};
							--detail-to: {selectedCategory.color.to};
							--detail-halo: {selectedCategory.color.halo};
						"
					>
						<div class="detail-status">
							<span class="badge badge-{selected.status}">
								{statusLabel(selected.status)}
							</span>
							<span class="category-tag" style="color: {selectedCategory.color.accent}">
								{selectedCategory.label}
							</span>
							{#if isSelectedEnabled}
								<span class="enabled-pill" data-testid="vu-eco-enabled-pill">
									<IconCheck size={11} stroke={2.2} /> Enabled locally
								</span>
							{/if}
						</div>
						<p class="detail-tagline">{selected.tagline}</p>
						<p class="detail-promise">{selected.promise}</p>
						<div class="detail-promise-row">
							<IconShield size={16} stroke={1.6} />
							<span>
								Inherits the VuVault trust floor: passkey-gated, on-device crypto,
								zero-knowledge sync.
							</span>
						</div>

						{#if selected.mockup}
							<div
								class="enable-zone"
								class:is-active={activating}
								class:is-enabled={isSelectedEnabled || activatedJustNow}
							>
								{#if isSelectedEnabled || activatedJustNow}
									<div
										class="mockup-wrap"
										class:just-revealed={activatedJustNow}
										data-testid="vu-eco-mockup"
									>
										<VuEcosystemMockup
											kind={selected.mockup}
											accent={selectedCategory.color.accent}
										/>
									</div>
								{:else}
									<div class="enable-card">
										<div class="enable-shield" aria-hidden="true" class:cracking={activating}>
											<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
												<defs>
													<radialGradient id="shield-fill" cx="50%" cy="35%" r="65%">
														<stop offset="0" stop-color={selectedCategory.color.accent} stop-opacity="0.9" />
														<stop offset="1" stop-color={selectedCategory.color.accent} stop-opacity="0.05" />
													</radialGradient>
												</defs>
												<path
													class="shield-path"
													d="M32 5 L56 14 L56 30 C56 46 44 56 32 60 C20 56 8 46 8 30 L8 14 Z"
													fill="url(#shield-fill)"
													stroke={selectedCategory.color.accent}
													stroke-width="2"
												/>
												<path
													class="shield-key"
													d="M22 32 L30 40 L44 24"
													stroke={selectedCategory.color.accent}
													stroke-width="3"
													stroke-linecap="round"
													stroke-linejoin="round"
													fill="none"
												/>
											</svg>
											<span class="particles" aria-hidden="true">
												<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
											</span>
										</div>
										<div class="enable-copy">
											<span class="enable-title">Preview {selected.name}</span>
											<span class="enable-sub">
												Local preview only — no account, no upload, no email needed.
											</span>
										</div>
										<button
											type="button"
											class="enable-btn"
											onclick={enableSelected}
											disabled={activating}
											aria-busy={activating}
											data-testid="vu-eco-enable"
										>
											{activating ? 'Initializing…' : `Enable ${selected.name}`}
										</button>
									</div>
								{/if}
							</div>
						{/if}

						{#if selected.status === 'available' && selected.name === 'VuVault'}
							<div class="detail-cta">
								<a class="cta-link" href="/" data-sveltekit-reload>Open VuVault landing</a>
								<a class="cta-link subtle" href="/blueprint">Read the architecture blueprint</a>
							</div>
						{/if}
						<button type="button" class="back-link" onclick={backToGrid}>
							<IconArrowLeft size={14} stroke={1.8} />
							Back to ecosystem
						</button>
					</section>
				{:else}
					<p class="intro">
						The Vu Ecosystem is a single privacy contract applied across daily tools.
						VuVault is shipping today; everything else either ships next or is in
						active design — no telemetry, no third-party trackers, no plaintext
						uploads.
					</p>
					{#each visibleCategories as category (category.id)}
						<section
							class="category"
							aria-labelledby={`vu-eco-cat-${category.id}`}
							style="
								--cat-accent: {category.color.accent};
								--cat-from: {category.color.from};
								--cat-to: {category.color.to};
								--cat-halo: {category.color.halo};
							"
						>
							<div class="category-head">
								<h3 id={`vu-eco-cat-${category.id}`} class="category-label">
									<span class="category-bullet" aria-hidden="true"></span>
									{category.label}
								</h3>
								<p class="category-desc">{category.description}</p>
							</div>
							<div class="grid">
								{#each category.apps as app (app.name)}
									<button
										type="button"
										class="card"
										class:has-mockup={app.mockup !== undefined}
										class:is-enabled={enabledApps.has(app.name)}
										onclick={() => selectApp(app.name)}
										data-app={app.name}
										data-testid={`vu-eco-card-${app.name}`}
									>
										<span class="card-name">{app.name}</span>
										<span class="card-tagline">{app.tagline}</span>
										<span class="card-bottom">
											<span class="card-badge badge badge-{app.status}">
												{statusLabel(app.status)}
											</span>
											{#if enabledApps.has(app.name)}
												<span class="card-enabled" aria-label="Enabled">
													<IconCheck size={10} stroke={2.4} />
												</span>
											{/if}
										</span>
									</button>
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ----- Floating trigger ---------------------------------------- */
	.trigger {
		position: fixed;
		left: max(16px, env(safe-area-inset-left));
		bottom: max(16px, env(safe-area-inset-bottom));
		z-index: 90;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 16px;
		border-radius: 999px;
		background: var(--bg-elev, #0a0a0a);
		color: var(--text, #ffffff);
		border: 1px solid var(--border, rgba(255, 255, 255, 0.16));
		box-shadow: var(--shadow-card, 0 24px 60px rgba(0, 0, 0, 0.6));
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		min-height: 44px;
	}
	.trigger:hover {
		background: var(--surface-hover, rgba(255, 255, 255, 0.07));
		border-color: var(--border-strong, rgba(255, 255, 255, 0.22));
	}
	.trigger:focus-visible {
		outline: 2px solid var(--accent, #00d4ff);
		outline-offset: 3px;
	}
	.trigger.is-open {
		color: var(--accent, #00d4ff);
		border-color: color-mix(in srgb, var(--accent, #00d4ff) 50%, transparent);
	}
	.trigger-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent, #00d4ff);
		box-shadow: 0 0 8px color-mix(in srgb, var(--accent, #00d4ff) 60%, transparent);
		flex-shrink: 0;
	}
	.trigger-label {
		white-space: nowrap;
	}

	/* ----- Backdrop + panel --------------------------------------- */
	.backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg, #000) 60%, transparent);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		z-index: 95;
		display: flex;
		align-items: stretch;
		justify-content: flex-start;
	}
	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		width: min(460px, 92vw);
		height: 100dvh;
		background:
			radial-gradient(120% 60% at 0% 0%, rgba(125, 211, 252, 0.08), transparent 60%),
			radial-gradient(120% 60% at 100% 100%, rgba(240, 171, 252, 0.06), transparent 60%),
			var(--bg-elev, #0a0a0a);
		border-right: 1px solid var(--border, rgba(255, 255, 255, 0.12));
		box-shadow: var(--shadow-modal, 0 30px 80px rgba(0, 0, 0, 0.7));
		outline: none;
		animation: slide-in 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
		padding-top: env(safe-area-inset-top);
		padding-bottom: env(safe-area-inset-bottom);
		padding-left: env(safe-area-inset-left);
	}
	.panel.is-mobile {
		width: 100vw;
		max-width: 100vw;
		border-right: none;
	}
	@keyframes slide-in {
		from {
			transform: translateX(-12px);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	/* ----- Header ------------------------------------------------- */
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		flex-shrink: 0;
	}
	.head-left {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.head-titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.head-eyebrow {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3, #888);
	}
	.head-eyebrow.gradient-text {
		background: linear-gradient(
			90deg,
			#7dd3fc 0%,
			#c4b5fd 25%,
			#86efac 50%,
			#fcd34d 75%,
			#f0abfc 100%
		);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.head-title {
		font-size: 16px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text, #fff);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm, 6px);
		color: var(--text-2, #a8a8a8);
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		flex-shrink: 0;
	}
	.icon-btn:hover {
		background: var(--surface-hover, rgba(255, 255, 255, 0.07));
		color: var(--text, #fff);
	}
	.icon-btn:focus-visible {
		outline: 2px solid var(--accent, #00d4ff);
		outline-offset: 2px;
	}
	:global(html[data-vp~='mobile']) .icon-btn,
	:global(html[data-vp~='tablet']) .icon-btn {
		width: 44px;
		height: 44px;
	}

	/* ----- Category strip ---------------------------------------- */
	.category-strip {
		display: flex;
		gap: 6px;
		padding: 10px 14px 12px;
		overflow-x: auto;
		scrollbar-width: none;
		border-bottom: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		flex-shrink: 0;
	}
	.category-strip::-webkit-scrollbar {
		display: none;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--text-2, #b8b8b8);
		background: var(--surface, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		flex-shrink: 0;
		min-height: 30px;
	}
	.chip:hover {
		background: var(--surface-hover, rgba(255, 255, 255, 0.08));
	}
	.chip.active {
		color: var(--chip-accent, var(--accent, #00d4ff));
		background: linear-gradient(135deg, var(--chip-from, rgba(0, 212, 255, 0.18)), var(--chip-to, rgba(14, 165, 233, 0.04)));
		border-color: color-mix(in srgb, var(--chip-accent, var(--accent, #00d4ff)) 60%, transparent);
		box-shadow: 0 0 12px color-mix(in srgb, var(--chip-accent, var(--accent, #00d4ff)) 30%, transparent);
	}
	.chip-glyph {
		font-family: var(--font-mono, monospace);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: 1px 4px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--chip-accent, var(--accent, #00d4ff)) 20%, transparent);
		color: var(--chip-accent, var(--accent, #00d4ff));
	}
	.chip:not(.active) .chip-glyph {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-3, #888);
	}
	.chip-label {
		white-space: nowrap;
	}

	/* ----- Body --------------------------------------------------- */
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 22px;
	}
	.body.no-scroll {
		overflow: hidden;
	}
	.intro {
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-2, #a8a8a8);
		margin-bottom: -4px;
	}

	/* ----- Category section -------------------------------------- */
	.category {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.category-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.category-label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text, #fff);
	}
	.category-bullet {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--cat-accent);
		box-shadow: 0 0 8px var(--cat-halo);
		flex-shrink: 0;
	}
	.category-desc {
		font-size: 12px;
		color: var(--text-3, #888);
		line-height: 1.4;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	@media (max-width: 360px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	/* ----- App card ---------------------------------------------- */
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 12px 12px;
		text-align: left;
		background: linear-gradient(135deg, var(--cat-from), var(--cat-to));
		border: 1px solid color-mix(in srgb, var(--cat-accent) 22%, var(--border, rgba(255, 255, 255, 0.08)));
		border-radius: var(--radius-lg, 14px);
		color: inherit;
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		min-height: 44px;
		overflow: hidden;
		isolation: isolate;
	}
	.card::after {
		content: '';
		position: absolute;
		inset: 0;
		background: radial-gradient(120% 80% at 100% 0%, var(--cat-halo), transparent 65%);
		opacity: 0;
		transition: opacity 220ms ease;
		pointer-events: none;
		z-index: -1;
	}
	.card:hover {
		border-color: color-mix(in srgb, var(--cat-accent) 55%, transparent);
		transform: translateY(-1px);
		box-shadow: 0 14px 30px color-mix(in srgb, var(--cat-halo) 35%, transparent);
	}
	.card:hover::after {
		opacity: 0.55;
	}
	.card:focus-visible {
		outline: 2px solid var(--cat-accent);
		outline-offset: 2px;
	}
	.card.has-mockup {
		border-color: color-mix(in srgb, var(--cat-accent) 45%, transparent);
	}
	.card.is-enabled {
		border-color: var(--cat-accent);
		box-shadow: 0 0 18px color-mix(in srgb, var(--cat-halo) 50%, transparent);
	}
	.card-name {
		font-size: 14px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text, #fff);
	}
	.card-tagline {
		font-size: 11px;
		color: var(--text-2, #b8b8b8);
		line-height: 1.4;
	}
	.card-bottom {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
	}
	.card-enabled {
		display: inline-grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--cat-accent);
		color: #0a0a0a;
	}

	/* ----- Status badges ----------------------------------------- */
	.badge {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 3px 8px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.badge-available {
		background: color-mix(in srgb, var(--accent, #00d4ff) 18%, transparent);
		color: var(--accent, #00d4ff);
		border: 1px solid color-mix(in srgb, var(--accent, #00d4ff) 40%, transparent);
	}
	.badge-shipping-next {
		background: rgba(240, 171, 252, 0.18);
		color: #f0abfc;
		border: 1px solid color-mix(in srgb, #f0abfc 40%, transparent);
	}
	.badge-concept {
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-3, #888);
		border: 1px dashed rgba(255, 255, 255, 0.16);
	}
	.enabled-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		padding: 3px 8px 3px 6px;
		border-radius: 999px;
		color: #0a0a0a;
		background: var(--detail-accent, var(--accent, #00d4ff));
	}

	/* ----- Detail view ------------------------------------------- */
	.detail {
		display: flex;
		flex-direction: column;
		gap: 14px;
		--detail-accent: var(--accent, #00d4ff);
	}
	.detail-status {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.category-tag {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.detail-tagline {
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text, #fff);
		line-height: 1.3;
	}
	.detail-promise {
		font-size: 14px;
		color: var(--text-2, #a8a8a8);
		line-height: 1.55;
	}
	.detail-promise-row {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 14px;
		background: linear-gradient(135deg, var(--detail-from, rgba(0, 212, 255, 0.12)), var(--detail-to, rgba(0, 0, 0, 0)));
		border: 1px solid color-mix(in srgb, var(--detail-accent) 28%, var(--border, rgba(255, 255, 255, 0.08)));
		border-radius: var(--radius-lg, 14px);
		font-size: 12px;
		color: var(--text-2, #a8a8a8);
		line-height: 1.5;
	}
	.detail-promise-row :global(svg) {
		color: var(--detail-accent);
		flex-shrink: 0;
		margin-top: 2px;
	}

	/* ----- Enable / mockup zone ---------------------------------- */
	.enable-zone {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.enable-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: center;
		text-align: center;
		padding: 18px 16px 16px;
		border-radius: var(--radius-lg, 14px);
		background:
			radial-gradient(120% 80% at 50% 0%, var(--detail-halo), transparent 65%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25));
		border: 1px solid color-mix(in srgb, var(--detail-accent) 35%, var(--border, rgba(255, 255, 255, 0.08)));
		overflow: hidden;
	}
	.enable-shield {
		position: relative;
		width: 64px;
		height: 64px;
	}
	.enable-shield svg {
		width: 100%;
		height: 100%;
		display: block;
		filter: drop-shadow(0 0 8px var(--detail-halo));
	}
	.shield-path {
		transform-origin: 32px 32px;
		animation: shield-idle 4s ease-in-out infinite;
	}
	.shield-key {
		stroke-dasharray: 60;
		stroke-dashoffset: 60;
		transition: stroke-dashoffset 700ms ease 200ms;
	}
	.enable-shield.cracking .shield-path {
		animation: shield-pulse 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
	}
	.enable-shield.cracking .shield-key {
		stroke-dashoffset: 0;
	}
	@keyframes shield-idle {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.04);
		}
	}
	@keyframes shield-pulse {
		0% {
			transform: scale(1);
			opacity: 1;
		}
		40% {
			transform: scale(1.18);
			opacity: 1;
		}
		70% {
			transform: scale(0.96);
			opacity: 0.95;
		}
		100% {
			transform: scale(1.06);
			opacity: 1;
		}
	}
	.particles {
		position: absolute;
		inset: 0;
		display: block;
		pointer-events: none;
	}
	.particles i {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 4px;
		height: 4px;
		margin-left: -2px;
		margin-top: -2px;
		border-radius: 50%;
		background: var(--detail-accent);
		box-shadow: 0 0 6px var(--detail-accent);
		opacity: 0;
	}
	.enable-shield.cracking .particles i {
		animation: particle-burst 900ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
		animation-delay: 380ms;
	}
	.particles i:nth-child(1) {
		--tx: 28px;
		--ty: -34px;
	}
	.particles i:nth-child(2) {
		--tx: 38px;
		--ty: 0px;
	}
	.particles i:nth-child(3) {
		--tx: 28px;
		--ty: 34px;
	}
	.particles i:nth-child(4) {
		--tx: 0px;
		--ty: 40px;
	}
	.particles i:nth-child(5) {
		--tx: -28px;
		--ty: 34px;
	}
	.particles i:nth-child(6) {
		--tx: -38px;
		--ty: 0px;
	}
	.particles i:nth-child(7) {
		--tx: -28px;
		--ty: -34px;
	}
	.particles i:nth-child(8) {
		--tx: 0px;
		--ty: -40px;
	}
	@keyframes particle-burst {
		0% {
			transform: translate(0, 0) scale(0.4);
			opacity: 0;
		}
		25% {
			opacity: 1;
		}
		100% {
			transform: translate(var(--tx), var(--ty)) scale(1.1);
			opacity: 0;
		}
	}

	.enable-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.enable-title {
		font-size: 13px;
		font-weight: 700;
		color: var(--text, #fff);
	}
	.enable-sub {
		font-size: 11px;
		color: var(--text-3, #888);
		line-height: 1.5;
	}
	.enable-btn {
		margin-top: 4px;
		padding: 10px 18px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #0a0a0a;
		background: var(--detail-accent);
		border: none;
		box-shadow: 0 0 18px color-mix(in srgb, var(--detail-halo) 60%, transparent);
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		min-height: 38px;
	}
	.enable-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 6px 24px color-mix(in srgb, var(--detail-halo) 70%, transparent);
	}
	.enable-btn:focus-visible {
		outline: 2px solid var(--detail-accent);
		outline-offset: 3px;
	}
	.enable-btn:disabled {
		cursor: progress;
		opacity: 0.85;
	}

	.mockup-wrap {
		position: relative;
	}
	.mockup-wrap.just-revealed {
		animation: mockup-reveal 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}
	@keyframes mockup-reveal {
		0% {
			opacity: 0;
			transform: translateY(18px) scale(0.96);
			filter: blur(6px);
		}
		60% {
			filter: blur(0);
		}
		100% {
			opacity: 1;
			transform: translateY(0) scale(1);
			filter: blur(0);
		}
	}

	.detail-cta {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
	}
	.cta-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.02em;
		border-radius: var(--radius-sm, 6px);
		border: 1px solid var(--detail-accent);
		color: var(--detail-accent);
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		align-self: flex-start;
		min-height: 36px;
	}
	.cta-link.subtle {
		border-color: var(--border, rgba(255, 255, 255, 0.12));
		color: var(--text-2, #a8a8a8);
	}
	.cta-link:hover {
		background: var(--surface-hover, rgba(255, 255, 255, 0.07));
	}
	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 0;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2, #a8a8a8);
		align-self: flex-start;
		margin-top: 4px;
	}
	.back-link:hover {
		color: var(--text, #fff);
	}
	.back-link:focus-visible {
		outline: 2px solid var(--detail-accent);
		outline-offset: 2px;
		border-radius: var(--radius-sm, 6px);
	}

	/* ----- Mobile tweaks ----------------------------------------- */
	:global(html[data-vp~='mobile']) .trigger,
	:global(html[data-vp~='tablet']) .trigger {
		padding: 10px 14px;
		font-size: 11px;
	}

	@media (prefers-reduced-motion: reduce) {
		.panel,
		.shield-path,
		.particles i,
		.mockup-wrap.just-revealed {
			animation: none !important;
		}
	}
</style>
