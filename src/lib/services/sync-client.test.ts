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
	uploadV2Blob,
	fetchV2Blob,
	opaqueLoginKE3
} from './sync-client';

const SAMPLE_UUID = '11111111-1111-4111-8111-111111111111';

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

	it('rejects malformed successful responses', async () => {
		mockFetchOnce(
			jsonResponse({
				ok: true,
				data: {
					opaque: true,
					blobSync: true
				}
			})
		);
		const result = await getCapabilities();
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe('server');
			expect(result.message).toBe('response shape mismatch');
		}
	});

	it('sends clientId on OPAQUE KE3 without unsafe casts', async () => {
		const captured: { body?: string } = {};
		globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
			captured.body = init?.body as string;
			return jsonResponse({
				ok: true,
				data: {
					accountId: 'acct-1',
					token: 'a'.repeat(64),
					expiresAt: 1
				}
			});
		}) as unknown as typeof fetch;
		const result = await opaqueLoginKE3({
			op: 'opaque-login-ke3',
			clientId: 'client-1',
			requestId: 'req-1',
			ke3: 'AA=='
		});
		expect(result.ok).toBe(true);
		expect(JSON.parse(captured.body ?? '{}')).toMatchObject({
			clientId: 'client-1',
			requestId: 'req-1',
			ke3: 'AA=='
		});
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
			return jsonResponse({ ok: true, data: { blobId: SAMPLE_UUID, updatedAt: 1 } });
		}) as unknown as typeof fetch;
		await uploadV2Blob({ blobId: SAMPLE_UUID, nonce: 'Ag==', ciphertext: 'Aw==' });
		const headers = captured.headers as Record<string, string>;
		expect(headers.authorization).toBe(`Bearer ${'a'.repeat(64)}`);
	});

	it('omits the bearer token when no session is active', async () => {
		const captured: { headers?: HeadersInit } = {};
		globalThis.fetch = vi.fn(async (_url, init?: RequestInit) => {
			captured.headers = init?.headers;
			return jsonResponse({ ok: false, error: 'unauthorized', code: 401 }, { status: 401 });
		}) as unknown as typeof fetch;
		await fetchV2Blob(SAMPLE_UUID);
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
