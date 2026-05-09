/**
 * Tests for the bundle-integrity verifier.
 *
 * Mocks `$app/environment` (browser=true, dev=false), `$env/dynamic/public`
 * (PUBLIC_BUNDLE_HASH set to a known value), and `globalThis.fetch` so we
 * can drive the verifier through every branch:
 *
 *   - verified  : computed aggregate matches PUBLIC_BUNDLE_HASH
 *   - mismatch  : a per-chunk hash diverges
 *   - mismatch  : the canonical aggregate diverges
 *   - mismatch  : manifest fetch fails
 *
 * The placeholder branch is exercised by the existing default state
 * (PUBLIC_BUNDLE_HASH unset → `placeholder`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const FAKE_HASHES: Record<string, string> = {
	'/_app/immutable/chunks/a.js': sha384Of(new TextEncoder().encode('alpha-payload')),
	'/_app/immutable/chunks/b.js': sha384Of(new TextEncoder().encode('beta-payload'))
};

function sha384Of(bytes: Uint8Array): string {
	return createHash('sha384').update(bytes).digest('hex');
}

function aggregateOf(manifest: object): string {
	const json = JSON.stringify(manifest) + '\n';
	return sha384Of(new TextEncoder().encode(json));
}

const FAKE_MANIFEST = {
	version: 1,
	algorithm: 'SHA-384' as const,
	generatedAt: '2026-05-08T00:00:00.000Z',
	hashes: FAKE_HASHES
};

const FAKE_AGGREGATE = aggregateOf(FAKE_MANIFEST);

vi.mock('$app/environment', () => ({
	browser: true,
	dev: false
}));

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_BUNDLE_HASH: FAKE_AGGREGATE }
}));

const PAYLOADS: Record<string, Uint8Array> = {
	'/_app/immutable/chunks/a.js': new TextEncoder().encode('alpha-payload'),
	'/_app/immutable/chunks/b.js': new TextEncoder().encode('beta-payload')
};

const ORIGINAL_FETCH = globalThis.fetch;

function makeOkResponse(body: ArrayBuffer | object): Response {
	return new Response(
		body instanceof ArrayBuffer ? body : JSON.stringify(body),
		{ status: 200 }
	);
}

beforeEach(() => {
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
		const url = typeof input === 'string' ? input : (input as URL).toString();
		if (url === '/_app/immutable/bundle-manifest.json') {
			return makeOkResponse(FAKE_MANIFEST);
		}
		const payload = PAYLOADS[url];
		if (payload) {
			return makeOkResponse(payload.buffer.slice(0) as ArrayBuffer);
		}
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.resetModules();
});

describe('verifyBundleIntegrity', () => {
	it('verifies a manifest whose aggregate matches PUBLIC_BUNDLE_HASH', async () => {
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('verified');
		expect(result.expected).toBe(FAKE_AGGREGATE);
		expect(result.computed).toBe(FAKE_AGGREGATE);
	});

	it('returns mismatch when a chunk byte changes', async () => {
		// Tamper with one chunk's bytes — its hash diverges.
		PAYLOADS['/_app/immutable/chunks/a.js'] = new TextEncoder().encode(
			'TAMPERED-payload'
		);
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
		expect(result.mismatchedChunk).toBe('/_app/immutable/chunks/a.js');
	});

	it('returns mismatch when the manifest itself was tampered with', async () => {
		// Override the fetch mock for this test only — return a manifest
		// whose hashes match the real chunks, but whose `generatedAt`
		// is changed so the aggregate digest diverges from
		// PUBLIC_BUNDLE_HASH.
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL): Promise<Response> => {
				const url = typeof input === 'string' ? input : (input as URL).toString();
				if (url === '/_app/immutable/bundle-manifest.json') {
					const tampered = {
						...FAKE_MANIFEST,
						generatedAt: '1999-01-01T00:00:00.000Z'
					};
					return makeOkResponse(tampered);
				}
				const payload = PAYLOADS[url];
				if (payload) {
					return makeOkResponse(payload.buffer.slice(0) as ArrayBuffer);
				}
				return new Response('not found', { status: 404 });
			}
		);
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
	});

	it('returns mismatch when the manifest fetch fails', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async () => {
				return new Response('boom', { status: 502 });
			}
		);
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
		expect(result.mismatchedChunk).toBe('/_app/immutable/bundle-manifest.json');
	});
});
