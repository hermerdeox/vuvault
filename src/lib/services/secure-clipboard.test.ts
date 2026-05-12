import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearClipboard, copySecretToClipboard } from './secure-clipboard';

describe('secure clipboard', () => {
	const writeText = vi.fn<(text: string) => Promise<void>>();
	const originalNavigator = globalThis.navigator;

	beforeEach(() => {
		vi.useFakeTimers();
		writeText.mockResolvedValue(undefined);
		Object.defineProperty(globalThis, 'navigator', {
			value: { clipboard: { writeText } },
			configurable: true
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		Object.defineProperty(globalThis, 'navigator', {
			value: originalNavigator,
			configurable: true
		});
		vi.restoreAllMocks();
	});

	it('copies then clears after the TTL', async () => {
		await expect(copySecretToClipboard('password', 'secret', { ttlMs: 1000 })).resolves.toBe(
			true
		);
		expect(writeText).toHaveBeenCalledWith('secret');

		await vi.advanceTimersByTimeAsync(1000);
		expect(writeText).toHaveBeenLastCalledWith('');
	});

	it('clears immediately on demand', async () => {
		await copySecretToClipboard('password', 'secret', { ttlMs: 60_000 });
		await clearClipboard('lock');
		expect(writeText).toHaveBeenLastCalledWith('');
	});
});
