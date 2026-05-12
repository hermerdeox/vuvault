import type { Page } from '@playwright/test';

export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForFunction(
		() => document.documentElement.dataset.hydrated === 'true',
		undefined,
		{ timeout: 10_000 }
	);
}
