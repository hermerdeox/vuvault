/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * VuVault service worker — pinned-snapshot offline shell.
 *
 * Design (P5 — "No silent updates" — made mechanical):
 *
 *   - At install, the ENTIRE app snapshot is precached into a cache
 *     named after the deterministic build version: every immutable
 *     chunk, the prerendered pages, the curated static assets, the
 *     bundle-integrity manifest, the client-route shell, and this
 *     service worker file itself.
 *   - At fetch time, everything same-origin is served CACHE-FIRST
 *     from that one snapshot — including `/_app/immutable/
 *     bundle-manifest.json` and `/service-worker.js`. The in-page
 *     integrity verifier (src/lib/utils/env.ts) therefore always sees
 *     a COHERENT build: cached chunks hashed against the cached
 *     manifest from the same deploy. Online or offline, the running
 *     app cannot silently drift to a half-new, half-old state.
 *   - A new deploy produces a byte-different service-worker.js; the
 *     browser installs it in the background into a NEW versioned
 *     cache and then WAITS. Nothing changes for the user until they
 *     explicitly consent via the update toast (PwaUpdateToast), which
 *     sends SKIP_WAITING. Activation purges old snapshot caches and
 *     the page reloads into the new, again-coherent snapshot.
 *   - /api/* and non-GET requests NEVER touch the cache: auth and
 *     sync traffic (OPAQUE, encrypted blobs) passes straight through
 *     to the network. Offline, those calls fail exactly as the
 *     local-first services already expect (fire-and-forget sync).
 *
 * Supply-chain note: hand-rolled on the `$service-worker` module —
 * no workbox, no third-party runtime. The file is itself listed in
 * the SHA-384 bundle manifest (scripts/build-manifest.mjs) so the
 * integrity verifier covers the worker code too.
 */

import { build, files, prerendered, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `vuvault-snapshot-${version}`;

/**
 * Static assets that are NOT needed for the installed app to work
 * offline (marketing/social imagery). Everything else in static/ is
 * small and load-bearing: fonts, icons, the Argon2id WASM (master
 * password unlock MUST work offline), the lottie splash, manifest.
 */
const STATIC_EXCLUDE = [
	/^\/marketing\//,
	/^\/screenshots\//,
	/^\/landing\//,
	/^\/splash\//, // iOS fetches launch images itself at install time
	/^\/og-image\.png$/,
	/^\/twitter-card\.png$/
];

const precacheFiles = files.filter((path) => !STATIC_EXCLUDE.some((re) => re.test(path)));

/**
 * The client-route shell. /unlock (and every app route) is csr-only
 * (`ssr = false`), so the server returns a route-agnostic SvelteKit
 * boot shell for it. We cache one copy and use it as the navigation
 * fallback for ANY non-prerendered route while offline / pinned.
 */
const APP_SHELL = '/unlock';

/** The integrity manifest + this worker — cached so the in-page
 * verifier reads the SAME snapshot it is running. */
const INTEGRITY_EXTRAS = ['/_app/immutable/bundle-manifest.json', '/service-worker.js'];

const PRECACHE = [...build, ...precacheFiles, ...prerendered, APP_SHELL, ...INTEGRITY_EXTRAS];

/**
 * The in-page verifier fetches EVERY key of the bundle manifest —
 * a superset of `build` (it also hashes sourcemaps, and whatever
 * future build-manifest.mjs adds). The snapshot must cover that
 * exact set, or the verifier would fall through to the network and
 * fail offline / cross-deploy. Enumerate it at install time so the
 * two can never drift apart.
 */
async function integrityManifestKeys(): Promise<string[]> {
	try {
		const res = await fetch(new Request('/_app/immutable/bundle-manifest.json', { cache: 'reload' }));
		if (!res.ok) return [];
		const manifest = (await res.json()) as { hashes?: Record<string, string> };
		return manifest && typeof manifest.hashes === 'object' ? Object.keys(manifest.hashes ?? {}) : [];
	} catch {
		// Dev builds may not emit a manifest — precache the static list.
		return [];
	}
}

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);
			const urls = new Set([...PRECACHE, ...(await integrityManifestKeys())]);
			// `{cache: 'reload'}` bypasses the HTTP cache so the snapshot
			// is taken from the live deploy, not a stale CDN entry.
			await cache.addAll([...urls].map((url) => new Request(url, { cache: 'reload' })));
			// Do NOT skipWaiting() here: updates apply only on explicit
			// user consent (P5). First-ever install has no controller and
			// activates immediately as usual.
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Purge every snapshot except the one we were installed with.
			for (const key of await caches.keys()) {
				if (key !== CACHE_NAME && key.startsWith('vuvault-snapshot-')) {
					await caches.delete(key);
				}
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	const data = event.data;
	if (!data || typeof data !== 'object') return;
	if (data.type === 'SKIP_WAITING') {
		// The user pressed "Apply update" in PwaUpdateToast. This is the
		// ONLY path to activating a new snapshot over a controlled page.
		void sw.skipWaiting();
	} else if (data.type === 'GET_VERSION') {
		// Lets the page show WHICH version consent would apply.
		event.ports[0]?.postMessage({ version });
	}
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;

	// Network passthrough: anything that is not a same-origin GET.
	// /api/* carries OPAQUE auth + encrypted blobs — never cached.
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	if (url.pathname.startsWith('/api/')) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE_NAME);

			// Navigations: serve the pinned snapshot. Prerendered pages
			// have their own cached HTML; every other route boots from
			// the cached csr shell. Cache miss (e.g. evicted storage)
			// falls through to the network.
			if (request.mode === 'navigate') {
				const exact = await cache.match(url.pathname);
				if (exact) return exact;
				const shell = await cache.match(APP_SHELL);
				if (shell) return shell;
				return fetch(request);
			}

			// Subresources: cache-first against the snapshot. Same-deploy
			// assets that were not precached (e.g. marketing images) are
			// fetched once and filled into the snapshot cache so they
			// are purged together with it on update.
			const cached = await cache.match(request);
			if (cached) return cached;

			const response = await fetch(request);
			if (response.ok && (response.type === 'basic' || response.type === 'default')) {
				void cache.put(request, response.clone()).catch(() => undefined);
			}
			return response;
		})()
	);
});
