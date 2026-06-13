<script lang="ts">
	import { vault, type ItemKind } from '$lib/stores/vault.svelte';
	import {
		IconKey,
		IconCard,
		IconUser,
		IconNote,
		IconDocument,
		IconShield,
		IconTerminal,
		IconWarning,
		IconRefresh
	} from '$lib/icons';

	type CategoryId = 'all' | ItemKind | 'weak' | 'reused';

	type Category = {
		id: CategoryId;
		label: string;
		icon: typeof IconKey;
		count: number;
		group: 'main' | 'health';
		disabled?: boolean;
	};

	const categories = $derived<Category[]>([
		{ id: 'all', label: 'All items', icon: IconShield, count: vault.count, group: 'main' },
		{ id: 'login', label: 'Logins', icon: IconKey, count: vault.byKind.login.length, group: 'main' },
		{ id: 'card', label: 'Cards', icon: IconCard, count: vault.byKind.card.length, group: 'main' },
		{ id: 'identity', label: 'Identities', icon: IconUser, count: vault.byKind.identity.length, group: 'main' },
		{ id: 'note', label: 'Secure notes', icon: IconNote, count: vault.byKind.note.length, group: 'main' },
		{ id: 'document', label: 'Documents', icon: IconDocument, count: vault.byKind.document.length, group: 'main' },
		{ id: 'ssh', label: 'SSH keys', icon: IconTerminal, count: vault.byKind.ssh.length, group: 'main' },
		{ id: 'crypto-seed', label: 'Crypto seeds', icon: IconShield, count: vault.byKind['crypto-seed'].length, group: 'main' },
		// Health buckets — real detection runs locally in `password-health.ts`
		// against the in-memory items. No password material leaves memory.
		{ id: 'weak', label: 'Weak', icon: IconWarning, count: vault.weakCount, group: 'health' },
		{ id: 'reused', label: 'Reused', icon: IconRefresh, count: vault.reusedCount, group: 'health' }
	]);

	function selectCategory(id: CategoryId) {
		vault.categoryFilter = id;
	}
</script>

<aside class="sidebar">
	<div class="group">
		<div class="heading">Categories</div>
		{#each categories.filter((c) => c.group === 'main') as cat (cat.id)}
			{@const Icon = cat.icon}
			<button
				class="row"
				class:active={vault.categoryFilter === cat.id}
				onclick={() => selectCategory(cat.id)}
			>
				<Icon size={14} stroke={1.6} />
				<span class="label">{cat.label}</span>
				<span class="count">{cat.count}</span>
			</button>
		{/each}
	</div>

	<div class="group">
		<div class="heading">Health</div>
		{#each categories.filter((c) => c.group === 'health') as cat (cat.id)}
			{@const Icon = cat.icon}
			<button
				class="row"
				class:active={vault.categoryFilter === cat.id}
				class:disabled={cat.disabled}
				class:has-issues={!cat.disabled && cat.count > 0}
				disabled={cat.disabled}
				onclick={() => !cat.disabled && selectCategory(cat.id)}
			>
				<Icon size={14} stroke={1.6} />
				<span class="label">{cat.label}</span>
				<span class="count">{cat.count}</span>
			</button>
		{/each}
		<div class="health-note">
			Strength checks run locally; passwords never leave this device.
		</div>
	</div>
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 18px 14px;
		overflow-y: auto;
		background: color-mix(in srgb, var(--bg-elev) 76%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-right: 1px solid var(--border);
		height: 100%;
		box-sizing: border-box;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.heading {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 0 12px;
		margin-bottom: 6px;
	}
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: var(--text-2);
		text-align: left;
		transition: var(--transition);
		border: 1px solid transparent;
		cursor: pointer;
	}
	:global(html[data-vp~='mobile']) .row,
	:global(html[data-vp~='tablet']) .row {
		min-height: 44px;
		padding: 12px 14px;
		font-size: 14px;
	}
	@media (hover: hover) {
		.row:hover:not(.disabled) {
			background: var(--surface);
			color: var(--text);
		}
		.row:hover:not(.disabled):not(.active) {
			transform: translateX(2px);
		}
	}
	.row.active {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
		box-shadow:
			inset 2px 0 0 var(--accent),
			0 0 18px color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.row:active:not(.disabled) {
		transform: scale(0.985);
		background: var(--surface-hover);
	}
	.row.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.row.has-issues .count {
		color: var(--warn);
		font-weight: 700;
	}
	.row.has-issues.active .count {
		color: var(--warn);
	}
	.label {
		font-weight: 500;
	}
	.row.active .label {
		font-weight: 600;
	}
	.count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
	}
	.row.active .count {
		color: var(--accent);
	}

	.health-note {
		margin-top: 4px;
		padding: 0 12px;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-4);
		letter-spacing: 0;
		line-height: 1.4;
	}
</style>
