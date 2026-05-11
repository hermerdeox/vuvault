/**
 * `sync-client.ts` contract tests.
 *
 * The module is the only place outside `opaque-client.ts` and the
 * bundle-integrity manifest fetch that is allowed to call `fetch()`
 * (enforced by the CI network-call guard). These tests exercise the
 * `SyncResult` contract — local-only short-circuit, server-error
 * shape decoding, and bearer-token application — without touching
 * the network. The full live D1/R2 round-trip lives in
 * `tests/e2e/sync.spec.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getCapabilities,
	isSyncWired,
	setSessionToken,
	hasSession,
	uploadBlob,
	fetchBlob
} from './sync-client';

const env = await import('$lib/utils/env');

function mockFetchOnce(response: Response | (() => Response | Promise<Response>)): void {
	const handler = typeof response === 'function' ? response : () => response;
	(globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => handler()) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init
	});
}

const ORIGINAL_FETCH = globalThis.fetch;

describe('sync-client', () => {
	beforeEach(() => {
		setSessionToken(null);
		vi.spyOn(env, 'isSyncOriginConfigured').mockReturnValue(true);
		vi.spyOn(env, 'getSyncOrigin').mockReturnValue('https://test.invalid');
	});

	afterEach(() => {
		globalThis.fetch = ORIGINAL_FETCH;
		setSessionToken(null);
		vi.restoreAllMocks();
	});

	it('short-circuits to local-only when PUBLIC_SYNC_ORIGIN is empty', async () => {
		vi.spyOn(env, 'isSyncOriginConfigured').mockReturnValue(false);
		const result = await getCapabilities();
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('local-only');
		}
	});

	it('returns ok:true when the worker reports capabilities', async () => {
		mockFetchOnce(
			jsonResponse({
				ok: true,
				data: {
					opaque: true,
					blobSync: true,
					deviceEnrollment: false,
					transparencyLog: false
				}
			})
		);
		const result = await getCapabilities();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.opaque).toBe(true);
		}
	});

	it('decodes server errors into ok:false with reason=server', async () => {
		mockFetchOnce(
			new Response(
				JSON.stringify({ ok: false, error: 'rate limit exceeded', code: 429 }),
				{ status: 429, headers: { 'content-type': 'application/json' } }
			)
		);
		const result = await getCapabilities();
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('server');
			expect(result.message).toBe('rate limit exceeded');
		}
	});

	it('decodes network errors into ok:false with reason=network', async () => {
		mockFetchOnce(() => {
			throw new TypeError('Failed to fetch');
		});
		const result = await getCapabilities();
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('network');
		}
	});

	it('attaches the bearer token to blob requests when a session is active', async () => {
		setSessionToken('a'.repeat(64));
		expect(hasSession()).toBe(true);
		const captured: { headers?: HeadersInit } = {};
		globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
			captured.headers = init?.headers;
			return jsonResponse({ ok: true, data: { updatedAt: 1, sequenceClock: 1 } });
		}) as unknown as typeof fetch;
		await uploadBlob({
			op: 'blob-upload',
			accountId: '',
			deviceId: '',
			sequenceClock: 1,
			header: 'AQ==',
			nonce: 'Ag==',
			ciphertext: 'Aw==',
			updatedAt: Date.now(),
			formatVersion: 2
		});
		const headers = captured.headers as Record<string, string>;
		expect(headers.authorization).toBe(`Bearer ${'a'.repeat(64)}`);
	});

	it('omits the bearer token when no session is active', async () => {
		const captured: { headers?: HeadersInit } = {};
		globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
			captured.headers = init?.headers;
			return jsonResponse({ ok: false, error: 'unauthorized', code: 401 }, { status: 401 });
		}) as unknown as typeof fetch;
		await fetchBlob({ op: 'blob-fetch', accountId: '', deviceId: '' });
		const headers = captured.headers as Record<string, string>;
		expect(headers.authorization).toBeUndefined();
	});

	it('isSyncWired mirrors isSyncOriginConfigured', () => {
		vi.spyOn(env, 'isSyncOriginConfigured').mockReturnValue(true);
		expect(isSyncWired()).toBe(true);
		vi.spyOn(env, 'isSyncOriginConfigured').mockReturnValue(false);
		expect(isSyncWired()).toBe(false);
	});
});
