<script lang="ts">
	import { vault, type VaultItem } from '$lib/stores/vault.svelte';
	import { audit } from '$lib/stores/audit.svelte';
	import { generateTOTP, parseTotpSeed } from '$lib/crypto/totp';
	import { safeHref } from '$lib/utils/sanitize';
	import { copySecretToClipboard } from '$lib/services/secure-clipboard';
	import { IconEye, IconEyeOff, IconCopy, IconClock, IconWarning } from '$lib/icons';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CreditCard from './CreditCard.svelte';

	type Props = {
		onEdit?: (item: VaultItem) => void;
	};
	let { onEdit }: Props = $props();

	const item = $derived(vault.selected);

	// Reveal state for the current item. Persists to vault.revealedField so
	// the ⌘K palette can flip it from outside this component.
	const itemId = $derived(item?.id ?? null);
	let revealedFields = $state<Record<string, boolean>>({});
	let revealTimers: Record<string, number> = {};
	let lastItemId: string | null = null;

	const REVEAL_TTL_MS = 30_000;

	// When the palette toggles vault.revealedField, reveal only the
	// primary secret field for the current item. Field-scoped reveal
	// keeps the blast radius smaller than revealing every secret at once.
	$effect(() => {
		const flag = vault.revealedField;
		const id = itemId;
		const current = item;
		if (!flag || !id || flag !== id || !current) return;
		reveal(primarySecretField(current), /*silent*/ true);
	});

	$effect(() => {
		if (vault.status !== 'unlocked') hideAll();
	});

	// Reset local reveal state when selection changes.
	$effect(() => {
		const id = itemId;
		if (id === lastItemId) return;
		lastItemId = id;
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
		const { [fieldKey]: _removed, ...rest } = revealTimers;
		void _removed;
		revealTimers = rest;
		if (vault.revealedField === itemId) vault.revealedField = null;
	}

	function hideAll() {
		for (const k of Object.keys(revealTimers)) {
			clearTimeout(revealTimers[k]);
		}
		revealedFields = {};
		revealTimers = {};
		vault.revealedField = null;
	}

	function primarySecretField(target: VaultItem): string {
		switch (target.kind) {
			case 'card':
				return 'cardNumber';
			case 'note':
				return 'noteBody';
			case 'ssh':
				return target.sshKeyBody ? 'sshKeyBody' : 'password';
			case 'crypto-seed':
				return 'seedPhrase';
			default:
				return 'password';
		}
	}

	function toggle(fieldKey: string) {
		if (revealedFields[fieldKey]) hide(fieldKey);
		else reveal(fieldKey);
	}

	async function copyValue(fieldKey: string, value: string | undefined) {
		await copySecretToClipboard(fieldKey, value);
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

	let docBusy = $state(false);
	let docError = $state<string | null>(null);

	function formatDocSize(n: number | undefined): string {
		if (typeof n !== 'number') return '';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MB`;
	}

	async function downloadDocument(target: VaultItem) {
		if (target.kind !== 'document' || !target.docBlobId) return;
		docBusy = true;
		docError = null;
		try {
			const { readDocumentBlob } = await import('$lib/services/document-blobs');
			const plaintext = await readDocumentBlob(target.docBlobId);
			const blob = new Blob([new Uint8Array(plaintext)], {
				type: target.docMimeType || 'application/octet-stream'
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = target.docFileName || `${target.title || 'document'}.bin`;
			a.rel = 'noopener noreferrer';
			document.body.appendChild(a);
			a.click();
			a.remove();
			// Revoke the object URL on the next tick — Chrome/Firefox
			// both keep the download alive once a.click() returns.
			setTimeout(() => URL.revokeObjectURL(url), 1_000);
			audit.push('warn', `Decrypted and downloaded document`, {
				blob: target.docBlobId.slice(0, 8)
			});
		} catch (err) {
			docError =
				err instanceof Error ? err.message : 'Could not decrypt the document.';
			audit.push('danger', `Document download failed: ${docError}`);
		} finally {
			docBusy = false;
		}
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
					{@const externalHref = href?.startsWith('http://') || href?.startsWith('https://') ? href : null}
					<div class="field">
						<div class="key">Website</div>
						<div class="row">
							{#if externalHref}
								<a
									href={externalHref}
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
				<div class="card-hero">
					<div class="card-col">
						<div class="cc-host">
						<CreditCard
							cardholder={item.cardholder}
							cardNumber={item.cardNumber}
							cardExpiry={item.cardExpiry}
							revealed={Boolean(revealedFields.cardNumber)}
						/>
					</div>
					<aside class="billing">
						<div class="billing-head">Billing information</div>
						{#if item.billingAddress || item.billingCity || item.billingState || item.billingZip || item.billingCountry}
							<address class="billing-block">
								{#if item.cardholder}<div class="billing-line name">{item.cardholder}</div>{/if}
								{#if item.billingAddress}<div class="billing-line">{item.billingAddress}</div>{/if}
								{#if item.billingCity || item.billingState || item.billingZip}
									<div class="billing-line">
										{[item.billingCity, item.billingState].filter(Boolean).join(', ')}
										{item.billingZip ?? ''}
									</div>
								{/if}
								{#if item.billingCountry}<div class="billing-line country">{item.billingCountry}</div>{/if}
							</address>
							<button
								class="billing-copy"
								onclick={() =>
									copyValue(
										'billing address',
										[
											item.billingAddress,
											[item.billingCity, item.billingState].filter(Boolean).join(', ') +
												(item.billingZip ? ' ' + item.billingZip : ''),
											item.billingCountry
										]
											.filter((l) => l && l.trim())
											.join('\n')
									)}
							>
								<IconCopy size={12} stroke={1.6} />
								Copy address
							</button>
						{:else}
							<div class="billing-empty">
								No billing information on file.
								<span>Use Edit to add the card's billing address.</span>
							</div>
						{/if}
					</aside>
					</div>
					<div class="card-fields">
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
					</div>
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
				{#if item.docBlobId && item.docFileName}
					<div class="field">
						<div class="key">File</div>
						<div class="row">
							<div class="value">{item.docFileName}</div>
						</div>
					</div>
					<div class="grid-2">
						{#if item.docMimeType}
							<div class="field">
								<div class="key">Type</div>
								<div class="row">
									<div class="value mono">{item.docMimeType}</div>
								</div>
							</div>
						{/if}
						{#if typeof item.docSize === 'number'}
							<div class="field">
								<div class="key">Size</div>
								<div class="row">
									<div class="value mono">{formatDocSize(item.docSize)}</div>
								</div>
							</div>
						{/if}
					</div>
					{#if item.docSha256}
						<div class="field">
							<div class="key">SHA-256</div>
							<div class="row">
								<div class="value mono" title={item.docSha256}>
									{item.docSha256.slice(0, 32)}…
								</div>
								<button
									class="ico-btn"
									onclick={() => copyValue('sha256', item.docSha256)}
									aria-label="Copy SHA-256"
								>
									<IconCopy size={14} stroke={1.6} />
								</button>
							</div>
						</div>
					{/if}
					<div class="row-actions" data-testid="document-actions">
						<button
							class="head-btn"
							onclick={() => downloadDocument(item)}
							disabled={docBusy}
							data-testid="download-document"
						>
							{docBusy ? 'Decrypting…' : 'Download'}
						</button>
					</div>
					{#if docError}
						<div class="hint warn" role="alert">{docError}</div>
					{/if}
				{:else}
					<div class="info-row">
						<IconWarning size={14} stroke={2} />
						<div>
							<strong>Metadata-only document.</strong>
							This document has no attached encrypted file. Attach one from
							Edit, or use the description / external reference below.
						</div>
					</div>
				{/if}
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
		background: color-mix(in srgb, var(--bg-elev) 72%, transparent);
		overflow-y: auto;
		padding: 24px 28px;
		height: 100%;
		box-sizing: border-box;
	}
	:global(html[data-vp~='mobile']) .detail {
		padding: 16px 14px;
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
	:global(html[data-vp~='mobile']) .head-btn,
	:global(html[data-vp~='tablet']) .head-btn {
		min-height: 44px;
		padding: 10px 14px;
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
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-weight: 700;
		margin-bottom: 10px;
		padding: 4px 11px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
	}
	.kind::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
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
	@media (max-width: 45em) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
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
	:global(html[data-vp~='mobile']) .ico-btn,
	:global(html[data-vp~='tablet']) .ico-btn {
		width: 44px;
		height: 44px;
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
	.cc-host {
		min-width: 0;
	}
	.card-hero {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 24px;
		margin-bottom: 8px;
	}
	.card-col {
		flex: 0 1 440px;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	/* Desktop: the field rows live to the RIGHT of the card; below
	   ~900px content width they wrap underneath naturally. */
	.card-fields {
		flex: 1 1 340px;
		min-width: 300px;
	}
	.billing {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 18px 20px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.billing-head {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.billing-head::before {
		content: '';
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent);
	}
	.billing-block {
		font-style: normal;
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
	}
	.billing-line {
		font-size: 14px;
		color: var(--text);
		line-height: 1.45;
	}
	.billing-line.name {
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		font-size: 13px;
	}
	.billing-line.country {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.billing-copy {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--bg-elev);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
	}
	.billing-copy:hover {
		color: var(--text);
		border-color: var(--border-mid);
	}
	@media (pointer: coarse) {
		.billing-copy {
			min-height: 44px;
		}
	}
	.billing-empty {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 6px;
		justify-content: center;
		font-size: 13px;
		color: var(--text-2);
	}
	.billing-empty span {
		font-size: 12px;
		color: var(--text-3);
	}
</style>
