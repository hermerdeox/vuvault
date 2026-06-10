/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * VuVault service worker — pinned-snapshot offline shell.
 *
 * Design (P5 — "No silent updates" — made mechanical for the running
 * session):
 *
 *   - At install, the ENTIRE app snapshot is precached into a
 *     content-addressed cache: every key of the bundle-integrity
 *     manifest (chunks AND sourcemaps), the prerendered pages, the
 *     curated static assets, the client-route shell, and this worker
 *     file itself.
 *   - At fetch time, everything same-origin is served CACHE-FIRST
 *     from that one snapshot — including `/_app/immutable/
 *     bundle-manifest.json` and `/service-worker.js`. The in-page
 *     integrity verifier (src/lib/utils/env.ts) therefore always sees
 *     a COHERENT build: cached chunks hashed against the cached
 *     manifest from the same deploy, online or offline.
 *   - A new deploy produces a byte-different service-worker.js; the
 *     browser installs it in the background into a NEW snapshot cache
 *     and then WAITS. While the app is open, the running session
 *     never swaps underneath the user: activation requires explicit
 *     consent via the update toast (PwaUpdateToast → SKIP_WAITING).
 *     Once the last client closes, the platform activates the waiting
 *     worker on next launch — consent is a session guarantee, not a
 *     cross-launch one (the next cold start boots the new, signed,
 *     again-coherent snapshot).
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

/**
 * Content-addressed cache name.
 *
 * Keying on `version` alone is not enough: version uniqueness per
 * deploy content is asserted nowhere (a re-published tag, or any
 * deploy path with PUBLIC_VAULT_VERSION unset → constant 'dev',
 * would reuse the name). If a byte-different worker installed into
 * the cache the ACTIVE worker is serving, it would overwrite the
 * live snapshot before any consent — silently updating some clients
 * and tripping the integrity verifier into a false MISMATCH for
 * others. Folding a digest of the inlined build identity into the
 * name guarantees content-different deploys land in different
 * caches. (Deterministic across the reproducible-build two-pass:
 * the hashed inputs are identical between passes.)
 *
 * Residual gap, documented deliberately: a redeploy that changes
 * ONLY static/ file contents (same filenames, same version) emits a
 * byte-identical worker — the browser never even installs it. The
 * tag-driven release flow always bumps `version`, so this requires
 * an out-of-band redeploy; operators must bump the version for any
 * content change.
 */
function fnv1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

const SNAPSHOT_ID = fnv1a(JSON.stringify([build, files, prerendered, version]));
const CACHE_NAME = `vuvault-snapshot-${version}-${SNAPSHOT_ID}`;

const MANIFEST_PATH = '/_app/immutable/bundle-manifest.json';

/**
 * Static assets that are NOT needed for the installed app to work
 * offline (marketing/social imagery; iOS fetches launch screens
 * itself at install time). Everything else in static/ is small and
 * load-bearing: fonts, icons, the Argon2id WASM (master password
 * unlock MUST work offline), the lottie splash, manifest.
 */
const STATIC_EXCLUDE = [
	/^\/marketing\//,
	/^\/screenshots\//,
	/^\/landing\//,
	/^\/splash\//,
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

const PRECACHE = [...build, ...precacheFiles, ...prerendered, APP_SHELL, '/service-worker.js'];

type BundleManifest = { hashes?: Record<string, string> };

/** Hex SHA-384 of a buffer — mirrors the in-page verifier. */
async function sha384Hex(buf: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-384', buf);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE_NAME);

			// The in-page verifier fetches EVERY key of the bundle
			// manifest — a superset of `build` (it also hashes sourcemaps
			// and whatever future build-manifest.mjs adds). Fetch the
			// manifest exactly ONCE, store that very response into the
			// snapshot, and derive the precache set from its keys so the
			// two can never drift apart.
			//
			// Fail-closed: in a built app (build list non-empty) a
			// missing/unreadable manifest aborts the install — a snapshot
			// the verifier cannot satisfy offline must not be pinned.
			// The browser retries the install on a later navigation.
			let manifestKeys: string[] = [];
			const manifestRes = await fetch(new Request(MANIFEST_PATH, { cache: 'reload' })).catch(
				() => null
			);
			if (manifestRes?.ok) {
				const manifest = (await manifestRes.clone().json().catch(() => null)) as BundleManifest | null;
				if (manifest && typeof manifest.hashes === 'object') {
					manifestKeys = Object.keys(manifest.hashes ?? {});
					await cache.put(MANIFEST_PATH, manifestRes);
				} else if (build.length > 0) {
					throw new Error('bundle manifest unparseable — refusing to pin an unverifiable snapshot');
				}
			} else if (build.length > 0) {
				throw new Error('bundle manifest unavailable — refusing to pin an unverifiable snapshot');
			}

			const urls = new Set([...PRECACHE, ...manifestKeys]);
			urls.delete(MANIFEST_PATH); // already stored above
			// `{cache: 'reload'}` bypasses the HTTP cache so the snapshot
			// is taken from the live deploy, not a stale CDN entry.
			await cache.addAll([...urls].map((url) => new Request(url, { cache: 'reload' })));
			// Do NOT skipWaiting() here: while clients are open, updates
			// apply only on explicit user consent (P5). First-ever install
			// has no controller and activates immediately as usual.
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Purge every snapshot except the one we were installed with.
			// Clients of the previous snapshot are reloaded by the page
			// layer on controllerchange (consent given in ANY tab speaks
			// for the user in all tabs — see pwa.svelte.ts).
			for (const key of await caches.keys()) {
				if (key !== CACHE_NAME && key.startsWith('vuvault-snapshot-')) {
					await caches.delete(key);
				}
			}
			await sw.clients.claim();
		})()
	);
});

/**
 * Self-repair after Cache Storage eviction (iOS evicts caches more
 * aggressively than registrations; install never re-runs for a
 * byte-identical worker). Refill is HASH-VERIFIED: only entries
 * whose network bytes match the CACHED manifest's SHA-384 are
 * restored, so a newer deploy on the origin can never tear the
 * pinned snapshot. If the cached manifest itself is gone, the
 * snapshot is unrecoverable as-pinned — re-precache the live deploy
 * wholesale (coherent-new beats torn-old; the page layer's update
 * flow handles the version transition).
 */
async function repairSnapshot(): Promise<void> {
	const cache = await caches.open(CACHE_NAME);
	const cachedManifestRes = await cache.match(MANIFEST_PATH);

	if (!cachedManifestRes) {
		// Manifest evicted → cannot verify against the pinned deploy.
		const fresh = await fetch(new Request(MANIFEST_PATH, { cache: 'reload' })).catch(() => null);
		if (!fresh?.ok) return; // offline — nothing we can do now
		const manifest = (await fresh.clone().json().catch(() => null)) as BundleManifest | null;
		if (!manifest?.hashes) return;
		await cache.put(MANIFEST_PATH, fresh);
		const urls = new Set([...PRECACHE, ...Object.keys(manifest.hashes)]);
		urls.delete(MANIFEST_PATH);
		await Promise.all(
			[...urls].map(async (url) => {
				if (await cache.match(url)) return;
				const res = await fetch(new Request(url, { cache: 'reload' })).catch(() => null);
				if (res?.ok && !res.redirected) await cache.put(url, res);
			})
		);
		return;
	}

	const manifest = (await cachedManifestRes.clone().json().catch(() => null)) as BundleManifest | null;
	const hashes = manifest?.hashes ?? {};
	const expected = new Set([...PRECACHE, ...Object.keys(hashes)]);
	expected.delete(MANIFEST_PATH);

	await Promise.all(
		[...expected].map(async (url) => {
			if (await cache.match(url)) return;
			const res = await fetch(new Request(url, { cache: 'reload' })).catch(() => null);
			if (!res?.ok || res.redirected) return;
			const want = hashes[url];
			if (want) {
				// Integrity-manifest entry: verify bytes before restoring.
				const got = await sha384Hex(await res.clone().arrayBuffer());
				if (got !== want) return; // origin moved on — keep the gap honest
			}
			await cache.put(url, res);
		})
	);
}

sw.addEventListener('message', (event) => {
	const data = event.data;
	if (!data || typeof data !== 'object') return;
	if (data.type === 'SKIP_WAITING') {
		// The user pressed "Apply update" in PwaUpdateToast. This is the
		// ONLY path to activating a new snapshot over controlled pages.
		void sw.skipWaiting();
	} else if (data.type === 'GET_VERSION') {
		// Lets the page show WHICH version consent would apply.
		event.ports[0]?.postMessage({ version });
	} else if (data.type === 'CHECK_SNAPSHOT') {
		// Posted by the page layer on its periodic poll / foreground
		// return — heals storage-pressure eviction without an update.
		event.waitUntil?.(repairSnapshot());
	}
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;

	// Network passthrough: anything that is not a same-origin GET.
	// /api carries OPAQUE auth + encrypted blobs — never cached.
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

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
			// are purged together with it on update. Redirected responses
			// are never stored under the original key (poison guard).
			const cached = await cache.match(request);
			if (cached) return cached;

			const response = await fetch(request);
			if (
				response.ok &&
				!response.redirected &&
				(response.type === 'basic' || response.type === 'default')
			) {
				void cache.put(request, response.clone()).catch(() => undefined);
			}
			return response;
		})()
	);
});
