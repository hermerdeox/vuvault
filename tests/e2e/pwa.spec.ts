import { test, expect } from '@playwright/test';
import { waitForHydration } from './_helpers';

/**
 * PWA contract tests.
 *
 * Everything in `pwa · manifest & shell` runs against the vite dev
 * server (CI default). The service-worker group needs a BUILT app
 * (vite preview / wrangler pages dev) because SvelteKit only emits
 * /service-worker.js for builds — those tests skip themselves on dev.
 */

test.describe('pwa · manifest & shell', () => {
	test('manifest is valid, installable, and app-scoped', async ({ page, request }) => {
		await page.goto('/');
		const href = await page.locator('link[rel="manifest"]').getAttribute('href');
		expect(href).toBeTruthy();

		const res = await request.get(href!);
		expect(res.ok()).toBeTruthy();
		const manifest = await res.json();

		// Installability minimum: name, icons (192 + 512), start_url, display.
		expect(manifest.name).toBe('VuVault');
		expect(manifest.id).toBe('/');
		expect(manifest.scope).toBe('/');
		expect(manifest.start_url).toBe('/unlock');
		expect(['standalone', 'fullscreen']).toContain(manifest.display);
		const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
		expect(sizes).toContain('192x192');
		expect(sizes).toContain('512x512');
		const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose);
		expect(purposes).toContain('maskable');

		// Every referenced asset must actually resolve.
		const refs: string[] = [
			...manifest.icons.map((i: { src: string }) => i.src),
			...(manifest.shortcuts ?? []).flatMap((s: { icons?: { src: string }[] }) =>
				(s.icons ?? []).map((i) => i.src)
			),
			...(manifest.screenshots ?? []).map((s: { src: string }) => s.src)
		];
		for (const src of refs) {
			const r = await request.get(src);
			expect(r.ok(), `manifest asset ${src} should resolve`).toBeTruthy();
		}
	});

	test('iOS meta + launch screens are wired', async ({ page, request }) => {
		await page.goto('/');
		await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
			'content',
			'yes'
		);
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
			'href',
			/icon-180\.png/
		);
		const startupImages = page.locator('link[rel="apple-touch-startup-image"]');
		expect(await startupImages.count()).toBeGreaterThanOrEqual(10);
		// Spot-check one launch image resolves.
		const one = await startupImages.first().getAttribute('href');
		const r = await request.get(one!);
		expect(r.ok()).toBeTruthy();
	});

	test('theme-color follows the theme before and after toggle', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		const meta = page.locator('meta[name="theme-color"]');
		await expect(meta).toHaveAttribute('content', '#000000');

		// Flip to brutalist via the store's contract (localStorage + attribute).
		await page.evaluate(() => {
			localStorage.setItem('vuvault-theme', 'brutalist');
		});
		await page.reload();
		await expect(meta).toHaveAttribute('content', '#f5f5f0');
	});

});

test.describe('pwa · native-feel CSS (touch device)', () => {
	// The anti-zoom floor is keyed to `pointer: coarse` (NOT viewport
	// width — landscape iPhones report tablet-class widths), so the
	// test must emulate a touch device for the media query to match.
	test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

	test('overscroll is suppressed and inputs are floored at 16px', async ({ page }) => {
		await page.goto('/onboarding');
		await waitForHydration(page);

		const overscroll = await page.evaluate(
			() => getComputedStyle(document.documentElement).overscrollBehaviorY
		);
		expect(overscroll).toBe('none');

		// iOS zoom floor: every text input on a touch device >= 16px.
		await page.getByRole('button', { name: 'Begin setup' }).click();
		const fontSize = await page
			.locator('input[type="text"]')
			.first()
			.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		expect(fontSize).toBeGreaterThanOrEqual(16);
	});
});

test.describe('pwa · service worker (built app only)', () => {
	test('registers, controls the page, and pins a coherent snapshot', async ({ page, baseURL }) => {
		// Registration is disabled in dev (pwa.init gates on `dev`), and
		// the vite dev server serves a stub /service-worker.js anyway —
		// this test is only meaningful against a BUILT app, signalled by
		// an explicit PLAYWRIGHT_BASE_URL (vite preview / wrangler pages dev).
		test.skip(
			!process.env.PLAYWRIGHT_BASE_URL,
			'service worker testable only against built output (set PLAYWRIGHT_BASE_URL)'
		);

		await page.goto('/');
		const state = await page.evaluate(async () => {
			const reg = await navigator.serviceWorker.ready;
			await new Promise((resolve) => {
				if (navigator.serviceWorker.controller) return resolve(null);
				navigator.serviceWorker.addEventListener('controllerchange', () => resolve(null), {
					once: true
				});
				// First-load claim can race; reload-free fallback timeout.
				setTimeout(() => resolve(null), 4000);
			});
			const cacheNames = await caches.keys();
			return {
				active: reg.active?.state ?? null,
				snapshotCaches: cacheNames.filter((n) => n.startsWith('vuvault-snapshot-'))
			};
		});
		expect(state.active).toBe('activated');
		expect(state.snapshotCaches.length).toBeGreaterThanOrEqual(1);

		// The pinned snapshot must contain the integrity manifest, the
		// app shell, and the worker itself — the coherence set.
		const snapshot = await page.evaluate(async () => {
			const names = await caches.keys();
			const name = names.find((n) => n.startsWith('vuvault-snapshot-'))!;
			const cache = await caches.open(name);
			const keys = (await cache.keys()).map((r) => new URL(r.url).pathname);
			return keys;
		});
		expect(snapshot).toContain('/_app/immutable/bundle-manifest.json');
		expect(snapshot).toContain('/service-worker.js');
		expect(snapshot).toContain('/unlock');

		// Offline shell: with the network cut, navigation still serves.
		const context = page.context();
		await context.setOffline(true);
		try {
			await page.goto(`${baseURL}/unlock`, { waitUntil: 'domcontentloaded' });
			const booted = await page.evaluate(() => document.querySelector('#svelte') !== null);
			expect(booted).toBeTruthy();
		} finally {
			await context.setOffline(false);
		}
	});
});
