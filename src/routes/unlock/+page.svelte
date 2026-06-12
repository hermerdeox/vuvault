<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import BrandMark from '$lib/components/BrandMark.svelte';
	import Button from '$lib/components/Button.svelte';
	import SplashScreen from '$lib/components/SplashScreen.svelte';
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
	import { CURRENT_LEVEL } from '$lib/data/privacy-level';
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
	let quickUnlockAvailable = $state(false);
	let useEmergencyKey = $state(false);
	let quickUnlockMessage = $state<string | null>(null);

	const validKey = $derived.by(() => {
		try {
			decodeSecretKey(secretKeyInput);
			return true;
		} catch {
			return false;
		}
	});
	const locked = $derived(attempts >= MAX_ATTEMPTS);
	const quickUnlockMode = $derived(
		authMode === 'production' && quickUnlockAvailable && !useEmergencyKey
	);
	const canUnlock = $derived(
		!locked &&
			!unlocking &&
			(quickUnlockMode || validKey) &&
			(!masterPasswordRequired || masterPasswordInput.length > 0)
	);
	const secretKeyStatusId = 'secret-key-status';
	const masterPasswordHintId = 'master-password-hint';
	const unlockErrorId = 'unlock-error';
	const secretKeyDescribedBy = $derived(
		[secretKeyStatusId, errorMessage ? unlockErrorId : undefined].filter(Boolean).join(' ')
	);
	const masterPasswordDescribedBy = $derived(
		[masterPasswordHintId, errorMessage ? unlockErrorId : undefined].filter(Boolean).join(' ')
	);

	function failedAttemptMessage(message: string) {
		const remaining = MAX_ATTEMPTS - attempts;
		return remaining > 0
			? `${message} ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
			: 'Recovery required.';
	}

	function isMissingPrfOutput(message: string) {
		return /Authenticator did not return a PRF output/i.test(message);
	}

	onMount(async () => {
		if (!(await hasAccount())) {
			goto(resolve('/onboarding'));
			return;
		}
		const account = await getAccount();
		if (!account) {
			goto(resolve('/onboarding'));
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
		const { hasQuickUnlock } = await import('$lib/services/quick-unlock');
		quickUnlockAvailable = await hasQuickUnlock();
		useEmergencyKey = !quickUnlockAvailable;
		quickUnlockMessage = quickUnlockAvailable
			? 'Touch ID quick unlock is enabled on this trusted device.'
			: null;
		integrity = await verifyBundleIntegrity();
		loading = false;
	});

	function passIntegrityGate(): boolean {
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
			return false;
		}
		return true;
	}

	async function unlockWithSecretKey(
		secretKey: Uint8Array,
		source: 'quick' | 'emergency',
		prfOutput?: Uint8Array
	) {
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
					if (prfOutput) prfOutput.fill(0);
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
			if (prfOutput) prfOutput.fill(0);
			errorMessage =
				err instanceof Error ? err.message : 'Master-password derivation failed.';
			unlocking = false;
			return;
		}

		// Optional OPAQUE login. Required when the account row says
		// `opaqueState === 'enrolled'` AND `authMode === 'production'`.
		// On success: the export key is folded into openVault's
		// derivation, and the bearer token (when minted) is stashed
		// in `sync-client.ts`'s module-scope `sessionToken`. This is
		// a JS module closure — NOT sessionStorage and NOT
		// localStorage — so the token dies on hard reload and is
		// cleared explicitly by `lockSession()`. Subsequent
		// `/api/v2/blobs/*` and `/api/v2/inv/*` calls authenticate
		// via this in-memory value only.
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
				// omits token minting (KE3 endpoint missing the field,
				// misconfigured server build, etc.) the export key still
				// folds into vault key derivation but every blob op
				// will early-return via hasSession(). Surface that
				// case distinctly so a missing-token deployment is
				// not invisible to the user — mirrors the onboarding
				// branch in StepProvision.svelte:249-257.
				const tokenMinted = typeof log.token === 'string' && log.token.length > 0;
				setSessionToken(tokenMinted ? log.token! : null);
				if (tokenMinted) {
					audit.push('success', 'OPAQUE login complete · sync token bound', {
						serverId: opaqueServerId!
					});
				} else {
					audit.push('warn', 'OPAQUE login complete · NO sync token returned', {
						serverId: opaqueServerId!,
						note: 'Vault unlocks locally; sync stays local-only until the server mints a token.'
					});
				}
			}
		} catch (err) {
			secretKey.fill(0);
			if (prfOutput) prfOutput.fill(0);
			if (masterPasswordKey) masterPasswordKey.fill(0);
			const msg = err instanceof Error ? err.message : 'OPAQUE login failed';
			// 401 / "MAC" / "auth" → wrong password, count attempt.
			// Other errors → server unreachable, do NOT count attempt.
			if (/MAC|auth|wrong|401/i.test(msg)) {
				attempts += 1;
				errorMessage = failedAttemptMessage(
					'Sync authentication failed. The Secret Key may be wrong for this vault, or the server-side sync enrollment may not match this device.'
				);
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
				prfOutput,
				masterPasswordKey,
				opaqueExportKey
			});
			vault.loadFromDecrypted(items);
			audit.push('success', 'Vault unlocked', { items: items.length, source });
			secretKey.fill(0);
			if (prfOutput) prfOutput.fill(0);
			if (masterPasswordKey) masterPasswordKey.fill(0);
			if (opaqueExportKey) opaqueExportKey.fill(0);
			secretKeyInput = '';
			masterPasswordInput = '';
			goto(resolve('/vault'));
		} catch (err) {
			secretKey.fill(0);
			if (prfOutput) prfOutput.fill(0);
			if (masterPasswordKey) masterPasswordKey.fill(0);
			if (opaqueExportKey) opaqueExportKey.fill(0);
			const msg = err instanceof Error ? err.message : 'Unlock failed';
			if (isMissingPrfOutput(msg)) {
				if (source === 'quick') {
					quickUnlockAvailable = false;
					useEmergencyKey = true;
					quickUnlockMessage =
						'Touch ID quick unlock failed. Use your Emergency Key to unlock this device.';
				}
				errorMessage =
					'Your passkey did not return the device PRF needed to unlock this vault. Use the same registered Touch ID/passkey and device from setup, or retry Touch ID if you canceled or it timed out.';
				audit.push('warn', 'Unlock blocked by missing passkey PRF output', {
					message: msg,
					source
				});
				return;
			}
			attempts += 1;
			errorMessage = failedAttemptMessage(
				/Vault decryption failed/i.test(msg)
					? 'The uploaded Secret Key is valid, but it does not match this local vault, registered passkey/device, master password, or sync enrollment. Use the exact .vukey/Emergency Kit from setup and the same Touch ID/passkey.'
					: 'Unlock failed.'
			);
			audit.push('warn', 'Unlock attempt failed', { attempts, message: msg, source });
			if (source === 'quick') {
				quickUnlockAvailable = false;
				useEmergencyKey = true;
				quickUnlockMessage =
					'Touch ID quick unlock failed. Use your Emergency Key to unlock this device.';
			}
		} finally {
			unlocking = false;
		}
	}

	async function unlock() {
		if (locked || unlocking || !passIntegrityGate()) return;
		if (!quickUnlockMode && (!validKey || !credentialId || !deviceSalt)) {
			errorMessage = 'Provide a 256-bit Secret Key to continue.';
			return;
		}
		if (masterPasswordRequired && !masterPasswordInput) {
			errorMessage = 'Master password is required for this vault.';
			return;
		}
		unlocking = true;
		errorMessage = null;

		if (quickUnlockMode) {
			let secretKey: Uint8Array | null = null;
			let prfOutput: Uint8Array | null = null;
			try {
				const { openQuickUnlock, QuickUnlockCacheError } = await import(
					'$lib/services/quick-unlock'
				);
				try {
					const quick = await openQuickUnlock();
					secretKey = quick.secretKey;
					prfOutput = quick.prfOutput;
					await unlockWithSecretKey(secretKey, 'quick', prfOutput);
				} catch (err) {
					if (secretKey) secretKey.fill(0);
					if (prfOutput) prfOutput.fill(0);

					// Only a genuine cache invalidation (the cache was deleted)
					// forces the user onto their Emergency Key. A dismissed
					// Touch ID prompt, a timeout, or the wrong device is
					// recoverable — keep quick unlock offered so a single
					// accidental Cancel doesn't send the user hunting for a
					// 256-bit key they rarely need on a trusted device.
					const cacheGone = err instanceof QuickUnlockCacheError;
					if (cacheGone) {
						quickUnlockAvailable = false;
						useEmergencyKey = true;
						quickUnlockMessage =
							'Trusted-device quick unlock is no longer valid here. Use your Emergency Key to unlock.';
						errorMessage =
							err instanceof Error ? err.message : 'Quick unlock cache was cleared.';
					} else {
						// Stay in quick-unlock mode; the cache is intact.
						quickUnlockMessage =
							'Touch ID was cancelled or didn’t complete. Try again, or use your Emergency Key.';
						errorMessage =
							err instanceof Error && /PRF output/i.test(err.message)
								? 'Touch ID was cancelled or the device didn’t respond. Try again.'
								: err instanceof Error
									? `Touch ID quick unlock failed: ${err.message}`
									: 'Touch ID quick unlock failed. Try again, or use your Emergency Key.';
					}
					audit.push('warn', 'Trusted-device quick unlock failed', {
						cacheCleared: cacheGone ? 'yes' : 'no',
						message: err instanceof Error ? err.message : 'quick unlock failed'
					});
					unlocking = false;
				}
			} catch (importErr) {
				// The quick-unlock module itself failed to load — fall back
				// to the Emergency Key path rather than dead-ending.
				quickUnlockAvailable = false;
				useEmergencyKey = true;
				errorMessage =
					'Could not load the quick-unlock module. Use your Emergency Key to unlock.';
				audit.push('warn', 'Quick-unlock module failed to load', {
					message: importErr instanceof Error ? importErr.message : 'import failed'
				});
				unlocking = false;
			}
			return;
		}

		let secretKey: Uint8Array;
		try {
			secretKey = decodeSecretKey(secretKeyInput);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Invalid Secret Key';
			unlocking = false;
			return;
		}
		await unlockWithSecretKey(secretKey, 'emergency');
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

	function showEmergencyKey() {
		useEmergencyKey = true;
		errorMessage = null;
	}

	function showQuickUnlock() {
		if (!quickUnlockAvailable) return;
		useEmergencyKey = false;
		errorMessage = null;
	}

	function openRekorUrl(url: string) {
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canUnlock) {
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

	<SplashScreen visible={loading || unlocking} />

	{#if loading}
		<!-- Content hidden behind SplashScreen while account loads -->
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
				{quickUnlockMode ? 'Trusted device ready.' : 'Welcome back.'}<br />
				<span class="italic-serif">
					{#if authMode === 'demo'}
						Secret Key only.
					{:else if quickUnlockMode}
						Touch ID quick unlock.
					{:else}
						Touch ID + Secret Key.
					{/if}
				</span>
			</h1>
			<p class="lede">
				{#if quickUnlockMode}
					<span data-vp-show="desktop"
						>Use Touch ID on this trusted device to unlock. Your Emergency Key is still
						required for recovery and new devices.</span
					>
					<span data-vp-show="mobile"
						>Use Touch ID on this trusted device. Emergency Key stays available for
						recovery.</span
					>
				{:else if authMode === 'demo'}
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

			{#if quickUnlockMessage}
				<div class="quick-message">
					<IconFingerprint size={14} stroke={1.8} />
					{quickUnlockMessage}
				</div>
			{/if}

			{#if !quickUnlockMode}
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
							aria-invalid={secretKeyInput.length > 0 && !validKey}
							aria-describedby={secretKeyDescribedBy}
						></textarea>
					</div>
					<div class="field-hint" id={secretKeyStatusId}>
						{#if validKey}
							<span class="ok">256-bit Secret Key parsed</span>
						{:else if secretKeyInput.length > 0}
							<span class="warn">Not a valid 256-bit Secret Key</span>
						{:else}
							<span class="muted">{SECRET_KEY_BASE32_LEN} Crockford-Base32 characters · 13 groups of 4</span>
						{/if}
					</div>
				</div>
			{/if}

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
						aria-invalid={Boolean(errorMessage && masterPasswordRequired && !masterPasswordInput)}
						aria-describedby={masterPasswordDescribedBy}
					/>
					<div class="field-hint muted" id={masterPasswordHintId}>
						Argon2id stretches this locally · ~1–2s on a modern laptop
					</div>
				</div>
			{/if}

			{#if errorMessage}
				<div class="err" id={unlockErrorId} role="alert">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}

			<div class="cta-row">
				<Button
					variant="primary"
					size="lg"
					disabled={!canUnlock}
					onclick={unlock}
				>
					<IconFingerprint size={16} />
					{#if unlocking}
						Unlocking…
					{:else if quickUnlockMode}
						Touch ID quick unlock
					{:else}
						Touch ID + Unlock
					{/if}
					<IconArrowRight size={14} stroke={2.2} />
				</Button>
				{#if quickUnlockAvailable}
					{#if quickUnlockMode}
						<Button variant="ghost" onclick={showEmergencyKey}>Use Emergency Key instead</Button>
					{:else}
						<Button variant="ghost" onclick={showQuickUnlock}>Use Touch ID quick unlock</Button>
					{/if}
				{/if}
				<Button variant="ghost" href="/">Back to landing</Button>
			</div>

			<div class="footer-line">
				<IconUnlock size={12} stroke={1.6} />
				All decryption is local · zero bytes transmitted ·
				<a class="privacy-link" href={resolve('/privacy')}>Vu Level {CURRENT_LEVEL}</a>
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
							<button
								type="button"
								class="rekor-link"
								onclick={() => openRekorUrl(integrity!.rekorUrl)}
								title="Open this build's Sigstore/Rekor entry in a new tab"
							>
								verify on Rekor
							</button>
						{/if}
					</span>
				{/if}
			</div>
		</section>
	{/if}

	{#if !loading}
		<aside class="unlock-art" aria-hidden="true">
			<img
				src="/icons/icon-512.png"
				srcset="/icons/icon-512.png 1x, /icons/icon-1024.png 2x"
				alt=""
			/>
		</aside>
	{/if}
</main>

<style>
	.screen {
		height: 100dvh;
		display: grid;
		/* The topbar pads itself by safe-area-inset-top — the row must
		   grow by the same amount or the brand/toggle get squeezed up
		   into the status-bar zone (measured on iPhone 16 Pro). */
		grid-template-rows: calc(var(--header-h) + var(--safe-top, 0px)) 1fr;
		grid-template-columns: minmax(0, 0.92fr) minmax(320px, 1.08fr);
		background: var(--bg);
	}
	.topbar {
		grid-column: 1 / -1;
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
		/* `safe center`: centered when content fits, scrollable from the
		   top when it does not (plain `center` makes overflowing tops
		   unreachable on short landscape viewports). */
		justify-content: safe center;
		grid-row: 2;
		grid-column: 1;
		padding: clamp(20px, 5vw, 48px) clamp(16px, 5vw, 64px);
		padding-left: max(clamp(16px, 5vw, 64px), var(--safe-left, 0px));
		padding-right: max(clamp(16px, 5vw, 64px), var(--safe-right, 0px));
		padding-bottom: max(clamp(20px, 5vw, 48px), var(--safe-bottom, 0px));
		max-width: 720px;
		gap: 18px;
		overflow-y: auto;
		/* Keep the focused field clear of the iOS keyboard when the
		   browser auto-scrolls it into view. */
		scroll-padding-bottom: 45dvh;
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
	.unlock-art {
		grid-row: 2;
		grid-column: 2;
		align-self: center;
		justify-self: center;
		width: min(42vw, 520px);
		pointer-events: none;
	}
	.unlock-art img {
		display: block;
		width: clamp(220px, 28vw, 420px);
		height: auto;
		margin: 0 auto;
		opacity: 0.78;
		filter: drop-shadow(0 24px 52px color-mix(in srgb, var(--accent) 22%, transparent))
			drop-shadow(0 8px 22px color-mix(in srgb, var(--text) 10%, transparent));
	}
	@media (max-width: 48em) {
		.screen {
			grid-template-columns: 1fr;
		}
		.unlock-art {
			display: none;
		}
	}
	@media (max-width: 30em) {
		.topbar {
			/* padding-inline only — the base safe-top padding must survive
			   or the brand/toggle slide under the Dynamic Island. */
			padding-inline: 14px;
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

	.quick-message {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--accent);
		background: var(--accent-faint);
		border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
		border-radius: var(--radius);
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
	@media (pointer: coarse) {
		.rekor-link,
		.privacy-link {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
			margin-block: -14px;
		}
	}
	.rekor-link {
		appearance: none;
		padding: 0;
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.rekor-link:hover,
	.rekor-link:focus-visible {
		color: var(--accent);
		text-decoration-style: solid;
	}
	.privacy-link {
		color: var(--accent);
		text-decoration: underline;
		text-decoration-style: dotted;
		text-underline-offset: 3px;
	}
	.privacy-link:hover,
	.privacy-link:focus-visible {
		text-decoration-style: solid;
	}
</style>
