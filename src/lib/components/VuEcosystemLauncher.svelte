<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { IconClose, IconArrowLeft, IconShield } from '$lib/icons';
	import { viewport } from '$lib/stores/viewport.svelte';
	import {
		VU_ECOSYSTEM_CATEGORIES,
		statusLabel,
		type EcosystemApp,
		type EcosystemCategory
	} from '$lib/data/vu-ecosystem';

	/**
	 * Global Vu Ecosystem launcher.
	 *
	 * Behaviors:
	 *   - Floating bottom-left button. Label is `Vu Ecosystem` when
	 *     closed and `vuteletransport` when the panel is open.
	 *   - Desktop / tablet: a fixed left-side drawer slides in
	 *     (max-width 440px, clamped to viewport on small screens).
	 *   - Mobile (`html[data-vp~='mobile']`): the panel becomes
	 *     full-viewport, scrollable.
	 *   - Clicking an app card switches the same panel into a mini
	 *     detail page; a back button returns to the grid.
	 *   - Escape, backdrop click, and the explicit close button all
	 *     dismiss the panel. Focus is returned to the trigger button.
	 *
	 * The component is self-contained — no stores, no network calls,
	 * no analytics, just local `$state`. Data lives in
	 * `src/lib/data/vu-ecosystem.ts`.
	 */

	let open = $state(false);
	let selectedAppName = $state<string | null>(null);
	let triggerEl: HTMLButtonElement | null = $state(null);
	let panelEl: HTMLDivElement | null = $state(null);

	const selected = $derived<EcosystemApp | null>(
		selectedAppName ? (findApp(selectedAppName) ?? null) : null
	);
	const selectedCategory = $derived<EcosystemCategory | null>(
		selectedAppName ? (findCategoryOf(selectedAppName) ?? null) : null
	);
	const buttonLabel = $derived(open ? 'vuteletransport' : 'Vu Ecosystem');

	function findApp(name: string): EcosystemApp | undefined {
		for (const cat of VU_ECOSYSTEM_CATEGORIES) {
			const hit = cat.apps.find((a) => a.name === name);
			if (hit) return hit;
		}
		return undefined;
	}

	function findCategoryOf(name: string): EcosystemCategory | undefined {
		return VU_ECOSYSTEM_CATEGORIES.find((cat) => cat.apps.some((a) => a.name === name));
	}

	function toggleOpen(): void {
		if (open) {
			close();
		} else {
			open = true;
			selectedAppName = null;
			queueFocusInsidePanel();
		}
	}

	function close(): void {
		open = false;
		selectedAppName = null;
		// Return focus to the trigger on next frame so screen readers
		// catch the trigger as the new focused control.
		queueMicrotask(() => triggerEl?.focus());
	}

	function selectApp(name: string): void {
		selectedAppName = name;
		queueFocusInsidePanel();
	}

	function backToGrid(): void {
		selectedAppName = null;
		queueFocusInsidePanel();
	}

	function queueFocusInsidePanel(): void {
		queueMicrotask(() => {
			panelEl?.focus();
		});
	}

	function onKeydown(e: KeyboardEvent): void {
		if (!open) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
			return;
		}
		// Lightweight focus trap so Tab cycles within the panel while open.
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
		if (e.target === e.currentTarget) close();
	}

	// While the panel is open, lock background scroll on mobile so
	// the full-viewport panel doesn't double-scroll the document.
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
		// Eagerly read the viewport state once so the component layer
		// boots after hydration without an extra rune-tracked tick.
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
					{#if selected}
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
							<span class="head-eyebrow">{selectedCategory?.label ?? 'Vu Ecosystem'}</span>
							<h2 class="head-title">{selected.name}</h2>
						</div>
					{:else}
						<div class="head-titles">
							<span class="head-eyebrow">Vu Ecosystem</span>
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

			<div class="body">
				{#if selected}
					<section class="detail" data-testid="vu-ecosystem-detail">
						<div class="detail-status">
							<span class="badge badge-{selected.status}">
								{statusLabel(selected.status)}
							</span>
							<span class="category-tag">{selectedCategory?.label}</span>
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
					{#each VU_ECOSYSTEM_CATEGORIES as category (category.id)}
						<section class="category" aria-labelledby={`vu-eco-cat-${category.id}`}>
							<div class="category-head">
								<h3 id={`vu-eco-cat-${category.id}`} class="category-label">
									{category.label}
								</h3>
								<p class="category-desc">{category.description}</p>
							</div>
							<div class="grid">
								{#each category.apps as app (app.name)}
									<button
										type="button"
										class="card"
										onclick={() => selectApp(app.name)}
										data-app={app.name}
										data-testid={`vu-eco-card-${app.name}`}
									>
										<span class="card-name">{app.name}</span>
										<span class="card-tagline">{app.tagline}</span>
										<span class="card-badge badge badge-{app.status}">
											{statusLabel(app.status)}
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
		width: min(440px, 92vw);
		height: 100dvh;
		background: var(--bg-elev, #0a0a0a);
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
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-3, #666);
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

	/* ----- Body --------------------------------------------------- */
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 24px;
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
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text, #fff);
	}
	.category-desc {
		font-size: 12px;
		color: var(--text-3, #666);
		line-height: 1.4;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.panel.is-mobile .grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
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
		padding: 12px 12px 14px;
		text-align: left;
		background: var(--surface, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-lg, 14px);
		color: inherit;
		transition: var(--transition, 220ms cubic-bezier(0.2, 0.8, 0.2, 1));
		min-height: 44px;
	}
	.card:hover {
		background: var(--surface-hover, rgba(255, 255, 255, 0.07));
		border-color: var(--border-strong, rgba(255, 255, 255, 0.22));
		transform: translateY(-1px);
	}
	.card:focus-visible {
		outline: 2px solid var(--accent, #00d4ff);
		outline-offset: 2px;
	}
	.card-name {
		font-size: 14px;
		font-weight: 700;
		letter-spacing: -0.01em;
		color: var(--text, #fff);
	}
	.card-tagline {
		font-size: 11px;
		color: var(--text-3, #666);
		line-height: 1.4;
	}
	.card-badge {
		margin-top: 6px;
		align-self: flex-start;
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
		background: var(--surface-strong, rgba(255, 255, 255, 0.08));
		color: var(--text, #fff);
		border: 1px solid var(--border-mid, rgba(255, 255, 255, 0.14));
	}
	.badge-concept {
		background: var(--surface, rgba(255, 255, 255, 0.04));
		color: var(--text-3, #888);
		border: 1px dashed var(--border-mid, rgba(255, 255, 255, 0.14));
	}

	/* ----- Detail view ------------------------------------------- */
	.detail {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.detail-status {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
	}
	.category-tag {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-3, #666);
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
		background: var(--surface, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--border, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-lg, 14px);
		font-size: 12px;
		color: var(--text-2, #a8a8a8);
		line-height: 1.5;
	}
	.detail-promise-row :global(svg) {
		color: var(--accent, #00d4ff);
		flex-shrink: 0;
		margin-top: 2px;
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
		border: 1px solid var(--accent, #00d4ff);
		color: var(--accent, #00d4ff);
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
		margin-top: 8px;
	}
	.back-link:hover {
		color: var(--text, #fff);
	}
	.back-link:focus-visible {
		outline: 2px solid var(--accent, #00d4ff);
		outline-offset: 2px;
		border-radius: var(--radius-sm, 6px);
	}

	/* ----- Mobile tweaks ----------------------------------------- */
	:global(html[data-vp~='mobile']) .trigger,
	:global(html[data-vp~='tablet']) .trigger {
		padding: 10px 14px;
		font-size: 11px;
	}
</style>
