import { expect, test } from '@playwright/test';
import { clearStorage, completeDemoOnboarding } from './helpers';

/**
 * End-to-end coverage for the vault user journeys.
 *
 * Demo-mode auth is enabled in dev (the Playwright web server runs `npm run
 * dev`), so these tests can complete the 7-step onboarding without a real
 * platform authenticator. CI guard rails ensure demo mode never ships to
 * production.
 *
 * Each test starts from a clean IndexedDB by clearing storage before
 * navigation. We rely on Playwright's per-test browser contexts being
 * isolated, but call clearStorage explicitly as belt-and-suspenders for
 * test runs against `reuseExistingServer: true`.
 */

test.describe('vault flows · onboarding', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
	});

	test('demo-mode onboarding completes and reaches the vault', async ({ page }) => {
		await completeDemoOnboarding(page);
		await expect(page.getByRole('button', { name: 'Add item' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Lock vault' })).toBeVisible();
	});

	test('cannot reach /vault without provisioning', async ({ page }) => {
		await page.goto('/vault');
		await expect(page).toHaveURL(/\/onboarding/);
	});

	test('revisiting /onboarding after provisioning redirects away (no overwrite)', async ({
		page
	}) => {
		await completeDemoOnboarding(page);
		// A fresh navigation reloads the app, so persisted accounts are sent to unlock
		// instead of restarting setup and overwriting the existing vault.
		await page.goto('/onboarding');
		await expect(page).toHaveURL(/\/unlock/);
	});
});

test.describe('vault flows · CRUD', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
		await completeDemoOnboarding(page);
	});

	test('add → list → detail round-trip for a login item', async ({ page }) => {
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('GitHub');
		await page.locator('#ie-username').fill('r-lopez');
		await page.locator('#ie-password').fill('Tr0ub4dor&3-Lemon-Sky-Forest');
		await page.locator('#ie-url').fill('https://github.com');
		await page.getByRole('button', { name: 'Add to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('GitHub');
		await page.locator('.list-pane button.item').first().click();
		await expect(page.locator('.detail')).toContainText('GitHub');
		await expect(page.locator('.detail')).toContainText('r-lopez');
	});

	test('javascript: URLs are rejected before save (XSS guard)', async ({ page }) => {
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('Evil');
		await page.locator('#ie-username').fill('attacker');
		await page.locator('#ie-url').fill('javascript:alert(1)');
		await page.getByRole('button', { name: 'Add to vault' }).click();
		await expect(page.locator('.field-err')).toContainText(
			'URL does not look valid'
		);
		await expect(page.locator('.list-pane')).not.toContainText('Evil');
	});

	test('item editor blocks save when title is empty', async ({ page }) => {
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		// Title is empty by default — the primary CTA is disabled.
		await expect(page.getByRole('button', { name: 'Add to vault' })).toBeDisabled();
	});
});

test.describe('vault flows · lock / unlock', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
		await completeDemoOnboarding(page);
	});

	test('locking the vault redirects to /unlock', async ({ page }) => {
		await page.getByRole('button', { name: 'Lock vault' }).click();
		await expect(page).toHaveURL(/\/unlock/);
	});

	test('after lock, /vault is gated by the load() guard', async ({ page }) => {
		await page.getByRole('button', { name: 'Lock vault' }).click();
		await expect(page).toHaveURL(/\/unlock/);
		await page.goto('/vault');
		// Still locked — /vault redirects through the guard.
		await expect(page).toHaveURL(/\/unlock/);
	});

	test('after lock, /unlock guard does not bounce away', async ({ page }) => {
		await page.getByRole('button', { name: 'Lock vault' }).click();
		await expect(page).toHaveURL(/\/unlock/);
		// We're on the unlock page and the load() did not redirect us
		// elsewhere. Confirm the unlock UI is showing.
		await expect(page.getByText(/secret key/i).first()).toBeVisible();
	});
});

test.describe('vault flows · command palette', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
		await completeDemoOnboarding(page);
		// Seed at least one item so the palette has something to surface.
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('GitHub');
		await page.locator('#ie-username').fill('r-lopez');
		await page.locator('#ie-password').fill('Tr0ub4dor&3-Lemon-Sky-Forest');
		await page.getByRole('button', { name: 'Add to vault' }).click();
	});

	test('Cmd+K opens the palette with combobox a11y', async ({ page }) => {
		const isMac = process.platform === 'darwin';
		await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
		await expect(page.getByTestId('command-palette')).toBeVisible();
		const combobox = page.getByRole('combobox');
		await expect(combobox).toBeFocused();
	});

	test('typing filters the palette to matching items', async ({ page }) => {
		const isMac = process.platform === 'darwin';
		await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
		await expect(page.getByTestId('command-palette')).toBeVisible();
		await page.keyboard.type('git');
		await expect(page.getByRole('option', { name: /GitHub/ }).first()).toBeVisible();
	});

	test('Escape closes the palette', async ({ page }) => {
		const isMac = process.platform === 'darwin';
		await page.keyboard.press(isMac ? 'Meta+k' : 'Control+k');
		await expect(page.getByTestId('command-palette')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('command-palette')).toBeHidden();
	});
});

test.describe('vault flows · password generator', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
		await completeDemoOnboarding(page);
	});

	test('topbar key icon opens the standalone QuickGenerator popover', async ({
		page
	}) => {
		const button = page.getByRole('button', { name: 'Generate password' });
		await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		await button.click();
		const popover = page.getByTestId('quick-generator');
		await expect(popover).toBeVisible();
		await expect(popover).toHaveAttribute('role', 'dialog');
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		// Escape closes the popover without creating any vault item.
		await page.keyboard.press('Escape');
		await expect(popover).toBeHidden();
		await expect(button).toHaveAttribute('aria-expanded', 'false');
	});

	test('QuickGenerator generates a password and exposes the class-coverage controls', async ({
		page
	}) => {
		await page.getByRole('button', { name: 'Generate password' }).click();
		const popover = page.getByTestId('quick-generator');
		await expect(popover).toBeVisible();
		// The generator UI inside the popover renders a non-empty
		// password and the four character-class toggles.
		const password = popover.locator('.password');
		await expect(password).not.toHaveText('enable at least one class');
		await expect(popover.getByText('a–z', { exact: true })).toBeVisible();
		await expect(popover.getByText('A–Z', { exact: true })).toBeVisible();
		await expect(popover.getByText('0–9', { exact: true })).toBeVisible();
		await expect(popover.getByText('!@#', { exact: true })).toBeVisible();
	});
});
