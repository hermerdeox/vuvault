import { expect, type Page } from '@playwright/test';
import { waitForHydration } from './_helpers';

const RECOVERY_PASSWORD = 'Jasper! Maple! Lantern! Orchid!';

export async function clearStorage(page: Page): Promise<void> {
	await page.goto('/');
	await waitForHydration(page);
	await page.evaluate(async () => {
		try {
			localStorage.clear();
			sessionStorage.clear();
			const dbs = await indexedDB.databases?.();
			for (const db of dbs ?? []) {
				if (db.name) indexedDB.deleteDatabase(db.name);
			}
		} catch {
			// best-effort for browsers that do not expose indexedDB.databases()
		}
	});
}

export async function completeDemoOnboarding(
	page: Page,
	deviceLabel = 'Test Mac'
): Promise<void> {
	await page.goto('/onboarding');
	await waitForHydration(page);
	await page.getByRole('button', { name: 'Begin setup' }).click();
	await page.locator('input[type="text"]').first().fill(deviceLabel);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.locator('input[type="checkbox"]').first().check();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByLabel('Recovery Password', { exact: true }).fill(RECOVERY_PASSWORD);
	await page.getByLabel('Confirm Recovery Password').fill(RECOVERY_PASSWORD);
	await page
		.getByLabel(/I have saved this Recovery Password separately/)
		.check();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.getByRole('button', { name: 'Use demo mode' }).click();
	await page.getByRole('button', { name: 'Continue in demo mode' }).click();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Enter your vault' })).toBeEnabled({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Enter your vault' }).click();
	await expect(page).toHaveURL(/\/vault/);
}
