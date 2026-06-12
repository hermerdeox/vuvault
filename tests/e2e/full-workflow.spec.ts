import { expect, test, type Page } from '@playwright/test';
import { clearStorage, completeDemoOnboarding } from './helpers';

/**
 * End-to-end coverage for the full vault workflow described in the
 * "Full App Workflow E2E + Privacy Level Plan":
 *
 *   1. Create an account via demo-mode onboarding
 *   2. Add a login item with a real password; reveal it and confirm
 *      the plaintext matches input
 *   3. Add a credit card item; reveal the card number and CVC
 *   4. Attach an encrypted document file to a document item
 *   5. Download the document, decrypt client-side, and confirm the
 *      plaintext bytes match the input
 *   6. Inspect the on-disk IndexedDB rows to assert the vault blob
 *      and the document blob contain NO plaintext substrings — the
 *      shipped zero-knowledge claim against a server compromise
 *   7. Lock the vault and confirm the route guard sends the user
 *      to /unlock (re-unlock requires Secret Key re-entry which is
 *      covered by `tests/e2e/sync.spec.ts` end-to-end with OPAQUE)
 *
 * Sync is unwired in dev — `PUBLIC_SYNC_ORIGIN` is empty — so this
 * test exercises the local-first path. The R2 round-trip is covered
 * by `tests/integration/api-routes.spec.ts` (handler-level) and the
 * live M3 sync test (`tests/e2e/sync.spec.ts`).
 */

const LOGIN_PASSWORD = 'Tr0ub4dor&3-Lemon-Sky-Forest';
const CARD_NUMBER = '4242 4242 4242 4242';
const CARD_CVC = '123';
const CARD_EXPIRY = '12/29';
const DOCUMENT_TEXT =
	'CONFIDENTIAL LEASE AGREEMENT — Greenville office. 24 months. Confidential.';

async function selectListItem(page: Page, title: string): Promise<void> {
	await page
		.locator('.list-pane button.item', { hasText: title })
		.first()
		.click();
	await expect(page.locator('.detail')).toContainText(title);
}

/** Read the encrypted vault row + document blob rows from Dexie/IDB. */
async function dumpIdb(page: Page): Promise<{
	vaultCiphertextLen: number;
	vaultCiphertextHex: string;
	documentBlobs: { id: string; ciphertextLen: number; ciphertextHex: string }[];
}> {
	return page.evaluate(async () => {
		function toHex(bytes: Uint8Array): string {
			let out = '';
			for (const b of bytes) out += b.toString(16).padStart(2, '0');
			return out;
		}
		async function readAll<T>(
			dbName: string,
			storeName: string
		): Promise<T[]> {
			return new Promise((resolve, reject) => {
				const req = indexedDB.open(dbName);
				req.onerror = () => reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains(storeName)) {
						db.close();
						resolve([]);
						return;
					}
					const tx = db.transaction(storeName, 'readonly');
					const store = tx.objectStore(storeName);
					const getAll = store.getAll();
					getAll.onerror = () => {
						db.close();
						reject(getAll.error);
					};
					getAll.onsuccess = () => {
						db.close();
						resolve((getAll.result ?? []) as T[]);
					};
				};
			});
		}
		const vault = (await readAll<{
			id: string;
			ciphertext: Uint8Array;
		}>('vuvault', 'vault'))[0];
		const docs = await readAll<{
			id: string;
			ciphertext: Uint8Array;
		}>('vuvault', 'documentBlobs');
		return {
			vaultCiphertextLen: vault ? vault.ciphertext.length : 0,
			vaultCiphertextHex: vault ? toHex(vault.ciphertext) : '',
			documentBlobs: docs.map((d) => ({
				id: d.id,
				ciphertextLen: d.ciphertext.length,
				ciphertextHex: toHex(d.ciphertext)
			}))
		};
	});
}

test.describe('full vault workflow', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
	});

	test('account → login → card → document → reveal → download → lock', async ({
		page
	}) => {
		await completeDemoOnboarding(page, 'E2E Workflow');

		// --- Step 1: add and verify the login item -------------------
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Login$/ }).click();
		await page.locator('#ie-title').fill('GitHub');
		await page.locator('#ie-username').fill('r-lopez');
		await page.locator('#ie-password').fill(LOGIN_PASSWORD);
		await page.locator('#ie-url').fill('https://github.com');
		await page.getByRole('button', { name: 'Save to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('GitHub');

		await selectListItem(page, 'GitHub');
		const detail = page.locator('.detail');
		await expect(detail).toContainText('r-lopez');
		await detail.getByRole('button', { name: 'Toggle reveal' }).first().click();
		await expect(detail).toContainText(LOGIN_PASSWORD);

		// --- Step 2: add and verify the card item --------------------
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Card$/ }).click();
		await page.locator('#ie-title').fill('Visa');
		await page.locator('#ie-holder').fill('Ricardo Lopez');
		await page.locator('#ie-num').fill(CARD_NUMBER);
		await page.locator('#ie-exp').fill(CARD_EXPIRY);
		await page.locator('#ie-cvc').fill(CARD_CVC);
		await page.getByRole('button', { name: 'Save to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('Visa');

		await selectListItem(page, 'Visa');
		await expect(detail).toContainText('Ricardo Lopez');
		await expect(detail).toContainText('•••• •••• •••• 4242');
		await detail.getByRole('button', { name: 'Toggle reveal' }).first().click();
		await expect(detail).toContainText(CARD_NUMBER);
		await detail.getByRole('button', { name: 'Toggle CVC' }).first().click();
		await expect(detail).toContainText(CARD_CVC);

		// --- Step 3: add a document with an encrypted file ----------
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Document$/ }).click();
		await page.locator('#ie-title').fill('Lease');
		const fileBytes = new TextEncoder().encode(DOCUMENT_TEXT);
		await page.locator('[data-testid="document-file-input"]').setInputFiles({
			name: 'lease.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from(fileBytes)
		});
		const summary = page.getByTestId('document-summary');
		await expect(summary).toBeVisible({ timeout: 10_000 });
		await expect(summary).toContainText('lease.txt');
		await expect(summary).toContainText('text/plain');
		await page.locator('#ie-doc-desc').fill('Greenville office, 24 months');
		await page.getByRole('button', { name: 'Save to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('Lease');

		await selectListItem(page, 'Lease');
		const docActions = page.getByTestId('document-actions');
		await expect(docActions).toBeVisible();
		await expect(detail).toContainText('lease.txt');
		await expect(detail).toContainText('text/plain');

		// Capture and verify the SHA-256 advertised in the UI matches
		// what the input bytes hash to. The codec serializes that hash
		// alongside the encrypted blob so the integrity claim is
		// reproducible by anyone who knows the plaintext.
		const expectedSha = await page.evaluate(async (text: string) => {
			const digest = await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(text)
			);
			const view = new Uint8Array(digest);
			let hex = '';
			for (const b of view) hex += b.toString(16).padStart(2, '0');
			return hex;
		}, DOCUMENT_TEXT);
		await expect(detail).toContainText(expectedSha.slice(0, 32));

		// --- Step 4: exercise the document download path ------------
		const downloadPromise = page.waitForEvent('download');
		await page.getByTestId('download-document').click();
		const download = await downloadPromise;
		const path = await download.path();
		expect(path).toBeTruthy();
		const fs = await import('node:fs/promises');
		const downloaded = await fs.readFile(path!);
		expect(downloaded.toString('utf8')).toBe(DOCUMENT_TEXT);
		expect(download.suggestedFilename()).toBe('lease.txt');

		// --- Step 5: zero-knowledge IDB inspection ------------------
		// Assert that the encrypted bytes in IndexedDB contain none of
		// the secret material the user typed. AES-GCM ciphertext is
		// random-looking; a plaintext substring leaking through would
		// mean an encryption regression.
		const dump = await dumpIdb(page);
		expect(dump.vaultCiphertextLen).toBeGreaterThan(0);
		expect(dump.documentBlobs).toHaveLength(1);
		const lookFor = [
			'GitHub',
			'r-lopez',
			LOGIN_PASSWORD,
			'Ricardo',
			'4242 4242 4242 4242',
			'Lease',
			DOCUMENT_TEXT
		];
		for (const needle of lookFor) {
			const hex = Buffer.from(needle, 'utf8').toString('hex');
			expect(
				dump.vaultCiphertextHex,
				`vault ciphertext contains plaintext "${needle}"`
			).not.toContain(hex);
			for (const doc of dump.documentBlobs) {
				expect(
					doc.ciphertextHex,
					`document ciphertext contains plaintext "${needle}"`
				).not.toContain(hex);
			}
		}

		// --- Step 6: lock the vault ---------------------------------
		// Re-unlock with full Secret Key re-entry is covered by the
		// M3 sync E2E (`tests/e2e/sync.spec.ts`); here we assert the
		// route guard correctly fences /vault behind /unlock once
		// the in-memory session is torn down.
		await page.getByRole('button', { name: 'Lock vault' }).click();
		await expect(page).toHaveURL(/\/unlock/);
		await page.goto('/vault');
		await expect(page).toHaveURL(/\/unlock/);
	});
});
