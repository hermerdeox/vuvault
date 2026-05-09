<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import BrandMark from '$lib/components/BrandMark.svelte';
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconKey,
		IconWarning,
		IconRefresh
	} from '$lib/icons';

	import {
		decodeSecretKey,
		parseVuKeyFile,
		SECRET_KEY_BASE32_LEN
	} from '$lib/crypto/secret-key';
	import { hasAccount, clearAll, getAccount } from '$lib/utils/storage';
	import { audit } from '$lib/stores/audit.svelte';
	import { postTabMessage } from '$lib/services/tab-sync';

	type Scenario = 'menu' | 'lost-passkey' | 'fresh-start';

	let scenario = $state<Scenario>('menu');
	let loading = $state(true);
	let accountExists = $state(false);
	let deviceLabel = $state('');
	let authMode = $state<'production' | 'demo' | null>(null);

	let secretKeyInput = $state('');
	let confirmFreshStart = $state(false);
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);

	const validKey = $derived.by(() => {
		try {
			decodeSecretKey(secretKeyInput);
			return true;
		} catch {
			return false;
		}
	});

	onMount(async () => {
		accountExists = await hasAccount();
		if (accountExists) {
			const acct = await getAccount();
			deviceLabel = acct?.deviceLabel ?? '';
			authMode = acct?.authMode ?? null;
		}
		loading = false;
	});

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			secretKeyInput = parseVuKeyFile(text);
			errorMessage = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Could not parse file';
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	async function rewirePasskey() {
		// Phase 5 placeholder: re-registering a new passkey + re-sealing
		// the vault under a new PRF derivation requires re-entering the
		// onboarding flow so the new credentialId is bound to a fresh
		// device salt and the existing items are re-encrypted. The full
		// implementation lands when sync is wired in Phase 6+.
		errorMessage =
			'Passkey re-registration is wired through fresh start for now. To migrate items, unlock with your Secret Key first, export, then start fresh and re-import. The full in-place re-wiring lands in Phase 6.';
	}

	async function startFresh() {
		if (busy) return;
		if (!confirmFreshStart) return;
		busy = true;
		errorMessage = null;
		try {
			await clearAll();
			// Tell every other tab they're now sitting on a vault that
			// no longer exists. They drop their in-memory state and
			// will route to /onboarding on next render.
			postTabMessage('wiped');
			audit.push('warn', 'Local data cleared via /recover');
			goto('/onboarding');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to clear local data';
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Recover · VuVault</title>
</svelte:head>

<main class="screen">
	<header class="topbar">
		<BrandMark showPill="Recover" />
		<ThemeToggle />
	</header>

	{#if loading}
		<section class="screen-inner">
			<div class="loading">Reading account…</div>
		</section>
	{:else if scenario === 'menu'}
		<section class="screen-inner">
			<Eyebrow>Recovery</Eyebrow>
			<h1 class="h1">
				Pick your <span class="italic-serif">situation.</span>
			</h1>
			<p class="lede">
				By design, VuVault cannot un-lose your secrets for you — that's the whole point.
				Recovery is local, scoped, and honest about what each option costs.
			</p>

			<div class="options">
				<button
					class="option"
					onclick={() => (scenario = 'lost-passkey')}
					disabled={!accountExists}
				>
					<div class="option-title">Lost my passkey</div>
					<div class="option-body">
						You still have the <strong>Secret Key</strong> and access to this device, but
						your authenticator is gone. Re-register a new passkey and re-seal the vault.
					</div>
					{#if !accountExists}
						<div class="option-tag">No account on this device</div>
					{:else if authMode === 'demo'}
						<div class="option-tag">Demo mode — no passkey to recover</div>
					{/if}
				</button>

				<button class="option" onclick={() => (scenario = 'fresh-start')}>
					<div class="option-title">Start fresh</div>
					<div class="option-body">
						Wipe local data on this device and run onboarding again. <strong
							>Existing encrypted vault on this device will be deleted.</strong
						> Any synced copy on other devices remains untouched.
					</div>
				</button>

				<div class="option disabled">
					<div class="option-title">Restore from sync</div>
					<div class="option-body">
						Pull encrypted blob from a paired device or self-hosted server. <strong>
							Wires up in Phase 5+
						</strong> — depends on the OPAQUE/blob-sync server.
					</div>
					<div class="option-tag">Coming in Phase 5+</div>
				</div>

				<div class="option disabled">
					<div class="option-title">Threshold recovery (FROST)</div>
					<div class="option-body">
						t-of-n signing across paired devices recovers vault access without a
						server. <strong>Phase 6+.</strong>
					</div>
					<div class="option-tag">Coming in Phase 6+</div>
				</div>
			</div>

			<div class="cta-row">
				<Button variant="ghost" href="/unlock">
					<IconArrowLeft size={14} />
					Back to unlock
				</Button>
			</div>
		</section>
	{:else if scenario === 'lost-passkey'}
		<section class="screen-inner">
			<Eyebrow>Lost passkey · {deviceLabel}</Eyebrow>
			<h1 class="h1">Re-bind your <span class="italic-serif">authenticator.</span></h1>
			<p class="lede">
				Provide your 256-bit Secret Key. We'll guide you through registering a new
				passkey and re-sealing the vault under the new PRF binding.
			</p>

			<div class="field">
				<label for="rec-secret">Secret Key</label>
				<div
					class="input-zone"
					ondrop={onDrop}
					ondragover={onDragOver}
					role="region"
					aria-label="Secret Key input"
				>
					<IconKey size={16} stroke={1.6} />
					<textarea
						id="rec-secret"
						bind:value={secretKeyInput}
						placeholder="Paste your Crockford-Base32 Secret Key, or drop a .vukey file"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						rows="3"
					></textarea>
				</div>
				<div class="field-hint">
					{#if validKey}
						<span class="ok">Secret Key parsed</span>
					{:else if secretKeyInput.length > 0}
						<span class="warn">Not a valid 256-bit Secret Key</span>
					{:else}
						<span class="muted">{SECRET_KEY_BASE32_LEN} characters · 13 groups of 4</span>
					{/if}
				</div>
			</div>

			{#if errorMessage}
				<div class="err">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}

			<div class="cta-row">
				<Button variant="ghost" onclick={() => (scenario = 'menu')}>
					<IconArrowLeft size={14} />
					Back
				</Button>
				<Button onclick={rewirePasskey} disabled={!validKey}>
					<IconRefresh size={14} stroke={1.8} />
					Re-bind passkey
				</Button>
			</div>
		</section>
	{:else if scenario === 'fresh-start'}
		<section class="screen-inner">
			<Eyebrow>Start fresh</Eyebrow>
			<h1 class="h1">
				Delete local data,<br />
				<span class="italic-serif">start onboarding again.</span>
			</h1>
			<p class="lede">
				This wipes the encrypted vault, account record, and audit log on this device. If
				you have synced copies elsewhere, this device will re-pull on next sign-in (Phase
				5+). If this is your only copy, the data is gone — by design.
			</p>

			<label class="confirm">
				<input type="checkbox" bind:checked={confirmFreshStart} />
				<div class="confirm-text">
					I understand this <strong>permanently deletes</strong> the encrypted vault on
					this device. There is no undo.
				</div>
			</label>

			{#if errorMessage}
				<div class="err">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}

			<div class="cta-row">
				<Button variant="ghost" onclick={() => (scenario = 'menu')}>
					<IconArrowLeft size={14} />
					Back
				</Button>
				<Button
					variant="primary"
					size="lg"
					onclick={startFresh}
					disabled={!confirmFreshStart || busy}
				>
					Wipe and restart
					<IconArrowRight size={14} stroke={2.2} />
				</Button>
			</div>
		</section>
	{/if}
</main>

<style>
	.screen {
		height: 100dvh;
		display: grid;
		grid-template-rows: var(--header-h) 1fr;
		background: var(--bg);
	}
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 32px;
		border-bottom: 1px solid var(--border);
	}
	.screen-inner {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 48px 64px;
		max-width: 760px;
		gap: 18px;
		overflow-y: auto;
	}
	.loading {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text-3);
	}
	.h1 {
		font-size: clamp(36px, 5vw, 56px);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1;
	}
	.italic-serif {
		font-family: var(--font-serif);
		font-style: italic;
		font-weight: 400;
		font-size: 1.06em;
	}
	.lede {
		font-size: 16px;
		color: var(--text-2);
		line-height: 1.55;
		max-width: 600px;
	}

	.options {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px;
		margin-top: 12px;
	}
	.option {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 20px;
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-2);
		transition: var(--transition);
		cursor: pointer;
		font: inherit;
	}
	.option:hover:not(:disabled):not(.disabled) {
		background: var(--surface-hover);
		border-color: var(--accent);
		color: var(--text);
	}
	.option:disabled,
	.option.disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.option-title {
		font-size: 15px;
		font-weight: 700;
		color: var(--text);
		letter-spacing: -0.01em;
	}
	.option-body {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.option-body strong {
		color: var(--text);
	}
	.option-tag {
		margin-top: auto;
		padding: 3px 8px;
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: var(--radius-xs);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		align-self: flex-start;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 8px;
	}
	label {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.input-zone {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 12px;
		padding: 14px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-3);
		transition: var(--transition);
	}
	.input-zone:focus-within {
		border-color: var(--accent);
		background: var(--accent-faint);
		color: var(--accent);
	}
	.input-zone textarea {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text);
		letter-spacing: 0.02em;
		resize: none;
		width: 100%;
		min-height: 60px;
		background: transparent;
		border: none;
		outline: none;
	}
	.input-zone textarea::placeholder {
		color: var(--text-3);
	}
	.field-hint {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.field-hint .ok {
		color: var(--success);
	}
	.field-hint .warn {
		color: var(--warn);
	}
	.field-hint .muted {
		color: var(--text-3);
	}

	.confirm {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 14px 16px;
		background: color-mix(in srgb, var(--warn) 6%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border));
		border-radius: var(--radius);
		cursor: pointer;
	}
	.confirm input {
		margin-top: 3px;
	}
	.confirm-text {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.5;
	}
	.confirm-text strong {
		color: var(--warn);
	}

	.err {
		display: inline-flex;
		gap: 8px;
		align-items: flex-start;
		padding: 10px 14px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--radius);
		line-height: 1.5;
	}

	.cta-row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin-top: 18px;
	}
</style>
