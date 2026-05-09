<script lang="ts">
	import { vault, type VaultItem } from '$lib/stores/vault.svelte';
	import { audit } from '$lib/stores/audit.svelte';
	import { generateTOTP, parseTotpSeed } from '$lib/crypto/totp';
	import { safeHref } from '$lib/utils/sanitize';
	import { IconEye, IconEyeOff, IconCopy, IconClock, IconWarning } from '$lib/icons';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	type Props = {
		onEdit?: (item: VaultItem) => void;
	};
	let { onEdit }: Props = $props();

	const item = $derived(vault.selected);

	// Reveal state for the current item. Persists to vault.revealedField so
	// the ⌘K palette can flip it from outside this component.
	const itemId = $derived(item?.id ?? null);
	let revealedFields = $state<Record<string, boolean>>({});
	let revealTimers = $state<Record<string, number>>({});

	const REVEAL_TTL_MS = 30_000;

	// When the palette toggles vault.revealedField for the current item,
	// reflect that into local reveal state so the secret-bearing fields
	// (password, cardNumber, cardCvc, sshKeyBody, seedPhrase, noteBody)
	// all flip in lockstep.
	$effect(() => {
		const flag = vault.revealedField;
		const id = itemId;
		if (flag && id && flag === id) {
			const all = ['password', 'cardNumber', 'cardCvc', 'sshKeyBody', 'seedPhrase', 'noteBody'];
			for (const key of all) reveal(key, /*silent*/ true);
		}
	});

	// Reset local reveal state when selection changes.
	$effect(() => {
		void itemId;
		for (const k of Object.keys(revealTimers)) {
			clearTimeout(revealTimers[k]);
		}
		revealedFields = {};
		revealTimers = {};
	});

	function reveal(fieldKey: string, silent = false) {
		revealedFields = { ...revealedFields, [fieldKey]: true };
		if (!silent) audit.push('warn', `Revealed ${fieldKey}`, { ttl: '30s' });

		if (revealTimers[fieldKey]) {
			clearTimeout(revealTimers[fieldKey]);
		}
		revealTimers = {
			...revealTimers,
			[fieldKey]: window.setTimeout(() => {
				revealedFields = { ...revealedFields, [fieldKey]: false };
				if (!silent) audit.push('info', `Auto-hid ${fieldKey}`);
				if (vault.revealedField === itemId) vault.revealedField = null;
			}, REVEAL_TTL_MS)
		};
	}

	function hide(fieldKey: string) {
		revealedFields = { ...revealedFields, [fieldKey]: false };
		if (revealTimers[fieldKey]) {
			clearTimeout(revealTimers[fieldKey]);
		}
		if (vault.revealedField === itemId) vault.revealedField = null;
	}

	function toggle(fieldKey: string) {
		if (revealedFields[fieldKey]) hide(fieldKey);
		else reveal(fieldKey);
	}

	async function copyValue(fieldKey: string, value: string | undefined) {
		if (!value) return;
		try {
			await navigator.clipboard.writeText(value);
			audit.push('success', `Copied ${fieldKey}`, { clears: '60s' });
			// Unconditional clear at 60s. Firefox + many Chrome configs
			// deny `clipboard-read` permission, so the previous
			// readText-and-compare path silently left secrets on the
			// clipboard forever. An occasional clobber of an unrelated
			// later copy is preferable to leaking credentials.
			setTimeout(() => {
				navigator.clipboard.writeText('').catch(() => {
					audit.push('warn', `Auto-clear of clipboard was rejected for ${fieldKey}`);
				});
			}, 60_000);
		} catch {
			audit.push('warn', `Clipboard write rejected`);
		}
	}

	// Health snapshot for the currently selected item. The health
	// computation lives in `password-health.ts` and runs locally over
	// the in-memory items; this view only reads derived booleans + bits.
	const itemHealth = $derived(item ? vault.health.byId.get(item.id) : undefined);

	// Snapshot identity of the item being deleted at the moment the
	// dialog opens — `vault.selected` is reactive and could change
	// underneath us (e.g. another tab activity) before the user
	// confirms.
	let pendingDelete = $state<{ id: string; title: string } | null>(null);

	function requestDelete(target: VaultItem) {
		pendingDelete = { id: target.id, title: target.title };
	}

	function confirmDelete() {
		if (pendingDelete) vault.remove(pendingDelete.id);
		pendingDelete = null;
	}

	// Live TOTP ticker — uses parseTotpSeed so plain Base32 and otpauth://
	// both work. Only LoginItem carries `totpSeed`; narrow on kind so
	// the type system enforces it.
	const loginItem = $derived(item && item.kind === 'login' ? item : null);
	let totp = $state<{ code: string; secondsRemaining: number } | null>(null);
	let totpError = $state<string | null>(null);
	$effect(() => {
		const seed = loginItem?.totpSeed;
		if (!seed) {
			totp = null;
			totpError = null;
			return;
		}
		let parsed: ReturnType<typeof parseTotpSeed>;
		try {
			parsed = parseTotpSeed(seed);
			totpError = null;
		} catch (err) {
			totp = null;
			totpError = err instanceof Error ? err.message : 'Unparseable TOTP seed';
			return;
		}
		const tick = () => {
			try {
				totp = generateTOTP({
					secret: parsed.secret,
					period: parsed.period,
					digits: parsed.digits,
					algorithm: parsed.algorithm
				});
			} catch {
				totp = null;
			}
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	});
</script>

<div class="detail">
	{#if !item}
		<div class="placeholder">
			<div class="placeholder-title">Select an item</div>
			<div class="placeholder-body">
				Pick something from the list, or press <kbd>⌘N</kbd> to add a new item.
			</div>
		</div>
	{:else}
		<header class="head">
			<div>
				<div class="kind">{item.kind}</div>
				<h2 class="title">{item.title}</h2>
				{#if item.subtitle}
					<div class="subtitle">{item.subtitle}</div>
				{/if}
			</div>
			<div class="head-actions">
				{#if onEdit}
					<button class="head-btn" onclick={() => onEdit?.(item)}>Edit</button>
				{/if}
				<button
					class="head-btn danger"
					onclick={() => requestDelete(item)}>Delete</button
				>
			</div>
		</header>

		{#if itemHealth && (itemHealth.weak || itemHealth.reused)}
			<div class="health-banner" role="status">
				<IconWarning size={14} stroke={2} />
				<div>
					{#if itemHealth.weak && itemHealth.reused}
						<strong>Weak and reused password.</strong>
						This password is below the minimum-entropy threshold and is also
						stored on another vault item. Generate a stronger one and update.
					{:else if itemHealth.weak}
						<strong>Weak password.</strong>
						{#if itemHealth.weakReason === 'common'}
							This password appears in a list of widely-known weak credentials.
						{:else if itemHealth.weakReason === 'short'}
							This password is too short.
						{:else}
							This password is below the minimum-entropy threshold.
						{/if}
						Estimated strength: {Math.round(itemHealth.bits)} bits.
					{:else if itemHealth.reused}
						<strong>Reused password.</strong>
						The same password is also stored on at least one other vault item.
						Reuse turns one breach into many — generate a unique one.
					{/if}
				</div>
			</div>
		{/if}

		<div class="fields">
			{#if item.kind === 'login'}
				{#if item.username}
					<div class="field">
						<div class="key">Username</div>
						<div class="row">
							<div class="value">{item.username}</div>
							<button
								class="ico-btn"
								onclick={() => copyValue('username', item.username)}
								aria-label="Copy username"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}

				{#if item.password}
					<div class="field">
						<div class="key">Password</div>
						<div class="row">
							<div class="value mono">
								{revealedFields.password ? item.password : '••••••••••••••••'}
							</div>
							<button
								class="ico-btn"
								onclick={() => toggle('password')}
								aria-label="Toggle reveal"
							>
								{#if revealedFields.password}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
							<button
								class="ico-btn"
								onclick={() => copyValue('password', item.password)}
								aria-label="Copy password"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
						{#if revealedFields.password}
							<div class="hint">Auto-hides in 30 seconds</div>
						{/if}
					</div>
				{/if}

				{#if item.url}
					{@const href = safeHref(item.url)}
					<div class="field">
						<div class="key">Website</div>
						<div class="row">
							{#if href}
								<a
									{href}
									class="value link"
									target="_blank"
									rel="noreferrer noopener"
								>
									{item.url}
								</a>
							{:else}
								<div class="value warn-text" title="URL scheme is not http(s); rendered as text for safety">
									{item.url}
								</div>
							{/if}
							<button
								class="ico-btn"
								onclick={() => copyValue('url', item.url)}
								aria-label="Copy URL"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
						{#if !href}
							<div class="hint warn">
								This URL uses a non-http(s) scheme and was not rendered as a clickable link.
							</div>
						{/if}
					</div>
				{/if}

				{#if totp}
					<div class="field">
						<div class="key">2FA · TOTP</div>
						<div class="row">
							<div class="value totp">
								<IconClock size={12} stroke={1.6} />
								<span class="code">{totp.code}</span>
								<span class="ttl">{totp.secondsRemaining}s</span>
							</div>
							<button
								class="ico-btn"
								onclick={() => copyValue('totp', totp?.code)}
								aria-label="Copy code"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{:else if totpError}
					<div class="field">
						<div class="key">2FA · TOTP</div>
						<div class="row warn">
							<IconWarning size={12} stroke={2} />
							<div class="value">{totpError}</div>
						</div>
					</div>
				{/if}
			{:else if item.kind === 'card'}
				{#if item.cardholder}
					<div class="field">
						<div class="key">Cardholder</div>
						<div class="row">
							<div class="value">{item.cardholder}</div>
						</div>
					</div>
				{/if}
				{#if item.cardNumber}
					<div class="field">
						<div class="key">Card number</div>
						<div class="row">
							<div class="value mono">
								{revealedFields.cardNumber
									? item.cardNumber
									: '•••• •••• •••• ' + item.cardNumber.slice(-4)}
							</div>
							<button
								class="ico-btn"
								onclick={() => toggle('cardNumber')}
								aria-label="Toggle reveal"
							>
								{#if revealedFields.cardNumber}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
							<button
								class="ico-btn"
								onclick={() => copyValue('card', item.cardNumber)}
								aria-label="Copy card"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}
				<div class="grid-2">
					{#if item.cardExpiry}
						<div class="field">
							<div class="key">Expiry</div>
							<div class="row">
								<div class="value mono">{item.cardExpiry}</div>
							</div>
						</div>
					{/if}
					{#if item.cardCvc}
						<div class="field">
							<div class="key">CVC</div>
							<div class="row">
								<div class="value mono">
									{revealedFields.cardCvc ? item.cardCvc : '•••'}
								</div>
								<button
									class="ico-btn"
									onclick={() => toggle('cardCvc')}
									aria-label="Toggle CVC"
								>
									{#if revealedFields.cardCvc}
										<IconEyeOff size={14} stroke={1.6} />
									{:else}
										<IconEye size={14} stroke={1.6} />
									{/if}
								</button>
							</div>
						</div>
					{/if}
				</div>
			{:else if item.kind === 'note'}
				{#if item.noteBody}
					<div class="field">
						<div class="key">Body</div>
						<div class="row note-row">
							<div class="value mono note-body">
								{revealedFields.noteBody
									? item.noteBody
									: '••• Hidden — click reveal to read •••'}
							</div>
						</div>
						<div class="row-actions">
							<button class="head-btn" onclick={() => toggle('noteBody')}>
								{revealedFields.noteBody ? 'Hide' : 'Reveal'}
							</button>
							<button
								class="head-btn"
								onclick={() => copyValue('note', item.noteBody)}
							>
								Copy
							</button>
						</div>
					</div>
				{/if}
			{:else if item.kind === 'identity'}
				{#if item.identityName}
					<div class="field">
						<div class="key">Full name</div>
						<div class="row">
							<div class="value">{String(item.identityName)}</div>
							<button
								class="ico-btn"
								onclick={() => copyValue('name', String(item.identityName))}
								aria-label="Copy name"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}
				{#if item.identityEmail}
					<div class="field">
						<div class="key">Email</div>
						<div class="row">
							<div class="value">{String(item.identityEmail)}</div>
							<button
								class="ico-btn"
								onclick={() => copyValue('email', String(item.identityEmail))}
								aria-label="Copy email"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}
				{#if item.identityPhone}
					<div class="field">
						<div class="key">Phone</div>
						<div class="row">
							<div class="value">{String(item.identityPhone)}</div>
							<button
								class="ico-btn"
								onclick={() => copyValue('phone', String(item.identityPhone))}
								aria-label="Copy phone"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}
				{#if item.identityAddress}
					<div class="field">
						<div class="key">Address</div>
						<div class="row note-row">
							<div class="value">{String(item.identityAddress)}</div>
						</div>
					</div>
				{/if}
			{:else if item.kind === 'ssh'}
				{#if item.sshKeyBody}
					<div class="field">
						<div class="key">Private key</div>
						<div class="row note-row">
							<div class="value mono note-body">
								{revealedFields.sshKeyBody
									? String(item.sshKeyBody)
									: '••• Hidden — click reveal to display •••'}
							</div>
						</div>
						<div class="row-actions">
							<button class="head-btn" onclick={() => toggle('sshKeyBody')}>
								{revealedFields.sshKeyBody ? 'Hide' : 'Reveal'}
							</button>
							<button
								class="head-btn"
								onclick={() => copyValue('ssh-key', String(item.sshKeyBody))}
							>
								Copy
							</button>
						</div>
					</div>
				{/if}
				{#if item.sshPassphrase}
					<div class="field">
						<div class="key">Passphrase</div>
						<div class="row">
							<div class="value mono">
								{revealedFields.password ? String(item.sshPassphrase) : '••••••••'}
							</div>
							<button class="ico-btn" onclick={() => toggle('password')} aria-label="Toggle">
								{#if revealedFields.password}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
							<button
								class="ico-btn"
								onclick={() => copyValue('passphrase', String(item.sshPassphrase))}
								aria-label="Copy"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}
			{:else if item.kind === 'crypto-seed'}
				{#if item.seedPhrase}
					<div class="field">
						<div class="key">Seed phrase</div>
						<div class="row note-row">
							<div class="value mono note-body">
								{revealedFields.seedPhrase
									? String(item.seedPhrase)
									: '••• Hidden — click reveal to display •••'}
							</div>
						</div>
						<div class="row-actions">
							<button class="head-btn" onclick={() => toggle('seedPhrase')}>
								{revealedFields.seedPhrase ? 'Hide' : 'Reveal'}
							</button>
							<button
								class="head-btn"
								onclick={() => copyValue('seed', String(item.seedPhrase))}
							>
								Copy
							</button>
						</div>
					</div>
				{/if}
			{:else if item.kind === 'document'}
				<div class="info-row">
					<IconWarning size={14} stroke={2} />
					<div>
						<strong>Metadata-only document.</strong>
						Encrypted file-blob storage ships in a later milestone. Description and
						external reference are stored encrypted alongside other vault items.
					</div>
				</div>
				{#if item.docDescription}
					<div class="field">
						<div class="key">Description</div>
						<div class="row note-row">
							<div class="value note-body">{String(item.docDescription)}</div>
						</div>
						<div class="row-actions">
							<button
								class="head-btn"
								onclick={() => copyValue('description', String(item.docDescription))}
							>
								Copy
							</button>
						</div>
					</div>
				{/if}
				{#if item.docExternalRef}
					<div class="field">
						<div class="key">External reference</div>
						<div class="row">
							<div class="value mono">{String(item.docExternalRef)}</div>
							<button
								class="ico-btn"
								onclick={() =>
									copyValue('docExternalRef', String(item.docExternalRef))}
								aria-label="Copy reference"
							>
								<IconCopy size={14} stroke={1.6} />
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<ConfirmDialog
	open={pendingDelete !== null}
	title={pendingDelete ? `Delete "${pendingDelete.title}"?` : 'Delete item?'}
	message="This item will be removed from the vault. This action cannot be undone."
	confirmLabel="Delete"
	cancelLabel="Cancel"
	variant="danger"
	onConfirm={confirmDelete}
	onCancel={() => (pendingDelete = null)}
/>

<style>
	.detail {
		background: var(--bg-elev);
		overflow-y: auto;
		padding: 24px 28px;
		height: 100%;
		box-sizing: border-box;
	}
	.placeholder {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 8px;
	}
	.placeholder-title {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-2);
	}
	.placeholder-body {
		font-size: 13px;
		color: var(--text-3);
		max-width: 320px;
		line-height: 1.5;
	}
	kbd {
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 2px 6px;
		background: var(--surface-strong);
		border: 1px solid var(--border-mid);
		border-radius: var(--radius-xs);
		color: var(--text-2);
	}

	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 24px;
		padding-bottom: 18px;
		border-bottom: 1px solid var(--border);
	}
	.head-actions {
		display: flex;
		gap: 8px;
	}
	.head-btn {
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 600;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		color: var(--text-2);
		background: var(--surface);
		transition: var(--transition);
		cursor: pointer;
	}
	.head-btn:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.head-btn.danger:hover {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
	}
	.kind {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 700;
		margin-bottom: 6px;
	}
	.title {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text);
		margin: 0;
	}
	.subtitle {
		font-size: 13px;
		color: var(--text-3);
		margin-top: 4px;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.key {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	.row.note-row {
		align-items: flex-start;
	}
	.row.warn {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 35%, var(--border));
	}
	.row-actions {
		display: flex;
		gap: 6px;
	}
	.value {
		flex: 1;
		font-size: 13px;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.value.mono {
		font-family: var(--font-mono);
		letter-spacing: 0.02em;
	}
	.value.link {
		color: var(--accent);
	}
	.value.warn-text {
		color: var(--warn);
		font-family: var(--font-mono);
		font-size: 12px;
		word-break: break-all;
	}
	.hint.warn {
		color: var(--warn);
	}
	.value.totp {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.note-body {
		white-space: pre-wrap;
		text-overflow: clip;
		word-break: break-word;
		max-height: 240px;
		overflow-y: auto;
	}
	.code {
		font-family: var(--font-mono);
		font-size: 18px;
		font-weight: 700;
		letter-spacing: 0.16em;
		color: var(--accent);
	}
	.ttl {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
	}
	.ico-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		transition: var(--transition);
		cursor: pointer;
	}
	.ico-btn:hover {
		background: var(--surface-hover);
		color: var(--text);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--warn);
	}
	.info-row,
	.health-banner {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 14px 16px;
		background: color-mix(in srgb, var(--warn) 6%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--border));
		border-radius: var(--radius);
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.info-row strong,
	.health-banner strong {
		color: var(--warn);
		display: block;
		margin-bottom: 2px;
	}
	.health-banner {
		margin-bottom: 18px;
	}
</style>
