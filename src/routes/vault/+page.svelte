<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	import VaultSidebar from './VaultSidebar.svelte';
	import VaultList from './VaultList.svelte';
	import VaultDetail from './VaultDetail.svelte';

	// PERFORMANCE: the four modal overlays below are loaded lazily on
	// first open. Combined they account for ~25-35 KB of the vault
	// route's initial chunk; most users land on /vault and read items
	// long before opening the editor, palette, MP settings, or the
	// password generator. The `{#await import(...)}` blocks fetch the
	// component module on demand; subsequent opens reuse the cached
	// import.
	const importItemEditor = () => import('./ItemEditor.svelte');
	const importCommandK = () => import('./CommandK.svelte');
	const importMasterPasswordSettings = () =>
		import('./MasterPasswordSettings.svelte');
	const importQuickGenerator = () => import('./QuickGenerator.svelte');

	import BackgroundFx from '$lib/components/BackgroundFx.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import SplashScreen from '$lib/components/SplashScreen.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import AuditFooter from '$lib/components/AuditFooter.svelte';
	import {
		IconSearch,
		IconKey,
		IconLock,
		IconRefresh,
		IconShield,
		IconNote
	} from '$lib/icons';

	import { vault, type ItemKind, type VaultItem } from '$lib/stores/vault.svelte';
	import { createAutoLockController, type AutoLockReason } from '$lib/services/auto-lock';

	let editorOpen = $state(false);
	let editorMode = $state<'create' | 'edit'>('create');
	let editorInitial = $state<VaultItem | null>(null);
	let editorKind = $state<ItemKind | null>(null);

	let paletteOpen = $state(false);
	let settingsOpen = $state(false);
	let quickGenOpen = $state(false);
	let locking = $state(false);
	let editorNonce = $state(0);

	// Mobile overflow popover holds the rare top-bar actions
	// (Generate / Sync / MP-Settings / Theme) so the right group
	// fits on a 360px-wide phone. CSS `[data-vp~='mobile']` rules
	// hide the inline icons and reveal the kebab button on mobile.
	let overflowOpen = $state(false);
	function closeOverflow() {
		overflowOpen = false;
	}
	function withOverflow<T extends () => void | Promise<void>>(fn: T) {
		return () => {
			void fn();
			overflowOpen = false;
		};
	}

	async function lockVault(reason: 'manual' | AutoLockReason = 'manual') {
		if (locking) return;
		locking = true;
		try {
			if (reason === 'manual') {
				await new Promise<void>((done) => requestAnimationFrame(() => done()));
			}
			await vault.lock(reason);
			await goto(resolve('/unlock'));
		} catch (error) {
			locking = false;
			throw error;
		}
	}

	function openCreateEditor() {
		editorMode = 'create';
		editorInitial = null;
		editorKind = null;
		editorNonce += 1;
		editorOpen = true;
	}

	function openEditEditor(item: VaultItem) {
		editorMode = 'edit';
		editorInitial = item;
		editorKind = item.kind;
		editorNonce += 1;
		editorOpen = true;
	}

	// Top-bar IconKey button. Opens the standalone QuickGenerator
	// popover for ad-hoc generation (copy-to-clipboard, no item
	// created). The in-modal generator inside ItemEditor is the
	// separate path for "create a new login with this password".
	function toggleQuickGenerator() {
		quickGenOpen = !quickGenOpen;
	}

	const syncLabel = $derived(vault.syncing ? 'Syncing' : 'Sync');
	const syncTitle = $derived(`${syncLabel} · ${vault.syncMessage}`);

	async function syncVaultNow() {
		await vault.syncNow();
	}

	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			paletteOpen = true;
		}
	}

	onMount(() => {
		const controller = createAutoLockController({
			getStatus: () => vault.status,
			lock: (reason) => lockVault(reason)
		});
		return () => controller.destroy();
	});
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>Vault — VuVault</title>
</svelte:head>

<SplashScreen visible={locking} />

<BackgroundFx />

<div class="app">
	<header class="topbar">
		<div class="left">
			<BrandMark showPill="Vault" />
		</div>

		<div class="center">
			<div class="search">
				<IconSearch size={14} stroke={1.6} />
				<input
					type="text"
					placeholder="Search the vault…"
					bind:value={vault.searchQuery}
					autocomplete="off"
					spellcheck="false"
				/>
				<button
					class="kbd"
					onclick={() => (paletteOpen = true)}
					title="Open command palette"
					aria-label="Open command palette">⌘K</button
				>
			</div>
		</div>

		<div class="right">
			<span class="sync-probe" data-testid="sync-status" title={vault.syncMessage}>
				{vault.syncStatus}
			</span>
			<button
				class="ico-btn overflow-target"
				class:active={quickGenOpen}
				onclick={toggleQuickGenerator}
				aria-label="Generate password"
				aria-haspopup="dialog"
				aria-expanded={quickGenOpen}
				title="Generate password"
			>
				<IconKey size={14} stroke={1.6} />
			</button>
			<button
				class="ico-btn overflow-target"
				class:active={vault.syncing}
				onclick={syncVaultNow}
				disabled={vault.syncing}
				aria-label={syncTitle}
				title={syncTitle}
			>
				<IconRefresh size={14} stroke={1.6} />
			</button>
			<button
				class="ico-btn overflow-target"
				onclick={() => (settingsOpen = true)}
				aria-label="Master password settings"
				title="Master password (advanced)"
				data-testid="open-mp-settings"
			>
				<IconShield size={14} stroke={1.6} />
			</button>
			<span class="overflow-target"><ThemeToggle /></span>
			<button
				class="lock-btn"
				onclick={() => lockVault()}
				disabled={locking}
				aria-label="Lock vault"
			>
				<IconLock size={14} stroke={1.8} />
				<span>{locking ? 'Locking…' : 'Lock'}</span>
			</button>

			<!-- Mobile overflow: collapses Generate/Sync/MP-Settings/Theme into
			     a dropdown so the right group fits on a 360px phone. -->
			<div class="overflow-wrap">
				<button
					class="ico-btn overflow-trigger"
					class:active={overflowOpen}
					onclick={() => (overflowOpen = !overflowOpen)}
					aria-label="More actions"
					aria-haspopup="menu"
					aria-expanded={overflowOpen}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.2"
						stroke-linecap="round"
					>
						<circle cx="12" cy="5" r="1" />
						<circle cx="12" cy="12" r="1" />
						<circle cx="12" cy="19" r="1" />
					</svg>
				</button>
				{#if overflowOpen}
					<div
						class="overflow-backdrop"
						aria-hidden="true"
						onclick={closeOverflow}
					></div>
					<div class="overflow-menu" role="menu" aria-label="More actions">
						<button
							class="overflow-item"
							role="menuitem"
							onclick={withOverflow(toggleQuickGenerator)}
						>
							<IconKey size={14} stroke={1.6} />
							<span>Generate password</span>
						</button>
						<button
							class="overflow-item"
							class:active={vault.syncing}
							role="menuitem"
							onclick={withOverflow(syncVaultNow)}
							disabled={vault.syncing}
							aria-label={syncTitle}
							title={syncTitle}
						>
							<IconRefresh size={14} stroke={1.6} />
							<span>{syncLabel}</span>
						</button>
						<button
							class="overflow-item"
							role="menuitem"
							onclick={withOverflow(() => {
								settingsOpen = true;
							})}
							data-testid="open-mp-settings-mobile"
						>
							<IconShield size={14} stroke={1.6} />
							<span>Master password</span>
						</button>
						<div class="overflow-theme">
							<ThemeToggle />
						</div>
					</div>
				{/if}
			</div>
		</div>
	</header>

	{#if vault.otherTabActivity}
		<aside class="tab-banner" role="status" data-testid="tab-activity">
			<div>
				<strong>Vault changed in another tab.</strong>
				{#if vault.otherTabActivity.kind === 'wiped'}
					Local data was wiped from another tab.
				{:else}
					An edit was persisted from another tab — reload to see the latest items.
				{/if}
			</div>
			<button
				class="tab-banner-action"
				onclick={() => location.reload()}
				aria-label="Reload page"
			>
				Reload
			</button>
			<button
				class="tab-banner-dismiss"
				onclick={() => (vault.otherTabActivity = null)}
				aria-label="Dismiss"
			>
				✕
			</button>
		</aside>
	{/if}

	<main class="panes" data-mobile-pane={vault.mobilePane}>
		<div class="pane sidebar-pane"><VaultSidebar /></div>
		<div class="pane list-pane-wrap"><VaultList onAdd={openCreateEditor} /></div>
		<div class="pane detail-pane">
			<button
				class="detail-back"
				onclick={() => (vault.mobilePane = 'list')}
				aria-label="Back to items"
			>
				<svg
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.2"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
				>
				Items
			</button>
			<VaultDetail onEdit={openEditEditor} />
		</div>
	</main>

	<nav class="mobile-tabs" aria-label="Vault sections">
		<button
			class="tab"
			class:active={vault.mobilePane === 'sidebar'}
			onclick={() => (vault.mobilePane = 'sidebar')}
			aria-label="Categories"
		>
			<IconShield size={16} stroke={1.6} />
			<span>Categories</span>
		</button>
		<button
			class="tab"
			class:active={vault.mobilePane === 'list'}
			onclick={() => (vault.mobilePane = 'list')}
			aria-label="Items"
		>
			<IconNote size={16} stroke={1.6} />
			<span>Items</span>
		</button>
		<button
			class="tab"
			class:active={vault.mobilePane === 'detail'}
			onclick={() => (vault.mobilePane = 'detail')}
			aria-label="Detail"
		>
			<IconKey size={16} stroke={1.6} />
			<span>Detail</span>
		</button>
	</nav>
</div>

<AuditFooter fallback="Vault unlocked · 0 bytes synced · all operations local" />

{#if editorOpen}
	{#await importItemEditor() then mod}
		{#key editorNonce}
			{@const ItemEditor = mod.default}
			<ItemEditor
				open={editorOpen}
				mode={editorMode}
				initial={editorInitial}
				kind={editorKind}
				onClose={() => (editorOpen = false)}
			/>
		{/key}
	{/await}
{/if}

{#if paletteOpen}
	{#await importCommandK() then mod}
		{@const CommandK = mod.default}
		<CommandK
			open={paletteOpen}
			onClose={() => (paletteOpen = false)}
			onLock={lockVault}
		/>
	{/await}
{/if}

{#if settingsOpen}
	{#await importMasterPasswordSettings() then mod}
		{@const MasterPasswordSettings = mod.default}
		<MasterPasswordSettings
			open={settingsOpen}
			onClose={() => (settingsOpen = false)}
		/>
	{/await}
{/if}

{#if quickGenOpen}
	{#await importQuickGenerator() then mod}
		{@const QuickGenerator = mod.default}
		<QuickGenerator
			open={quickGenOpen}
			onClose={() => (quickGenOpen = false)}
		/>
	{/await}
{/if}

<style>
	.app {
		height: 100dvh;
		display: grid;
		/* Header row grows by the island inset; side padding keeps the
		   panes clear of the landscape notch (62px each side on
		   iPhone 16 Pro — sidebar rows measured at x=14 without it). */
		grid-template-rows: calc(var(--header-h) + var(--safe-top, 0px)) 1fr;
		padding-bottom: calc(var(--footer-h) + var(--safe-bottom, 0px));
		padding-left: var(--safe-left, 0px);
		padding-right: var(--safe-right, 0px);
		/* Translucent over BackgroundFx — the homepage's grid +
		   spotlight ambience reads through every pane. */
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		position: relative;
		z-index: 1;
	}

	.tab-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		background: color-mix(in srgb, var(--warn) 12%, var(--bg-elev));
		border-bottom: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border));
		color: var(--text);
		font-size: 13px;
		flex-shrink: 0;
	}
	.tab-banner > div {
		flex: 1;
		min-width: 0;
	}
	.tab-banner strong {
		color: var(--warn);
		margin-right: 4px;
	}
	@media (pointer: coarse) {
		.tab-banner-action,
		.tab-banner-dismiss {
			min-height: 44px;
		}
	}
	.tab-banner-action {
		padding: 6px 14px;
		font-size: 12px;
		font-weight: 600;
		color: var(--bg);
		background: var(--warn);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}
	.tab-banner-dismiss {
		padding: 6px 10px;
		font-size: 12px;
		color: var(--text-3);
		background: transparent;
		border: none;
		cursor: pointer;
	}
	.tab-banner-dismiss:hover {
		color: var(--text);
	}
	.detail-back {
		display: none;
	}
	.topbar {
		display: grid;
		grid-template-columns: 240px 1fr auto;
		align-items: center;
		gap: 16px;
		/* Content sits below the Dynamic Island; the bar's blurred
		   background still paints up under the status bar. */
		padding: var(--safe-top, 0px) 18px 0;
		border-bottom: 1px solid var(--border);
		background: color-mix(in srgb, var(--bg) 60%, transparent);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
		position: relative;
	}
	.topbar::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 1px;
		background: linear-gradient(
			90deg,
			transparent 8%,
			color-mix(in srgb, var(--accent) 45%, transparent) 50%,
			transparent 92%
		);
		pointer-events: none;
	}

	.center {
		display: flex;
		justify-content: center;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		width: 100%;
		max-width: 460px;
		color: var(--text-3);
	}
	.search input {
		flex: 1;
		font-size: 13px;
		color: var(--text);
	}
	.search input::placeholder {
		color: var(--text-3);
	}
	.kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 2px 6px;
		background: var(--surface-strong);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		color: var(--text-2);
		cursor: pointer;
		transition: var(--transition);
	}
	.kbd:hover {
		color: var(--text);
		border-color: var(--border-mid);
	}
	/* Touch devices at ANY viewport width (iPhone 16 Pro landscape is
	   874px — outside the mobile media blocks below, but fingers are
	   the same size): 44pt floors on the topbar controls, and no ⌘K
	   keyboard hint where there is no ⌘ key. */
	@media (pointer: coarse) {
		.lock-btn,
		.overflow-trigger {
			min-height: 44px;
			min-width: 44px;
		}
		.search {
			min-height: 44px;
			padding-top: 0;
			padding-bottom: 0;
		}
		.search input {
			min-height: 44px;
		}
		.kbd {
			display: none;
		}
	}

	.right {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sync-probe {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.ico-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition: var(--transition);
	}
	:global(html[data-vp~='mobile']) .ico-btn,
	:global(html[data-vp~='tablet']) .ico-btn {
		width: 44px;
		height: 44px;
	}
	.ico-btn:hover {
		background: var(--surface);
		color: var(--text);
	}
	.ico-btn.active {
		background: var(--accent-dim);
		color: var(--accent);
	}

	/* Overflow popover — desktop hides the trigger, mobile hides the
	   inline targets. Belt-and-braces: also media-query gated for any
	   user that has no JS / first-paint before viewport store hydrates. */
	.overflow-wrap {
		position: relative;
	}
	.overflow-trigger {
		display: none;
	}
	.overflow-backdrop {
		position: fixed;
		inset: 0;
		z-index: 38;
	}
	.overflow-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 39;
		min-width: 220px;
		padding: 6px;
		background: var(--bg-elev);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius);
		box-shadow: var(--shadow-modal);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.overflow-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text);
		border-radius: var(--radius-sm);
		text-align: left;
		transition: var(--transition);
		min-height: 44px;
	}
	.overflow-item:hover {
		background: var(--surface-hover);
	}
	.overflow-theme {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		margin-top: 4px;
		border-top: 1px solid var(--border);
	}
	.overflow-theme::before {
		content: 'Theme';
		font-size: 13px;
		color: var(--text-2);
	}

	.lock-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		color: var(--text-2);
		background: var(--surface);
		transition: var(--transition);
	}
	.lock-btn:hover:not(:disabled) {
		color: var(--text);
		background: var(--surface-hover);
	}
	.lock-btn:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.panes {
		display: grid;
		/* List pane widened 15% (320 → 368px); the 1fr detail column
		   to its right absorbs the difference. */
		grid-template-columns: 240px 368px 1fr;
		min-height: 0;
		overflow: hidden;
		height: 100%;
	}
	.pane {
		min-height: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* Bottom-tab navigation only renders ≤720px. */
	.mobile-tabs {
		display: none;
	}

	@media (max-width: 64em) {
		.topbar {
			grid-template-columns: auto 1fr auto;
		}
		.left {
			display: none;
		}
		.panes {
			grid-template-columns: 200px 322px 1fr;
		}
	}
	@media (max-width: 45em) {
		.app {
			grid-template-rows: calc(var(--header-h) + var(--safe-top, 0px)) 1fr auto;
			padding-bottom: calc(var(--footer-h) + 56px + var(--safe-bottom));
		}
		.topbar {
			padding: var(--safe-top, 0px) 12px 0;
			gap: 8px;
		}
		.right {
			gap: 4px;
		}
		.panes {
			grid-template-columns: 1fr;
		}
		.center {
			display: none;
		}
		.pane {
			display: none;
		}
		.panes[data-mobile-pane='sidebar'] .sidebar-pane {
			display: block;
		}
		.panes[data-mobile-pane='list'] .list-pane-wrap {
			display: block;
		}
		.panes[data-mobile-pane='detail'] .detail-pane {
			display: block;
		}

		/* Collapse rare actions into the kebab popover. */
		.right .overflow-target {
			display: none;
		}
		.overflow-trigger {
			display: grid;
		}

		.detail-back {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			min-height: 44px;
			padding: 0 14px;
			font-size: 14px;
			font-weight: 600;
			color: var(--accent);
		}
		.mobile-tabs {
			position: fixed;
			bottom: calc(var(--footer-h) + var(--safe-bottom));
			left: 0;
			right: 0;
			height: 56px;
			z-index: 25;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			background: color-mix(in srgb, var(--bg) 70%, transparent);
			backdrop-filter: blur(18px);
			-webkit-backdrop-filter: blur(18px);
			border-top: 1px solid var(--border);
		}
		.tab {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 2px;
			padding: 6px;
			color: var(--text-3);
			font-family: var(--font-mono);
			font-size: 10px;
			font-weight: 700;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			transition: var(--transition);
			cursor: pointer;
		}
		.tab.active {
			color: var(--accent);
			background: var(--accent-dim);
		}
	}
	@media (max-width: 30em) {
		/* Below 480px the Lock label joins the icon-only group. */
		.lock-btn span {
			display: none;
		}
		.lock-btn {
			padding: 0;
			width: 44px;
			height: 44px;
			justify-content: center;
		}
		/* Kebab trigger lifts to the WCAG floor on touch. */
		.overflow-trigger {
			width: 44px;
			height: 44px;
		}
		/* Tab-activity banner stacks instead of horizontal-overflows. */
		.tab-banner {
			flex-wrap: wrap;
			padding: 8px 12px;
			gap: 8px;
		}
		.tab-banner > div {
			flex: 1 1 100%;
		}
	}
</style>
