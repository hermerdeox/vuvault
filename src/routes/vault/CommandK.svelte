<script lang="ts">
	import { vault, type VaultItem } from '$lib/stores/vault.svelte';
	import { audit } from '$lib/stores/audit.svelte';
	import { generateTOTP, parseTotpSeed } from '$lib/crypto/totp';
	import { copySecretToClipboard } from '$lib/services/secure-clipboard';
	import { rankItems } from './command-rank';
	import {
		IconSearch,
		IconKey,
		IconCard,
		IconUser,
		IconNote,
		IconDocument,
		IconShield,
		IconTerminal,
		IconCopy,
		IconEye,
		IconLock,
		IconClock
	} from '$lib/icons';

	type Props = {
		open: boolean;
		onClose: () => void;
		onLock: () => void;
	};

	let { open, onClose, onLock }: Props = $props();

	let inputEl: HTMLInputElement | null = $state(null);
	let query = $state('');
	let cursor = $state(0);

	type ItemRow = {
		kind: 'item';
		id: string;
		title: string;
		subtitle: string;
		icon: typeof IconKey;
		item: VaultItem;
	};
	type ActionRow = {
		kind: 'action';
		id: string;
		title: string;
		subtitle: string;
		icon: typeof IconKey;
		disabled: boolean;
		shortcut?: string;
		run: () => void;
	};
	type Row = ItemRow | ActionRow;

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

	async function copy(label: string, value: string | undefined): Promise<boolean> {
		return copySecretToClipboard(`${label} via ⌘K`, value);
	}

	const sel = $derived(vault.selected);
	// `username`, `password`, and `totpSeed` only exist on the LoginItem
	// variant of the discriminated union; type-narrow once and reuse.
	const selLogin = $derived(sel && sel.kind === 'login' ? sel : null);
	const hasUsername = $derived(Boolean(selLogin?.username));
	const hasPassword = $derived(Boolean(selLogin?.password));
	const hasTotp = $derived(Boolean(selLogin?.totpSeed));

	const actions = $derived<ActionRow[]>([
		{
			kind: 'action',
			id: 'copy-username',
			title: 'Copy username',
			subtitle: hasUsername
				? (selLogin!.username as string)
				: 'no username on selected item',
			icon: IconCopy,
			disabled: !hasUsername,
			run: () => copy('username', selLogin?.username)
		},
		{
			kind: 'action',
			id: 'copy-password',
			title: 'Copy password',
			subtitle: hasPassword ? '••••••••' : 'no password on selected item',
			icon: IconCopy,
			disabled: !hasPassword,
			run: () => copy('password', selLogin?.password)
		},
		{
			kind: 'action',
			id: 'copy-totp',
			title: 'Copy TOTP code',
			subtitle: hasTotp ? 'live 30s code' : 'no TOTP seed',
			icon: IconClock,
			disabled: !hasTotp,
			run: () => {
				const seed = selLogin?.totpSeed;
				if (!seed) return;
				try {
					const parsed = parseTotpSeed(seed);
					const { code } = generateTOTP({
						secret: parsed.secret,
						period: parsed.period,
						digits: parsed.digits,
						algorithm: parsed.algorithm
					});
					copy('TOTP', code);
				} catch (err) {
					const msg = err instanceof Error ? err.message : 'Failed to parse TOTP seed';
					audit.push('warn', `TOTP error: ${msg}`);
				}
			}
		},
		{
			kind: 'action',
			id: 'reveal',
			title: 'Reveal primary secret on selected item',
			subtitle: sel ? 'field-scoped; auto-hides in 30s' : 'no item selected',
			icon: IconEye,
			disabled: !sel,
			run: () => {
				if (!sel) return;
				const id = sel.id;
				vault.revealedField = id;
				audit.push('warn', 'Revealed via ⌘K', { ttl: '30s' });
				setTimeout(() => {
					if (vault.revealedField === id) vault.revealedField = null;
				}, 30_000);
			}
		},
		{
			kind: 'action',
			id: 'lock',
			title: 'Lock vault',
			subtitle: 'requires re-unlock',
			icon: IconLock,
			disabled: false,
			run: onLock
		}
	]);

	const rows = $derived.by<Row[]>(() => {
		const ranked = rankItems(vault.items, query, 8);
		const items: Row[] = ranked.map((item) => {
			// `username` / `url` only exist on LoginItem; narrow before
			// reading. Other kinds fall back to subtitle or the empty
			// string so the palette label still renders cleanly.
			const sub =
				item.subtitle ??
				(item.kind === 'login' ? item.username ?? item.url ?? '' : '');
			return {
				kind: 'item',
				id: `item:${item.id}`,
				title: item.title,
				subtitle: sub,
				icon: iconFor(item.kind),
				item
			};
		});

		const q = query.trim().toLowerCase();
		const matchingActions: Row[] = q
			? actions.filter(
					(a) => a.title.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q)
				)
			: actions;

		return [...items, ...matchingActions];
	});

	$effect(() => {
		if (open) {
			query = '';
			cursor = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});

	$effect(() => {
		if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
	});

	function exec(row: Row) {
		if (row.kind === 'item') {
			vault.select(row.item.id);
			onClose();
			return;
		}
		if (row.disabled) {
			audit.push('warn', `${row.title}: ${row.subtitle}`);
			return;
		}
		row.run();
		onClose();
	}

	function moveCursor(delta: number) {
		if (rows.length === 0) return;
		// Skip past disabled action rows when navigating with the keyboard
		// so Enter never lands on a no-op.
		let next = cursor + delta;
		const total = rows.length;
		for (let attempts = 0; attempts < total; attempts++) {
			if (next < 0) next = total - 1;
			if (next >= total) next = 0;
			const row = rows[next]!;
			if (row.kind !== 'action' || !row.disabled) {
				cursor = next;
				return;
			}
			next += delta || 1;
		}
		cursor = Math.max(0, Math.min(total - 1, cursor));
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			moveCursor(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			moveCursor(-1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const row = rows[cursor];
			if (row) exec(row);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		} else if (e.key === 'Home') {
			e.preventDefault();
			cursor = 0;
			moveCursor(0); // re-skip disabled if first row is disabled
		} else if (e.key === 'End') {
			e.preventDefault();
			cursor = rows.length - 1;
			moveCursor(0);
		}
	}

	function onBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	const activeId = $derived(rows[cursor]?.id ?? '');
	const labelId = 'cmdk-listbox';
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="backdrop" onclick={onBackdrop} role="presentation">
		<div
			class="palette"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			data-testid="command-palette"
		>
			<div class="search">
				<IconSearch size={14} stroke={1.6} />
				<input
					bind:this={inputEl}
					type="text"
					bind:value={query}
					placeholder="Search items or run a command…"
					autocomplete="off"
					spellcheck="false"
					role="combobox"
					aria-expanded="true"
					aria-controls={labelId}
					aria-activedescendant={activeId}
					aria-autocomplete="list"
				/>
				<span class="kbd" aria-hidden="true">esc</span>
			</div>

			<ul
				class="rows"
				id={labelId}
				role="listbox"
				aria-label="Vault items and quick actions"
			>
				{#if rows.length === 0}
					<li class="empty" role="status">No matches</li>
				{:else}
					{#each rows as row, i (row.id)}
						{@const Icon = row.icon}
						{@const disabled = row.kind === 'action' && row.disabled}
						<li
							id={row.id}
							role="presentation"
						>
							<button
								class="row"
								class:active={cursor === i}
								class:disabled
								type="button"
								role="option"
								aria-selected={cursor === i}
								aria-disabled={disabled || undefined}
								onmouseenter={() => (cursor = i)}
								onclick={() => exec(row)}
							>
								<div class="row-ico">
									<Icon size={14} stroke={1.6} />
								</div>
								<div class="row-text">
									<div class="row-title">{row.title}</div>
									<div class="row-sub">{row.subtitle}</div>
								</div>
								<div class="row-tag">
									{disabled ? 'unavailable' : row.kind === 'item' ? 'item' : 'action'}
								</div>
							</button>
						</li>
					{/each}
				{/if}
			</ul>

			<div class="footer" aria-hidden="true">
				<span><span class="kbd">↑↓</span> navigate</span>
				<span><span class="kbd">↵</span> execute</span>
				<span><span class="kbd">esc</span> close</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: color-mix(in srgb, var(--bg) 75%, transparent);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		display: grid;
		place-items: start center;
		padding-top: 18vh;
		z-index: 100;
	}
	.palette {
		width: min(560px, calc(100vw - 32px));
		max-height: 64dvh;
		display: flex;
		flex-direction: column;
		background: color-mix(in srgb, var(--bg-elev) 85%, transparent);
		backdrop-filter: blur(18px);
		-webkit-backdrop-filter: blur(18px);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-modal);
		overflow: hidden;
	}
	@media (max-width: 30em) {
		.backdrop {
			padding: max(8px, env(safe-area-inset-top)) 8px 8px;
		}
		.palette {
			width: 100%;
			max-height: calc(100dvh - 16px - env(safe-area-inset-top, 0px));
			border-radius: var(--radius-lg);
		}
	}
	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 18px;
		border-bottom: 1px solid var(--border);
		color: var(--text-3);
	}
	.search input {
		flex: 1;
		font-size: 14px;
		color: var(--text);
	}
	.search input::placeholder {
		color: var(--text-3);
	}
	.kbd {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 600;
		padding: 2px 6px;
		background: var(--surface-strong);
		border: 1px solid var(--border);
		border-radius: var(--radius-xs);
		color: var(--text-2);
	}

	.rows {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		margin: 0;
		list-style: none;
	}
	.rows li {
		padding: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 28px 1fr auto;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		width: 100%;
		text-align: left;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		color: inherit;
		transition: var(--transition);
		cursor: pointer;
		background: transparent;
		font: inherit;
	}
	.row.active {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.row.disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.row.disabled.active {
		background: color-mix(in srgb, var(--text-3) 12%, transparent);
		border-color: var(--border);
	}
	.row-ico {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		background: var(--surface-strong);
		border-radius: var(--radius-sm);
		color: var(--accent);
	}
	.row-text {
		min-width: 0;
	}
	.row-title {
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-sub {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.row-tag {
		font-family: var(--font-mono);
		font-size: 9px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-3);
	}

	.empty {
		padding: 24px;
		font-family: var(--font-mono);
		font-size: 12px;
		text-align: center;
		color: var(--text-3);
	}

	.footer {
		display: flex;
		gap: 16px;
		padding: 10px 18px;
		font-size: 11px;
		color: var(--text-3);
		border-top: 1px solid var(--border);
		background: var(--surface);
	}
</style>
