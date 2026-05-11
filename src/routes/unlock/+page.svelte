<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	import BrandMark from '$lib/components/BrandMark.svelte';
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import {
		IconArrowRight,
		IconFingerprint,
		IconKey,
		IconWarning,
		IconUnlock
	} from '$lib/icons';

	import {
		decodeSecretKey,
		parseVuKeyFile,
		SECRET_KEY_BASE32_LEN,
		encodeBase32
	} from '$lib/crypto/secret-key';
	import { hasAccount, getAccount } from '$lib/utils/storage';
	import {
		verifyBundleIntegrity,
		type BundleIntegrity,
		isSyncOriginConfigured,
		getSyncOrigin
	} from '$lib/utils/env';
	import { vault } from '$lib/stores/vault.svelte';
	import { audit } from '$lib/stores/audit.svelte';

	import type { Argon2idStoredParams, OpaqueState } from '$lib/utils/storage';

	// PERFORMANCE: the heavy crypto + sync modules below are loaded
	// lazily inside `unlock()` so the unlock page can render before
	// ~155 KB of Noble curves / ML-KEM-1024 / OPAQUE / Argon2 ships.
	// The user expects work to happen after they click "Unlock"
	// (PRF roundtrip, optional Argon2 ~1-2 s) — the few extra ms
	// to fetch the chunk inside that click are unnoticeable.

	let loading = $state(true);
	let deviceLabel = $state('');
	let credentialId = $state<ArrayBuffer | null>(null);
	let deviceSalt = $state<Uint8Array | null>(null);

	let secretKeyInput = $state('');
	let masterPasswordInput = $state('');
	let unlocking = $state(false);
	let attempts = $state(0);
	const MAX_ATTEMPTS = 3;
	let errorMessage = $state<string | null>(null);
	let dragOver = $state(false);
	// Tracks the loaded account's auth mode so the UI can label demo unlocks accurately.
	let authMode = $state<'production' | 'demo' | null>(null);
	let integrity = $state<BundleIntegrity | null>(null);
	let masterPasswordRequired = $state(false);
	let masterPasswordSalt = $state<Uint8Array | null>(null);
	let masterPasswordParams = $state<Argon2idStoredParams | null>(null);
	let opaqueState = $state<OpaqueState>('none');
	let opaqueServerId = $state<string | null>(null);
	let opaqueClientId = $state<string | null>(null);

	const validKey = $derived.by(() => {
		try {
			decodeSecretKey(secretKeyInput);
			return true;
		} catch {
			return false;
		}
	});
	const locked = $derived(attempts >= MAX_ATTEMPTS);

	onMount(async () => {
		if (!(await hasAccount())) {
			goto('/onboarding');
			return;
		}
		const account = await getAccount();
		if (!account) {
			goto('/onboarding');
			return;
		}
		deviceLabel = account.deviceLabel;
		credentialId = account.credentialId;
		deviceSalt = account.deviceSalt;
		authMode = account.authMode;
		masterPasswordRequired = account.masterPasswordEnabled === true;
		masterPasswordSalt = account.masterPasswordSalt ?? null;
		masterPasswordParams = account.masterPasswordParams ?? null;
		opaqueState = account.opaqueState ?? 'none';
		opaqueServerId = account.opaqueServerId ?? null;
		opaqueClientId = account.opaqueClientId ?? null;
		integrity = await verifyBundleIntegrity();
		loading = false;
	});

	async function unlock() {
		if (locked || unlocking) return;
		// Bundle-integrity gate. If the running bundle doesn't match
		// the build-time manifest we refuse to decrypt — a tampered
		// bundle could exfiltrate the Secret Key the moment we ran
		// `decodeSecretKey`. `placeholder` (dev builds) and the
		// genuinely verified state are both allowed; `mismatch` and
		// `unsupported` block.
		if (
			integrity?.state === 'mismatch' ||
			integrity?.state === 'unsupported'
		) {
			errorMessage =
				`Bundle integrity check failed — refusing to decrypt. ` +
				`Verify the published hash on Rekor (${integrity.rekorUrl}) and reload from the canonical origin.`;
			audit.push('danger', 'Unlock blocked by bundle integrity check', {
				state: integrity.state,
				chunk: integrity.mismatchedChunk ?? '(aggregate)'
			});
			return;
		}
		if (!validKey || !credentialId || !deviceSalt) {
			errorMessage = 'Provide a 256-bit Secret Key to continue.';
			return;
		}
		unlocking = true;
		errorMessage = null;

		let secretKey: Uint8Array;
		try {
			secretKey = decodeSecretKey(secretKeyInput);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Invalid Secret Key';
			unlocking = false;
			return;
		}

		// Lazy-load every heavy crypto path now that the user has
		// clicked. These imports pull the Noble curves chunk,
		// ML-KEM-1024, OPAQUE, and Argon2id WASM — collectively ~155
		// KB JS + 143 KB WASM that would otherwise block first paint.
		// The fetches happen in parallel with `Promise.all`.
		const [vaultSessionMod, opaqueClientMod, syncClientMod, argon2Mod] =
			await Promise.all([
				import('$lib/services/vault-session'),
				import('$lib/services/opaque-client'),
				import('$lib/services/sync-client'),
				import('$lib/crypto/argon2')
			]);
		const { openVault } = vaultSessionMod;
		const { login, createFetchTransport } = opaqueClientMod;
		const { setSessionToken } = syncClientMod;
		const { deriveMasterPasswordKey } = argon2Mod;

		// Optional Argon2id master-password derivation. Runs locally
		// before openVault — adds ~2–3s with VAULT_HIGH_PARAMS, but
		// the alternative is shipping the password to a server, which
		// we explicitly don't.
		let masterPasswordKey: Uint8Array | undefined;
		try {
			if (masterPasswordRequired) {
				if (!masterPasswordInput || !masterPasswordSalt || !masterPasswordParams) {
					errorMessage = 'Master password is required for this vault.';
					secretKey.fill(0);
					unlocking = false;
					return;
				}
				masterPasswordKey = await deriveMasterPasswordKey({
					password: masterPasswordInput,
					salt: masterPasswordSalt,
					params: masterPasswordParams
				});
			}
		} catch (err) {
			secretKey.fill(0);
			errorMessage =
				err instanceof Error ? err.message : 'Master-password derivation failed.';
			unlocking = false;
			return;
		}

		// Optional OPAQUE login. Required when the account row says
		// `opaqueState === 'enrolled'` AND `authMode === 'production'`.
		// On success: the export key is folded into openVault's
		// derivation, and the bearer token is stashed in
		// sessionStorage (NEVER localStorage — the token must die
		// with the tab).
		//
		// Demo accounts skip OPAQUE entirely (B6 invariant).
		// If sync is configured but the server is unreachable, we
		// surface a "server unreachable, try again or recover" error
		// without burning an attempt — wrong-password rejection
		// (401) DOES burn an attempt.
		let opaqueExportKey: Uint8Array | undefined;
		try {
			const useOpaque =
				authMode === 'production' &&
				opaqueState === 'enrolled' &&
				opaqueServerId &&
				opaqueClientId &&
				isSyncOriginConfigured();
			if (useOpaque) {
				const transport = createFetchTransport(getSyncOrigin());
				const password = encodeBase32(secretKey);
				const log = await login({
					serverId: opaqueServerId!,
					clientId: opaqueClientId!,
					password,
					transport
				});
				opaqueExportKey = log.exportKey;
				// Blob sync is only available after the Worker returns
				// a session token from OPAQUE login. If this deployment
				// omits token minting, keep blob operations local-only.
				setSessionToken(log.token ?? null);
				audit.push('success', 'OPAQUE login complete', {
					serverId: opaqueServerId!
				});
			}
		} catch (err) {
			secretKey.fill(0);
			if (masterPasswordKey) masterPasswordKey.fill(0);
			const msg = err instanceof Error ? err.message : 'OPAQUE login failed';
			// 401 / "MAC" / "auth" → wrong password, count attempt.
			// Other errors → server unreachable, do NOT count attempt.
			if (/MAC|auth|wrong|401/i.test(msg)) {
				attempts += 1;
				const remaining = MAX_ATTEMPTS - attempts;
				errorMessage =
					remaining > 0
						? `Unlock failed. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
						: 'Recovery required.';
			} else {
				errorMessage =
					'Sync server unreachable. Reconnect or use the recovery flow to unlock locally.';
			}
			audit.push('warn', 'OPAQUE login failed', { message: msg });
			unlocking = false;
			return;
		}

		try {
			const items = await openVault({
				secretKey,
				masterPasswordKey,
				opaqueExportKey
			});
			vault.loadFromDecrypted(items);
			audit.push('success', 'Vault unlocked', { items: items.length });
			secretKey.fill(0);
			if (masterPasswordKey) masterPasswordKey.fill(0);
			if (opaqueExportKey) opaqueExportKey.fill(0);
			secretKeyInput = '';
			masterPasswordInput = '';
			goto('/vault');
		} catch (err) {
			secretKey.fill(0);
			if (masterPasswordKey) masterPasswordKey.fill(0);
			if (opaqueExportKey) opaqueExportKey.fill(0);
			attempts += 1;
			const remaining = MAX_ATTEMPTS - attempts;
			errorMessage =
				remaining > 0
					? `Unlock failed. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
					: 'Recovery required.';
			audit.push('warn', 'Unlock attempt failed', { attempts });
		} finally {
			unlocking = false;
		}
	}

	function onPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text');
		if (text) {
			e.preventDefault();
			secretKeyInput = text.trim();
		}
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		const text = await file.text();
		try {
			secretKeyInput = parseVuKeyFile(text);
			errorMessage = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Could not parse file';
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}
	function onDragLeave() {
		dragOver = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && validKey && !unlocking) {
			unlock();
		}
	}
</script>

<svelte:head>
	<title>Unlock — VuVault</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<main class="screen">
	<header class="topbar">
		<BrandMark />
		<ThemeToggle />
	</header>

	{#if loading}
		<section class="screen-inner">
			<div class="loading">Reading account…</div>
		</section>
	{:else if locked}
		<section class="screen-inner">
			<Eyebrow>Recovery required</Eyebrow>
			<h1 class="h1">
				Three failed attempts.<br />
				<span class="italic-serif">Use the recovery flow.</span>
			</h1>
			<p class="lede">
				<span data-vp-show="desktop"
					>The vault has rate-limited unlock on this device. Use the recovery flow to
					re-bind a passkey with your Secret Key, restore from future Tier 2 sync,
					or wipe local data and start fresh.</span
				>
				<span data-vp-show="mobile"
					>Unlock rate-limited on this device. Open the recovery flow to re-bind, restore,
					or wipe.</span
				>
			</p>
			<div class="cta-row">
				<Button variant="primary" size="lg" href="/recover">Open recovery</Button>
				<Button variant="ghost" href="/">Back to landing</Button>
			</div>
		</section>
	{:else}
		<section class="screen-inner">
			<Eyebrow>
				Unlock vault · {deviceLabel}{authMode === 'demo' ? ' · DEMO MODE' : ''}
			</Eyebrow>
			<h1 class="h1">
				Welcome back.<br />
				<span class="italic-serif">
					{authMode === 'demo' ? 'Secret Key only.' : 'Touch ID + Secret Key.'}
				</span>
			</h1>
			<p class="lede">
				{#if authMode === 'demo'}
					<span data-vp-show="desktop"
						>This vault was provisioned in demo mode. Security falls to your Secret Key
						alone plus the original device. Provide the 256-bit Secret Key to continue.</span
					>
					<span data-vp-show="mobile"
						>Demo-mode vault — security rests on your Secret Key + this device.</span
					>
				{:else}
					<span data-vp-show="desktop"
						>Provide your 256-bit Secret Key, then authenticate with the same passkey
						that registered this device. Decryption happens locally — nothing
						transmitted.</span
					>
					<span data-vp-show="mobile"
						>Provide your Secret Key, then Touch ID. Decrypts locally — nothing
						transmitted.</span
					>
				{/if}
			</p>

			<div class="field">
				<label for="secret-key">Secret Key</label>
				<div
					class="input-zone"
					class:dragging={dragOver}
					ondrop={onDrop}
					ondragover={onDragOver}
					ondragleave={onDragLeave}
					role="region"
					aria-label="Secret Key input"
				>
					<IconKey size={16} stroke={1.6} />
					<textarea
						id="secret-key"
						bind:value={secretKeyInput}
						onpaste={onPaste}
						placeholder="Paste your Crockford-Base32 Secret Key, or drop a .vukey file"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						rows="3"
					></textarea>
				</div>
				<div class="field-hint">
					{#if validKey}
						<span class="ok">256-bit Secret Key parsed</span>
					{:else if secretKeyInput.length > 0}
						<span class="warn">Not a valid 256-bit Secret Key</span>
					{:else}
						<span class="muted">{SECRET_KEY_BASE32_LEN} Crockford-Base32 characters · 13 groups of 4</span>
					{/if}
				</div>
			</div>

			{#if masterPasswordRequired}
				<div class="key-input-block">
					<label class="lbl" for="master-password">Master password</label>
					<input
						id="master-password"
						type="password"
						bind:value={masterPasswordInput}
						placeholder="Type your master password"
						autocomplete="current-password"
						disabled={unlocking}
					/>
					<div class="field-hint muted">
						Argon2id stretches this locally · ~1–2s on a modern laptop
					</div>
				</div>
			{/if}

			{#if errorMessage}
				<div class="err">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}

			<div class="cta-row">
				<Button
					variant="primary"
					size="lg"
					disabled={!validKey || unlocking || (masterPasswordRequired && !masterPasswordInput)}
					onclick={unlock}
				>
					<IconFingerprint size={16} />
					{unlocking ? 'Unlocking…' : 'Touch ID + Unlock'}
					<IconArrowRight size={14} stroke={2.2} />
				</Button>
				<Button variant="ghost" href="/">Back to landing</Button>
			</div>

			<div class="footer-line">
				<IconUnlock size={12} stroke={1.6} />
				All decryption is local · zero bytes transmitted
				{#if integrity}
					<span class="integrity integrity-{integrity.state}">
						· bundle {integrity.expectedShort}
						{#if integrity.state === 'verified'}
							(verified)
						{:else if integrity.state === 'mismatch'}
							(mismatch — refusing unlock)
						{:else if integrity.state === 'unsupported'}
							(verification unsupported — refusing unlock)
						{:else}
							(dev build · no published hash to verify)
						{/if}
						{#if integrity.state !== 'placeholder'}
							·
							<a
								class="rekor-link"
								href={integrity.rekorUrl}
								target="_blank"
								rel="noopener noreferrer"
								title="Open this build's Sigstore/Rekor entry in a new tab"
							>
								verify on Rekor
							</a>
						{/if}
					</span>
				{/if}
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
		padding-top: env(safe-area-inset-top, 0px);
		padding-left: max(clamp(14px, 4vw, 32px), env(safe-area-inset-left, 0px));
		padding-right: max(clamp(14px, 4vw, 32px), env(safe-area-inset-right, 0px));
		border-bottom: 1px solid var(--border);
	}
	.screen-inner {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: clamp(20px, 5vw, 48px) clamp(16px, 5vw, 64px);
		padding-top: max(clamp(20px, 5vw, 48px), env(safe-area-inset-top));
		padding-bottom: max(clamp(20px, 5vw, 48px), env(safe-area-inset-bottom));
		max-width: 720px;
		gap: 18px;
		overflow-y: auto;
	}
	.loading {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text-3);
	}
	.h1 {
		font-size: clamp(28px, 7vw, 56px);
		font-weight: 700;
		letter-spacing: -0.03em;
		line-height: 1;
	}
	@media (max-width: 30em) {
		.topbar {
			padding: 0 14px;
		}
		.lede {
			font-size: 14px;
		}
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
	.input-zone:focus-within,
	.input-zone.dragging {
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
	}
	.input-zone textarea::placeholder {
		color: var(--text-3);
	}
	.key-input-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 16px;
	}
	.key-input-block .lbl {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	#master-password {
		font-size: 14px;
		font-family: inherit;
		color: var(--text);
		padding: 10px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: var(--transition);
	}
	#master-password:focus {
		border-color: var(--accent);
		background: var(--bg);
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

	.err {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--radius);
	}

	.cta-row {
		display: flex;
		gap: 12px;
		align-items: center;
		margin-top: 16px;
		flex-wrap: wrap;
	}

	.footer-line {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 24px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		flex-wrap: wrap;
	}
	.integrity-verified {
		color: var(--success);
	}
	.integrity-placeholder {
		color: var(--warn);
	}
	.integrity-mismatch {
		color: var(--danger);
	}
	.rekor-link {
		color: inherit;
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
	}
	.rekor-link:hover,
	.rekor-link:focus-visible {
		color: var(--accent);
		text-decoration-style: solid;
	}
</style>
