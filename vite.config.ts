import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/api': {
				target: process.env.PUBLIC_SYNC_PROXY_ORIGIN ?? 'http://localhost:8788',
				changeOrigin: true
			}
		}
	},
	build: {
		target: 'esnext',
		// Production sourcemaps cost ~2.1 MB of CDN egress per cold
		// deploy region. Setting this to `'hidden'` keeps sourcemap
		// files on disk for local debugging (build artifacts), but
		// strips the trailing `//# sourceMappingURL=...` comment so
		// the browser never downloads them. Devs still get rich
		// stack traces in `vite dev` (no `build.sourcemap` switch).
		sourcemap: process.env.VUVAULT_FULL_SOURCEMAP === 'true' ? true : 'hidden',
		rollupOptions: {
			output: {
				// Pin the heavy crypto/sync deps into their own chunks
				// so a Svelte component change doesn't bust the
				// `@noble/*` / `dexie` / OPAQUE caches on every release.
				// Reproducibility: the two-pass bundle-hash guard in
				// `.github/workflows/ci.yml` re-asserts fixed-point
				// convergence after any chunking change.
				manualChunks(id: string) {
					if (id.includes('node_modules/dexie')) return 'vendor-dexie';
					if (id.includes('node_modules/@structured-id/opaque')) {
						return 'vendor-opaque';
					}
					if (id.includes('node_modules/@noble/post-quantum')) {
						return 'vendor-noble-pq';
					}
					if (id.includes('node_modules/@noble/ciphers')) {
						return 'vendor-noble-ciphers';
					}
					if (
						id.includes('node_modules/@noble/curves') ||
						id.includes('node_modules/@noble/hashes')
					) {
						return 'vendor-noble-core';
					}
					return undefined;
				}
			}
		}
	},
	test: {
		include: [
			'src/**/*.{test,spec}.{js,ts}',
			'tests/integration/**/*.{test,spec}.{js,ts}'
		],
		environment: 'node',
		globals: false
	}
});
