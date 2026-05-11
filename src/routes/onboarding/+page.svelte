<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import AuditFooter from '$lib/components/AuditFooter.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	import BackgroundFx from '$lib/components/BackgroundFx.svelte';

	import StepWelcome from './_steps/StepWelcome.svelte';
	import StepIdentity from './_steps/StepIdentity.svelte';
	import StepSecret from './_steps/StepSecret.svelte';
	import StepTouch from './_steps/StepTouch.svelte';
	import StepVerify from './_steps/StepVerify.svelte';
	import StepPricing from './_steps/StepPricing.svelte';
	import StepProvision from './_steps/StepProvision.svelte';

	import { onboarding } from '$lib/stores/onboarding.svelte';
	import { IconClose } from '$lib/icons';

	const stepDefs = [
		{ id: 'welcome', name: 'Welcome' },
		{ id: 'identity', name: 'Device' },
		{ id: 'secret', name: 'Secret Key' },
		{ id: 'touch', name: 'Touch ID' },
		{ id: 'verify', name: 'Verify' },
		{ id: 'pricing', name: 'Plan' },
		{ id: 'provision', name: 'Provision' }
	];

	let confirmExitOpen = $state(false);

	function exit() {
		confirmExitOpen = true;
	}

	function confirmExit() {
		confirmExitOpen = false;
		onboarding.reset();
		goto('/');
	}

	function handleKey(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

		if ((e.key === 'ArrowRight' || e.key === 'PageDown') && onboarding.canAdvance) {
			e.preventDefault();
			onboarding.next();
		} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
			e.preventDefault();
			onboarding.prev();
		}
	}

	function onComplete() {
		// Provisioning completed → enter vault
		goto('/vault');
	}

	onMount(() => {
		// In production: check if user already has an account; if so,
		// redirect to /vault. For now: always start at welcome.
		onboarding.reset();
	});
</script>

<svelte:window onkeydown={handleKey} />

<svelte:head>
	<title>Set up your vault — VuVault</title>
</svelte:head>

<BackgroundFx />

<header class="header">
	<BrandMark showPill="Setup" />
	<Stepper steps={stepDefs} current={onboarding.current} />
	<button class="exit" onclick={exit} aria-label="Exit setup">
		<IconClose size={14} stroke={2} />
		<span class="exit-label">Exit</span>
	</button>
</header>

<main class="stage">
	{#if onboarding.current === 'welcome'}
		<StepWelcome />
	{:else if onboarding.current === 'identity'}
		<StepIdentity />
	{:else if onboarding.current === 'secret'}
		<StepSecret />
	{:else if onboarding.current === 'touch'}
		<StepTouch />
	{:else if onboarding.current === 'verify'}
		<StepVerify />
	{:else if onboarding.current === 'pricing'}
		<StepPricing />
	{:else if onboarding.current === 'provision'}
		<StepProvision {onComplete} />
	{/if}
</main>

<AuditFooter fallback="Setup started · all operations local · same-origin only" />

<ConfirmDialog
	open={confirmExitOpen}
	title="Exit setup?"
	message="Nothing has been transmitted, but progress will be lost."
	confirmLabel="Exit"
	cancelLabel="Cancel"
	onConfirm={confirmExit}
	onCancel={() => (confirmExitOpen = false)}
/>

<style>
	:global(html) {
		--header-h: 64px;
		--footer-h: 56px;
	}

	/* Background grid + spotlight live in the shared `BackgroundFx`
	   component now — the previous local copy ran the 32 s spotlight
	   animation unconditionally even on mobile, which the shared
	   component already gates by `viewport.isMobile`. */

	.header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 30;
		height: calc(var(--header-h) + env(safe-area-inset-top, 0px));
		padding-top: env(safe-area-inset-top, 0px);
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		padding-left: max(28px, env(safe-area-inset-left, 0px));
		padding-right: max(28px, env(safe-area-inset-right, 0px));
		gap: 32px;
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(18px) saturate(140%);
		-webkit-backdrop-filter: blur(18px) saturate(140%);
		border-bottom: 1px solid var(--border);
	}
	@media (max-width: 30em) {
		.header {
			padding-left: max(14px, env(safe-area-inset-left, 0px));
			padding-right: max(14px, env(safe-area-inset-right, 0px));
			gap: 12px;
		}
		.exit-label {
			display: none;
		}
		.exit {
			width: 44px;
			height: 44px;
			padding: 0;
			justify-content: center;
		}
	}

	.exit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-3);
		border-radius: var(--radius);
		border: 1px solid transparent;
		transition: var(--transition);
	}
	.exit:hover {
		color: var(--text-2);
		border-color: var(--border);
	}

	.stage {
		position: relative;
		z-index: 1;
		height: 100dvh;
		padding-top: var(--header-h);
		padding-bottom: var(--footer-h);
		overflow: hidden;
	}
</style>
