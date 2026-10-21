import { test, expect, type Page } from '@playwright/test';
import { clearStorage } from './helpers';

const M3_E2E = process.env.M3_E2E === '1' || process.env.M3_E2E === 'true';
const RECOVERY_PASSWORD = 'Cobalt! River! Juniper! Falcon!';

type ApiRequest = {
	method: string;
	path: string;
	headers: Record<string, string>;
	bodyLength: number;
};

/**
 * Record every `/api/*` request the page issues, with its headers and
 * body size. Used to prove — behaviorally, against the live preview —
 * that the v2 surface is the only blob transport (never the retired
 * per-account `/api/blobs/*`, `/api/documents/*` routes; V1-C1/V1-C3),
 * that v2 requests carry anonymous tokens instead of the session token
 * (V0-C1), and that vault uploads are a fixed size on the wire (V0-C2).
 */
function trackApiRequests(page: Page): ApiRequest[] {
	const seen: ApiRequest[] = [];
	page.on('request', (req) => {
		try {
			const path = new URL(req.url()).pathname;
			if (!path.startsWith('/api/')) return;
			seen.push({
				method: req.method(),
				path,
				headers: req.headers(),
				bodyLength: req.postData()?.length ?? 0
			});
		} catch {
			/* non-URL request; ignore */
		}
	});
	return seen;
}

/** Assert no request ever hit the deleted per-account transport. */
function assertNoLegacyRoutes(requests: ApiRequest[]): void {
	const legacy = requests
		.map((r) => r.path)
		.filter((p) => p.startsWith('/api/blobs/') || p.startsWith('/api/documents/'));
	expect(legacy, `legacy per-account routes must be gone: ${legacy.join(', ')}`).toEqual([]);
}

/** Every v2 blob / inventory request spends a token and never sends the session token. */
function assertTokenOnlyV2(requests: ApiRequest[]): void {
	const v2 = requests.filter(
		(r) => r.path.startsWith('/api/v2/blobs/') || r.path.startsWith('/api/v2/inv/')
	);
	expect(v2.length).toBeGreaterThan(0);
	for (const r of v2) {
		expect(r.headers['x-vu0-token'], `${r.method} ${r.path} must carry a token`).toMatch(/^v1\./);
		expect(r.headers.authorization, `${r.method} ${r.path} must not carry the session`).toBeUndefined();
	}
	const tokens = v2.map((r) => r.headers['x-vu0-token']);
	expect(new Set(tokens).size, 'each request spends its own token').toBe(tokens.length);
}

test.describe('vault flows · sync', () => {
	test.skip(!M3_E2E, 'M3_E2E=1 not set; full sync round-trip skipped (see file header)');

	test('onboard → save → sync → re-unlock stays local and token-only', async ({ page }) => {
		await clearStorage(page);
		const api = trackApiRequests(page);
		await completeM3Onboarding(page);

		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('m3-sync-test-item');
		await page.locator('#ie-username').fill('sync-user');
		await page.locator('#ie-password').fill('correct-horse-battery-staple');
		await page.getByRole('button', { name: 'Save to vault' }).click();
		await expect(page.getByText('m3-sync-test-item')).toBeVisible();

		await page.getByRole('button', { name: /Sync ·/ }).click();
		await expect(page.getByTestId('sync-status')).toHaveText('synced', { timeout: 20_000 });

		await page.getByRole('button', { name: 'Lock vault' }).click();
		await expect(page).toHaveURL(/\/unlock/);
		const beforeUnlock = api.length;
		await page.getByRole('button', { name: 'Touch ID quick unlock' }).click();
		await expect(page).toHaveURL(/\/vault/);
		await expect(
			page.getByRole('button', { name: 'm3-sync-test-item sync-user' })
		).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('sync-status')).toContainText(/ready|synced/);

		// Unlock reads nothing back from the sync server (V0-C1: a read
		// would link this session to the one that wrote the object).
		const unlockReads = api
			.slice(beforeUnlock)
			.filter((r) => r.path.startsWith('/api/v2/') && r.method === 'GET');
		expect(unlockReads.map((r) => r.path)).toEqual([]);

		assertNoLegacyRoutes(api);
		assertTokenOnlyV2(api);
		// Every save wrote its inventory to a fresh address.
		const invPuts = api
			.filter((r) => r.method === 'PUT' && r.path.startsWith('/api/v2/inv/'))
			.map((r) => r.path);
		expect(invPuts.length).toBeGreaterThan(0);
		expect(new Set(invPuts).size).toBe(invPuts.length);
	});

	test('every vault upload is the same size on the wire (V0-C2 floor)', async ({ page }) => {
		// Forty items through the UI outlasts the 30s default.
		test.setTimeout(180_000);
		await clearStorage(page);
		const api = trackApiRequests(page);
		await completeM3Onboarding(page);

		// One small item, then a much larger vault: both stay under the
		// 64 KiB floor, so the uploads must be byte-identical in size.
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Secure note$/ }).click();
		await page.locator('#ie-title').fill('tiny');
		await page.getByRole('button', { name: 'Save to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('tiny');
		await page.getByRole('button', { name: /Sync ·/ }).click();
		await expect(page.getByTestId('sync-status')).toHaveText('synced', { timeout: 20_000 });

		for (let i = 0; i < 40; i++) {
			await page.getByRole('button', { name: 'Add item' }).click();
			await page.getByRole('button', { name: /^Login$/ }).click();
			await page.locator('#ie-title').fill(`account-${i}`);
			await page.locator('#ie-username').fill(`user${i}@example.com`);
			await page.locator('#ie-password').fill(`correct-horse-battery-staple-${i}`);
			await page.getByRole('button', { name: 'Save to vault' }).click();
		}
		await expect(page.locator('.list-pane')).toContainText('account-39');
		await page.getByRole('button', { name: /Sync ·/ }).click();
		await expect(page.getByTestId('sync-status')).toHaveText('synced', { timeout: 20_000 });

		const blobPuts = api.filter((r) => r.method === 'PUT' && r.path.startsWith('/api/v2/blobs/'));
		expect(blobPuts.length).toBeGreaterThan(1);
		expect(new Set(blobPuts.map((r) => r.bodyLength)).size).toBe(1);
		assertTokenOnlyV2(api);
	});
});

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

	await page.getByLabel('Recovery Password', { exact: true }).fill(RECOVERY_PASSWORD);
	await page.getByLabel('Confirm Recovery Password').fill(RECOVERY_PASSWORD);
	await page
		.getByLabel(/I have saved this Recovery Password separately/)
		.check();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await page.getByRole('button', { name: 'Bind biometric authenticator' }).click();
	await expect(page.getByText(/WebAuthn PRF active/)).toBeVisible();
	await page.getByRole('button', { name: 'Continue', exact: true }).click();

	await expect(page.getByRole('button', { name: 'Enter your vault' })).toBeEnabled({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Enter your vault' }).click();
	await expect(page).toHaveURL(/\/vault/);
	return secretKey.replace(/\s+/g, '');
}
