<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { IconArrowLeft, IconArrowRight, IconKey, IconWarning } from '$lib/icons';
	import { validateRecoveryPassword } from '$lib/security/recovery-password-policy';

	let password1 = $state('');
	let password2 = $state('');

	const policy = $derived(
		validateRecoveryPassword(password1, { secretKey: onboarding.secretKey })
	);
	const strongEnough = $derived(policy.ok);
	const matches = $derived(strongEnough && password1 === password2);

	function syncState() {
		onboarding.recoveryPassword = matches ? password1 : '';
		onboarding.recoveryConfirmed = false;
	}

	function toggleConfirm(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		onboarding.recoveryConfirmed = target.checked && matches;
	}

	$effect(() => {
		void password1;
		void password2;
		syncState();
	});
</script>

<section class="screen">
	<div class="screen-inner">
		<Eyebrow>{onboarding.stepLabel('recovery')} · Recovery Envelope</Eyebrow>

		<h1 class="h1" style="margin-top: 24px;">
			Add local recovery.<br /><span class="italic-serif">Still zero-knowledge.</span>
		</h1>
		<p class="lede">
			Create a separate Recovery Password. Together with your Secret Key, it seals a
			local Recovery Envelope that can recover this vault if the passkey is lost.
			VuVault cannot reset this password.
		</p>

		<div class="warn-banner">
			<IconWarning size={14} stroke={2} />
			<div>
				<strong>Offline risk:</strong> anyone with your Secret Key, Recovery Envelope,
				and Recovery Password can recover this vault. Keep the password separate from
				your Emergency Kit.
			</div>
		</div>

		<div class="form">
			<label for="recovery-password">Recovery Password</label>
			<input
				id="recovery-password"
				type="password"
				bind:value={password1}
				minlength="16"
				autocomplete="new-password"
				placeholder="Long passphrase, at least 16 characters"
			/>
			<label for="recovery-password-confirm">Confirm Recovery Password</label>
			<input
				id="recovery-password-confirm"
				type="password"
				bind:value={password2}
				minlength="16"
				autocomplete="new-password"
			/>
			<div class="hint">
				{#if password1.length > 0 && !strongEnough}
					<span class="warn">{policy.message}</span>
				{:else if password2.length > 0 && !matches}
					<span class="warn">Passwords do not match.</span>
				{:else if matches}
					<span class="ok">Recovery Password ready · ~{Math.round(policy.bits)} bits.</span>
				{:else}
					<span class="muted">Use a long passphrase stored separately from your .vukey.</span>
				{/if}
			</div>
		</div>

		<label class="confirm">
			<input
				type="checkbox"
				checked={onboarding.recoveryConfirmed}
				onchange={toggleConfirm}
				disabled={!matches}
			/>
			<div class="confirm-text">
				<IconKey size={14} stroke={1.8} />
				<span>
					I have saved this Recovery Password separately. I understand VuVault cannot
					recover it for me.
				</span>
			</div>
		</label>

		<div class="cta-row">
			<Button variant="ghost" onclick={() => onboarding.prev()}>
				<IconArrowLeft size={14} />
				Back
			</Button>
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

	.form {
		display: grid;
		gap: 10px;
		margin: 22px 0;
		max-width: 520px;
	}
	label {
		font-family: var(--font-mono);
		font-size: 10px;
		font-weight: 700;
		color: var(--text-3);
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	input[type='password'] {
		font: inherit;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 12px 14px;
	}
	.hint {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.ok {
		color: var(--success);
	}
	.warn {
		color: var(--warn);
	}
	.muted {
		color: var(--text-3);
	}
	.warn-banner {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 14px;
		border: 1px solid color-mix(in srgb, var(--warn) 35%, transparent);
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--warn) 8%, transparent);
		color: var(--text-2);
		font-size: 13px;
		line-height: 1.45;
		max-width: 620px;
	}
	.confirm-text {
		display: flex;
		gap: 8px;
		align-items: flex-start;
	}
</style>
