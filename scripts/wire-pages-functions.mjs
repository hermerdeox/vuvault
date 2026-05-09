#!/usr/bin/env node
/**
 * Copy `functions/` (Cloudflare Pages Functions at the repo root)
 * into the SvelteKit Cloudflare adapter output so a single
 * `wrangler pages deploy .svelte-kit/cloudflare` ships both the
 * SvelteKit Worker AND the Pages Functions.
 *
 * Why this is needed: the SvelteKit Cloudflare adapter does not know
 * about `functions/` at the repo root. The adapter consolidates
 * everything into `_worker.js` + `_routes.json`. With our config
 * (`routes.exclude: ['<all>', '/api/*']`), Cloudflare Pages routes
 * `/api/*` requests AROUND the SvelteKit Worker — but only if the
 * deploy artifact has a `functions/` directory next to `_worker.js`.
 * Without this script, the adapter output has no `functions/` dir
 * and `/api/*` requests 404.
 *
 * Run this script BETWEEN `vite build` and
 * `scripts/build-manifest.mjs`. The order matters because the
 * manifest only hashes files under `_app/immutable/`, so this copy
 * step does NOT change the manifest aggregate digest.
 */

import { cp, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SRC = join(ROOT, 'functions');
const DEST_PARENT = join(ROOT, '.svelte-kit', 'cloudflare');
const DEST = join(DEST_PARENT, 'functions');

async function exists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

if (!(await exists(SRC))) {
	console.log('wire-pages-functions: no functions/ at repo root; nothing to wire');
	process.exit(0);
}

if (!(await exists(DEST_PARENT))) {
	console.error(
		`::error::adapter output missing at ${DEST_PARENT}. Did vite build run before this script?`
	);
	process.exit(1);
}

await mkdir(DEST, { recursive: true });
await cp(SRC, DEST, {
	recursive: true,
	// SOURCE_DATE_EPOCH-friendly: copy file modes/contents but don't
	// preserve mtimes — the adapter output is otherwise wall-clock-
	// influenced only via `generatedAt` in build-manifest.mjs.
	preserveTimestamps: false,
	// Don't overwrite if a same-named file already exists in the
	// adapter output (the adapter's _worker.js wins by design).
	force: false,
	errorOnExist: false
});

console.log(`wire-pages-functions: copied ${SRC} → ${DEST}`);
