<script lang="ts">
	import { vault, type VaultItem } from '$lib/stores/vault.svelte';
	import {
		IconKey,
		IconCard,
		IconUser,
		IconNote,
		IconDocument,
		IconShield,
		IconTerminal,
		IconSearch
	} from '$lib/icons';

	function iconFor(kind: VaultItem['kind']) {
		switch (kind) {
			case 'login':
				return IconKey;
			case 'card':
				return IconCard;
			case 'identity':
				return IconUser;
			case 'note':
				return IconNote;
			case 'document':
				return IconDocument;
			case 'ssh':
				return IconTerminal;
			case 'crypto-seed':
				return IconShield;
		}
	}

	const items = $derived(vault.filtered);

	const headline = $derived.by<string>(() => {
		if (vault.categoryFilter === 'all') return 'All items';
		if (vault.categoryFilter === 'weak') return 'Weak passwords';
		if (vault.categoryFilter === 'reused') return 'Reused passwords';
		const labels: Record<string, string> = {
			login: 'Logins',
			card: 'Cards',
			note: 'Secure notes',
			identity: 'Identities',
			ssh: 'SSH keys',
			'crypto-seed': 'Crypto seeds',
			document: 'Documents'
		};
		return labels[vault.categoryFilter] ?? vault.categoryFilter;
	});
</script>

<div class="list-pane">
	<div class="search">
		<IconSearch size={14} stroke={1.6} />
		<input
			type="text"
			placeholder="Filter {headline.toLowerCase()}…"
			bind:value={vault.searchQuery}
			autocomplete="off"
			spellcheck="false"
		/>
		<span class="count">{items.length}</span>
	</div>

	<div class="header-row">
		<span class="header-label">{headline}</span>
		{#if vault.searchQuery.trim()}
			<button class="clear" onclick={() => (vault.searchQuery = '')}>Clear</button>
		{/if}
	</div>

	<div class="items">
		{#if items.length === 0}
			<div class="empty">
				{#if vault.items.length === 0}
					<div class="empty-title">Vault is empty</div>
					<div class="empty-body">
						Click the <strong>+</strong> button in the top bar to add your first item.
					</div>
				{:else if vault.categoryFilter === 'weak'}
					<div class="empty-title">No weak passwords</div>
					<div class="empty-body">
						Every password in this vault meets the minimum-entropy threshold.
					</div>
				{:else if vault.categoryFilter === 'reused'}
					<div class="empty-title">No reused passwords</div>
					<div class="empty-body">
						Each item has a unique password.
					</div>
				{:else}
					<div class="empty-title">No matches</div>
					<div class="empty-body">
						Try a different filter or clear your search.
					</div>
				{/if}
			</div>
		{:else}
			{#each items as item (item.id)}
				{@const Icon = iconFor(item.kind)}
				<button
					class="item"
					class:selected={vault.selectedId === item.id}
					onclick={() => vault.select(item.id)}
				>
					<div class="ico">
						<Icon size={14} stroke={1.6} />
					</div>
					<div class="info">
						<div class="title">{item.title}</div>
						{#if item.subtitle}
							<div class="sub">{item.subtitle}</div>
						{:else if item.kind === 'login' && item.username}
							<div class="sub">{item.username}</div>
						{/if}
					</div>
					{#if item.favorite}
						<div class="fav">★</div>
					{/if}
				</button>
			{/each}
		{/if}
	</div>
</div>

<style>
	.list-pane {
		display: flex;
		flex-direction: column;
		background: var(--bg);
		border-right: 1px solid var(--border);
		overflow: hidden;
		height: 100%;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		border-bottom: 1px solid var(--border);
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
	.count {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
	}

	.header-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 14px;
		font-family: var(--font-mono);
		font-size: 9px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		border-bottom: 1px dashed var(--border);
	}
	.clear {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: var(--transition);
	}
	.clear:hover {
		text-decoration: underline;
	}

	.items {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
	}

	.item {
		display: grid;
		grid-template-columns: 32px 1fr auto;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: var(--radius);
		text-align: left;
		font-family: inherit;
		color: inherit;
		transition: var(--transition);
		width: 100%;
		border: 1px solid transparent;
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface);
	}
	.item.selected {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}

	.ico {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		background: var(--surface-strong);
		border-radius: var(--radius-sm);
		color: var(--accent);
	}
	.info {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fav {
		color: var(--warn);
		font-size: 12px;
	}

	.empty {
		padding: 32px 20px;
		text-align: center;
	}
	.empty-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-2);
		margin-bottom: 6px;
	}
	.empty-body {
		font-size: 12px;
		color: var(--text-3);
		line-height: 1.5;
	}
	.empty-body strong {
		color: var(--accent);
		font-family: var(--font-mono);
	}
	@media (max-width: 30em) {
		.item {
			padding: 8px 10px;
			gap: 8px;
		}
		.sub {
			display: none;
		}
	}
</style>
