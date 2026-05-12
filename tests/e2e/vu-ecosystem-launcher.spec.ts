import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from './_helpers';

/**
 * Vu Ecosystem launcher — global app-shell surface mounted from
 * `src/routes/+layout.svelte`. The spec verifies the user-visible
 * behaviors from the launcher plan:
 *
 *   1. The bottom-left floating trigger is present on the landing
 *      route (the launcher is global, so visibility on `/` is the
 *      canonical smoke).
 *   2. Clicking the trigger opens the dialog and relabels the
 *      button from `Vu Ecosystem` to `vuteletransport`.
 *   3. Clicking an app card swaps the panel into the mini detail
 *      page for that app, and the back button returns to the grid.
 *   4. Pressing Escape closes the panel and the label returns to
 *      `Vu Ecosystem`.
 *   5. On a mobile viewport the same panel renders as a full-width
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
