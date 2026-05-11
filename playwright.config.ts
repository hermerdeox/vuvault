import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration — Phase 3 smoke coverage.
 *
 * The dev server is started by Playwright via `webServer.command`. The
 * goal is route-guard coverage and basic flow smoke; deeper component
 * coverage stays in vitest.
 */
export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [['list']],
	use: {
		baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
		trace: 'retain-on-failure'
	},
	webServer:
		process.env.PLAYWRIGHT_SKIP_WEB_SERVER === '1'
			? undefined
			: {
					command: 'npm run dev',
					url: 'http://localhost:5173',
					reuseExistingServer: !process.env.CI,
					timeout: 60_000
				},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
