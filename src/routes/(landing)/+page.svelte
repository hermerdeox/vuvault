<script lang="ts">
	import { audience } from '$lib/stores/audience.svelte';
	import { landing, PANEL_IDS } from '$lib/stores/landing.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';

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

	// On mobile/tablet (≤md) we hand control to native CSS scroll-snap on
	// the .stage element. The JS pager (transform: translateY(...) +
	// wheel/keyboard handlers) is desktop-only — it fights iOS Safari
	// momentum scrolling and the dvh-during-address-bar-collapse animation
	// that the native scroller handles correctly.
	const useNativeSnap = $derived(viewport.isMobile || viewport.isTablet);

	let wheelLockedUntil = 0;
	const WHEEL_COOLDOWN_MS = 600;

	function onKeydown(e: KeyboardEvent) {
		if (useNativeSnap) return;
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
		if (useNativeSnap) return;
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
		if (useNativeSnap) return;
		touchStartY = e.touches[0]?.clientY ?? 0;
	}
	function onTouchEnd(e: TouchEvent) {
		if (useNativeSnap) return;
		const endY = e.changedTouches[0]?.clientY ?? 0;
		const dy = touchStartY - endY;
		if (Math.abs(dy) < 40) return;
		if (dy > 0) landing.next();
		else landing.prev();
	}

	// In native-snap mode we let the browser place panels in document
	// order; the `transform: translateY(...)` is suppressed via CSS.
	const trackTransform = $derived(
		useNativeSnap ? 'none' : `translateY(calc(${-landing.currentPanel} * 100dvh))`
	);
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
	class:native-snap={useNativeSnap}
	role="region"
	aria-label="Landing"
	ontouchstart={onTouchStart}
	ontouchend={onTouchEnd}
>
	<div class="track" style:transform={trackTransform}>
		{#each PANELS as Panel, i (PANEL_IDS[i])}
			{@const active = useNativeSnap ? true : landing.currentPanel === i}
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

	/* Native scroll-snap mode: the .stage becomes the scroller, the
	   .track is a passive flex column, and each .slot snaps to start
	   while allowing its own content to push past 100dvh on dense
	   panels (Compare table, Promise card stack). The Cardinal Rule
	   still holds: html/body do not scroll; only .stage does. */
	.stage.native-snap {
		overflow-y: auto;
		scroll-snap-type: y mandatory;
		-webkit-overflow-scrolling: touch;
		scroll-behavior: smooth;
		overscroll-behavior-y: contain;
	}
	.stage.native-snap .track {
		position: static;
		inset: auto;
		transition: none;
		will-change: auto;
	}
	.stage.native-snap .slot {
		flex: 0 0 auto;
		height: auto;
		min-height: 100dvh;
		scroll-snap-align: start;
		/* `normal` (not `always`) lets users scroll naturally through
		   panels that grew past 100dvh (Compare, Promise) instead of
		   getting stuck snapping at the top of a tall panel. */
		scroll-snap-stop: normal;
		overflow: visible;
	}
	/* Keep the inert/aria-hidden semantics from poisoning the layout
	   in snap mode — every slot is "active" because it is in flow. */
	.stage.native-snap .slot[inert] {
		pointer-events: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.track {
			transition: none;
		}
		.stage.native-snap {
			scroll-behavior: auto;
		}
	}
</style>
