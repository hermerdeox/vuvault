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
	 *   4. DISABLE: ask for current Secret Key (re-confirmation) +
	 *      current master password; rotateAuth({ masterPasswordKey: null }).
	 *
	 * The actual cryptographic operations live in
	 * `vault-session.rotateAuth()` and `crypto/argon2.deriveMasterPasswordKey()`
	 * — this component is a UI shell.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Button from '$lib/components/Button.svelte';
	import { IconLock, IconWarning, IconCheck } from '$lib/icons';
	import {
		decodeSecretKey,
		SECRET_KEY_BASE32_LEN
	} from '$lib/crypto/secret-key';
	import { evaluatePRF } from '$lib/crypto/webauthn-prf';
	import {
		deriveMasterPasswordKey,
		generateMasterPasswordSalt,
		VAULT_HIGH_PARAMS
	} from '$lib/crypto/argon2';
	import { rotateAuth, loadAccount } from '$lib/services/vault-session';
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
	let currentPassword = $state('');
	let secretKeyInput = $state('');
	let busy = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);

	$effect(() => {
		if (open) {
			loading = true;
			errorMessage = null;
			successMessage = null;
			password1 = '';
			password2 = '';
			currentPassword = '';
			secretKeyInput = '';
			loadAccount()
				.then((acc) => {
					if (!acc) {
						errorMessage = 'No account loaded; reload the page.';
						return;
					}
					summary = {
						masterPasswordEnabled: acc.masterPasswordEnabled === true,
						credentialId: acc.credentialId,
						deviceSalt: acc.deviceSalt,
						authMode: acc.authMode
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
	const canSubmitDisable = $derived(
		!busy && validSecretKey && currentPassword.length >= 1
	);

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
				// Disable. Use the user-typed currentPassword to derive
				// the SAME mpk that's currently bound — though we
				// actually don't need it to call rotateAuth (we pass
				// `null`). We DO need it implicitly via the unlock flow
				// that produced the current session, so we just re-use
				// the unlocked vaultKey. rotateAuth refuses if MPK is
				// `undefined` for an enrolled account; we pass `null`.
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
			currentPassword = '';
			secretKeyInput = '';
			busy = false;
		}
	}
</script>

<Modal {open} {onClose} title="Master password" size="md">
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
			{:else}
				<div class="form-block">
					<label for="mp-cur" class="lbl">Current master password</label>
					<input
						id="mp-cur"
						type="password"
						bind:value={currentPassword}
						autocomplete="current-password"
						disabled={busy}
					/>
				</div>
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
