import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from './_helpers';
import { clearStorage, completeDemoOnboarding } from './helpers';

/**
 * Mobile responsiveness regression spec.
 *
 * Asserts the invariants the Mobile Responsive Overhaul plan locked in:
 *   1. The FOUC-safe `<html data-vp>` attribute is set on every route
 *      *before* hydration (this guards the [data-vp-show] CSS-only
 *      content-reduction pattern from flashing long copy on phones).
 *   2. None of the four primary routes scroll horizontally on a 360×640
 *      iPhone-SE-class viewport — i.e. `documentElement.scrollWidth`
 *      stays equal to the viewport width.
 *   3. The Cardinal Rule (no body scroll) still holds on mobile,
 *      including in the landing route's native scroll-snap mode where
 *      `.stage` becomes the scroller instead of `body`.
 *
 * In Vite dev mode the FOUC inline script is blocked by an over-tight
 * CSP (a known SvelteKit dev-only issue — the production build hashes
 * the script via `csp.mode: 'auto'`). To keep this spec runnable under
 * `npm run dev`, we polyfill the same data-vp attribute via
 * `addInitScript` before navigation. The polyfill mirrors the real
 * `app.html` script byte-for-byte modulo the resize listener.
 */

const MOBILE = { width: 360, height: 640 };

test.use({ viewport: MOBILE });

test.beforeEach(async ({ page }) => {
	// In Vite dev mode SvelteKit emits a strict `script-src 'self'` CSP
	// that blocks the hashed inline FOUC script (a known dev-only
	// quirk — production builds hash-allow it via `csp.mode: 'auto'`).
	// Drop the CSP header for the *document* response so the FOUC
	// script can run, exercising the same responsive surface this
	// spec aims to verify. We deliberately scope to navigation requests
	// only — handling every request would race Vite's HMR WebSocket.
	await page.route('**/*', async (route) => {
		const request = route.request();
		const isDocument = request.resourceType() === 'document';
		if (!isDocument) {
			await route.fallback();
			return;
		}
		try {
			const response = await route.fetch();
			const headers = { ...response.headers() };
			delete headers['content-security-policy'];
			delete headers['Content-Security-Policy'];
			await route.fulfill({ response, headers });
		} catch {
			await route.fallback();
		}
	});
});

const ROUTES = ['/', '/onboarding', '/vault', '/blueprint'] as const;

async function readVp(page: Page): Promise<string> {
	return (await page.evaluate(() => document.documentElement.getAttribute('data-vp'))) ?? '';
}

async function noHorizontalOverflow(page: Page): Promise<void> {
	const result = await page.evaluate(() => ({
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth
	}));
	// allow 1px rounding tolerance for sub-pixel layout
	expect(result.scrollWidth - result.clientWidth).toBeLessThanOrEqual(1);
}

async function assertTouchTargetFloor(
	page: Page,
	selector: string,
	label: string
): Promise<void> {
	const boxes = await page
		.locator(selector)
		.evaluateAll((elements) =>
			elements
				.filter((el) => {
					const style = window.getComputedStyle(el);
					const rect = el.getBoundingClientRect();
					return (
						style.display !== 'none' &&
						style.visibility !== 'hidden' &&
						rect.width > 0 &&
						rect.height > 0
					);
				})
				.map((el) => {
					const rect = el.getBoundingClientRect();
					const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
					const aria =
						el.getAttribute('aria-label') ?? el.getAttribute('title') ?? text;
					return {
						width: Math.round(rect.width * 100) / 100,
						height: Math.round(rect.height * 100) / 100,
						label: aria || el.className.toString()
					};
				})
		);
	expect(boxes, `${label}: expected at least one visible target`).not.toHaveLength(0);
	for (const box of boxes) {
		expect(
			Math.min(box.width, box.height),
			`${label} "${box.label}" is ${box.width}×${box.height}, below WCAG 2.5.5 44×44 floor`
		).toBeGreaterThanOrEqual(44);
	}
}

test.describe('mobile · data-vp first-paint', () => {
	for (const route of ROUTES) {
		test(`html[data-vp] resolves to mobile on ${route}`, async ({ page }) => {
			await page.goto(route);
			const vp = await readVp(page);
			expect(vp).toMatch(/\bmobile\b/);
			// 360px is in the xs band (< 480) per app.html.
			expect(vp).toMatch(/\bxs\b/);
		});
	}
});

test.describe('mobile · no horizontal overflow at 360×640', () => {
	for (const route of ROUTES) {
		test(`${route} does not scroll horizontally`, async ({ page }) => {
			await page.goto(route);
			// Allow layout to settle (fonts, viewport store hydration).
			await page.waitForLoadState('networkidle');
			await noHorizontalOverflow(page);
		});
	}
});

test.describe('mobile · cardinal rule still holds on phones', () => {
	test('html and body still have overflow:hidden on /', async ({ page }) => {
		await page.goto('/');
		const overflow = await page.evaluate(() => ({
			html: window.getComputedStyle(document.documentElement).overflow,
			body: window.getComputedStyle(document.body).overflow
		}));
		expect(overflow.html).toContain('hidden');
		expect(overflow.body).toContain('hidden');
	});

	test('the .stage scroller absorbs scroll on /', async ({ page }) => {
		await page.goto('/');
		// Wait for the viewport store to flip native-snap on after
		// hydration (matchMedia / data-vp observer is microtask-async).
		await expect(page.locator('main.stage.native-snap')).toBeAttached();
		const scrollerOverflow = await page.evaluate(() => {
			const stage = document.querySelector('main.stage');
			return stage ? window.getComputedStyle(stage as HTMLElement).overflowY : null;
		});
		// Native-snap mode swaps overflow-y to auto on the .stage; if
		// the swap regresses, panels would clip instead of scroll.
		expect(scrollerOverflow).toBe('auto');
	});
});

test.describe('mobile · landing key panels still rendered', () => {
	test('Compare panel is in the DOM and tagged for card-per-row reflow', async ({ page }) => {
		await page.goto('/');
		// The data-col attribute we emit drives the mobile reflow's
		// td::before key labels. If it disappears, the table goes
		// back to being unreadable on phones.
		const cell = page.locator('section#compare table.compare-table td[data-col]').first();
		await expect(cell).toBeAttached();
	});

	test('Vault preview panel renders the mobile mock, not the 1200×750 SVG', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('section#vault .vault-preview-mini')).toBeAttached();
		await expect(page.locator('section#vault .vault-preview-mock')).toHaveCount(0);
	});
});

test.describe('mobile · touch-target floor', () => {
	test('primary vault chrome hits at least 44×44 CSS px', async ({ page }) => {
		await clearStorage(page);
		await completeDemoOnboarding(page);
		await waitForHydration(page);

		// <720px renders the iOS MobileShell (the desktop 3-pane chrome is
		// display:none here); assert the shell's own primary chrome.
		await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible({
			timeout: 20_000
		});

		await assertTouchTargetFloor(page, '.vv-tabbar button:visible', 'tab bar button');
		await assertTouchTargetFloor(page, '.vv-root header button:visible', 'header button');

		// The real master-password dialog is now reached via the Settings
		// tab → Change master password (a shared overlay rendered above the
		// shell), so the modal's 44px floor still gets exercised.
		await page.getByRole('button', { name: 'Settings', exact: true }).click();
		await page.getByRole('button', { name: 'Change master password' }).click();
		await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
		await assertTouchTargetFloor(page, '.modal .close:visible', 'modal .close');
		await assertTouchTargetFloor(page, '.btn.sm:visible, .btn:visible', 'Button');
		await page.keyboard.press('Escape');

		const isMac = process.platform === 'darwin';
		await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
		await expect(page.getByTestId('command-palette')).toBeVisible();
		await assertTouchTargetFloor(page, '[role="option"]:visible', 'command palette row');
	});
});
