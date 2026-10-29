<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import {
		IconArrowLeft,
		IconArrowRight,
		IconCheck,
		IconFingerprint,
		IconKey,
		IconRefresh,
		IconWarning
	} from '$lib/icons';
	import {
		decodeSecretKey,
		parseVuKeyFileDetailed,
		encodeBase32,
		SECRET_KEY_BASE32_LEN
	} from '$lib/crypto/secret-key';
	import { hasAccount } from '$lib/utils/storage';
	import {
		verifyBundleIntegrity,
		isSyncOriginConfigured,
		getSyncOrigin,
		getRpId,
		isDemoAuthEnabled,
		type BundleIntegrity
	} from '$lib/utils/env';
	import { audit } from '$lib/stores/audit.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import type { RecoveryMaterial } from '$lib/crypto/recovery-envelope';
	import type { RestoreRecordPayload } from '$lib/crypto/restore-record';
	import type { DiscoveredRestoreRecord } from '$lib/services/server-restore';

	// PERFORMANCE: the heavy crypto + sync modules load lazily inside
	// `findVault()` / `finish*()` — same pattern as /unlock and /recover.

	type Stage = 'input' | 'searching' | 'login' | 'ready' | 'passkey' | 'adopting' | 'done';

	let loading = $state(true);
	let syncAvailable = $state(false);
	let integrity = $state<BundleIntegrity | null>(null);
	let stage = $state<Stage>('input');
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let progress = $state<string>('');
	let found = $state<{ deviceLabel: string; writtenAt: number } | null>(null);
	let passkeyFailed = $state(false);

	let secretKeyInput = $state('');
	let recoveryPasswordInput = $state('');
	let deviceLabel = $state('');
	const demoAuthAllowed = isDemoAuthEnabled();

	// Secrets held between "find" and "finish". Plain module-scope
	// variables, not runes, so they never appear in reactive snapshots.
	let pendingSecretKey: Uint8Array | null = null;
	let pendingMaterial: RecoveryMaterial | null = null;
	let pendingRecord: RestoreRecordPayload | null = null;
	let pendingFound: DiscoveredRestoreRecord | null = null;
	let pendingExportKey: Uint8Array | null = null;
	let pendingLogin: { accountId: string; clientId: string } | null = null;

	const validKey = $derived.by(() => {
		try {
			decodeSecretKey(secretKeyInput);
			return true;
		} catch {
			return false;
		}
	});
	const canSearch = $derived(
		!busy &&
			syncAvailable &&
			validKey &&
			recoveryPasswordInput.length > 0 &&
			deviceLabel.trim().length >= 2
	);
	const secretStatusId = 'restore-secret-status';
	const errorId = 'restore-error';

	onMount(async () => {
		if (await hasAccount()) {
			goto(resolve('/unlock'));
			return;
		}
		syncAvailable = isSyncOriginConfigured();
		integrity = await verifyBundleIntegrity();
		loading = false;
	});

	function zeroizePending() {
		pendingSecretKey?.fill(0);
		pendingSecretKey = null;
		if (pendingMaterial) {
			pendingMaterial.envelopeKey.fill(0);
			pendingMaterial.restoreRoot.fill(0);
		}
		pendingMaterial = null;
		if (pendingRecord) {
			pendingRecord.aesKey.fill(0);
			pendingRecord.accountSeed?.fill(0);
		}
		pendingRecord = null;
		pendingFound = null;
		pendingExportKey?.fill(0);
		pendingExportKey = null;
		pendingLogin = null;
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		const file = e.dataTransfer?.files?.[0];
		if (!file) return;
		try {
			const parsed = parseVuKeyFileDetailed(await file.text());
			secretKeyInput = parsed.secretKey;
			errorMessage = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Could not parse file';
		}
	}
	function onDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function passIntegrityGate(): boolean {
		if (integrity?.state === 'mismatch' || integrity?.state === 'unsupported') {
			errorMessage =
				'Bundle integrity check failed — refusing to handle your Secret Key. ' +
				`Verify the published hash on Rekor (${integrity.rekorUrl}) and reload from the canonical origin.`;
			audit.push('danger', 'Restore blocked by bundle integrity check', { state: integrity.state });
			return false;
		}
		return true;
	}

	/** Phase 1: stretch the Recovery Password, find the record, log in. */
	async function findVault() {
		if (busy || !canSearch) return;
		if (!passIntegrityGate()) return;
		busy = true;
		errorMessage = null;
		zeroizePending();
		stage = 'searching';
		progress = 'Stretching your Recovery Password (Argon2id, 256 MiB)…';
		try {
			pendingSecretKey = decodeSecretKey(secretKeyInput);
			const [recoveryMod, restoreMod, opaqueMod, syncMod] = await Promise.all([
				import('$lib/services/recovery-envelope'),
				import('$lib/services/server-restore'),
				import('$lib/services/opaque-client'),
				import('$lib/services/sync-client')
			]);
			pendingMaterial = await recoveryMod.deriveRecoveryMaterialFor({
				secretKey: pendingSecretKey,
				recoveryPassword: recoveryPasswordInput
			});
			progress = 'Searching the sync server for your vault…';
			const hit = await restoreMod.discoverRestoreRecord(pendingMaterial.restoreRoot, {
				onProgress: ({ daysScanned }) => {
					progress = `Searching the sync server for your vault… (${daysScanned} day${daysScanned === 1 ? '' : 's'} scanned)`;
				}
			});
			if (!hit) {
				throw new Error(
					'No vault found for this Secret Key + Recovery Password. Either the Recovery Password is wrong, new-device restore was never enabled on the original device, or the server copy expired after 60 days without use.'
				);
			}
			pendingFound = hit;
			pendingRecord = hit.record;

			stage = 'login';
			progress = 'Signing in to the sync server (OPAQUE)…';
			const transport = opaqueMod.createFetchTransport(getSyncOrigin());
			const login = await opaqueMod.loginWithRetry({
				serverId: getRpId(),
				clientId: hit.record.opaqueClientId,
				password: encodeBase32(pendingSecretKey),
				transport
			});
			if (!login.token) {
				login.exportKey.fill(0);
				throw new Error('The sync server did not issue a session; try again in a moment.');
			}
			syncMod.setSessionToken(login.token);
			pendingExportKey = login.exportKey;
			pendingLogin = { accountId: login.accountId, clientId: hit.record.opaqueClientId };
			found = { deviceLabel: hit.record.deviceLabel, writtenAt: hit.record.writtenAt };
			audit.push('success', 'Restore record found on the sync server', {
				from: hit.record.deviceLabel
			});
			stage = 'ready';
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Restore failed';
			audit.push('warn', 'Restore search failed', { message: errorMessage });
			zeroizePending();
			stage = 'input';
		} finally {
			busy = false;
			progress = '';
		}
	}

	/** Phase 2: bind this device and adopt the vault. */
	async function finish(mode: 'production' | 'demo') {
		if (busy || stage !== 'ready' && stage !== 'passkey') return;
		if (!pendingSecretKey || !pendingMaterial || !pendingRecord || !pendingFound || !pendingExportKey || !pendingLogin) {
			errorMessage = 'Restore state was lost. Start again.';
			stage = 'input';
			return;
		}
		busy = true;
		errorMessage = null;
		passkeyFailed = false;
		let prfOutput: Uint8Array | null = null;
		try {
			const [vaultSessionMod, webauthnMod, recoveryMod] = await Promise.all([
				import('$lib/services/vault-session'),
				import('$lib/crypto/webauthn-prf'),
				import('$lib/services/recovery-envelope')
			]);
			const deviceSalt = vaultSessionMod.generateDeviceSalt();
			let credentialId: ArrayBuffer;
			let credentialPublicKey: ArrayBuffer;
			if (mode === 'production') {
				stage = 'passkey';
				const outcome = await webauthnMod.registerPasskey({ deviceLabel, prfSalt: deviceSalt });
				if (!outcome.ok) {
					passkeyFailed = true;
					throw new Error(
						outcome.reason.kind === 'unsupported'
							? 'WebAuthn is not available in this browser.'
							: outcome.reason.kind === 'declined'
								? 'Passkey registration was canceled.'
								: 'Passkey registration failed.'
					);
				}
				if (!outcome.result.prfSupported || !outcome.result.prfOutput) {
					passkeyFailed = true;
					throw new Error('This authenticator does not support the WebAuthn PRF extension.');
				}
				prfOutput = outcome.result.prfOutput;
				credentialId = outcome.result.credentialId;
				credentialPublicKey = outcome.result.publicKey;
			} else {
				if (!demoAuthAllowed) throw new Error('Demo mode is disabled in this build.');
				credentialId = crypto.getRandomValues(new Uint8Array(32)).buffer;
				credentialPublicKey = new ArrayBuffer(0);
			}

			stage = 'adopting';
			const items = await vaultSessionMod.adoptRestoredVault({
				record: pendingRecord,
				foundAt: { day: pendingFound.day, slot: pendingFound.slot },
				secretKey: pendingSecretKey,
				opaqueExportKey: pendingExportKey,
				opaque: {
					accountId: pendingLogin.accountId,
					serverId: getRpId(),
					clientId: pendingLogin.clientId
				},
				deviceLabel: deviceLabel.trim(),
				credentialId,
				credentialPublicKey,
				authMode: mode,
				prfOutput,
				deviceSalt
			});
			vault.loadFromDecrypted(items);

			// Local recovery + a fresh restore record for THIS device, from
			// the material already stretched above.
			try {
				await recoveryMod.enableRecovery({
					secretKey: pendingSecretKey,
					recoveryPassword: recoveryPasswordInput,
					material: pendingMaterial
				});
				audit.push('success', 'Recovery Envelope and new-device restore enabled on this device');
			} catch (err) {
				audit.push('warn', 'Vault restored, but recovery could not be re-enabled here', {
					message: err instanceof Error ? err.message : 'recovery setup failed'
				});
			}
			if (mode === 'production' && prfOutput) {
				try {
					const { enableQuickUnlock } = await import('$lib/services/quick-unlock');
					await enableQuickUnlock(pendingSecretKey, { prfOutput });
				} catch {
					/* optional convenience */
				}
			}
			audit.push('success', `Vault restored from "${pendingRecord.deviceLabel}"`, {
				items: items.length
			});
			stage = 'done';
			zeroizePending();
			goto(resolve('/vault'));
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Restore failed';
			audit.push('danger', 'Restore failed', { message: errorMessage });
			if (passkeyFailed) {
				stage = 'ready';
			} else {
				zeroizePending();
				stage = 'input';
			}
		} finally {
			prfOutput?.fill(0);
			busy = false;
		}
	}

	function startOver() {
		zeroizePending();
		found = null;
		passkeyFailed = false;
		errorMessage = null;
		stage = 'input';
	}
</script>

<svelte:head>
	<title>Restore · VuVault</title>
</svelte:head>

<main class="screen">
	<header class="topbar">
		<BrandMark showPill="Restore" />
		<ThemeToggle />
	</header>

	{#if loading}
		<section class="screen-inner">
			<div class="loading">Checking this device…</div>
		</section>
	{:else if stage === 'input' || stage === 'searching' || stage === 'login'}
		<section class="screen-inner">
			<Eyebrow>Restore · new device</Eyebrow>
			<h1 class="h1">
				Bring your vault <span class="italic-serif">to this device.</span>
			</h1>
			<p class="lede">
				Your Secret Key and Recovery Password locate your encrypted vault on the sync server
				and open it here. The server never learns either — it holds ciphertext it cannot read,
				at an address it cannot compute.
			</p>

			{#if !syncAvailable}
				<div class="err" role="alert">
					<IconWarning size={14} stroke={2} />
					Sync is not configured in this build, so there is nothing to restore from.
				</div>
			{/if}

			<div class="field">
				<label for="restore-secret">Secret Key</label>
				<div
					class="input-zone"
					ondrop={onDrop}
					ondragover={onDragOver}
					role="region"
					aria-label="Secret Key input"
				>
					<IconKey size={16} stroke={1.6} />
					<textarea
						id="restore-secret"
						bind:value={secretKeyInput}
						placeholder="Paste your Crockford-Base32 Secret Key, or drop a .vukey file"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						rows="3"
						disabled={busy}
						aria-invalid={secretKeyInput.length > 0 && !validKey}
						aria-describedby={[secretStatusId, errorMessage ? errorId : undefined]
							.filter(Boolean)
							.join(' ')}
					></textarea>
				</div>
				<div class="field-hint" id={secretStatusId}>
					{#if validKey}
						<span class="ok">256-bit Secret Key parsed</span>
					{:else if secretKeyInput.length > 0}
						<span class="warn">Not a valid 256-bit Secret Key</span>
					{:else}
						<span class="muted">{SECRET_KEY_BASE32_LEN} characters · 13 groups of 4</span>
					{/if}
				</div>
			</div>

			<div class="field">
				<label for="restore-password">Recovery Password</label>
				<div class="input-zone">
					<IconKey size={16} stroke={1.6} />
					<input
						id="restore-password"
						type="password"
						bind:value={recoveryPasswordInput}
						placeholder="The Recovery Password you set on the original device"
						autocomplete="current-password"
						disabled={busy}
					/>
				</div>
			</div>

			<div class="field">
				<label for="restore-device">Name this device</label>
				<div class="input-zone">
					<IconFingerprint size={16} stroke={1.6} />
					<input
						id="restore-device"
						type="text"
						bind:value={deviceLabel}
						placeholder="e.g. Work laptop"
						autocomplete="off"
						maxlength="64"
						enterkeyhint="go"
						disabled={busy}
						onkeydown={(e) => {
							if (e.key === 'Enter' && canSearch) void findVault();
						}}
					/>
				</div>
			</div>

			{#if busy && progress}
				<div class="progress" role="status" aria-live="polite">
					<IconRefresh size={14} stroke={1.8} />
					{progress}
				</div>
			{/if}

			{#if errorMessage}
				<div class="err" id={errorId} role="alert">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}

			<div class="cta-row">
				<Button variant="ghost" href="/onboarding">
					<IconArrowLeft size={14} />
					Set up a new vault instead
				</Button>
				<Button variant="primary" size="lg" onclick={findVault} disabled={!canSearch}>
					{#if busy}
						Searching…
					{:else}
						Find my vault
					{/if}
					<IconArrowRight size={14} stroke={2.2} />
				</Button>
			</div>
		</section>
	{:else if stage === 'ready' || stage === 'passkey' || stage === 'adopting'}
		<section class="screen-inner">
			<Eyebrow>Restore · vault found</Eyebrow>
			<h1 class="h1">
				Found it. <span class="italic-serif">Bind this device.</span>
			</h1>
			<p class="lede">
				Encrypted vault last published from
				<strong>{found?.deviceLabel || 'an unnamed device'}</strong>
				{#if found?.writtenAt}
					on {new Date(found.writtenAt).toLocaleString()}.
				{/if}
				Register a passkey on this device to re-seal it under a key that never leaves your
				hardware. The copy on the server stays encrypted and keeps syncing from here.
			</p>

			<div class="found" role="status">
				<IconCheck size={14} stroke={2} />
				<span>Record opened · sync session established · ready to decrypt locally</span>
			</div>

			{#if errorMessage}
				<div class="err" id={errorId} role="alert">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}

			<div class="cta-row">
				<Button variant="ghost" onclick={startOver} disabled={busy}>
					<IconArrowLeft size={14} />
					Start over
				</Button>
				<Button
					variant="primary"
					size="lg"
					onclick={() => finish('production')}
					disabled={busy}
				>
					<IconFingerprint size={14} stroke={1.8} />
					{#if stage === 'passkey'}
						Registering passkey…
					{:else if stage === 'adopting'}
						Decrypting and sealing…
					{:else}
						Register passkey and restore
					{/if}
				</Button>
				{#if passkeyFailed && demoAuthAllowed}
					<Button variant="ghost" onclick={() => finish('demo')} disabled={busy}>
						Continue in demo mode
					</Button>
				{/if}
			</div>
		</section>
	{:else}
		<section class="screen-inner">
			<div class="loading">Vault restored · opening…</div>
		</section>
	{/if}
</main>

<style>
	.screen {
		height: 100dvh;
		display: grid;
		grid-template-rows: calc(var(--header-h) + var(--safe-top, 0px)) 1fr;
		background: var(--bg);
	}
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-top: env(safe-area-inset-top, 0px);
		padding-left: max(32px, env(safe-area-inset-left, 0px));
		padding-right: max(32px, env(safe-area-inset-right, 0px));
		border-bottom: 1px solid var(--border);
	}
	.screen-inner {
		display: flex;
		flex-direction: column;
		justify-content: safe center;
		scroll-padding-bottom: 45dvh;
		padding-top: max(48px, env(safe-area-inset-top, 0px));
		padding-right: max(64px, env(safe-area-inset-right, 0px));
		padding-bottom: max(48px, env(safe-area-inset-bottom, 0px));
		padding-left: max(64px, env(safe-area-inset-left, 0px));
		max-width: 760px;
		gap: 18px;
		overflow-y: auto;
	}
	@media (max-width: 45em) {
		.screen-inner {
			padding-top: 24px;
			padding-right: max(18px, env(safe-area-inset-right, 0px));
			padding-bottom: max(24px, env(safe-area-inset-bottom, 0px));
			padding-left: max(18px, env(safe-area-inset-left, 0px));
		}
	}
	@media (max-width: 30em) {
		.screen-inner {
			padding-top: 18px;
			padding-right: max(14px, env(safe-area-inset-right, 0px));
			padding-bottom: max(18px, env(safe-area-inset-bottom, 0px));
			padding-left: max(14px, env(safe-area-inset-left, 0px));
			gap: 14px;
		}
		.h1 {
			font-size: clamp(28px, 8vw, 40px);
		}
		.lede {
			font-size: 14px;
		}
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
	.lede strong {
		color: var(--text);
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
	.input-zone textarea,
	.input-zone input {
		font-family: var(--font-mono);
		font-size: 13px;
		color: var(--text);
		letter-spacing: 0.02em;
		width: 100%;
		background: transparent;
		border: none;
		outline: none;
	}
	.input-zone textarea {
		resize: none;
		min-height: 60px;
	}
	.input-zone textarea::placeholder,
	.input-zone input::placeholder {
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
	.progress,
	.found {
		display: inline-flex;
		gap: 8px;
		align-items: center;
		padding: 10px 14px;
		font-family: var(--font-mono);
		font-size: 12px;
		border-radius: var(--radius);
		line-height: 1.5;
	}
	.progress {
		color: var(--text-2);
		background: var(--surface);
		border: 1px solid var(--border);
	}
	.found {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
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
