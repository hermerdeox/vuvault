<script lang="ts">
	import { audience } from '$lib/stores/audience.svelte';
	import { landing, PANEL_IDS } from '$lib/stores/landing.svelte';

	import BackgroundFx from '$lib/components/landing/BackgroundFx.svelte';
	import TopBar from '$lib/components/landing/TopBar.svelte';
	import PagerDots from '$lib/components/landing/PagerDots.svelte';

	import Hero from './_panels/Hero.svelte';
	import Problem from './_panels/Problem.svelte';
	import Promise_ from './_panels/Promise.svelte';
	import VaultPanel from './_panels/Vault.svelte';
	import Mobile from './_panels/Mobile.svelte';
	import Documents from './_panels/Documents.svelte';
	import Stack from './_panels/Stack.svelte';
	import Compare from './_panels/Compare.svelte';
	import Pricing from './_panels/Pricing.svelte';
	import Trust from './_panels/Trust.svelte';
	import Final from './_panels/Final.svelte';

	const PANELS = [
		Hero,
		Problem,
		Promise_,
		VaultPanel,
		Mobile,
		Documents,
		Stack,
		Compare,
		Pricing,
		Trust,
		Final
	];

	let wheelLockedUntil = 0;
	const WHEEL_COOLDOWN_MS = 600;

	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J' || e.key === 'PageDown') {
			e.preventDefault();
			landing.next();
		} else if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K' || e.key === 'PageUp') {
			e.preventDefault();
			landing.prev();
		} else if (e.key === 'Home') {
			e.preventDefault();
			landing.first();
		} else if (e.key === 'End') {
			e.preventDefault();
			landing.last();
		} else if (e.key === 't' || e.key === 'T') {
			e.preventDefault();
			audience.toggle();
		}
	}

	function onWheel(e: WheelEvent) {
		const now = performance.now();
		if (now < wheelLockedUntil) return;
		const dy = e.deltaY;
		if (Math.abs(dy) < 12) return;
		wheelLockedUntil = now + WHEEL_COOLDOWN_MS;
		if (dy > 0) landing.next();
		else landing.prev();
	}

	let touchStartY = 0;
	function onTouchStart(e: TouchEvent) {
		touchStartY = e.touches[0]?.clientY ?? 0;
	}
	function onTouchEnd(e: TouchEvent) {
		const endY = e.changedTouches[0]?.clientY ?? 0;
		const dy = touchStartY - endY;
		if (Math.abs(dy) < 40) return;
		if (dy > 0) landing.next();
		else landing.prev();
	}
</script>

<svelte:head>
	<title>VuVault — Mathematical privacy. Not policy.</title>
	<meta
		name="description"
		content="Zero-knowledge password manager. Touch ID unlocks your vault locally — the company that runs it cannot read your data."
	/>
</svelte:head>

<svelte:window onkeydown={onKeydown} onwheel={onWheel} />

<BackgroundFx />
<TopBar />
<PagerDots />

<main
	class="stage"
	role="region"
	aria-label="Landing"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
>
	<div
		class="track"
		style:transform="translateY(calc({-landing.currentPanel} * 100dvh))"
	>
		{#each PANELS as Panel, i (PANEL_IDS[i])}
			{@const active = landing.currentPanel === i}
			<section
				id={PANEL_IDS[i]}
				class="slot"
				aria-hidden={!active}
				inert={!active}
			>
				<Panel />
			</section>
		{/each}
	</div>
</main>

<style>
	.stage {
		position: fixed;
		inset: 0;
		overflow: hidden;
		z-index: 1;
	}
	.track {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		transition: transform var(--transition-slow);
		will-change: transform;
	}
	.slot {
		flex: 0 0 100dvh;
		height: 100dvh;
		width: 100%;
		position: relative;
	}

	@media (prefers-reduced-motion: reduce) {
		.track {
			transition: none;
		}
	}
</style>
