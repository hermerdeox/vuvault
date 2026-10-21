/**
 * `sync-client.ts` contract tests.
 *
 * The module is the only place outside `opaque-client.ts` and the
 * bundle-integrity manifest fetch that is allowed to call `fetch()`
 * (enforced by the CI network-call guard). These tests exercise the
 * `SyncResult` contract — local-only short-circuit, server-error
 * shape decoding, and which credential each request carries (Bearer
 * for issuance, an anonymous token for the v2 routes) — without
 * touching the network. The full live D1/R2 round-trip lives in
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
import { createFakeTokenIssuer } from './test-utils/fake-token-issuer';

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

	type Call = { url: string; method: string; headers: Record<string, string> };

	/** fetch mock: real token issuance, then `route` for everything else. */
	function installTokenFetch(
		route: (call: Call, redeemed: boolean) => Response,
		issuer = createFakeTokenIssuer()
	): Call[] {
		const calls: Call[] = [];
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const call: Call = {
				url: String(input),
				method: (init?.method ?? 'GET').toUpperCase(),
				headers: { ...((init?.headers as Record<string, string>) ?? {}) }
			};
			calls.push(call);
			const tokenRoute = issuer.handle(call.url, call.method, init?.body as string | undefined);
			if (tokenRoute) return tokenRoute;
			return route(call, issuer.redeem(call.headers['x-vu0-token'] ?? null));
		}) as unknown as typeof fetch;
		return calls;
	}

	it('sends v2 blob requests with an anonymous token and never the bearer token', async () => {
		setSessionToken('a'.repeat(64));
		expect(hasSession()).toBe(true);
		const calls = installTokenFetch((_call, redeemed) =>
			redeemed
				? jsonResponse({ ok: true, data: { blobId: SAMPLE_UUID, updatedAt: 1 } })
				: jsonResponse({ ok: false, error: 'invalid token' }, { status: 401 })
		);
		const result = await uploadV2Blob({ blobId: SAMPLE_UUID, nonce: 'Ag==', ciphertext: 'Aw==' });
		expect(result.ok).toBe(true);

		const blobCall = calls.find((c) => c.url.includes('/api/v2/blobs/'))!;
		expect(blobCall.headers['x-vu0-token']).toMatch(/^v1\.1\./);
		expect(blobCall.headers.authorization).toBeUndefined();
		// The session token went only to issuance; the key fetch is public.
		const issue = calls.find((c) => c.url.endsWith('/api/v0/tokens/issue'))!;
		expect(issue.headers.authorization).toBe(`Bearer ${'a'.repeat(64)}`);
		const key = calls.find((c) => c.url.endsWith('/api/v0/tokens/key'))!;
		expect(key.headers.authorization).toBeUndefined();
	});

	it('does not contact the v2 routes without a session (no token can be minted)', async () => {
		const calls = installTokenFetch(() => jsonResponse({ ok: true, data: {} }));
		const result = await fetchV2Blob(SAMPLE_UUID);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toBe('no anonymous token available');
		expect(calls).toEqual([]);
	});

	it('spends a distinct token per request and refills the pool from one issuance', async () => {
		setSessionToken('a'.repeat(64));
		const issuer = createFakeTokenIssuer();
		const calls = installTokenFetch(
			(_call, redeemed) =>
				redeemed
					? jsonResponse({
							ok: true,
							data: { blobId: SAMPLE_UUID, nonce: 'AA==', ciphertext: 'AA==', updatedAt: 1 }
						})
					: jsonResponse({ ok: false, error: 'invalid token' }, { status: 401 }),
			issuer
		);
		for (let i = 0; i < 5; i++) expect((await fetchV2Blob(SAMPLE_UUID)).ok).toBe(true);
		const tokens = calls
			.filter((c) => c.url.includes('/api/v2/blobs/'))
			.map((c) => c.headers['x-vu0-token']);
		expect(new Set(tokens).size).toBe(5);
		expect(issuer.spentCount).toBe(5);
	});

	it('drops a stale pool and retries once when the server says the token is invalid', async () => {
		setSessionToken('a'.repeat(64));
		let rejectNext = true;
		const calls = installTokenFetch((_call, redeemed) => {
			if (rejectNext || !redeemed) {
				rejectNext = false;
				return jsonResponse({ ok: false, error: 'invalid token' }, { status: 401 });
			}
			return jsonResponse({
				ok: true,
				data: { blobId: SAMPLE_UUID, nonce: 'AA==', ciphertext: 'AA==', updatedAt: 1 }
			});
		});
		const result = await fetchV2Blob(SAMPLE_UUID);
		expect(result.ok).toBe(true);
		expect(calls.filter((c) => c.url.includes('/api/v2/blobs/')).length).toBe(2);
	});

	it('refuses a token batch issued under a key other than the publicly served one', async () => {
		setSessionToken('a'.repeat(64));
		const signer = createFakeTokenIssuer(1);
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			const method = (init?.method ?? 'GET').toUpperCase();
			if (url.endsWith('/api/v0/tokens/key')) {
				// A different public key than the one that signs the batch.
				return jsonResponse({ ok: true, data: { keyId: 1, publicKey: 'A'.repeat(43) + '=' } });
			}
			const tokenRoute = signer.handle(url, method, init?.body as string | undefined);
			if (tokenRoute) return tokenRoute;
			return jsonResponse({ ok: false, error: 'unexpected' }, { status: 500 });
		}) as unknown as typeof fetch;
		const result = await fetchV2Blob(SAMPLE_UUID);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.message).toBe('no anonymous token available');
	});

	it('isSyncWired mirrors isSyncOriginConfigured', () => {
		vi.spyOn(env, 'isSyncOriginConfigured').mockReturnValue(true);
		expect(isSyncWired()).toBe(true);
		vi.spyOn(env, 'isSyncOriginConfigured').mockReturnValue(false);
		expect(isSyncWired()).toBe(false);
	});
});
