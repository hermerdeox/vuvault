<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import Stepper from '$lib/components/Stepper.svelte';
	import AuditFooter from '$lib/components/AuditFooter.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

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

<div class="bg-grid" aria-hidden="true"></div>
<div class="bg-spotlight" aria-hidden="true"></div>

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

	.bg-grid,
	.bg-spotlight {
		position: fixed;
		pointer-events: none;
		z-index: 0;
	}
	.bg-grid {
		inset: 0;
		background-image:
			linear-gradient(var(--grid-color) 1px, transparent 1px),
			linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
		background-size: 48px 48px;
		mask-image: radial-gradient(ellipse at center, #000 0%, transparent 75%);
		-webkit-mask-image: radial-gradient(ellipse at center, #000 0%, transparent 75%);
	}
	.bg-spotlight {
		width: 80vmax;
		height: 80vmax;
		border-radius: 50%;
		top: -30vmax;
		right: -30vmax;
		background: radial-gradient(circle, var(--accent-faint) 0%, transparent 60%);
		animation: drift 32s ease-in-out infinite;
	}
	@keyframes drift {
		0%,
		100% {
			transform: translate(0, 0);
		}
		50% {
			transform: translate(-6vw, 4vh);
		}
	}

	.header {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 30;
		height: var(--header-h);
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		padding: 0 28px;
		gap: 32px;
		background: color-mix(in srgb, var(--bg) 55%, transparent);
		backdrop-filter: blur(18px) saturate(140%);
		-webkit-backdrop-filter: blur(18px) saturate(140%);
		border-bottom: 1px solid var(--border);
	}
	@media (max-width: 30em) {
		.header {
			padding: 0 14px;
			gap: 12px;
		}
		.exit-label {
			display: none;
		}
		.exit {
			padding: 8px;
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
