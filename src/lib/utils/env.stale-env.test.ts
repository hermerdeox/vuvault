/**
 * Bundle-integrity verifier — stale runtime env (edge-cached /_app/env.js).
 *
 * The adapter-served `/_app/env.js` can be cached at the CDN edge across
 * releases (seen live: a week-old copy), so the `$env/dynamic/public`
 * module the page loaded may carry a PREVIOUS release's
 * PUBLIC_BUNDLE_HASH while the no-store manifest is current. The verifier
 * must read the hash past that cache and compare against the fresh
 * value, and the stale baked value must never be able to pass or fail a
 * bundle on its own.
 *
 *   1. stale module env + fresh env matching the bundle → verified,
 *      `staleEnv` flagged, `expected`/Rekor use the fresh hash
 *   2. fresh env unreadable → falls back to the baked value (verified
 *      when that is current)
 *   3. fresh env carrying a hash that does not match the bundle →
 *      mismatch (a poisoned env cannot vouch for a tampered bundle, and
 *      cannot discredit a good one into passing either)
 *   4. the fresh read happens once per page load and is reused
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
const MANIFEST = {
	version: 1,
	algorithm: 'SHA-384' as const,
	generatedAt: '2026-10-29T00:00:00.000Z',
	hashes: Object.fromEntries(Object.entries(PAYLOADS).map(([k, v]) => [k, sha384Hex(v)]))
};
const CURRENT = aggregateOf(MANIFEST);
// A previous release's hash: what a stale edge copy of env.js carries.
const STALE = sha384Hex(new TextEncoder().encode('previous-release'));

vi.mock('$app/environment', () => ({ browser: true, dev: false }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_BUNDLE_HASH: STALE } }));

const ORIGINAL_FETCH = globalThis.fetch;
let freshEnvHash: string | null = CURRENT;
let envFetches = 0;

beforeEach(() => {
	envFetches = 0;
	freshEnvHash = CURRENT;
	globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : (input as URL).toString();
		if (url.startsWith('/_app/env.js')) {
			envFetches += 1;
			expect(url).toMatch(/\?integrity=/); // cache-busted
			expect(init?.cache).toBe('no-store');
			if (freshEnvHash === null) return new Response('gone', { status: 502 });
			return new Response(`export const env={"PUBLIC_BUNDLE_HASH":"${freshEnvHash}","PUBLIC_VAULT_VERSION":"0.4.2"}`, {
				status: 200,
				headers: { 'content-type': 'application/javascript' }
			});
		}
		if (url === '/_app/immutable/bundle-manifest.json') {
			return new Response(JSON.stringify(MANIFEST), { status: 200 });
		}
		const payload = PAYLOADS[url];
		if (payload) return new Response(payload.buffer.slice(0) as ArrayBuffer, { status: 200 });
		return new Response('not found', { status: 404 });
	}) as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	vi.resetModules();
});

describe('verifyBundleIntegrity · stale runtime env', () => {
	it('verifies against the fresh hash when the loaded env module is stale', async () => {
		const { verifyBundleIntegrity, currentBundleHash } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('verified');
		expect(result.staleEnv).toBe(true);
		expect(result.expected).toBe(CURRENT);
		expect(result.expectedShort).toBe(CURRENT.slice(0, 8));
		expect(result.rekorUrl).toContain(CURRENT);
		expect(currentBundleHash()).toBe(CURRENT);
	});

	it('falls back to the baked value when the fresh read fails', async () => {
		freshEnvHash = null;
		const { verifyBundleIntegrity, currentBundleHash } = await import('./env');
		const result = await verifyBundleIntegrity();
		// The baked value is a previous release's, so this bundle does not
		// verify against it — but the verifier is honest about which value
		// it used, and never reports a stale env it could not read.
		expect(result.state).toBe('mismatch');
		expect(result.staleEnv).toBe(false);
		expect(result.expected).toBe(STALE);
		expect(currentBundleHash()).toBe(STALE);
	});

	it('refuses when the fresh env hash does not match the bundle', async () => {
		freshEnvHash = sha384Hex(new TextEncoder().encode('poisoned'));
		const { verifyBundleIntegrity } = await import('./env');
		const result = await verifyBundleIntegrity();
		expect(result.state).toBe('mismatch');
		expect(result.computed).toBe(CURRENT);
		expect(result.expected).toBe(freshEnvHash);
	});

	it('reads the fresh env once per page load', async () => {
		const { verifyBundleIntegrity, ensureFreshBundleHash } = await import('./env');
		await ensureFreshBundleHash();
		await verifyBundleIntegrity();
		await verifyBundleIntegrity();
		expect(envFetches).toBe(1);
	});
});
