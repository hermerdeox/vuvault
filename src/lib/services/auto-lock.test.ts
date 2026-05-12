import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoLockController, type AutoLockReason } from './auto-lock';
import type { VaultStatus } from '$lib/stores/vault.svelte';

class FakeEventTarget {
	private readonly listeners = new Map<string, Set<(event: Event) => void>>();

	addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		const fn =
			typeof listener === 'function'
				? listener
				: (event: Event) => listener.handleEvent(event);
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(fn);
	}

	removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
		const fn =
			typeof listener === 'function'
				? listener
				: (event: Event) => listener.handleEvent(event);
		this.listeners.get(type)?.delete(fn);
	}

	dispatchEvent(event: Event): boolean {
		for (const listener of this.listeners.get(event.type) ?? []) {
			listener(event);
		}
		return true;
	}
}

function setVisibility(state: DocumentVisibilityState): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => state
	});
}

describe('auto-lock controller', () => {
	let status: VaultStatus;
	let reasons: AutoLockReason[];
	let originalWindow: typeof globalThis.window | undefined;
	let originalDocument: typeof globalThis.document | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		originalWindow = globalThis.window;
		originalDocument = globalThis.document;
		const fakeWindow = new FakeEventTarget() as unknown as typeof window;
		Object.assign(fakeWindow, {
			setTimeout: globalThis.setTimeout.bind(globalThis),
			clearTimeout: globalThis.clearTimeout.bind(globalThis)
		});
		const fakeDocument = new FakeEventTarget() as unknown as typeof document;
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			writable: true,
			value: fakeWindow
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			writable: true,
			value: fakeDocument
		});
		status = 'unlocked';
		reasons = [];
		setVisibility('visible');
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
		vi.restoreAllMocks();
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			writable: true,
			value: originalWindow
		});
		Object.defineProperty(globalThis, 'document', {
			configurable: true,
			writable: true,
			value: originalDocument
		});
	});

	it('locks after the idle timeout while unlocked', async () => {
		createAutoLockController({
			getStatus: () => status,
			lock: (reason) => {
				reasons.push(reason);
				status = 'locked';
			},
			idleMs: 100,
			hiddenMs: 50
		});

		await vi.advanceTimersByTimeAsync(100);
		expect(reasons).toEqual(['idle']);
	});

	it('resets the idle timer on user activity', async () => {
		createAutoLockController({
			getStatus: () => status,
			lock: (reason) => {
				reasons.push(reason);
				status = 'locked';
			},
			idleMs: 100,
			hiddenMs: 50
		});

		await vi.advanceTimersByTimeAsync(75);
		window.dispatchEvent(new Event('keydown'));
		await vi.advanceTimersByTimeAsync(75);
		expect(reasons).toEqual([]);
		await vi.advanceTimersByTimeAsync(25);
		expect(reasons).toEqual(['idle']);
	});

	it('locks after the hidden timeout and cancels when visible again', async () => {
		createAutoLockController({
			getStatus: () => status,
			lock: (reason) => {
				reasons.push(reason);
				status = 'locked';
			},
			idleMs: 1_000,
			hiddenMs: 100
		});

		setVisibility('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(50);
		setVisibility('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(100);
		expect(reasons).toEqual([]);

		setVisibility('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(100);
		expect(reasons).toEqual(['hidden']);
	});

	it('locks immediately on pagehide and freeze', async () => {
		const controller = createAutoLockController({
			getStatus: () => status,
			lock: (reason) => {
				reasons.push(reason);
				status = 'locked';
			},
			idleMs: 1_000,
			hiddenMs: 1_000
		});

		window.dispatchEvent(new Event('pagehide'));
		await vi.runAllTimersAsync();
		expect(reasons).toEqual(['pagehide']);

		status = 'unlocked';
		controller.destroy();
		const next = createAutoLockController({
			getStatus: () => status,
			lock: (reason) => {
				reasons.push(reason);
				status = 'locked';
			},
			idleMs: 1_000,
			hiddenMs: 1_000
		});
		window.dispatchEvent(new Event('freeze'));
		await vi.runAllTimersAsync();
		next.destroy();
		expect(reasons).toEqual(['pagehide', 'pagehide']);
	});

	it('does not lock while already locked and cleans up listeners', async () => {
		status = 'locked';
		const controller = createAutoLockController({
			getStatus: () => status,
			lock: (reason) => {
				reasons.push(reason);
			},
			idleMs: 100,
			hiddenMs: 50
		});
		await vi.advanceTimersByTimeAsync(100);
		expect(reasons).toEqual([]);

		status = 'unlocked';
		controller.destroy();
		window.dispatchEvent(new Event('keydown'));
		window.dispatchEvent(new Event('pagehide'));
		await vi.runAllTimersAsync();
		expect(reasons).toEqual([]);
	});
});
