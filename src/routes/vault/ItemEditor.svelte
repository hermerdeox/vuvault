<script lang="ts">
	import Modal from '$lib/components/Modal.svelte';
	import GeneratorPanel from './GeneratorPanel.svelte';
	import {
		detectNetwork,
		formatCardNumber,
		formatExpiry,
		expiryComplete,
		cardNumberComplete,
		cvcLengthFor,
		stripDigits,
		networkLabel
	} from '$lib/utils/card';
	import { vault, type VaultItem, type ItemKind } from '$lib/stores/vault.svelte';
	import type { VaultItemPayload } from '$lib/types/vault-item';
	import { audit } from '$lib/stores/audit.svelte';
	import {
		validateLogin,
		validateCard,
		validateNote,
		validateIdentity,
		validateSsh,
		validateSeed,
		validateDocument,
		labelFor,
		DOCUMENT_FILE_MAX
	} from './item-validation';
	import {
		IconKey,
		IconCard,
		IconUser,
		IconNote,
		IconTerminal,
		IconShield,
		IconDocument,
		IconRefresh,
		IconEye,
		IconEyeOff,
		IconWarning
	} from '$lib/icons';
	import { untrack } from 'svelte';

	type Props = {
		open: boolean;
		mode: 'create' | 'edit';
		initial: VaultItem | null;
		kind: ItemKind | null;
		/** When true (and kind is 'login'), open the inline password generator immediately. */
		openGenerator?: boolean;
		onClose: () => void;
	};

	let { open, mode, initial, kind, openGenerator = false, onClose }: Props = $props();
	const initialMode = untrack(() => mode);
	const initialItem = untrack(() => initial);
	const initialRequestedKind = untrack(() => kind);
	const initialOpenGenerator = untrack(() => openGenerator);

	type KindOption = {
		id: ItemKind;
		label: string;
		icon: typeof IconKey;
	};

	const KIND_OPTIONS: KindOption[] = [
		{ id: 'login', label: 'Login', icon: IconKey },
		{ id: 'card', label: 'Card', icon: IconCard },
		{ id: 'note', label: 'Secure note', icon: IconNote },
		{ id: 'identity', label: 'Identity', icon: IconUser },
		{ id: 'ssh', label: 'SSH key', icon: IconTerminal },
		{ id: 'crypto-seed', label: 'Crypto seed', icon: IconShield },
		{ id: 'document', label: 'Document', icon: IconDocument }
	];

	let selectedKind = $state<ItemKind | null>(null);
	let title = $state('');
	let url = $state('');
	let username = $state('');
	let password = $state('');
	let totpSeed = $state('');
	let cardholder = $state('');
	let cardNumber = $state('');
	let cardExpiry = $state('');
	let cardCvc = $state('');

	// Card intelligence: live network detection + formatting +
	// auto-advance (number → expiry → CVC). All local (utils/card).
	const cardNetwork = $derived(detectNetwork(cardNumber));
	let cardExpiryRef = $state<HTMLInputElement | undefined>();
	let cardCvcRef = $state<HTMLInputElement | undefined>();

	function onCardNumberInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const before = input.value.slice(0, input.selectionStart ?? input.value.length);
		const digitsBefore = stripDigits(before).length;
		cardNumber = formatCardNumber(input.value);
		input.value = cardNumber;
		// Restore the caret after reformatting: walk to the position
		// that has the same number of digits before it.
		let pos = 0;
		let seen = 0;
		while (pos < cardNumber.length && seen < digitsBefore) {
			if (/\d/.test(cardNumber[pos]!)) seen += 1;
			pos += 1;
		}
		input.setSelectionRange(pos, pos);
		if (cardNumberComplete(cardNumber)) cardExpiryRef?.focus();
	}

	function onCardExpiryInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		cardExpiry = formatExpiry(input.value);
		input.value = cardExpiry;
		if (expiryComplete(cardExpiry)) cardCvcRef?.focus();
	}

	function onCardCvcInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		cardCvc = stripDigits(input.value).slice(0, cvcLengthFor(cardNumber));
		input.value = cardCvc;
	}
	let noteBody = $state('');
	let identityName = $state('');
	let identityEmail = $state('');
	let identityPhone = $state('');
	let identityAddress = $state('');
	let sshKeyBody = $state('');
	let sshPassphrase = $state('');
	let seedPhrase = $state('');
	let docDescription = $state('');
	let docExternalRef = $state('');
	let docFileName = $state<string | undefined>(undefined);
	let docMimeType = $state<string | undefined>(undefined);
	let docSize = $state<number | undefined>(undefined);
	let docSha256 = $state<string | undefined>(undefined);
	let docBlobId = $state<string | undefined>(undefined);
	let docRemote = $state<boolean | undefined>(undefined);
	let docAttaching = $state(false);
	let docError = $state<string | null>(null);

	let showGenerator = $state(false);

	// Per-secret reveal toggles. Default hidden — use type="password" so
	// the field is masked, copy-protected by the browser, and can't be
	// captured by basic screen recording without an explicit reveal.
	let showPassword = $state(false);
	let showCvc = $state(false);
	let showSshPassphrase = $state(false);
	let showSeed = $state(false);
	let showSshKey = $state(false);
	let revealTimers: Record<string, number> = {};

	let attemptedSave = $state(false);

	const initialKind =
		initialMode === 'edit' && initialItem ? initialItem.kind : initialRequestedKind;
	if (initialMode === 'edit' && initialItem) {
		hydrateFromInitial(initialItem);
	} else {
		reset();
	}
	if (initialOpenGenerator && (initialKind === 'login' || initialKind === null)) {
		selectedKind = 'login';
		showGenerator = true;
	}

	const validation = $derived.by(() => {
		switch (selectedKind) {
			case 'login':
				return validateLogin({ title, url, username, password, totpSeed });
			case 'card':
				return validateCard({ title, cardholder, cardNumber, cardExpiry, cardCvc });
			case 'note':
				return validateNote({ title, noteBody });
			case 'identity':
				return validateIdentity({
					title,
					identityName,
					identityEmail,
					identityPhone,
					identityAddress
				});
			case 'ssh':
				return validateSsh({ title, sshKeyBody, sshPassphrase });
			case 'crypto-seed':
				return validateSeed({ title, seedPhrase });
			case 'document':
				return validateDocument({
					title,
					docDescription,
					docExternalRef,
					docFileName,
					docMimeType,
					docSize
				});
			default:
				return { ok: false, fieldErrors: {} as Record<string, string> };
		}
	});

	function reset() {
		selectedKind = initialRequestedKind ?? null;
		title = '';
		url = '';
		username = '';
		password = '';
		totpSeed = '';
		cardholder = '';
		cardNumber = '';
		cardExpiry = '';
		cardCvc = '';
		noteBody = '';
		identityName = '';
		identityEmail = '';
		identityPhone = '';
		identityAddress = '';
		sshKeyBody = '';
		sshPassphrase = '';
		seedPhrase = '';
		docDescription = '';
		docExternalRef = '';
		docFileName = undefined;
		docMimeType = undefined;
		docSize = undefined;
		docSha256 = undefined;
		docBlobId = undefined;
		docRemote = undefined;
		docAttaching = false;
		docError = null;
		showGenerator = false;
		showPassword = false;
		showCvc = false;
		showSshPassphrase = false;
		showSeed = false;
		showSshKey = false;
		clearRevealTimers();
		attemptedSave = false;
	}

	function clearRevealTimers(): void {
		for (const timer of Object.values(revealTimers)) clearTimeout(timer);
		revealTimers = {};
	}

	function revealFor(key: string, setValue: (visible: boolean) => void, current: boolean): void {
		if (current) {
			setValue(false);
			if (revealTimers[key]) clearTimeout(revealTimers[key]);
			const { [key]: _removed, ...rest } = revealTimers;
			void _removed;
			revealTimers = rest;
			return;
		}
		setValue(true);
		if (revealTimers[key]) clearTimeout(revealTimers[key]);
		revealTimers = {
			...revealTimers,
			[key]: window.setTimeout(() => {
				setValue(false);
				const { [key]: _removed, ...rest } = revealTimers;
				void _removed;
				revealTimers = rest;
			}, 30_000)
		};
	}

	function hydrateFromInitial(item: VaultItem) {
		selectedKind = item.kind;
		title = item.title ?? '';
		// Type-narrow per kind so the discriminated union doesn't
		// surface fields from other variants. Each branch only reads
		// the fields its kind actually owns.
		switch (item.kind) {
			case 'login':
				url = item.url ?? '';
				username = item.username ?? '';
				password = item.password ?? '';
				totpSeed = item.totpSeed ?? '';
				break;
			case 'card':
				cardholder = item.cardholder ?? '';
				cardNumber = item.cardNumber ?? '';
				cardExpiry = item.cardExpiry ?? '';
				cardCvc = item.cardCvc ?? '';
				break;
			case 'note':
				noteBody = item.noteBody ?? '';
				break;
			case 'identity':
				identityName = item.identityName ?? '';
				identityEmail = item.identityEmail ?? '';
				identityPhone = item.identityPhone ?? '';
				identityAddress = item.identityAddress ?? '';
				break;
			case 'ssh':
				sshKeyBody = item.sshKeyBody ?? '';
				sshPassphrase = item.sshPassphrase ?? '';
				break;
			case 'crypto-seed':
				seedPhrase = item.seedPhrase ?? '';
				break;
			case 'document':
				docDescription = item.docDescription ?? '';
				docExternalRef = item.docExternalRef ?? '';
				docFileName = item.docFileName;
				docMimeType = item.docMimeType;
				docSize = item.docSize;
				docSha256 = item.docSha256;
				docBlobId = item.docBlobId;
				docRemote = item.docRemote;
				break;
		}
	}

	function buildPayload(): VaultItemPayload | null {
		if (!selectedKind) return null;
		const trimmedTitle = title.trim();
		if (!trimmedTitle) return null;

		switch (selectedKind) {
			case 'login':
				return {
					kind: 'login',
					title: trimmedTitle,
					url: url.trim() || undefined,
					username: username.trim() || undefined,
					password: password || undefined,
					totpSeed: totpSeed.trim() || undefined,
					subtitle: username.trim() || url.trim() || undefined
				};
			case 'card':
				return {
					kind: 'card',
					title: trimmedTitle,
					cardholder: cardholder.trim() || undefined,
					cardNumber: cardNumber.trim() || undefined,
					cardExpiry: cardExpiry.trim() || undefined,
					cardCvc: cardCvc.trim() || undefined,
					subtitle: cardNumber
						? `•••• ${cardNumber.replace(/\s/g, '').slice(-4)}`
						: undefined
				};
			case 'note':
				return {
					kind: 'note',
					title: trimmedTitle,
					noteBody: noteBody,
					subtitle: 'Secure note'
				};
			case 'identity':
				return {
					kind: 'identity',
					title: trimmedTitle,
					identityName: identityName.trim() || undefined,
					identityEmail: identityEmail.trim() || undefined,
					identityPhone: identityPhone.trim() || undefined,
					identityAddress: identityAddress.trim() || undefined,
					subtitle: identityName.trim() || identityEmail.trim() || undefined
				};
			case 'ssh':
				return {
					kind: 'ssh',
					title: trimmedTitle,
					sshKeyBody: sshKeyBody,
					sshPassphrase: sshPassphrase || undefined,
					subtitle: 'SSH key'
				};
			case 'crypto-seed':
				return {
					kind: 'crypto-seed',
					title: trimmedTitle,
					seedPhrase: seedPhrase,
					subtitle: 'Crypto seed phrase'
				};
			case 'document':
				return {
					kind: 'document',
					title: trimmedTitle,
					docDescription: docDescription.trim() || undefined,
					docExternalRef: docExternalRef.trim() || undefined,
					docFileName,
					docMimeType,
					docSize,
					docSha256,
					docBlobId,
					docRemote,
					subtitle: docFileName
						? docFileName
						: docExternalRef.trim()
							? 'Document (reference only)'
							: 'Document'
				};
		}
	}

	let saveError = $state<string | null>(null);

	function save() {
		attemptedSave = true;
		saveError = null;
		if (!validation.ok) return;
		const payload = buildPayload();
		if (!payload) return;
		try {
			if (mode === 'create') {
				vault.add(payload);
			} else if (initial) {
				vault.update(initial.id, payload as Partial<VaultItem>);
			}
		} catch (err) {
			// Most likely VaultCapacityError when the user has hit the
			// hard cap, but surface any thrown error rather than
			// silently swallowing it.
			saveError =
				err instanceof Error ? err.message : 'Could not save the item.';
			audit.push('danger', `Item save failed: ${saveError}`);
			return;
		}
		onClose();
	}

	function pickKind(k: ItemKind) {
		selectedKind = k;
		attemptedSave = false;
	}

	function applyGeneratedPassword(value: string) {
		password = value;
		showGenerator = false;
	}

	async function onDocumentFileChange(ev: Event) {
		const target = ev.currentTarget as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		docError = null;
		if (file.size > DOCUMENT_FILE_MAX) {
			docError = `File is too large (max ${(DOCUMENT_FILE_MAX / (1024 * 1024)).toFixed(1)} MB).`;
			target.value = '';
			return;
		}
		docAttaching = true;
		try {
			const { attachDocumentFile } = await import('$lib/services/document-blobs');
			const result = await attachDocumentFile(file);
			docBlobId = result.blobId;
			docFileName = result.fileName;
			docMimeType = result.mimeType;
			docSize = result.size;
			docSha256 = result.sha256Hex;
			docRemote = result.remote;
			audit.push('success', `Attached document (${result.size} bytes)`, {
				blob: result.blobId.slice(0, 8),
				remote: result.remote ? 'pushed' : 'local'
			});
		} catch (err) {
			docError = err instanceof Error ? err.message : 'Could not attach the file.';
			audit.push('danger', `Document attach failed: ${docError}`);
		} finally {
			docAttaching = false;
			target.value = '';
		}
	}

	async function clearDocumentFile() {
		if (!docBlobId) return;
		const idToPurge = docBlobId;
		try {
			const { purgeDocumentBlob } = await import('$lib/services/document-blobs');
			await purgeDocumentBlob(idToPurge);
		} catch {
			// Non-fatal — the user can still proceed without an attachment.
		}
		docBlobId = undefined;
		docFileName = undefined;
		docMimeType = undefined;
		docSize = undefined;
		docSha256 = undefined;
		docRemote = undefined;
		docError = null;
	}

	function formatDocSize(n: number | undefined): string {
		if (typeof n !== 'number') return '';
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / (1024 * 1024)).toFixed(2)} MB`;
	}

	function err(field: string): string | null {
		if (!attemptedSave) return null;
		return validation.fieldErrors[field] ?? null;
	}

	function errId(field: string): string {
		return `ie-error-${field}`;
	}

	function describedBy(field: string, extra?: string): string | undefined {
		const ids = [extra, err(field) ? errId(field) : undefined].filter(Boolean);
		return ids.length > 0 ? ids.join(' ') : undefined;
	}

	const docFileDescribedBy = $derived(
		[
			'ie-doc-file-hint',
			docError ? 'ie-doc-file-error' : undefined,
			err('docFile') ? errId('docFile') : undefined
		]
			.filter(Boolean)
			.join(' ')
	);
</script>

<Modal {open} title={mode === 'create' ? 'Add to vault' : 'Edit item'} {onClose} size="md">
	{#if !selectedKind}
		<div class="picker">
			<div class="picker-label">Choose what you're saving</div>
			<div class="picker-grid">
				{#each KIND_OPTIONS as opt (opt.id)}
					{@const Icon = opt.icon}
					<button class="picker-item" onclick={() => pickKind(opt.id)}>
						<Icon size={18} stroke={1.6} />
						<span>{opt.label}</span>
					</button>
				{/each}
			</div>
			<p class="picker-note">
				Files attached to document items are sealed client-side with the
				active vault key (AES-256-GCM) before they touch local storage or
				the sync server.
			</p>
		</div>
	{:else}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<div class="kind-pill">{labelFor(selectedKind)}</div>

			{#if saveError}
				<div class="save-error" role="alert">
					<IconWarning size={14} stroke={2} />
					<div>{saveError}</div>
				</div>
			{/if}

			<div class="field">
				<label for="ie-title">Title</label>
				<input
					id="ie-title"
					type="text"
					bind:value={title}
					placeholder="Display name"
					autocomplete="off"
					maxlength="200"
					aria-invalid={err('title') !== null}
					aria-describedby={describedBy('title')}
				/>
				{#if err('title')}
					<div class="field-err" id={errId('title')}>{err('title')}</div>
				{/if}
			</div>

			{#if selectedKind === 'login'}
					<div class="field">
						<label for="ie-url">Website</label>
						<input
							id="ie-url"
							type="url"
							bind:value={url}
							placeholder="https://example.com"
							autocomplete="off"
							aria-invalid={err('url') !== null}
							aria-describedby={describedBy('url')}
						/>
						{#if err('url')}
							<div class="field-err" id={errId('url')}>{err('url')}</div>
						{/if}
					</div>
					<div class="field">
						<label for="ie-username">Username</label>
						<input
							id="ie-username"
							type="text"
							bind:value={username}
							autocomplete="off"
							aria-invalid={err('username') !== null}
							aria-describedby={describedBy('username')}
						/>
						{#if err('username')}
							<div class="field-err" id={errId('username')}>{err('username')}</div>
						{/if}
					</div>
					<div class="field">
						<label for="ie-password">Password</label>
						<div class="row">
							<input
								id="ie-password"
								type={showPassword ? 'text' : 'password'}
								bind:value={password}
								autocomplete="new-password"
								aria-describedby={describedBy('password')}
							/>
							<button
								type="button"
								class="ico-btn"
								onclick={() =>
									revealFor('password', (visible) => (showPassword = visible), showPassword)}
								aria-label={showPassword ? 'Hide password' : 'Reveal password'}
								title={showPassword ? 'Hide password' : 'Reveal password'}
							>
								{#if showPassword}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
							<button
								type="button"
								class="row-btn"
								onclick={() => (showGenerator = !showGenerator)}
							>
								<IconRefresh size={12} stroke={1.8} />
								Generate
							</button>
						</div>
						{#if showGenerator}
							<div class="generator-host">
								<GeneratorPanel
									onUse={applyGeneratedPassword}
									onCancel={() => (showGenerator = false)}
								/>
							</div>
						{/if}
					</div>
					<div class="field">
						<label for="ie-totp">TOTP seed (optional)</label>
						<input
							id="ie-totp"
							type="text"
							bind:value={totpSeed}
							placeholder="otpauth://… or Base32 secret"
							autocomplete="off"
							aria-invalid={err('totpSeed') !== null}
							aria-describedby={describedBy('totpSeed')}
						/>
						{#if err('totpSeed')}
							<div class="field-err" id={errId('totpSeed')}>{err('totpSeed')}</div>
						{/if}
					</div>
				{:else if selectedKind === 'card'}
					<div class="field">
						<label for="ie-holder">Cardholder</label>
						<input
							id="ie-holder"
							type="text"
							bind:value={cardholder}
							autocomplete="off"
							autocapitalize="characters"
							enterkeyhint="next"
							placeholder="Name on card"
						/>
					</div>
					<div class="field">
						<label for="ie-num">Card number</label>
						<div class="card-num-wrap">
							<input
								id="ie-num"
								type="text"
								value={cardNumber}
								oninput={onCardNumberInput}
								inputmode="numeric"
								autocomplete="off"
								enterkeyhint="next"
								placeholder="1234 5678 9012 3456"
								class="mono"
								aria-invalid={err('cardNumber') !== null}
								aria-describedby={describedBy('cardNumber')}
							/>
							{#if cardNetwork !== 'unknown'}
								<span class="network-badge">{networkLabel(cardNetwork)}</span>
							{/if}
						</div>
						{#if err('cardNumber')}
							<div class="field-err" id={errId('cardNumber')}>{err('cardNumber')}</div>
						{/if}
					</div>
					<div class="grid-2">
						<div class="field">
							<label for="ie-exp">Expiry</label>
							<input
								id="ie-exp"
								type="text"
								value={cardExpiry}
								oninput={onCardExpiryInput}
								bind:this={cardExpiryRef}
								placeholder="MM/YY"
								inputmode="numeric"
								autocomplete="off"
								enterkeyhint="next"
								maxlength="5"
								class="mono"
								aria-invalid={err('cardExpiry') !== null}
								aria-describedby={describedBy('cardExpiry')}
							/>
							{#if err('cardExpiry')}
								<div class="field-err" id={errId('cardExpiry')}>{err('cardExpiry')}</div>
							{/if}
						</div>
						<div class="field">
							<label for="ie-cvc">CVC</label>
							<div class="row">
								<input
									id="ie-cvc"
									type={showCvc ? 'text' : 'password'}
									value={cardCvc}
									oninput={onCardCvcInput}
									bind:this={cardCvcRef}
									inputmode="numeric"
									autocomplete="off"
									enterkeyhint="done"
									maxlength={cvcLengthFor(cardNumber)}
									class="mono"
									aria-invalid={err('cardCvc') !== null}
									aria-describedby={describedBy('cardCvc')}
								/>
								<button
									type="button"
									class="ico-btn"
									onclick={() => revealFor('cardCvc', (visible) => (showCvc = visible), showCvc)}
									aria-label={showCvc ? 'Hide CVC' : 'Reveal CVC'}
								>
									{#if showCvc}
										<IconEyeOff size={14} stroke={1.6} />
									{:else}
										<IconEye size={14} stroke={1.6} />
									{/if}
								</button>
							</div>
							{#if err('cardCvc')}
								<div class="field-err" id={errId('cardCvc')}>{err('cardCvc')}</div>
							{/if}
						</div>
					</div>
				{:else if selectedKind === 'note'}
					<div class="field">
						<label for="ie-note">Body</label>
						<textarea
							id="ie-note"
							bind:value={noteBody}
							rows="8"
							aria-invalid={err('noteBody') !== null}
							aria-describedby={describedBy('noteBody')}
						></textarea>
						{#if err('noteBody')}
							<div class="field-err" id={errId('noteBody')}>{err('noteBody')}</div>
						{/if}
					</div>
				{:else if selectedKind === 'identity'}
					<div class="field">
						<label for="ie-name">Full name</label>
						<input
							id="ie-name"
							type="text"
							bind:value={identityName}
							autocomplete="off"
						/>
					</div>
					<div class="grid-2">
						<div class="field">
							<label for="ie-email">Email</label>
							<input
								id="ie-email"
								type="email"
								bind:value={identityEmail}
								autocomplete="off"
								aria-invalid={err('identityEmail') !== null}
								aria-describedby={describedBy('identityEmail')}
							/>
							{#if err('identityEmail')}
								<div class="field-err" id={errId('identityEmail')}>{err('identityEmail')}</div>
							{/if}
						</div>
						<div class="field">
							<label for="ie-phone">Phone</label>
							<input
								id="ie-phone"
								type="tel"
								bind:value={identityPhone}
								autocomplete="off"
								aria-invalid={err('identityPhone') !== null}
								aria-describedby={describedBy('identityPhone')}
							/>
							{#if err('identityPhone')}
								<div class="field-err" id={errId('identityPhone')}>{err('identityPhone')}</div>
							{/if}
						</div>
					</div>
					<div class="field">
						<label for="ie-address">Address</label>
						<textarea
							id="ie-address"
							bind:value={identityAddress}
							rows="3"
							aria-invalid={err('identityAddress') !== null}
							aria-describedby={describedBy('identityAddress')}
						></textarea>
						{#if err('identityAddress')}
							<div class="field-err" id={errId('identityAddress')}>{err('identityAddress')}</div>
						{/if}
					</div>
				{:else if selectedKind === 'ssh'}
					<div class="field">
						<label for="ie-ssh">Private key</label>
						<div class="row reveal-row">
							<textarea
								id="ie-ssh"
								bind:value={sshKeyBody}
								rows="8"
								class="mono"
								class:masked={!showSshKey}
								placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
								aria-invalid={err('sshKeyBody') !== null}
								aria-describedby={describedBy('sshKeyBody')}
							></textarea>
							<button
								type="button"
								class="ico-btn"
								onclick={() =>
									revealFor('sshKeyBody', (visible) => (showSshKey = visible), showSshKey)}
								aria-label={showSshKey ? 'Hide private key' : 'Reveal private key'}
							>
								{#if showSshKey}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
						</div>
						{#if err('sshKeyBody')}
							<div class="field-err" id={errId('sshKeyBody')}>
								<IconWarning size={12} stroke={2} /> {err('sshKeyBody')}
							</div>
						{/if}
					</div>
					<div class="field">
						<label for="ie-ssh-pp">Passphrase</label>
						<div class="row">
							<input
								id="ie-ssh-pp"
								type={showSshPassphrase ? 'text' : 'password'}
								bind:value={sshPassphrase}
								autocomplete="new-password"
								aria-describedby={describedBy('sshPassphrase')}
							/>
							<button
								type="button"
								class="ico-btn"
								onclick={() =>
									revealFor(
										'sshPassphrase',
										(visible) => (showSshPassphrase = visible),
										showSshPassphrase
									)}
								aria-label={showSshPassphrase ? 'Hide passphrase' : 'Reveal passphrase'}
							>
								{#if showSshPassphrase}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
						</div>
					</div>
				{:else if selectedKind === 'crypto-seed'}
					<div class="field">
						<label for="ie-seed">Seed phrase</label>
						<div class="row reveal-row">
							<textarea
								id="ie-seed"
								bind:value={seedPhrase}
								rows="4"
								class="mono"
								class:masked={!showSeed}
								placeholder="word word word …"
								aria-invalid={err('seedPhrase') !== null}
								aria-describedby={describedBy('seedPhrase')}
							></textarea>
							<button
								type="button"
								class="ico-btn"
								onclick={() => revealFor('seedPhrase', (visible) => (showSeed = visible), showSeed)}
								aria-label={showSeed ? 'Hide seed phrase' : 'Reveal seed phrase'}
							>
								{#if showSeed}
									<IconEyeOff size={14} stroke={1.6} />
								{:else}
									<IconEye size={14} stroke={1.6} />
								{/if}
							</button>
						</div>
						{#if err('seedPhrase')}
							<div class="field-err" id={errId('seedPhrase')}>{err('seedPhrase')}</div>
						{/if}
					</div>
				{:else if selectedKind === 'document'}
					<div class="info-banner">
						<IconShield size={14} stroke={2} />
						<div>
							<strong>Encrypted client-side.</strong>
							The file is sealed in your browser with the active vault key
							(AES-256-GCM, document-scoped AAD) before it touches local
							storage or the sync server. The server only ever holds opaque
							ciphertext.
						</div>
					</div>
					<div class="field">
						<label for="ie-doc-file">File</label>
						<div class="doc-attach-row">
							<input
								id="ie-doc-file"
								type="file"
								onchange={onDocumentFileChange}
								disabled={docAttaching}
								data-testid="document-file-input"
								aria-invalid={Boolean(docError || err('docFile'))}
								aria-describedby={docFileDescribedBy}
							/>
							{#if docAttaching}
								<span class="hint">Encrypting…</span>
							{/if}
						</div>
						{#if docFileName}
							<div class="doc-summary" data-testid="document-summary">
								<div class="doc-summary-row">
									<span class="doc-key">Name</span>
									<span class="doc-val">{docFileName}</span>
								</div>
								<div class="doc-summary-row">
									<span class="doc-key">Type</span>
									<span class="doc-val mono">{docMimeType || 'application/octet-stream'}</span>
								</div>
								<div class="doc-summary-row">
									<span class="doc-key">Size</span>
									<span class="doc-val mono">{formatDocSize(docSize)}</span>
								</div>
								{#if docSha256}
									<div class="doc-summary-row">
										<span class="doc-key">SHA-256</span>
										<span class="doc-val mono doc-digest" title={docSha256}>
											{docSha256.slice(0, 16)}…
										</span>
									</div>
								{/if}
								<div class="doc-summary-row">
									<span class="doc-key">Sync</span>
									<span class="doc-val mono">
										{docRemote ? 'pushed to server (opaque ciphertext)' : 'local only'}
									</span>
								</div>
								<button
									type="button"
									class="btn ghost doc-clear-btn"
									onclick={clearDocumentFile}
								>
									Remove file
								</button>
							</div>
						{/if}
						{#if docError}
							<div class="field-err" id="ie-doc-file-error" role="alert">
								<IconWarning size={12} stroke={2} /> {docError}
							</div>
						{/if}
						{#if err('docFile')}
							<div class="field-err" id={errId('docFile')}>{err('docFile')}</div>
						{/if}
						<div class="hint" id="ie-doc-file-hint">
							Maximum {(DOCUMENT_FILE_MAX / (1024 * 1024)).toFixed(1)} MB per
							document.
						</div>
					</div>
					<div class="field">
						<label for="ie-doc-desc">Description (optional)</label>
						<textarea
							id="ie-doc-desc"
							bind:value={docDescription}
							rows="3"
							placeholder="What this document is, why it matters…"
							aria-invalid={err('docDescription') !== null}
							aria-describedby={describedBy('docDescription')}
						></textarea>
						{#if err('docDescription')}
							<div class="field-err" id={errId('docDescription')}>{err('docDescription')}</div>
						{/if}
					</div>
					<div class="field">
						<label for="ie-doc-ref">External reference (optional)</label>
						<input
							id="ie-doc-ref"
							type="text"
							bind:value={docExternalRef}
							placeholder="bucket://archives/lease.pdf or other opaque reference"
							autocomplete="off"
							aria-invalid={err('docExternalRef') !== null}
							aria-describedby={describedBy('docExternalRef')}
						/>
						{#if err('docExternalRef')}
							<div class="field-err" id={errId('docExternalRef')}>{err('docExternalRef')}</div>
						{/if}
					</div>
				{/if}
			</form>
		{/if}

	{#snippet footer()}
		{#if selectedKind}
			<button class="btn ghost" onclick={onClose}>Cancel</button>
			<button
				class="btn primary"
				onclick={save}
				disabled={!title.trim() || (attemptedSave && !validation.ok)}
			>
				{mode === 'create' ? 'Add to vault' : 'Save changes'}
			</button>
		{:else}
			<button class="btn ghost" onclick={onClose}>Cancel</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.picker-label {
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.picker-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	:global(html[data-vp~='mobile']) .picker-grid {
		/* On phones the 3-col grid pushed cells to ~80 px each, below
		   thumb-comfortable. Drop to 2-col so each option is ~152 px
		   wide on a 360 px modal. */
		grid-template-columns: repeat(2, 1fr);
	}
	.picker-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 16px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
		cursor: pointer;
	}
	.picker-item:hover {
		background: var(--accent-dim);
		border-color: color-mix(in srgb, var(--accent) 35%, transparent);
		color: var(--accent);
		transform: translateY(-1px);
	}
	.picker-note {
		margin: 0;
		padding: 10px 12px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		line-height: 1.5;
		background: var(--surface);
		border: 1px dashed var(--border);
		border-radius: var(--radius-sm);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.save-error {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 14px;
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--radius);
		font-size: 13px;
		color: var(--danger);
		line-height: 1.5;
	}
	.kind-pill {
		display: inline-block;
		align-self: flex-start;
		padding: 4px 10px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	label {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	input,
	textarea {
		font-size: 14px;
		color: var(--text);
		padding: 10px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: var(--transition);
		width: 100%;
		font-family: inherit;
	}
	textarea {
		resize: vertical;
		min-height: 60px;
	}
	input.mono,
	textarea.mono {
		font-family: var(--font-mono);
		font-size: 13px;
		letter-spacing: 0.02em;
	}
	/* Visually mask multi-line secret fields. WebKit/Blink ship the
	   non-standard `-webkit-text-security` for masked textareas; Firefox
	   has no equivalent today, so we fall back to a sturdy
	   `font-family: 'masked'` swap that keeps the layout stable while
	   substituting glyphs that don't reveal characters. The user always
	   has the explicit "reveal" toggle to confirm content. */
	textarea.masked {
		-webkit-text-security: disc;
		text-security: disc;
		font-family: 'Courier New', Courier, monospace;
		letter-spacing: 0.4em;
		color: transparent;
		text-shadow: 0 0 6px var(--text);
	}
	input:focus,
	textarea:focus {
		border-color: var(--accent);
		background: var(--bg);
	}
	input[aria-invalid='true'],
	textarea[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.field-err {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--danger);
		line-height: 1.4;
	}

	.grid-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.row {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.row.reveal-row {
		align-items: flex-start;
	}
	.row input,
	.row textarea {
		flex: 1;
	}
	.card-num-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}
	.card-num-wrap input {
		flex: 1;
		padding-right: 120px;
	}
	.network-badge {
		position: absolute;
		right: 10px;
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 4px 10px;
		border-radius: 999px;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		pointer-events: none;
		white-space: nowrap;
		animation: badge-in 200ms ease;
	}
	@keyframes badge-in {
		from {
			opacity: 0;
			transform: translateX(4px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
	@media (pointer: coarse) {
		.row-btn,
		.btn {
			min-height: 44px;
		}
	}
	.row-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 10px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--accent);
		background: var(--accent-dim);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: var(--transition);
	}
	.row-btn:hover {
		filter: brightness(1.1);
	}
	.ico-btn {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		background: var(--surface);
		border: 1px solid var(--border);
		transition: var(--transition);
		cursor: pointer;
		flex-shrink: 0;
	}
	:global(html[data-vp~='mobile']) .ico-btn,
	:global(html[data-vp~='tablet']) .ico-btn {
		width: 44px;
		height: 44px;
	}
	.ico-btn:hover {
		color: var(--text);
		background: var(--surface-hover);
	}

	.generator-host {
		margin-top: 12px;
		padding: 14px;
		background: var(--surface-strong);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.info-banner {
		display: flex;
		gap: 10px;
		padding: 12px 14px;
		background: color-mix(in srgb, var(--warn) 8%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--warn) 30%, var(--border));
		border-radius: var(--radius);
		color: var(--text-2);
		font-size: 13px;
		line-height: 1.5;
	}
	.info-banner strong {
		display: block;
		color: var(--warn);
		margin-bottom: 2px;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 16px;
		font-size: 13px;
		font-weight: 600;
		border-radius: var(--radius-sm);
		transition: var(--transition);
		cursor: pointer;
	}
	.btn.ghost {
		color: var(--text-3);
		background: transparent;
		border: 1px solid transparent;
	}
	.btn.ghost:hover {
		color: var(--text);
		background: var(--surface);
	}
	.btn.primary {
		background: var(--brand);
		color: var(--bg);
		border: 1px solid var(--brand);
	}
	.btn.primary:hover:not(:disabled) {
		filter: brightness(0.96);
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.doc-attach-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.doc-attach-row .hint {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
	}
	.doc-summary {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 12px;
	}
	.doc-summary-row {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 10px;
		align-items: center;
	}
	.doc-key {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.doc-val {
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.doc-val.mono {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.doc-digest {
		letter-spacing: 0.02em;
	}
	.doc-clear-btn {
		align-self: flex-start;
		margin-top: 4px;
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
	}
</style>
