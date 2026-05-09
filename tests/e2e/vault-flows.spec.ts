import { expect, test, type Page } from '@playwright/test';

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

async function clearStorage(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(async () => {
		try {
			localStorage.clear();
			sessionStorage.clear();
			const dbs = await indexedDB.databases?.();
			for (const db of dbs ?? []) {
				if (db.name) indexedDB.deleteDatabase(db.name);
			}
		} catch {
			// best-effort
		}
	});
}

async function completeDemoOnboarding(page: Page, deviceLabel = 'Test Mac'): Promise<void> {
	await page.goto('/onboarding');
	// Step 1 — Welcome.
	await page.getByRole('button', { name: 'Begin setup' }).click();
	// Step 2 — Identity. Fill the device label.
	await page.locator('input[type="text"]').first().fill(deviceLabel);
	await page.getByRole('button', { name: /^Continue/ }).click();
	// Step 3 — Secret. Acknowledge the checkbox, then continue.
	await page.locator('input[type="checkbox"]').first().check();
	await page.getByRole('button', { name: /^Continue/ }).click();
	// Step 4 — Touch. Pick demo mode (gated behind the dev flag).
	await page.getByRole('button', { name: 'Use demo mode' }).click();
	await page.getByRole('button', { name: 'Continue in demo mode' }).click();
	await page.getByRole('button', { name: /^Continue/ }).click();
	// Step 5 — Verify. Just continue.
	await page.getByRole('button', { name: 'Looks right, continue' }).click();
	// Step 6 — Pricing. Continue with Free.
	await page.getByRole('button', { name: /Continue with/ }).click();
	// Step 7 — Provision. Wait for the seal pipeline to complete.
	await expect(page.getByRole('button', { name: 'Enter your vault' })).toBeEnabled({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Enter your vault' }).click();
	await expect(page).toHaveURL(/\/vault/);
}

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
		// /onboarding now has an account and the vault is unlocked → /vault.
		await page.goto('/onboarding');
		await expect(page).toHaveURL(/\/vault/);
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

	test('javascript: URLs are NOT rendered as clickable links (XSS guard)', async ({ page }) => {
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('Evil');
		await page.locator('#ie-username').fill('attacker');
		// `type="url"` rejects `javascript:` natively, so use the `novalidate`
		// path by setting the value via JS to simulate a malicious import.
		await page.locator('#ie-url').evaluate((el, url) => {
			(el as HTMLInputElement).value = url;
			el.dispatchEvent(new Event('input', { bubbles: true }));
		}, 'javascript:alert(1)');
		await page.getByRole('button', { name: 'Add to vault' }).click();
		await page.locator('.list-pane button.item').first().click();
		// The URL field is rendered as plain text (no <a href>) and a
		// warning hint is shown.
		const detail = page.locator('.detail');
		await expect(detail).toContainText('javascript:alert(1)');
		await expect(detail.locator('a.value.link')).toHaveCount(0);
		await expect(detail).toContainText('non-http(s) scheme');
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
		await expect(popover.getByText('a–z')).toBeVisible();
		await expect(popover.getByText('A–Z')).toBeVisible();
		await expect(popover.getByText('0–9')).toBeVisible();
		await expect(popover.getByText('!@#')).toBeVisible();
	});
});
