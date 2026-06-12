<script lang="ts">
	import { goto } from '$app/navigation';
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { audit } from '$lib/stores/audit.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { encodeBase32 } from '$lib/crypto/secret-key';
	import {
		getSyncOrigin,
		isSyncOriginConfigured,
		getRpId,
		verifyBundleIntegrity,
		type BundleIntegrity
	} from '$lib/utils/env';
	import { IconArrowRight, IconCheck, IconWarning } from '$lib/icons';

	// PERFORMANCE: vault-session, opaque-client, and sync-client pull
	// the Noble curves + ML-KEM-1024 + AES-GCM chunks (~155 KB JS) and
	// the OPAQUE WASM (~143 KB). These are loaded lazily inside
	// `runProvision()` so the onboarding step UI renders before the
	// crypto stack downloads. The user is already watching a "sealing
	// your vault" pipeline; the chunk fetch is invisible inside it.

	/**
	 * Derive an OPAQUE clientId from the WebAuthn credential id.
	 * Stable across reinstalls because the credential survives;
	 * never reveals the credential bytes to the server (SHA-256 +
	 * base16). 32-hex chars fits in the server's 256-byte limit.
	 */
	async function deriveOpaqueClientId(credentialId: ArrayBuffer): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', credentialId);
		return Array.from(new Uint8Array(digest), (b) =>
			b.toString(16).padStart(2, '0')
		).join('');
	}

	type Props = {
		onComplete: () => void;
	};
	let { onComplete }: Props = $props();

	type ProvStatus = 'queued' | 'running' | 'done' | 'skipped' | 'error';
	type ProvStep = {
		key: string;
		title: string;
		detail: string;
		status: ProvStatus;
		elapsed?: number;
	};

	let steps = $state<ProvStep[]>([
		{
			key: 'prf',
			title: 'Confirming WebAuthn PRF',
			detail: 'PRF eval against passkey · returns 32 bytes',
			status: 'queued'
		},
		{
			key: 'kdf',
			title: 'Deriving vault master key',
			detail: 'HKDF-SHA512( PRF ‖ SecretKey ) salt=device-salt → 256 bits',
			status: 'queued'
		},
		{
			key: 'seal',
			title: 'Sealing empty vault',
			detail: 'AES-256-GCM with bound AAD · @noble/ciphers',
			status: 'queued'
		},
		{
			key: 'storage',
			title: 'Persisting to IndexedDB',
			detail: 'Atomic transaction · account + vault rows',
			status: 'queued'
		},
		{
			key: 'opaque',
			title: 'OPAQUE registration',
			detail: 'RFC 9807 · server stores opaque envelope only',
			status: 'queued'
		},
		{
			key: 'zeroize',
			title: 'Zeroizing in-memory secrets',
			detail: 'PRF output · Secret Key buffer · vault key',
			status: 'queued'
		}
	]);

	let provisioning = $state(false);
	let started = $state(false);
	let done = $state(false);
	let errorMessage = $state<string | null>(null);
	// Non-fatal sync-enrollment failure: the vault is provisioned and
	// fully usable local-only; we surface the gap instead of failing.
	let syncNotice = $state<string | null>(null);
	// Bundle-integrity verdict, shown as a pill. The standalone Verify
	// screen was removed from the wizard; its GATE lives here instead —
	// runProvision refuses to seal a vault on a mismatched or
	// unverifiable bundle (the same check also blocks every unlock).
	let integrity = $state<BundleIntegrity | null>(null);

	// Screen-reader announcement for the pipeline. Polite live region:
	// announces the step currently running, then the terminal outcome.
	const liveStatus = $derived.by(() => {
		if (errorMessage) return `Provisioning failed. ${errorMessage}`;
		if (done) return 'Vault provisioned. Ready to enter your vault.';
		const running = steps.find((s) => s.status === 'running');
		return running ? `${running.title} — in progress` : '';
	});

	function setStep(key: string, status: ProvStatus, elapsed?: number) {
		steps = steps.map((s) =>
			s.key === key ? { ...s, status, ...(elapsed !== undefined ? { elapsed } : {}) } : s
		);
	}

	async function timed<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
		setStep(key, 'running');
		audit.push('info', steps.find((s) => s.key === key)!.title);
		const t0 = performance.now();
		try {
			const r = await fn();
			setStep(key, 'done', Math.round(performance.now() - t0));
			return r;
		} catch (err) {
			setStep(key, 'error', Math.round(performance.now() - t0));
			throw err;
		}
	}

	async function runProvision() {
		if (started || provisioning) return;
		started = true;
		provisioning = true;

		try {
			if (
				!onboarding.secretKey ||
				!onboarding.credentialId ||
				!onboarding.authMode ||
				!onboarding.deviceSalt
			) {
				throw new Error(
					'Missing Secret Key, credential, auth mode, or device salt. Please restart onboarding.'
				);
			}

			// Bundle-integrity gate (was the standalone Verify step).
			// Refuse to seal a vault from a bundle we cannot vouch for —
			// the identical check also blocks every unlock, so this is
			// belt-and-suspenders, surfaced at the earliest useful moment.
			integrity = await verifyBundleIntegrity();
			if (integrity.state === 'mismatch' || integrity.state === 'unsupported') {
				throw new Error(
					integrity.state === 'mismatch'
						? 'Bundle hash mismatch — the running code does not match the published release. Refusing to create a vault. Hard-refresh, and verify the release on GitHub.'
						: 'This browser cannot verify the bundle hash (WebCrypto unavailable). Refusing to create a vault.'
				);
			}

			// Lazy-load the heavy crypto stack. The chunk fetches happen in
			// parallel; the pipeline below blocks on them via the awaited
			// `Promise.all`, which is fine because the user is watching the
			// "Sealing your vault" progress UI.
			const [vaultSessionMod, opaqueClientMod, syncClientMod] =
				await Promise.all([
					import('$lib/services/vault-session'),
					import('$lib/services/opaque-client'),
					import('$lib/services/sync-client')
				]);
			const { provisionVault, getVaultByteSize, rotateAuth } = vaultSessionMod;
			const { enableQuickUnlock } = await import('$lib/services/quick-unlock');
			const { enableRecoveryEnvelope } = await import('$lib/services/recovery-envelope');
			const { register, login, createFetchTransport } = opaqueClientMod;
			const { setSessionToken } = syncClientMod;

			// CRITICAL: reuse the salt generated in StepTouch. The PRF output
			// captured at registration is bound to that exact salt; future
			// unlocks re-evaluate PRF with `account.deviceSalt` (which is
			// this same salt). Generating a new salt here would silently
			// brick the vault.
			const deviceSalt = onboarding.deviceSalt;

			// Step 1: in production mode, reuse the PRF output captured at
			// registration. In demo mode the stand-in is derived inside
			// provisionVault so we pass `null`. We never re-evaluate PRF
			// here against a different salt — that path was the source of
			// the unrecoverable-vault bug.
			const prfOutput = await timed('prf', async () => {
				if (onboarding.authMode === 'demo') {
					return null;
				}
				if (!onboarding.prfRegistrationOutput) {
					throw new Error(
						'PRF output missing. Re-register the passkey on the previous step.'
					);
				}
				return onboarding.prfRegistrationOutput;
			});

			// Step 2: stage marker — KDF actually happens inside provisionVault.
			await timed('kdf', () => Promise.resolve());

			// Step 3: stage marker — sealing actually happens inside provisionVault.
			await timed('seal', () => Promise.resolve());

			// Step 4: persist account + vault atomically. provisionVault sets
			// the module-local vault key on success.
			await timed('storage', async () => {
				await provisionVault({
					deviceLabel: onboarding.deviceLabel,
					secretKey: onboarding.secretKey!,
					credentialId: onboarding.credentialId!,
					credentialPublicKey: onboarding.publicKey ?? new ArrayBuffer(0),
					authMode: onboarding.authMode!,
					prfOutput,
					deviceSalt,
					plan: onboarding.plan
				});
			});

			// Step 5: OPAQUE registration — gated on (a) sync wired,
			// (b) production auth mode (demo accounts skip the
			// round-trip; SECURITY's "demo mode is dev-only" guarantee).
			// Failure here is non-fatal: the vault is already provisioned
			// in local-only mode, and the user can opt to skip OPAQUE.
			if (isSyncOriginConfigured() && onboarding.authMode === 'production') {
				try {
					await timed('opaque', async () => {
						const origin = getSyncOrigin();
						const serverId = getRpId();
						const clientId = await deriveOpaqueClientId(onboarding.credentialId!);
						// OPAQUE password = the user's Secret Key in
						// Base32-Crockford. The Secret Key is the strongest
						// credential the user has; OPAQUE blinds it locally
						// so the server never sees it.
						const password = encodeBase32(onboarding.secretKey!);
						const transport = createFetchTransport(origin);
						const reg = await register({
							serverId,
							clientId,
							password,
							transport
						});
						try {
							// Re-derive the vault key with the OPAQUE export key
							// folded in. Subsequent unlocks must run OPAQUE login
							// to reproduce the same key — the server gates that.
							//
							// rotateAuth is the SINGLE writer for OPAQUE state: it
							// persists the re-sealed vault and the account row
							// (opaqueState/accountId/serverId/clientId, with
							// accountSeed and createdAt carried over) in one atomic
							// saveAccountAndVault transaction. Do not follow it
							// with a separate saveAccount — that is a blind put
							// which would clobber fields rotateAuth preserves and
							// could leave the row half-enrolled if it failed.
							await rotateAuth({
								prfOutput: prfOutput,
								secretKey: onboarding.secretKey!,
								opaqueExportKey: reg.exportKey,
								opaqueAccountId: reg.accountId,
								opaqueServerId: serverId,
								opaqueClientId: clientId
							});
							try {
								const loginResult = await login({
									serverId,
									clientId,
									password,
									transport
								});
								try {
									setSessionToken(loginResult.token ?? null);
									if (loginResult.token) {
										audit.push('success', 'Sync session established after OPAQUE registration', {
											serverId
										});
									} else {
										audit.push('warn', 'OPAQUE login returned no sync token', {
											serverId
										});
									}
								} finally {
									loginResult.exportKey.fill(0);
								}
							} catch (err) {
								setSessionToken(null);
								const msg =
									err instanceof Error ? err.message : 'OPAQUE login failed';
								audit.push(
									'warn',
									'OPAQUE registered, but sync session was not established',
									{ message: msg }
								);
							}
						} finally {
							// Zeroize the export key after rotateAuth folds it in.
							reg.exportKey.fill(0);
						}
					});
					audit.push('success', 'OPAQUE registered with sync server', {
						serverId: getRpId()
					});
				} catch (err) {
					// Non-fatal by design: the vault is already provisioned and
					// fully usable local-only. rotateAuth persists atomically, so
					// a failure at any point leaves the account row in its prior
					// consistent state — either fully enrolled or untouched
					// ('none'). Nothing left the device in plaintext; the OPAQUE
					// protocol only ever sent blinded material. Surface the gap
					// and continue instead of dead-ending the whole provision.
					const msg = err instanceof Error ? err.message : 'OPAQUE registration failed';
					audit.push('warn', 'OPAQUE registration failed — continuing local-only', {
						message: msg
					});
					syncNotice =
						'Sync enrollment could not be completed, so sync stays off. ' +
						'Your vault was still created and works fully on this device — ' +
						'no secret ever left it. ' +
						`(${msg})`;
				}
			} else {
				setStep('opaque', 'skipped');
				audit.push(
					'info',
					isSyncOriginConfigured()
						? 'OPAQUE skipped (demo auth mode)'
						: 'OPAQUE skipped (local-only build)'
				);
			}

			// Step 6: zeroize. Before clearing the Secret Key from onboarding
			// memory, seal a trusted-device quick-unlock cache so returning
			// users can unlock with the registered passkey/Touch ID only.
			try {
				await enableRecoveryEnvelope({
					secretKey: onboarding.secretKey!,
					recoveryPassword: onboarding.recoveryPassword
				});
				audit.push('success', 'Local Recovery Envelope enabled');
			} catch (err) {
				throw new Error(
					err instanceof Error
						? `Recovery Envelope setup failed: ${err.message}`
						: 'Recovery Envelope setup failed',
					{ cause: err }
				);
			}

			if (onboarding.authMode === 'production' && onboarding.quickUnlockEnabled) {
				try {
					await enableQuickUnlock(onboarding.secretKey!, { prfOutput });
					audit.push('success', 'Trusted-device quick unlock enabled');
				} catch (err) {
					audit.push('warn', 'Trusted-device quick unlock unavailable', {
						message: err instanceof Error ? err.message : 'quick unlock failed'
					});
				}
			} else {
				audit.push('info', 'Trusted-device quick unlock skipped');
			}

			// Step 6: zeroize. After this, hydrate the runtime store so the
			// /vault route guard passes (vault.status === 'unlocked' AND
			// isSessionActive() === true).
			await timed('zeroize', () => {
				if (prfOutput) prfOutput.fill(0);
				onboarding.zeroizeSecrets();
				vault.loadFromDecrypted([]);
				return Promise.resolve();
			});

			audit.noteSync();
			audit.noteVaultSize(await getVaultByteSize());
			onboarding.provisioned = true;
			done = true;
		} catch (err) {
			// A vault already exists on this device. The single-writer guard
			// in saveAccountAndVault refused to overwrite it — this is the
			// race the route guards can't fully close (a re-entrant
			// provisioning effect, a stale onboarding tab, or a console
			// `goto` that skipped load()). Route to unlock rather than
			// dead-ending on a "Restart onboarding" loop that would just hit
			// the same guard. Detect by stable `code` so we don't have to
			// statically import the storage module into the wizard.
			if (
				err &&
				typeof err === 'object' &&
				(err as { code?: string }).code === 'account-exists'
			) {
				audit.push(
					'info',
					'A vault already exists on this device — routing to unlock instead of re-provisioning'
				);
				await goto('/unlock');
				return;
			}
			errorMessage = err instanceof Error ? err.message : 'Provisioning failed';
			audit.push('danger', errorMessage);
		} finally {
			provisioning = false;
		}
	}

	$effect(() => {
		void runProvision();
	});

	function enterVault() {
		audit.push('success', 'Vault unlocked · welcome');
		onComplete();
	}

	function retryOnboarding() {
		onboarding.reset();
		onboarding.goTo('welcome');
	}
</script>

<section class="screen">
	<div class="screen-inner wide">
		<Eyebrow>{onboarding.stepLabel('provision')} · Provisioning your vault</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Sealing your vault. <span class="italic-serif">One moment.</span>
		</h1>
		<p class="lede">
			Running the cryptographic operations that turn your Secret Key, Touch ID, and device
			into an encrypted vault. Each step happens locally — no server contacted.
		</p>

		{#if integrity}
			<div
				class="integrity-pill state-{integrity.state}"
				title="SHA-384 of the running bundle, checked against the published release manifest"
			>
				<span class="pill-dot"></span>
				{#if integrity.state === 'verified'}
					Bundle verified · {integrity.expectedShort}
				{:else if integrity.state === 'placeholder'}
					Dev build · bundle hash not pinned
				{:else if integrity.state === 'mismatch'}
					Bundle hash mismatch
				{:else}
					Bundle verification unavailable
				{/if}
			</div>
		{/if}

		<div class="sr-only" role="status" aria-live="polite">{liveStatus}</div>

		<div class="stack">
			{#each steps as step (step.key)}
				<div
					class="step"
					class:active={step.status === 'running'}
					class:done={step.status === 'done'}
					class:skipped={step.status === 'skipped'}
					class:error={step.status === 'error'}
				>
					<div class="icon">
						{#if step.status === 'done'}
							<IconCheck size={16} stroke={2.4} />
						{:else if step.status === 'running'}
							<div class="spinner"></div>
						{:else if step.status === 'error'}
							<IconWarning size={16} stroke={2} />
						{:else if step.status === 'skipped'}
							<div class="dash"></div>
						{:else}
							<div class="dot"></div>
						{/if}
					</div>
					<div class="text">
						<div class="title">{step.title}</div>
						<div class="detail">{step.detail}</div>
					</div>
					<div class="time">
						{#if step.status === 'done' && step.elapsed !== undefined}
							{step.elapsed} ms
						{:else if step.status === 'running'}
							running…
						{:else if step.status === 'skipped'}
							skipped
						{:else if step.status === 'error'}
							failed
						{:else}
							queued
						{/if}
					</div>
				</div>
			{/each}
		</div>

		{#if syncNotice}
			<div class="sync-notice" role="status">
				<IconWarning size={14} stroke={2} />
				<div>
					<strong>Local-only mode.</strong>
					<br />
					{syncNotice}
				</div>
			</div>
		{/if}

		{#if errorMessage}
			<div class="error-msg" role="alert">
				<IconWarning size={14} stroke={2} />
				<div>
					<strong>Provisioning failed.</strong>
					<br />
					{errorMessage}
				</div>
			</div>
		{/if}

		<div class="cta-row">
			{#if errorMessage}
				<Button variant="ghost" onclick={retryOnboarding}>Restart onboarding</Button>
			{/if}
			<Button variant="primary" size="lg" disabled={!done} onclick={enterVault}>
				Enter your vault
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
		</div>
	</div>
</section>

<style>
	@import './_screen.css';

	.stack {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 28px;
	}
	/* Desktop: two-column pipeline (6 steps → 3 rows) so the whole
	   screen — headline, steps, and the Enter-your-vault CTA — fits
	   in one viewport with no scrolling. */
	@media (min-width: 64em) {
		.stack {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 10px;
		}
	}
	.step {
		display: grid;
		grid-template-columns: 36px 1fr auto;
		gap: 14px;
		align-items: center;
		padding: 14px 18px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: var(--transition);
	}
	@media (max-width: 30em) {
		/* On 360 px viewports the 3-column grid forced the title +
		   detail mono caption to elide. Drop the time pill below the
		   title so all three lines stay legible. */
		.step {
			grid-template-columns: 36px 1fr;
			gap: 10px;
			padding: 12px 14px;
		}
		.step .time {
			grid-column: 2;
			justify-self: start;
		}
	}
	.step.active {
		background: var(--accent-dim);
		border-color: var(--accent);
	}
	.step.done {
		background: color-mix(in srgb, var(--success) 6%, var(--surface));
		border-color: color-mix(in srgb, var(--success) 30%, var(--border));
	}
	.step.skipped {
		opacity: 0.55;
	}
	.step.error {
		background: color-mix(in srgb, var(--danger) 6%, var(--surface));
		border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
	}

	.icon {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: var(--bg);
		border: 1px solid var(--border-mid);
		color: var(--text-3);
		flex-shrink: 0;
	}
	.step.active .icon {
		border-color: var(--accent);
		color: var(--accent);
	}
	.step.done .icon {
		background: var(--success);
		border-color: var(--success);
		color: var(--bg);
	}
	.step.error .icon {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--bg);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--accent-dim);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.dot {
		width: 6px;
		height: 6px;
		background: currentColor;
		border-radius: 50%;
	}
	.dash {
		width: 8px;
		height: 2px;
		background: currentColor;
		border-radius: 1px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.title {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.detail {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
		word-break: break-all;
	}
	.step.done .detail {
		color: var(--text-2);
	}
	.time {
		font-family: var(--font-mono);
		font-size: 10px;
		color: var(--text-3);
		letter-spacing: 0.04em;
		font-weight: 600;
		text-transform: uppercase;
	}
	.step.done .time {
		color: var(--success);
	}

	.integrity-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		align-self: flex-start;
		margin-bottom: 18px;
		padding: 5px 12px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.04em;
		border-radius: 999px;
		border: 1px solid var(--border-mid);
		background: var(--surface);
		color: var(--text-2);
	}
	.integrity-pill .pill-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--text-3);
	}
	.integrity-pill.state-verified {
		color: var(--success);
		border-color: color-mix(in srgb, var(--success) 35%, transparent);
		background: var(--success-dim);
	}
	.integrity-pill.state-verified .pill-dot {
		background: var(--success);
	}
	.integrity-pill.state-placeholder {
		color: var(--warn);
		border-color: color-mix(in srgb, var(--warn) 35%, transparent);
		background: color-mix(in srgb, var(--warn) 10%, transparent);
	}
	.integrity-pill.state-placeholder .pill-dot {
		background: var(--warn);
	}
	.integrity-pill.state-mismatch,
	.integrity-pill.state-unsupported {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 35%, transparent);
		background: color-mix(in srgb, var(--danger) 10%, transparent);
	}
	.integrity-pill.state-mismatch .pill-dot,
	.integrity-pill.state-unsupported .pill-dot {
		background: var(--danger);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}

	.sync-notice {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin: 8px 0 16px;
		padding: 12px 14px;
		font-size: 13px;
		color: var(--warn);
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: var(--radius);
		line-height: 1.5;
	}
	.sync-notice strong {
		display: inline-block;
		margin-bottom: 2px;
	}

	.error-msg {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin: 8px 0 16px;
		padding: 12px 14px;
		font-size: 13px;
		color: var(--danger);
		background: color-mix(in srgb, var(--danger) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
		border-radius: var(--radius);
		line-height: 1.5;
	}
	.error-msg strong {
		display: inline-block;
		margin-bottom: 2px;
	}
</style>
