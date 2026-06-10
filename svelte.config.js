import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Deterministic SvelteKit `version.name`.
 *
 * SvelteKit defaults `kit.version.name` to `Date.now().toString()`
 * (see `node_modules/@sveltejs/kit/src/core/config/options.js`), which
 * seeds the per-build `globalThis.__sveltekit_<hash>` runtime namespace.
 * That randomness propagates into every JS chunk that references
 * `$env/dynamic/public`, breaking the two-pass build convergence and
 * the reproducible-build verification job.
 *
 * Pin `version.name` to `PUBLIC_VAULT_VERSION` (the canonical release
 * tag CI / release workflow set), with a fixed dev fallback. Result:
 * given identical source + identical `PUBLIC_VAULT_VERSION`, the
 * compiled chunks under `_app/immutable/` are byte-identical, and the
 * manifest aggregate becomes a fixed point of the two-pass build.
 */
const VERSION_NAME =
	process.env.PUBLIC_VAULT_VERSION && process.env.PUBLIC_VAULT_VERSION.trim() !== ''
		? process.env.PUBLIC_VAULT_VERSION.trim()
		: 'dev';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			// `<all>` excludes static assets + prerendered pages so they
			// bypass the SvelteKit Worker. /api/* is now handled
			// inside the SvelteKit Worker via `+server.ts` routes
			// under `src/routes/api/`, NOT by Cloudflare Pages
			// Functions in `functions/` (which can't coexist with
			// adapter-cloudflare's `_worker.js`).
			routes: { include: ['/*'], exclude: ['<all>'] }
		}),
		alias: {
			$lib: 'src/lib',
			'$lib/*': 'src/lib/*'
		},
		version: {
			name: VERSION_NAME
		},
		serviceWorker: {
			// Manual registration in src/lib/pwa/pwa.svelte.ts — updates
			// must be consent-gated (P5 "no silent updates"), which needs
			// control over the waiting-worker lifecycle that SvelteKit's
			// auto-registration does not expose.
			register: false
		},
		csp: {
			mode: 'auto',
			directives: {
				// VU Level 0: zero third-party origins. Fonts are self-hosted under
				// /fonts/ (see src/lib/styles/fonts.css + static/fonts/), so
				// fonts.googleapis.com / fonts.gstatic.com must NOT appear here.
				'default-src': ['self'],
				// Argon2id and OPAQUE use WebAssembly. `wasm-unsafe-eval`
				// permits WASM compilation without permitting arbitrary JS eval.
				'script-src': [
					'self',
					'wasm-unsafe-eval',
					// sha256 of the inline FOUC/theme script in src/app.html.
					// Recompute when that script changes:
					//   node -e "const m=require('fs').readFileSync('src/app.html','utf8').match(/<script>([\s\S]*?)<\/script>/);console.log('sha256-'+require('crypto').createHash('sha256').update(m[1],'utf8').digest('base64'))"
					'sha256-2ciyL97eAATatHL+OvD2aIf6DH5sGN1m7sYzpoGPozc='
				],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self'],
				'img-src': ['self', 'data:', 'blob:'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'frame-src': ['none'],
				'worker-src': ['self'],
				'manifest-src': ['self'],
				'media-src': ['self'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['none'],
				'upgrade-insecure-requests': true
			}
		}
	},
	compilerOptions: {
		runes: true
	}
};

export default config;
