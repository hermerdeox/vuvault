import { test, expect, type Page } from '@playwright/test';
import { clearStorage } from './helpers';

const M3_E2E = process.env.M3_E2E === '1' || process.env.M3_E2E === 'true';
const RECOVERY_PASSWORD = 'Cobalt! River! Juniper! Falcon!';

/**
 * Record the pathname of every `/api/*` request the page issues. Used
 * to prove — behaviorally, against the live preview — that the §L07b
 * hard cutover holds: the save/document flow must touch ONLY the v2
 * surface (`/api/v2/blobs/*`, `/api/v2/inv/*`) and NEVER the retired
 * per-account routes (`/api/blobs/*`, `/api/documents/*`). This is the
 * V1-C1/V1-C3 closure that the shape-only release probe cannot make.
 */
function trackApiRequests(page: Page): string[] {
	const paths: string[] = [];
	page.on('request', (req) => {
		try {
			const p = new URL(req.url()).pathname;
			if (p.startsWith('/api/')) paths.push(p);
		} catch {
			/* non-URL request; ignore */
		}
	});
	return paths;
}

/** Assert no request ever hit the deleted per-account transport. */
function assertNoLegacyRoutes(paths: string[]): void {
	const legacy = paths.filter(
		(p) => p.startsWith('/api/blobs/') || p.startsWith('/api/documents/')
	);
	expect(legacy, `legacy per-account routes must be gone: ${legacy.join(', ')}`).toEqual([]);
}

test.describe('vault flows · sync', () => {
	test.skip(!M3_E2E, 'M3_E2E=1 not set; full sync round-trip skipped (see file header)');

	test('onboard → save → reload → re-unlock pulls remote blob', async ({ page }) => {
		await clearStorage(page);
		const apiPaths = trackApiRequests(page);
		await completeM3Onboarding(page);

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
		await page.getByRole('button', { name: 'Touch ID quick unlock' }).click();
		await expect(page).toHaveURL(/\/vault/);
		await expect(
			page.getByRole('button', { name: 'm3-sync-test-item sync-user' })
		).toBeVisible({ timeout: 20_000 });
		await expect(page.getByTestId('sync-status')).toContainText(/ready|synced/);

		// Behavioral V1-C1/V1-C3 proof: the whole-vault save + the
		// re-unlock pull used the v2 blob/inventory surface and never the
		// retired per-account routes.
		assertNoLegacyRoutes(apiPaths);
		expect(apiPaths.some((p) => p.startsWith('/api/v2/blobs/'))).toBe(true);
		expect(apiPaths.some((p) => p.startsWith('/api/v2/inv/'))).toBe(true);
	});

	test('document file round-trips through R2 as opaque ciphertext', async ({ page }) => {
		await clearStorage(page);
		const apiPaths = trackApiRequests(page);
		await completeM3Onboarding(page);

		// Attach an encrypted document. The client sealer (sealDocument)
		// runs inside the browser; sync-client.uploadV2Blob pushes the
		// AES-GCM ciphertext to /api/v2/blobs/<uuid> (random UUID, no
		// account prefix) against the live Wrangler R2 binding, and the
		// document UUID is recorded in the encrypted inventory at
		// /api/v2/inv/<addr>.
		const DOCUMENT_TEXT =
			'M3 sync E2E lease bytes — confidential — multi-paragraph payload.';
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Document$/ }).click();
		await page.locator('#ie-title').fill('m3-sync-doc');
		await page
			.locator('[data-testid="document-file-input"]')
			.setInputFiles({
				name: 'lease.txt',
				mimeType: 'text/plain',
				buffer: Buffer.from(new TextEncoder().encode(DOCUMENT_TEXT))
			});
		const summary = page.getByTestId('document-summary');
		await expect(summary).toBeVisible({ timeout: 10_000 });
		// `Sync` row in the summary toggles to `pushed to server` once
		// the upload to R2 completes.
		await expect(summary).toContainText(/pushed to server/i, {
			timeout: 20_000
		});
		await page.getByRole('button', { name: 'Add to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('m3-sync-doc');

		// Force a full vault sync so the parent vault blob (with the
		// docBlobId metadata) lands on the server too.
		await page.getByRole('button', { name: /Sync ·/ }).click();
		await expect(page.getByTestId('sync-status')).toHaveText('synced', {
			timeout: 20_000
		});

		// Purge ONLY the local document blob row so the next download
		// has to come from R2. The vault item (containing docBlobId)
		// stays put.
		const blobId = await page.evaluate(async () => {
			const req = indexedDB.open('vuvault');
			return new Promise<string>((resolve, reject) => {
				req.onerror = () => reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('documentBlobs')) {
						db.close();
						resolve('');
						return;
					}
					const tx = db.transaction('documentBlobs', 'readwrite');
					const store = tx.objectStore('documentBlobs');
					const all = store.getAllKeys();
					all.onsuccess = () => {
						const keys = (all.result ?? []) as string[];
						const first = keys[0] ?? '';
						store.clear().onsuccess = () => {
							db.close();
							resolve(first);
						};
					};
					all.onerror = () => {
						db.close();
						reject(all.error);
					};
				};
			});
		});
		expect(blobId).toBeTruthy();

		// Re-select the document and trigger a download. The vault
		// session sees no local blob row, falls back to GET
		// /api/v2/blobs/<uuid>, decrypts the ciphertext returned by R2,
		// and produces a Blob URL with the original plaintext.
		await page
			.locator('.list-pane button.item', { hasText: 'm3-sync-doc' })
			.first()
			.click();
		const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
		await page.getByTestId('download-document').click();
		const download = await downloadPromise;
		const path = await download.path();
		expect(path).toBeTruthy();
		const fs = await import('node:fs/promises');
		const downloaded = await fs.readFile(path!);
		expect(downloaded.toString('utf8')).toBe(DOCUMENT_TEXT);

		// Behavioral V1-C1 proof: the document upload, the full-vault
		// sync, and the R2-fallback download all used the v2 blob/
		// inventory surface and never the retired per-account routes.
		assertNoLegacyRoutes(apiPaths);
		expect(apiPaths.some((p) => p.startsWith('/api/v2/blobs/'))).toBe(true);
		expect(apiPaths.some((p) => p.startsWith('/api/v2/inv/'))).toBe(true);
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

	await page.getByRole('button', { name: 'Looks right, continue' }).click();
	await page.getByRole('button', { name: /Continue with/ }).click();
	await expect(page.getByRole('button', { name: 'Enter your vault' })).toBeEnabled({
		timeout: 30_000
	});
	await page.getByRole('button', { name: 'Enter your vault' }).click();
	await expect(page).toHaveURL(/\/vault/);
	return secretKey.replace(/\s+/g, '');
}
