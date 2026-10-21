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
 *   4. Add a text-only document record (file attachments were removed:
 *      the editor offers no file input, and there is no file store)
 *   5. Inspect the on-disk IndexedDB rows to assert the vault blob
 *      contains NO plaintext substrings — the shipped zero-knowledge
 *      claim against a server compromise — and is exactly the fixed
 *      64 KiB V0-C2 floor (+16-byte GCM tag)
 *   6. Lock the vault and confirm the route guard sends the user
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
const DOCUMENT_REF = 'Fireproof safe, bottom drawer — LEASE-2031-GVL';

async function selectListItem(page: Page, title: string): Promise<void> {
	await page
		.locator('.list-pane button.item', { hasText: title })
		.first()
		.click();
	await expect(page.locator('.detail')).toContainText(title);
}

/** Read the encrypted vault row and the store list from Dexie/IDB. */
async function dumpIdb(page: Page): Promise<{
	vaultCiphertextLen: number;
	vaultCiphertextHex: string;
	storeNames: string[];
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
		const storeNames = await new Promise<string[]>((resolve, reject) => {
			const req = indexedDB.open('vuvault');
			req.onerror = () => reject(req.error);
			req.onsuccess = () => {
				const names = Array.from(req.result.objectStoreNames);
				req.result.close();
				resolve(names);
			};
		});
		return {
			vaultCiphertextLen: vault ? vault.ciphertext.length : 0,
			vaultCiphertextHex: vault ? toHex(vault.ciphertext) : '',
			storeNames
		};
	});
}

test.describe('full vault workflow', () => {
	test.beforeEach(async ({ page }) => {
		await clearStorage(page);
	});

	test('account → login → card → document record → reveal → lock', async ({
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

		// --- Step 3: add a text-only document record ---------------
		await page.getByRole('button', { name: 'Add item' }).click();
		await page.getByRole('button', { name: /^Document$/ }).click();
		await expect(page.locator('input[type="file"]')).toHaveCount(0);
		await page.locator('#ie-title').fill('Lease');
		await page.locator('#ie-doc-desc').fill('Greenville office, 24 months');
		await page.locator('#ie-doc-ref').fill(DOCUMENT_REF);
		await page.getByRole('button', { name: 'Save to vault' }).click();
		await expect(page.locator('.list-pane')).toContainText('Lease');

		await selectListItem(page, 'Lease');
		await expect(detail).toContainText('Greenville office, 24 months');
		await expect(detail).toContainText(DOCUMENT_REF);
		await expect(page.getByTestId('download-document')).toHaveCount(0);

		// --- Step 4: zero-knowledge IDB inspection ------------------
		// Assert that the encrypted bytes in IndexedDB contain none of
		// the secret material the user typed. AES-GCM ciphertext is
		// random-looking; a plaintext substring leaking through would
		// mean an encryption regression. The vault row must also sit at
		// the fixed V0-C2 floor, and the retired file store must be gone.
		const dump = await dumpIdb(page);
		expect(dump.vaultCiphertextLen).toBe(64 * 1024 + 16);
		expect(dump.storeNames).not.toContain('documentBlobs');
		const lookFor = [
			'GitHub',
			'r-lopez',
			LOGIN_PASSWORD,
			'Ricardo',
			'4242 4242 4242 4242',
			'Lease',
			DOCUMENT_REF
		];
		for (const needle of lookFor) {
			const hex = Buffer.from(needle, 'utf8').toString('hex');
			expect(
				dump.vaultCiphertextHex,
				`vault ciphertext contains plaintext "${needle}"`
			).not.toContain(hex);
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
