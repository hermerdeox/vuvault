import { test, expect, type Page } from '@playwright/test';

const M3_E2E = process.env.M3_E2E === '1' || process.env.M3_E2E === 'true';

test.describe('vault flows · sync', () => {
	test.skip(!M3_E2E, 'M3_E2E=1 not set; full sync round-trip skipped (see file header)');

	test('onboard → save → reload → re-unlock pulls remote blob', async ({ page }) => {
		await clearStorage(page);
		const secretKey = await completeM3Onboarding(page);

		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('m3-sync-test-item');
		await page.locator('#ie-username').fill('sync-user');
		await page.locator('#ie-password').fill('correct-horse-battery-staple');
		await page.getByRole('button', { name: 'Add to vault' }).click();
		await expect(page.getByText('m3-sync-test-item')).toBeVisible();

		await page.getByRole('button', { name: /Sync ·/ }).click();
		await expect(page.getByTestId('sync-status')).toHaveText('synced', { timeout: 20_000 });

		await page.getByRole('button', { name: 'Lock vault' }).click();
		await expect(page).toHaveURL(/\/unlock/);
		await page.locator('#secret-key').fill(secretKey);
		await page.getByRole('button', { name: /Touch ID \+ Unlock/ }).click();
		await expect(page).toHaveURL(/\/vault/);
		await expect(
			page.getByRole('button', { name: 'm3-sync-test-item sync-user' })
		).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('sync-status')).toContainText(/ready|synced/);
	});
});

async function clearStorage(page: Page): Promise<void> {
	await page.goto('/');
	await page.evaluate(async () => {
		localStorage.clear();
		sessionStorage.clear();
		const dbs = await indexedDB.databases?.();
		for (const db of dbs ?? []) {
			if (db.name) indexedDB.deleteDatabase(db.name);
		}
	});
}

async function completeM3Onboarding(page: Page): Promise<string> {
	await page.goto('/onboarding');
	await page.getByRole('button', { name: 'Begin setup' }).click();
	await page.locator('#device-label').fill('m3-e2e-test');
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await expect.poll(async () => {
		return await page.evaluate(() =>
			[...document.querySelectorAll('.secret-value .grp')]
				.map((el) => el.textContent?.trim())
				.join('').length
		);
	}).toBe(52);
	const secretKey = await page.evaluate(() => {
		const groups = [...document.querySelectorAll('.secret-value .grp')].map((el) =>
			el.textContent?.trim()
		);
		return groups.join('');
	});
	expect(secretKey).toHaveLength(52);
	await page.locator('input[type="checkbox"]').first().check();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await page.getByRole('button', { name: 'Bind biometric authenticator' }).click();
	await expect(page.getByText(/WebAuthn PRF active/)).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await page.getByRole('button', { name: 'Looks right, continue' }).click();
	await page.getByRole('button', { name: /Continue with/ }).click();
	await expect(page.getByRole('button', { name: 'Enter your vault' })).toBeEnabled({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Enter your vault' }).click();
	await expect(page).toHaveURL(/\/vault/);
	return secretKey.replace(/\s+/g, '');
}
