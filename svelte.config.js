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
			routes: { include: ['/*'], exclude: ['<all>'] }
		}),
		alias: {
			$lib: 'src/lib',
			'$lib/*': 'src/lib/*'
		},
		version: {
			name: VERSION_NAME
		},
		csp: {
			mode: 'auto',
			directives: {
				// VU Level 0: zero third-party origins. Fonts are self-hosted under
				// /fonts/ (see src/lib/styles/fonts.css + static/fonts/), so
				// fonts.googleapis.com / fonts.gstatic.com must NOT appear here.
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'font-src': ['self'],
				'img-src': ['self', 'data:', 'blob:'],
				'connect-src': ['self'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['none']
			}
		}
	},
	compilerOptions: {
		runes: true
	}
};

export default config;
