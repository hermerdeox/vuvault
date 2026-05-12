<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { onMount } from 'svelte';
	import '../app.css';

	type Props = {
		children?: import('svelte').Snippet;
	};

	let { children }: Props = $props();

	const STALE_BUILD_RELOAD_KEY = 'vuvault:stale-build-reload';
	const STALE_BUILD_MARKERS = [
		'Failed to fetch dynamically imported module',
		'Importing a module script failed',
		'ChunkLoadError',
		'/_app/immutable/'
	];

	function includesStaleBuildMarker(value: unknown): boolean {
		return (
			typeof value === 'string' && STALE_BUILD_MARKERS.some((marker) => value.includes(marker))
		);
	}

	function isStaleBuildFailure(error: unknown): boolean {
		if (includesStaleBuildMarker(error)) return true;

		if (error && typeof error === 'object') {
			const candidate = error as {
				message?: unknown;
				stack?: unknown;
				filename?: unknown;
				reason?: unknown;
			};

			return (
				includesStaleBuildMarker(candidate.message) ||
				includesStaleBuildMarker(candidate.stack) ||
				includesStaleBuildMarker(candidate.filename) ||
				isStaleBuildFailure(candidate.reason)
			);
		}

		return false;
	}

	function reloadOnceForStaleBuild(error: unknown): void {
		if (!isStaleBuildFailure(error) || sessionStorage.getItem(STALE_BUILD_RELOAD_KEY)) return;

		// Recover clients that keep an old SvelteKit runtime open across a production deploy.
		sessionStorage.setItem(STALE_BUILD_RELOAD_KEY, '1');
		window.location.reload();
	}

	afterNavigate(({ type }) => {
		if (type !== 'enter') {
			sessionStorage.removeItem(STALE_BUILD_RELOAD_KEY);
		}
	});

	onMount(() => {
		document.documentElement.dataset.hydrated = 'true';

		const handleError = (event: ErrorEvent) => {
			reloadOnceForStaleBuild({
				message: event.message,
				stack: event.error?.stack,
				filename: event.filename,
				reason: event.error
			});
		};

		const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
			reloadOnceForStaleBuild(event.reason);
		};

		window.addEventListener('error', handleError);
		window.addEventListener('unhandledrejection', handleUnhandledRejection);

		return () => {
			window.removeEventListener('error', handleError);
			window.removeEventListener('unhandledrejection', handleUnhandledRejection);
		};
	});
</script>

<svelte:head>
	<title>VuVault — your data, your device, your control</title>
</svelte:head>

{#if children}
	{@render children()}
{/if}
