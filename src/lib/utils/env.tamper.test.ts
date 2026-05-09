/**
 * Bundle-integrity verifier — adversarial / fail-closed probes.
 *
 * Complements `env.test.ts` (which covers the four high-level state
 * transitions: verified, mismatch-on-chunk, mismatch-on-manifest,
 * mismatch-on-fetch). This file adds the more-pointed attacks that an
 * external auditor would expect to see locked down:
 *
 *   1. Single-bit flip in a chunk body → mismatch.
 *   2. Manifest with a swapped `algorithm` field → mismatch.
 *   3. Manifest body that is invalid JSON → mismatch.
 *   4. Manifest with an extra chunk added (a "phantom payload"
 *      injection) → mismatch via aggregate divergence.
 *   5. `crypto.subtle` is undefined → `unsupported` (refused, not
 *      silently passed).
 *   6. Rekor URL is per-build and contains the canonical bundle hash
 *      so the unlock UI can deep-link to Sigstore search.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

function sha384Hex(bytes: Uint8Array): string {
	return createHash('sha384').update(bytes).digest('hex');
}

function aggregateOf(manifest: object): string {
	return sha384Hex(new TextEncoder().encode(JSON.stringify(manifest) + '\n'));
}

const PAYLOADS: Record<string, Uint8Array> = {
	'/_app/immutable/chunks/a.js': new TextEncoder().encode('alpha-payload'),
	'/_app/immutable/chunks/b.js': new TextEncoder().encode('beta-payload')
};

const HASHES: Record<string, string> = {
	'/_app/immutable/chunks/a.js': sha384Hex(PAYLOADS['/_app/immutable/chunks/a.js']!),
	'/_app/immutable/chunks/b.js': sha384Hex(PAYLOADS['/_app/immutable/chunks/b.js']!)
};

const MANIFEST = {
	version: 1,
	algorithm: 'SHA-384' as const,
	generatedAt: '2026-05-09T00:00:00.000Z',
	hashes: HASHES
};

const AGGREGATE = aggregateOf(MANIFEST);

vi.mock('$app/environment', () => ({ browser: true, dev: false }));
vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_BUNDLE_HASH: AGGREGATE }
}));

const ORIGINAL_FETCH = globalThis.fetch;

function okBytes(bytes: Uint8Array): Response {
	return new Response(bytes.buffer.slice(0) as ArrayBuffer, { status: 200 });
}
function okJson(obj: object): Response {
	return new Response(JSON.stringify(obj), { status: 200 });
}

beforeEach(() => {
	// Reset the per-payload mutation between tests.
	PAYLOADS['/_app/immutable/chunks/a.js'] = new TextEncoder().encode('alpha-payload');
	PAYLOADS['/_app/immutable/chunks/b.js'] = new TextEncoder().encode('beta-payload');
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : (input as URL).toString();
		if (url === '/_app/immutable/bundle-manifest.json') return okJson(MANIFEST);
		const payload = PAYLOADS[url];
		if (payload) return okBytes(payload);
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.resetModules();
});

describe('verifyBundleIntegrity · adversarial probes', () => {
	it('refuses unlock on a single-bit flip in a chunk body', async () => {
		const orig = PAYLOADS['/_app/immutable/chunks/a.js']!;
		const flipped = new Uint8Array(orig);
		flipped[0]! ^= 0x01; // flip the LSB of the first byte
		PAYLOADS['/_app/immutable/chunks/a.js'] = flipped;

		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
		expect(result.mismatchedChunk).toBe('/_app/immutable/chunks/a.js');
	});

	it('refuses unlock when the manifest declares a non-SHA-384 algorithm', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : (input as URL).toString();
				if (url === '/_app/immutable/bundle-manifest.json') {
					return okJson({ ...MANIFEST, algorithm: 'SHA-256' });
				}
				const payload = PAYLOADS[url];
				if (payload) return okBytes(payload);
				return new Response('not found', { status: 404 });
			}
		);
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
		expect(result.mismatchedChunk).toBe('/_app/immutable/bundle-manifest.json');
	});

	it('refuses unlock when the manifest body is invalid JSON', async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : (input as URL).toString();
				if (url === '/_app/immutable/bundle-manifest.json') {
					return new Response('not-valid-json{', { status: 200 });
				}
				const payload = PAYLOADS[url];
				if (payload) return okBytes(payload);
				return new Response('not found', { status: 404 });
			}
		);
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
		expect(result.mismatchedChunk).toBe('/_app/immutable/bundle-manifest.json');
	});

	it('refuses unlock when a phantom chunk is injected into the manifest', async () => {
		// Add a brand-new chunk to the manifest that points at a payload
		// the verifier WILL fetch (and which hashes correctly), but the
		// aggregate digest no longer matches PUBLIC_BUNDLE_HASH because
		// the manifest body itself changed.
		const phantomPath = '/_app/immutable/chunks/phantom.js';
		const phantomBody = new TextEncoder().encode('phantom-payload');
		PAYLOADS[phantomPath] = phantomBody;
		const tampered = {
			...MANIFEST,
			hashes: {
				...HASHES,
				[phantomPath]: sha384Hex(phantomBody)
			}
		};
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
			async (input: RequestInfo | URL) => {
				const url = typeof input === 'string' ? input : (input as URL).toString();
				if (url === '/_app/immutable/bundle-manifest.json') {
					return okJson(tampered);
				}
				const payload = PAYLOADS[url];
				if (payload) return okBytes(payload);
				return new Response('not found', { status: 404 });
			}
		);
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		// All chunk-level hashes pass — but the manifest aggregate
		// digest (computed over the canonical text including the
		// phantom entry) no longer matches PUBLIC_BUNDLE_HASH.
		expect(result.state).toBe('mismatch');
		expect(result.mismatchedChunk).toBe('/_app/immutable/bundle-manifest.json');
	});

	it("returns 'unsupported' (not silent pass) when crypto.subtle is unavailable", async () => {
		const realCrypto = globalThis.crypto;
		// Strip subtle while keeping the rest of `crypto` intact so the
		// only impact is the verifier's own capability check failing.
		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: { ...realCrypto, subtle: undefined }
		});
		try {
			const { verifyBundleIntegrity } = await import('./env');
			const result = await verifyBundleIntegrity();
			expect(result.state).toBe('unsupported');
		} finally {
			Object.defineProperty(globalThis, 'crypto', {
				configurable: true,
				value: realCrypto
			});
		}
	});

	it('rekorUrl is per-build and embeds the canonical bundle hash query', async () => {
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.rekorUrl).toBe(
			`https://search.sigstore.dev/?hash=${AGGREGATE}`
		);
		// Sanity: the unlock UI's clickable anchor in
		// src/routes/unlock/+page.svelte uses this exact URL — locking
		// the format here means a future regression that prepends a
		// path or strips the query is caught loudly.
		expect(result.rekorUrl).toContain('?hash=');
		expect(result.rekorUrl).toContain(AGGREGATE);
	});
});
