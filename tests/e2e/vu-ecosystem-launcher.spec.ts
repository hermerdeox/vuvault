import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from './_helpers';

/**
 * Vu Ecosystem launcher — global app-shell surface mounted from
 * `src/routes/+layout.svelte`. The spec verifies the user-visible
 * behaviors from the launcher plan plus the colorful + enable
 * enhancements:
 *
 *   1. The bottom-left floating trigger is present on the landing
 *      route (the launcher is global, so visibility on `/` is the
 *      canonical smoke).
 *   2. Clicking the trigger opens the dialog and relabels the
 *      button from `Vu Ecosystem` to `vuteletransport`.
 *   3. The colorful category strip is rendered with one chip per
 *      category and an "All" chip; clicking a chip filters the grid.
 *   4. Clicking an app card swaps the panel into the mini detail
 *      page for that app, and the back button returns to the grid.
 *   5. Pressing Escape closes the panel and the label returns to
 *      `Vu Ecosystem`.
 *   6. The Enable button on mockup apps reveals the mockup and
 *      persists the enabled state across a full page reload.
 *   7. On a mobile viewport the same panel renders as a full-width
 *      surface (panel width ≈ viewport width).
 */

async function gotoLanding(page: Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
}

test.describe('vu ecosystem launcher · trigger', () => {
	test('floating trigger renders on landing with default label', async ({ page }) => {
		await gotoLanding(page);
		const trigger = page.getByTestId('vu-ecosystem-trigger');
		await expect(trigger).toBeVisible();
		await expect(trigger).toHaveText(/Vu Ecosystem/i);
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	});

	test('opening the launcher relabels the trigger to vuteletransport', async ({ page }) => {
		await gotoLanding(page);
		const trigger = page.getByTestId('vu-ecosystem-trigger');
		await trigger.click();
		await expect(page.getByTestId('vu-ecosystem-panel')).toBeVisible();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(trigger).toContainText('vuteletransport');
	});
});

test.describe('vu ecosystem launcher · navigation', () => {
	test('clicking a card opens the detail view, back returns to the grid', async ({ page }) => {
		await gotoLanding(page);
		await page.getByTestId('vu-ecosystem-trigger').click();
		const panel = page.getByTestId('vu-ecosystem-panel');
		await expect(panel).toBeVisible();

		await page.getByTestId('vu-eco-card-VuVault').click();
		const detail = page.getByTestId('vu-ecosystem-detail');
		await expect(detail).toBeVisible();
		await expect(detail).toContainText('Available now');
		await expect(detail).toContainText('Utility');

		await page.getByTestId('vu-ecosystem-back').click();
		await expect(detail).toHaveCount(0);
		await expect(page.getByTestId('vu-eco-card-VuVault')).toBeVisible();
	});

	test('Escape closes the panel and restores the default label', async ({ page }) => {
		await gotoLanding(page);
		const trigger = page.getByTestId('vu-ecosystem-trigger');
		await trigger.click();
		await expect(page.getByTestId('vu-ecosystem-panel')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByTestId('vu-ecosystem-panel')).toHaveCount(0);
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await expect(trigger).toHaveText(/Vu Ecosystem/i);
	});

	test('the close button dismisses the panel', async ({ page }) => {
		await gotoLanding(page);
		await page.getByTestId('vu-ecosystem-trigger').click();
		await page.getByTestId('vu-ecosystem-close').click();
		await expect(page.getByTestId('vu-ecosystem-panel')).toHaveCount(0);
	});

	test('category strip filters the grid to one category', async ({ page }) => {
		await gotoLanding(page);
		await page.getByTestId('vu-ecosystem-trigger').click();
		const strip = page.getByTestId('vu-ecosystem-strip');
		await expect(strip).toBeVisible();
		// Click the Finance chip → only finance apps should remain.
		await page.getByTestId('vu-eco-chip-finance').click();
		await expect(page.getByTestId('vu-eco-card-VuWallet')).toBeVisible();
		await expect(page.getByTestId('vu-eco-card-VuVault')).toHaveCount(0);
		// Clear filter via the "All" chip.
		await page.getByTestId('vu-eco-chip-all').click();
		await expect(page.getByTestId('vu-eco-card-VuVault')).toBeVisible();
	});
});

test.describe('vu ecosystem launcher · enable + mockup', () => {
	test('Enable reveals the mockup and persists across reload', async ({ page }) => {
		await gotoLanding(page);
		// Clear once after the page is open (not via addInitScript,
		// which would also fire on the reload below and wipe what we
		// asserted persisted).
		await page.evaluate(() => {
			try {
				localStorage.removeItem('vuvault:ecosystem-enabled');
			} catch {
				/* private mode */
			}
		});
		await page.getByTestId('vu-ecosystem-trigger').click();
		await page.getByTestId('vu-eco-card-VuBlink').click();

		const enableBtn = page.getByTestId('vu-eco-enable');
		await expect(enableBtn).toBeVisible();
		await enableBtn.click();

		// The cinematic animation runs for 1.2s before the mockup is
		// revealed. Generous timeout absorbs CI variance without
		// flaking on the happy path.
		const mockup = page.getByTestId('vu-eco-mockup');
		await expect(mockup).toBeVisible({ timeout: 4_000 });
		await expect(page.getByTestId('vu-eco-enabled-pill')).toBeVisible();

		// Hard reload: persistence is the contract.
		await page.reload();
		await waitForHydration(page);
		await page.getByTestId('vu-ecosystem-trigger').click();
		await page.getByTestId('vu-eco-card-VuBlink').click();
		await expect(page.getByTestId('vu-eco-mockup')).toBeVisible();
		// And the Enable button is no longer shown because the app is
		// already enabled.
		await expect(page.getByTestId('vu-eco-enable')).toHaveCount(0);
	});

	test('cards without a mockup do not show the Enable button', async ({ page }) => {
		await gotoLanding(page);
		await page.evaluate(() => {
			try {
				localStorage.removeItem('vuvault:ecosystem-enabled');
			} catch {
				/* private mode */
			}
		});
		await page.getByTestId('vu-ecosystem-trigger').click();
		// VuNotes is a concept app with no mockup.
		await page.getByTestId('vu-eco-card-VuNotes').click();
		await expect(page.getByTestId('vu-ecosystem-detail')).toBeVisible();
		await expect(page.getByTestId('vu-eco-enable')).toHaveCount(0);
	});
});

test.describe('vu ecosystem launcher · mobile', () => {
	const MOBILE = { width: 360, height: 720 };
	test.use({ viewport: MOBILE });

	test.beforeEach(async ({ page }) => {
		// Mirror the FOUC unblock in mobile-responsive.spec.ts so the
		// `<html data-vp>` attribute is populated correctly on a phone
		// viewport in dev mode. Without this the launcher would fall
		// back to its desktop drawer width and the spec would race the
		// hydration that flips `viewport.isMobile`.
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

	test('panel spans the full viewport width on phones', async ({ page }) => {
		await gotoLanding(page);
		await page.getByTestId('vu-ecosystem-trigger').click();
		const panel = page.getByTestId('vu-ecosystem-panel');
		await expect(panel).toBeVisible();
		// Wait for the MutationObserver-backed viewport store to
		// reflect the mobile class so .is-mobile has applied.
		await expect.poll(async () => panel.evaluate((el) => el.classList.contains('is-mobile'))).toBe(
			true
		);
		const box = await panel.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBeGreaterThanOrEqual(MOBILE.width - 1);
	});
});
