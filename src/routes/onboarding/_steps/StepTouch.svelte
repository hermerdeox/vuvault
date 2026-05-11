<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { generateDeviceSalt } from '$lib/services/vault-session';
	import { isDemoAuthEnabled } from '$lib/utils/env';
	import {
		registerPasskey,
		isWebAuthnSupported,
		isPlatformAuthenticatorAvailable
	} from '$lib/crypto/webauthn-prf';
	import { IconArrowRight, IconArrowLeft, IconFingerprint, IconWarning } from '$lib/icons';

	type Phase = 'idle' | 'scanning' | 'success' | 'error';
	let phase = $state<Phase>('idle');
	let status = $state<string>('Tap to register your biometric authenticator');
	let webauthnSupported = $state(true);
	let platformAvailable = $state(true);
	let demoConfirmRequested = $state(false);
	const demoAuthAllowed = isDemoAuthEnabled();

	$effect(() => {
		(async () => {
			webauthnSupported = isWebAuthnSupported();
			if (webauthnSupported) {
				platformAvailable = await isPlatformAuthenticatorAvailable();
			} else {
				platformAvailable = false;
			}
		})();
	});

	async function bind() {
		if (phase === 'scanning') return;
		phase = 'scanning';
		status = 'Scanning… please hold';

		// CRITICAL: generate the device salt ONCE here and persist it in
		// onboarding state. This same salt MUST be used for PRF registration,
		// PRF re-evaluation at provisioning, and PRF re-evaluation at every
		// future unlock. If StepProvision were to regenerate the salt, the
		// vault would derive a different key on unlock and become permanently
		// unrecoverable. Reuse if present so retries do not rotate the salt.
		if (!onboarding.deviceSalt) {
			onboarding.deviceSalt = generateDeviceSalt();
		}
		const deviceSalt = onboarding.deviceSalt;

		const outcome = await registerPasskey({
			deviceLabel: onboarding.deviceLabel,
			prfSalt: deviceSalt
		});

		if (!outcome.ok) {
			phase = 'error';
			if (outcome.reason.kind === 'unsupported') {
				status = demoAuthAllowed
					? 'WebAuthn not available in this browser. Use demo mode below to continue.'
					: 'WebAuthn is required and not available in this browser. Use a recent Safari, Chrome, Firefox, or Edge with a platform authenticator.';
			} else if (outcome.reason.kind === 'declined') {
				status = demoAuthAllowed
					? 'Registration canceled. Try again or use demo mode.'
					: 'Registration canceled. Try again on a device with WebAuthn PRF support.';
			} else {
				status = demoAuthAllowed
					? 'Registration failed. Try again or use demo mode.'
					: 'Registration failed. Try again on a device with WebAuthn PRF support.';
			}
			return;
		}

		const { result } = outcome;

		if (!result.prfSupported || !result.prfOutput) {
			// Authenticator registered but PRF unavailable. We refuse to silently
			// downgrade — provisioning would create a vault that cannot be unlocked
			// later. Force the user to either retry on a different device or
			// explicitly choose demo mode (when allowed).
			phase = 'error';
			status = demoAuthAllowed
				? 'This authenticator does not support the WebAuthn PRF extension. Use demo mode, or register on a device that does (recent iOS, macOS, Windows Hello, Chrome Android).'
				: 'This authenticator does not support the WebAuthn PRF extension. Production builds require PRF — register on a device that does (recent iOS, macOS, Windows Hello, Chrome Android).';
			return;
		}

		onboarding.credentialId = result.credentialId;
		onboarding.publicKey = result.publicKey;
		onboarding.authenticatorBound = true;
		onboarding.authMode = 'production';
		// CRITICAL: bind the captured PRF output to the salt that registered
		// it. StepProvision MUST persist `onboarding.deviceSalt` unchanged
		// into the account row so a future unlock re-evaluates PRF with the
		// same salt and re-derives the same vault key.
		onboarding.prfRegistrationOutput = result.prfOutput;
		phase = 'success';
		status = '✓ Authenticator bound · WebAuthn PRF active';
	}

	function chooseDemoMode() {
		if (!demoAuthAllowed) return;
		demoConfirmRequested = true;
	}

	function confirmDemoMode() {
		if (!demoAuthAllowed) return;
		// Synthesize an opaque pseudo-credential so unlock can rederive the
		// stand-in PRF deterministically. Marked authMode = 'demo' so the
		// crypto stack uses the matching path. The deviceSalt remains the
		// persisted salt to keep the unlock derivation stable.
		if (!onboarding.deviceSalt) {
			onboarding.deviceSalt = generateDeviceSalt();
		}
		const fakeCredId = crypto.getRandomValues(new Uint8Array(32));
		onboarding.credentialId = fakeCredId.buffer;
		onboarding.publicKey = new ArrayBuffer(0);
		onboarding.authenticatorBound = true;
		onboarding.authMode = 'demo';
		onboarding.prfRegistrationOutput = null;
		phase = 'success';
		status = '✓ Demo mode active · vault security falls to your Secret Key alone';
	}

	function cancelDemoMode() {
		demoConfirmRequested = false;
	}
</script>

<section class="screen">
	<div class="screen-inner">
		<Eyebrow>Step 4 of 7 · WebAuthn PRF · platform authenticator</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Bind Touch ID.<br /><span class="italic-serif">No password to type.</span>
		</h1>
		<p class="lede">
			<strong>Touch the sensor</strong>, <strong>scan your face</strong>, or use your
			<strong>device PIN</strong>. We'll create a <strong>passkey</strong> that derives
			<strong>your vault key</strong> <strong>without ever leaving your hardware</strong>. This
			<strong>replaces a master password</strong> — the
			<strong>same biometric that authenticates also unlocks</strong>.
		</p>

		{#if !webauthnSupported}
			<div class="warn-banner" role="status">
				<IconWarning size={14} stroke={2} />
				<div>
					<strong>This browser doesn't expose WebAuthn.</strong>
					Use a recent Safari, Chrome, Firefox, or Edge — or continue in demo mode for evaluation.
				</div>
			</div>
		{:else if !platformAvailable}
			<div class="warn-banner" role="status">
				<IconWarning size={14} stroke={2} />
				<div>
					<strong>No platform authenticator detected.</strong>
					You'll be prompted for a roaming security key, or you can continue in demo mode.
				</div>
			</div>
		{/if}

		<div class="touch-stage">
			<button
				class="circle"
				class:scanning={phase === 'scanning'}
				class:success={phase === 'success'}
				class:errored={phase === 'error'}
				onclick={bind}
				aria-label="Bind biometric authenticator"
			>
				<IconFingerprint size={64} stroke={1.4} />
			</button>
			<div class="status" class:err={phase === 'error'}>{status}</div>
		</div>

		{#if demoConfirmRequested && demoAuthAllowed}
			<div class="demo-confirm">
				<div class="demo-title">
					<IconWarning size={14} stroke={2} />
					Confirm demo mode
				</div>
				<p>
					Demo mode skips the WebAuthn PRF binding. Your vault will still be encrypted
					with your <strong>Secret Key</strong>, but the second factor (passkey-bound
					PRF) becomes a deterministic stand-in derived from local device data. This is
					<strong>strictly weaker</strong> and meant for browsers that lack PRF support
					or for evaluating the scaffold. Production builds should retry on a supported
					device.
				</p>
				<div class="demo-actions">
					<Button variant="ghost" onclick={cancelDemoMode}>Cancel</Button>
					<Button onclick={confirmDemoMode}>Continue in demo mode</Button>
				</div>
			</div>
		{/if}

		<div class="cta-row">
			<Button variant="ghost" onclick={() => onboarding.prev()}>
				<IconArrowLeft size={14} />
				Back
			</Button>
			{#if demoAuthAllowed && onboarding.authMode !== 'production'}
				<Button onclick={chooseDemoMode}>Use demo mode</Button>
			{/if}
			<Button
				variant="primary"
				size="lg"
				disabled={!onboarding.canAdvance}
				onclick={() => onboarding.next()}
			>
				Continue
				<IconArrowRight size={14} stroke={2.2} />
			</Button>
		</div>
	</div>
</section>

<style>
	@import './_screen.css';

	.warn-banner {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 14px;
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
		border-radius: var(--radius);
		font-size: 13px;
		color: var(--text-2);
		margin-bottom: 18px;
	}
	.warn-banner strong {
		color: var(--warn);
		display: block;
		margin-bottom: 2px;
	}

	.touch-stage {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		margin-bottom: 18px;
	}
	.circle {
		width: 160px;
		height: 160px;
		border-radius: 50%;
		flex-shrink: 0;
		background: radial-gradient(circle at 30% 30%, var(--accent-dim), transparent 70%);
		border: 1.5px solid var(--accent);
		display: grid;
		place-items: center;
		position: relative;
		cursor: pointer;
		transition: var(--transition);
		color: var(--accent);
	}
	.circle::before,
	.circle::after {
		content: '';
		position: absolute;
		border-radius: 50%;
		border: 1px solid var(--accent);
		opacity: 0;
		animation: ring-pulse 2.4s ease-in-out infinite;
	}
	.circle::before {
		inset: -20px;
	}
	.circle::after {
		inset: -40px;
		animation-delay: 0.4s;
	}
	@keyframes ring-pulse {
		0% {
			opacity: 0.5;
			transform: scale(0.94);
		}
		100% {
			opacity: 0;
			transform: scale(1.15);
		}
	}
	.circle.scanning {
		background: radial-gradient(circle at 30% 30%, var(--accent), var(--accent-dim) 70%);
		box-shadow: var(--shadow-glow);
		color: var(--bg);
	}
	.circle.scanning::before,
	.circle.scanning::after {
		animation-duration: 0.8s;
	}
	.circle.success {
		border-color: var(--success);
		background: radial-gradient(
			circle at 30% 30%,
			var(--success),
			color-mix(in srgb, var(--success) 30%, transparent) 70%
		);
		color: var(--bg);
	}
	.circle.errored {
		border-color: var(--danger);
		background: radial-gradient(
			circle at 30% 30%,
			color-mix(in srgb, var(--danger) 60%, transparent),
			transparent 70%
		);
		color: var(--danger);
	}
	.circle.success::before,
	.circle.success::after,
	.circle.errored::before,
	.circle.errored::after {
		animation: none;
		opacity: 0;
	}

	.status {
		font-family: var(--font-mono);
		font-size: 12px;
		color: var(--text-2);
		letter-spacing: 0;
		text-align: center;
		min-height: 32px;
		max-width: 520px;
		line-height: 1.5;
	}
	.status.err {
		color: var(--danger);
	}

	.demo-confirm {
		margin-bottom: 18px;
		padding: 14px 16px;
		background: color-mix(in srgb, var(--warn) 6%, var(--surface));
		border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border));
		border-radius: var(--radius);
	}
	.demo-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
		color: var(--warn);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		margin-bottom: 8px;
	}
	.demo-confirm p {
		font-size: 13px;
		color: var(--text-2);
		line-height: 1.55;
		margin: 0 0 12px;
	}
	.demo-confirm strong {
		color: var(--text);
	}
	.demo-actions {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}

	/* On short viewports (landscape phones, devtools with the
	   responsive panel taller than wide) the 160 px circle pushes
	   the CTA row past the fold. Shrink it so the next button
	   stays visible without scrolling. */
	@media (max-height: 44em) {
		.circle {
			width: 120px;
			height: 120px;
		}
		.touch-stage {
			gap: 16px;
			margin-bottom: 12px;
		}
	}
</style>
