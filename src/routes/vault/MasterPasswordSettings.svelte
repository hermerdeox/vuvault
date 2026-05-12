<script lang="ts">
	/**
	 * Master-password Settings (Milestone 2 — opt-in third factor).
	 *
	 * Composes the existing Modal + Button + form-input components.
	 * No design tokens, color literals, or layout primitives are
	 * introduced here — invariants 4 and 6 stay intact.
	 *
	 * Flow:
	 *   1. User opens this modal from the topbar gear button.
	 *   2. UI shows current state (off / on).
	 *   3. ENABLE: ask for new password (twice, must match) +
	 *      Secret Key re-confirmation; we re-evaluate WebAuthn PRF,
	 *      derive Argon2id key, and rotateAuth() under the new factor.
	 *   4. DISABLE: require an active unlocked vault session plus
	 *      Secret Key/passkey re-confirmation; then rotateAuth({
	 *      masterPasswordKey: null }). No real password verification is
	 *      performed in this UI pass.
	 *
	 * The actual cryptographic operations live in
	 * `vault-session.rotateAuth()` and `crypto/argon2.deriveMasterPasswordKey()`
	 * — this component is a UI shell.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Button from '$lib/components/Button.svelte';
	import { IconLock, IconWarning, IconCheck, IconKey } from '$lib/icons';
	import {
		decodeSecretKey,
		groupChars,
		SECRET_KEY_BASE32_LEN
	} from '$lib/crypto/secret-key';
	import { PUBLIC_BUNDLE_HASH, PUBLIC_VAULT_VERSION, BUNDLE_HASH_SHORT } from '$lib/utils/env';
	import { evaluatePRF } from '$lib/crypto/webauthn-prf';
	import { validateRecoveryPassword } from '$lib/security/recovery-password-policy';
	import {
		deriveMasterPasswordKey,
		generateMasterPasswordSalt,
		VAULT_HIGH_PARAMS
	} from '$lib/crypto/argon2';
	import { rotateAuth, loadAccount } from '$lib/services/vault-session';
	import {
		disableQuickUnlock,
		enableQuickUnlock,
		hasQuickUnlock
	} from '$lib/services/quick-unlock';
	import { audit } from '$lib/stores/audit.svelte';

	type Props = {
		open: boolean;
		onClose: () => void;
	};
	let { open, onClose }: Props = $props();

	type AccountSummary = {
		masterPasswordEnabled: boolean;
		credentialId: ArrayBuffer;
		deviceSalt: Uint8Array;
		authMode: 'production' | 'demo';
	};

	let summary = $state<AccountSummary | null>(null);
	let loading = $state(true);
	let mode = $state<'enable' | 'disable'>('enable');
	let password1 = $state('');
	let password2 = $state('');
	let secretKeyInput = $state('');
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);
	let quickUnlockEnabled = $state(false);
	let quickUnlockBusy = $state(false);
	let recoveryEnabled = $state(false);
	let recoveryPassword1 = $state('');
	let recoveryPassword2 = $state('');
	let recoveryBusy = $state(false);

	async function refreshQuickUnlockStatus() {
		quickUnlockEnabled = await hasQuickUnlock();
	}

	async function refreshRecoveryStatus() {
		const { hasRecoveryEnvelope } = await import('$lib/services/recovery-envelope');
		recoveryEnabled = await hasRecoveryEnvelope();
	}

	$effect(() => {
		if (open) {
			loading = true;
			errorMessage = null;
			successMessage = null;
			password1 = '';
			password2 = '';
			secretKeyInput = '';
			Promise.all([loadAccount(), refreshQuickUnlockStatus(), refreshRecoveryStatus()])
				.then((acc) => {
					const [account] = acc;
					if (!account) {
						errorMessage = 'No account loaded; reload the page.';
						return;
					}
					summary = {
						masterPasswordEnabled: account.masterPasswordEnabled === true,
						credentialId: account.credentialId,
						deviceSalt: account.deviceSalt,
						authMode: account.authMode
					};
					mode = summary.masterPasswordEnabled ? 'disable' : 'enable';
				})
				.catch((err) => {
					errorMessage = err instanceof Error ? err.message : 'Failed to load account';
				})
				.finally(() => {
					loading = false;
				});
		}
	});

	const validSecretKey = $derived.by(() => {
		try {
			decodeSecretKey(secretKeyInput);
			return true;
		} catch {
			return false;
		}
	});
	const passwordsMatch = $derived(password1.length >= 8 && password1 === password2);
	const canSubmitEnable = $derived(
		!busy && validSecretKey && passwordsMatch
	);
	const canSubmitDisable = $derived(!busy && validSecretKey);
	const canRecreateQuickUnlock = $derived(
		!quickUnlockBusy && validSecretKey && summary?.authMode === 'production'
	);
	const recoveryPolicy = $derived.by(() => {
		let secretKey: Uint8Array | null = null;
		try {
			secretKey = validSecretKey ? decodeSecretKey(secretKeyInput) : null;
			return validateRecoveryPassword(recoveryPassword1, { secretKey });
		} finally {
			if (secretKey) secretKey.fill(0);
		}
	});
	const recoveryPasswordsMatch = $derived(
		recoveryPolicy.ok && recoveryPassword1 === recoveryPassword2
	);
	const canRotateRecovery = $derived(
		!recoveryBusy && validSecretKey && recoveryPasswordsMatch
	);

	function downloadText(filename: string, content: string, type = 'text/plain') {
		const blob = new Blob([content], { type });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function submit() {
		if (!summary) return;
		busy = true;
		errorMessage = null;
		successMessage = null;

		let secretKey: Uint8Array | null = null;
		try {
			secretKey = decodeSecretKey(secretKeyInput);

			// Re-evaluate WebAuthn PRF against the SAME persisted salt
			// the original provisioning used. Production mode prompts
			// the platform authenticator; demo mode falls through.
			let prfOutput: Uint8Array | null = null;
			if (summary.authMode === 'production') {
				prfOutput = (await evaluatePRF({
					credentialId: summary.credentialId,
					salt: summary.deviceSalt
				})) as Uint8Array | null;
				if (!prfOutput) {
					throw new Error(
						'Authenticator did not return a PRF output. Try again or use the same device that registered this vault.'
					);
				}
			}

			if (mode === 'enable') {
				const salt = generateMasterPasswordSalt();
				const mpk = await deriveMasterPasswordKey({
					password: password1,
					salt,
					params: VAULT_HIGH_PARAMS
				});
				try {
					await rotateAuth({
						prfOutput,
						secretKey,
						masterPasswordKey: mpk,
						masterPasswordSalt: salt,
						masterPasswordParams: VAULT_HIGH_PARAMS
					});
					successMessage = 'Master password enabled. Required on every unlock.';
					audit.push('success', 'Master password enabled', { mode: 'enable' });
					summary.masterPasswordEnabled = true;
					mode = 'disable';
				} finally {
					mpk.fill(0);
				}
			} else {
				// Disable uses the active unlocked session plus
				// Secret Key/passkey re-confirmation. We deliberately
				// do not collect or fake-verify the current password here;
				// rotateAuth gets `null` to remove the enrolled MPK factor.
				await rotateAuth({
					prfOutput,
					secretKey,
					masterPasswordKey: null
				});
				successMessage = 'Master password disabled.';
				audit.push('warn', 'Master password disabled', { mode: 'disable' });
				summary.masterPasswordEnabled = false;
				mode = 'enable';
			}
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Operation failed';
			audit.push('danger', `Master password rotation failed: ${errorMessage}`);
		} finally {
			if (secretKey) secretKey.fill(0);
			password1 = '';
			password2 = '';
			secretKeyInput = '';
			busy = false;
		}
	}

	async function disableTrustedDevice() {
		quickUnlockBusy = true;
		errorMessage = null;
		successMessage = null;
		try {
			await disableQuickUnlock();
			await refreshQuickUnlockStatus();
			successMessage = 'Touch ID quick unlock disabled on this device.';
			audit.push('warn', 'Trusted-device quick unlock disabled');
		} catch (err) {
			errorMessage =
				err instanceof Error ? err.message : 'Failed to disable trusted-device quick unlock';
			audit.push('danger', `Trusted-device quick unlock disable failed: ${errorMessage}`);
		} finally {
			quickUnlockBusy = false;
		}
	}

	async function recreateTrustedDevice() {
		if (!summary || summary.authMode !== 'production') return;
		quickUnlockBusy = true;
		errorMessage = null;
		successMessage = null;
		let secretKey: Uint8Array | null = null;
		let prfOutput: Uint8Array | null = null;
		try {
			secretKey = decodeSecretKey(secretKeyInput);
			prfOutput = (await evaluatePRF({
				credentialId: summary.credentialId,
				salt: summary.deviceSalt
			})) as Uint8Array | null;
			if (!prfOutput) {
				throw new Error(
					'Authenticator did not return a PRF output. Try again on the same trusted device.'
				);
			}
			await enableQuickUnlock(secretKey, { prfOutput });
			await refreshQuickUnlockStatus();
			successMessage = 'Touch ID quick unlock cache recreated on this device.';
			audit.push('success', 'Trusted-device quick unlock recreated');
		} catch (err) {
			errorMessage =
				err instanceof Error ? err.message : 'Failed to recreate trusted-device quick unlock';
			audit.push('danger', `Trusted-device quick unlock recreate failed: ${errorMessage}`);
		} finally {
			if (secretKey) secretKey.fill(0);
			if (prfOutput) prfOutput.fill(0);
			secretKeyInput = '';
			quickUnlockBusy = false;
		}
	}

	async function rotateRecoveryEnvelope() {
		recoveryBusy = true;
		errorMessage = null;
		successMessage = null;
		let secretKey: Uint8Array | null = null;
		try {
			const { enableRecoveryEnvelope } = await import('$lib/services/recovery-envelope');
			secretKey = decodeSecretKey(secretKeyInput);
			await enableRecoveryEnvelope({
				secretKey,
				recoveryPassword: recoveryPassword1
			});
			await refreshRecoveryStatus();
			successMessage = recoveryEnabled
				? 'Recovery Envelope rotated.'
				: 'Recovery Envelope enabled.';
			audit.push('success', 'Recovery Envelope updated');
			recoveryPassword1 = '';
			recoveryPassword2 = '';
			secretKeyInput = '';
		} catch (err) {
			errorMessage =
				err instanceof Error ? err.message : 'Failed to update Recovery Envelope';
			audit.push('danger', `Recovery Envelope update failed: ${errorMessage}`);
		} finally {
			if (secretKey) secretKey.fill(0);
			recoveryBusy = false;
		}
	}

	async function exportRecoveryKit() {
		errorMessage = null;
		successMessage = null;
		try {
			const { exportRecoveryEnvelope } = await import('$lib/services/recovery-envelope');
			const envelope = await exportRecoveryEnvelope();
			if (!envelope) {
				throw new Error('Recovery Envelope is not enabled.');
			}
			const secretValue = secretKeyInput.trim().replace(/[\s-]+/g, '');
			decodeSecretKey(secretValue);
			const payload = {
				format: 'vukey/v2',
				issued: new Date().toISOString(),
				device: summary ? 'recovery-export' : null,
				secretKey: {
					encoding: 'base32-crockford',
					bits: 256,
					groups: groupChars(secretValue, 4),
					value: secretValue
				},
				recoveryEnvelope: envelope,
				build: {
					version: PUBLIC_VAULT_VERSION,
					bundleHash: PUBLIC_BUNDLE_HASH,
					bundleHashShort: BUNDLE_HASH_SHORT
				}
			};
			downloadText(
				`vuvault-recovery-${Date.now()}.vukey`,
				JSON.stringify(payload, null, 2),
				'application/json'
			);
			successMessage = 'Recovery .vukey exported. Keep it offline and separate from your Recovery Password.';
			audit.push('success', 'Recovery .vukey exported');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to export Recovery Kit';
		}
	}

	async function disableRecovery() {
		recoveryBusy = true;
		errorMessage = null;
		successMessage = null;
		try {
			const { disableRecoveryEnvelope } = await import('$lib/services/recovery-envelope');
			await disableRecoveryEnvelope();
			await refreshRecoveryStatus();
			successMessage = 'Recovery Envelope disabled on this device.';
			audit.push('warn', 'Recovery Envelope disabled');
		} catch (err) {
			errorMessage =
				err instanceof Error ? err.message : 'Failed to disable Recovery Envelope';
		} finally {
			recoveryBusy = false;
		}
	}
</script>

<Modal {open} {onClose} title="Security settings" size="md">
	{#snippet children()}
		{#if loading}
			<p class="lede">Loading account…</p>
		{:else if !summary}
			<p class="lede">No account loaded.</p>
		{:else}
			<div class="state">
				{#if summary.masterPasswordEnabled}
					<IconCheck size={14} stroke={2} />
					<span>Master password is currently <strong>enabled</strong>.</span>
				{:else}
					<IconLock size={14} stroke={1.6} />
					<span>Master password is currently <strong>disabled</strong>.</span>
				{/if}
			</div>

			<p class="lede">
				The master password is an optional third factor on top of WebAuthn PRF
				and your Secret Key. When enabled, every unlock requires the password.
				Argon2id stretches it locally with VuVault's high preset
				(256 MiB, 4 passes, p=1; ~2–3s per attempt).
			</p>

			<div class="trusted-device">
				<div>
					<div class="trusted-title">Recovery Envelope</div>
					<p>
						Local passkey-loss recovery is
						<strong>{recoveryEnabled ? 'enabled' : 'disabled'}</strong>.
					</p>
				</div>
				<Button
					variant="ghost"
					disabled={!recoveryEnabled || recoveryBusy || !validSecretKey}
					onclick={exportRecoveryKit}
				>
					<IconKey size={14} stroke={1.8} />
					Export .vukey
				</Button>
				<Button
					variant="ghost"
					disabled={!recoveryEnabled || recoveryBusy}
					onclick={disableRecovery}
				>
					{recoveryBusy ? 'Working…' : 'Disable'}
				</Button>
			</div>

			<div class="form-block">
				<label for="rec-new" class="lbl">New / rotated Recovery Password</label>
				<input
					id="rec-new"
					type="password"
					bind:value={recoveryPassword1}
					minlength="16"
					autocomplete="new-password"
					disabled={recoveryBusy}
				/>
				<label for="rec-new2" class="lbl">Confirm Recovery Password</label>
				<input
					id="rec-new2"
					type="password"
					bind:value={recoveryPassword2}
					minlength="16"
					autocomplete="new-password"
					disabled={recoveryBusy}
				/>
				<Button
					variant="ghost"
					disabled={!canRotateRecovery}
					onclick={rotateRecoveryEnvelope}
				>
					{recoveryBusy ? 'Sealing…' : recoveryEnabled ? 'Rotate recovery' : 'Enable recovery'}
				</Button>
				<div class="hint">
					Use a long passphrase, store it separately from <code>.vukey</code>;
					VuVault cannot reset it.
				</div>
				{#if recoveryPassword1 && !recoveryPolicy.ok}
					<div class="hint warn">{recoveryPolicy.message}</div>
				{:else if recoveryPassword1 && recoveryPassword2 && !recoveryPasswordsMatch}
					<div class="hint warn">Recovery Passwords don't match.</div>
				{:else if recoveryPasswordsMatch}
					<div class="hint">Recovery Password ready · ~{Math.round(recoveryPolicy.bits)} bits.</div>
				{/if}
			</div>

			<div class="trusted-device">
				<div>
					<div class="trusted-title">Trusted device</div>
					<p>
						Touch ID quick unlock is
						<strong>{quickUnlockEnabled ? 'enabled' : 'disabled'}</strong> on this
						device.
					</p>
				</div>
				<Button
					variant="ghost"
					disabled={!quickUnlockEnabled || quickUnlockBusy}
					onclick={disableTrustedDevice}
				>
					{quickUnlockBusy ? 'Disabling…' : 'Disable here'}
				</Button>
				<Button
					variant="ghost"
					disabled={!canRecreateQuickUnlock}
					onclick={recreateTrustedDevice}
				>
					{quickUnlockBusy ? 'Working…' : 'Recreate cache'}
				</Button>
			</div>

			{#if mode === 'enable'}
				<div class="form-block">
					<label for="mp-new" class="lbl">New master password</label>
					<input
						id="mp-new"
						type="password"
						bind:value={password1}
						minlength="8"
						autocomplete="new-password"
						disabled={busy}
					/>
					<label for="mp-new2" class="lbl">Confirm</label>
					<input
						id="mp-new2"
						type="password"
						bind:value={password2}
						minlength="8"
						autocomplete="new-password"
						disabled={busy}
					/>
					{#if password1 && password2 && !passwordsMatch}
						<div class="hint warn">Passwords don't match (minimum 8 chars).</div>
					{/if}
				</div>
			{/if}

			{#if mode === 'disable'}
				<p class="lede">
					Disabling requires this vault to already be unlocked, then re-confirms
					your Secret Key and passkey. Current-password verification is not
					implemented in this pass.
				</p>
			{/if}

			<div class="form-block">
				<label for="mp-sk" class="lbl">Re-confirm Secret Key</label>
				<input
					id="mp-sk"
					type="text"
					bind:value={secretKeyInput}
					maxlength={SECRET_KEY_BASE32_LEN + 16}
					autocomplete="off"
					spellcheck="false"
					disabled={busy}
				/>
			</div>

			{#if summary.authMode === 'production'}
				<div class="hint">
					<IconWarning size={12} stroke={2} />
					<span>You'll be asked to confirm with Touch ID / passkey.</span>
				</div>
			{/if}

			{#if errorMessage}
				<div class="error" role="alert">
					<IconWarning size={14} stroke={2} />
					{errorMessage}
				</div>
			{/if}
			{#if successMessage}
				<div class="success" role="status">
					<IconCheck size={14} stroke={2} />
					{successMessage}
				</div>
			{/if}
		{/if}
	{/snippet}

	{#snippet footer()}
		<Button variant="ghost" onclick={onClose}>Close</Button>
		{#if summary && mode === 'enable'}
			<Button variant="primary" disabled={!canSubmitEnable} onclick={submit}>
				{busy ? 'Stretching…' : 'Enable master password'}
			</Button>
		{:else if summary && mode === 'disable'}
			<Button variant="primary" disabled={!canSubmitDisable} onclick={submit}>
				{busy ? 'Removing…' : 'Disable master password'}
			</Button>
		{/if}
	{/snippet}
</Modal>

<style>
	.lede {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.55;
		margin: 0 0 14px;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		font-size: 12px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 14px;
	}
	.trusted-device {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-bottom: 14px;
	}
	.trusted-title {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		margin-bottom: 4px;
	}
	.trusted-device p {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-2);
	}
	.trusted-device strong {
		color: var(--text);
	}
	.form-block {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
	}
	.lbl {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	input[type='password'],
	input[type='text'] {
		font-size: 14px;
		font-family: inherit;
		color: var(--text);
		padding: 10px 14px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: var(--transition);
	}
	input[type='text'] {
		font-family: var(--font-mono);
		font-size: 13px;
		letter-spacing: 0.02em;
	}
	input:focus {
		border-color: var(--accent);
		background: var(--bg);
	}
	.hint {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		margin-top: 8px;
	}
	.hint.warn {
		color: var(--warn);
	}
	.error,
	.success {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		padding: 10px 12px;
		border-radius: var(--radius-sm);
		line-height: 1.5;
	}
	.error {
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		margin-top: 8px;
	}
	.success {
		color: var(--success);
		background: color-mix(in srgb, var(--success) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
		margin-top: 8px;
	}
</style>
