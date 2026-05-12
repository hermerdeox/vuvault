import { expect, test, type Page } from '@playwright/test';
import { waitForHydration } from './_helpers';

const PANEL_IDS = [
	'hero',
	'problem',
	'promise',
	'credentials',
	'vault',
	'mobile',
	'documents',
	'stack',
	'compare',
	'pricing',
	'trust',
	'final'
] as const;

async function readDocAttr(page: Page, attr: string): Promise<string | null> {
	return page.evaluate((a) => document.documentElement.getAttribute(a), attr);
}

async function waitForLandingHydration(page: Page): Promise<void> {
	await waitForHydration(page);
	await expect(page.locator('main.stage')).toHaveAttribute('data-hydrated', 'true');
	await expect(page.locator('section#hero')).toHaveAttribute('aria-hidden', 'false');
}

async function pressLandingShortcut(page: Page, key: string): Promise<void> {
	await page.evaluate((shortcut) => {
		window.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: shortcut,
				bubbles: true,
				cancelable: true
			})
		);
	}, key);
}

test.describe('landing page · render', () => {
	test('renders the canonical $25.60/year price and never $2.56', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		await expect(page.locator('main')).toContainText('VuVault');
		await expect(page.locator('main')).toContainText('25.60');
		await expect(page.locator('main')).not.toContainText('$2.56');
	});

	test('all 12 panels are present in the DOM with the expected ids', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		for (const id of PANEL_IDS) {
			await expect(page.locator(`section#${id}`)).toBeAttached();
		}
	});

	test('only the active panel is interactive (inert on the rest)', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		const hero = page.locator('section#hero');
		await expect(hero).toHaveAttribute('aria-hidden', 'false');
		const others = page.locator('section[aria-hidden="true"]');
		// 12 panels total, 11 should be aria-hidden when hero is active
		await expect(others).toHaveCount(11);
	});
});

test.describe('landing page · keyboard navigation', () => {
	test('J advances and K retreats one panel at a time', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		// Hero is active initially. Press J → problem.
		await pressLandingShortcut(page, 'j');
		await expect(page.locator('section#problem')).toHaveAttribute('aria-hidden', 'false');
		await pressLandingShortcut(page, 'j');
		await expect(page.locator('section#promise')).toHaveAttribute('aria-hidden', 'false');
		await pressLandingShortcut(page, 'k');
		await expect(page.locator('section#problem')).toHaveAttribute('aria-hidden', 'false');
	});

	test('PageDown / PageUp / Home / End', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		await pressLandingShortcut(page, 'End');
		await expect(page.locator('section#final')).toHaveAttribute('aria-hidden', 'false');
		await pressLandingShortcut(page, 'Home');
		await expect(page.locator('section#hero')).toHaveAttribute('aria-hidden', 'false');
		await pressLandingShortcut(page, 'PageDown');
		await expect(page.locator('section#problem')).toHaveAttribute('aria-hidden', 'false');
		await pressLandingShortcut(page, 'PageUp');
		await expect(page.locator('section#hero')).toHaveAttribute('aria-hidden', 'false');
	});

	test('arrow keys also advance and retreat', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		await pressLandingShortcut(page, 'ArrowDown');
		await expect(page.locator('section#problem')).toHaveAttribute('aria-hidden', 'false');
		await pressLandingShortcut(page, 'ArrowUp');
		await expect(page.locator('section#hero')).toHaveAttribute('aria-hidden', 'false');
	});
});

test.describe('landing page · audience toggle', () => {
	test('T key flips the data-audience attribute', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		expect(await readDocAttr(page, 'data-audience')).toBe('user');
		await page.keyboard.press('t');
		// Audience toggle has a 160ms fade; allow for it.
		await expect.poll(async () => readDocAttr(page, 'data-audience')).toBe('tech');
		await page.keyboard.press('t');
		await expect.poll(async () => readDocAttr(page, 'data-audience')).toBe('user');
	});

	test('the tab UI also flips audience', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		const audienceGroup = page.getByRole('group', { name: 'Audience' });
		await audienceGroup.getByRole('button', { name: 'Show me the proof' }).click();
		await expect.poll(async () => readDocAttr(page, 'data-audience')).toBe('tech');
		await audienceGroup.getByRole('button', { name: 'I just want it safe' }).click();
		await expect.poll(async () => readDocAttr(page, 'data-audience')).toBe('user');
	});
});

test.describe('landing page · pager dots', () => {
	test('clicking pager dots jumps to the matching panel', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		const pager = page.getByRole('navigation', { name: 'Sections' });
		await pager.getByRole('button', { name: 'Pricing' }).click();
		await expect(page.locator('section#pricing')).toHaveAttribute('aria-hidden', 'false');
		await pager.getByRole('button', { name: 'Hero' }).click();
		await expect(page.locator('section#hero')).toHaveAttribute('aria-hidden', 'false');
	});
});

test.describe('landing page · theme parity', () => {
	test('theme toggle flips data-theme attribute', async ({ page }) => {
		await page.goto('/');
		await waitForLandingHydration(page);
		expect(await readDocAttr(page, 'data-theme')).toBe('modern');
		await page.getByRole('button', { name: 'Toggle theme' }).click();
		await expect.poll(async () => readDocAttr(page, 'data-theme')).toBe('brutalist');
		// Hero is still rendered and active in the brutalist theme.
		await expect(page.locator('section#hero')).toHaveAttribute('aria-hidden', 'false');
		await expect(page.locator('main')).toContainText('25.60');
	});
});

test.describe('landing page · cardinal rule', () => {
	test('html and body never page-scroll', async ({ page }) => {
		await page.goto('/');
		await waitForHydration(page);
		const overflow = await page.evaluate(() => {
			const html = window.getComputedStyle(document.documentElement);
			const body = window.getComputedStyle(document.body);
			return { html: html.overflow, body: body.overflow };
		});
		expect(overflow.html).toContain('hidden');
		expect(overflow.body).toContain('hidden');
	});
});

test.describe('vault redirect guard', () => {
	test('a fresh browser at /vault is bounced to /onboarding', async ({ page }) => {
		await page.goto('/vault');
		await expect(page).toHaveURL(/\/onboarding/);
	});

	test('a fresh browser at /unlock is bounced to /onboarding', async ({ page }) => {
		await page.goto('/unlock');
		await expect(page).toHaveURL(/\/onboarding/);
	});
});
