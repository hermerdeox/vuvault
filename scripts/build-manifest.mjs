#!/usr/bin/env node
/**
 * Bundle-integrity manifest emitter.
 *
 * Run after `vite build` (or `svelte-kit build`). Walks the immutable
 * output chunks under `.svelte-kit/cloudflare/_app/immutable` plus the
 * generated `index.html` shells, computes SHA-384 of each file, and
 * writes:
 *
 *   .svelte-kit/cloudflare/_app/immutable/bundle-manifest.json
 *
 * The manifest is a flat record `{ version, generatedAt, hashes }` where
 * `hashes` maps each public-facing path (`/_app/immutable/...`) to its
 * canonical hex SHA-384. The aggregate digest of the canonicalized
 * manifest text is printed to stdout AND written to `.bundle-digest`
 * so CI can pin it as `PUBLIC_BUNDLE_HASH` for the next build pass.
 *
 * The runtime verifier (`src/lib/utils/env.ts::verifyBundleIntegrity`)
 * fetches this JSON, recomputes each chunk's SHA-384 in the browser,
 * compares to the manifest, then aggregates and compares to the
 * embedded `PUBLIC_BUNDLE_HASH`. A mismatch refuses unlock.
 *
 * Honest framing: the verifier runs inside the bundle it verifies, so a
 * fully malicious origin can lie. This is a tripwire against silent
 * CDN swaps and out-of-band integrity checks via the Rekor link.
 *
 * REPRODUCIBILITY: `generatedAt` is taken from `SOURCE_DATE_EPOCH`
 * (RFC-style UNIX timestamp env var, populated by reproducible-build
 * tooling and the M3 release workflow from `git log -1 --format=%ct`).
 * If unset, falls back to wall-clock time — fine for local dev but
 * non-deterministic, so production CI MUST set `SOURCE_DATE_EPOCH`.
 *
 * TWO-PASS CONVERGENCE: the manifest only walks `_app/immutable/`
 * (compiled JS/CSS chunks), NOT prerendered HTML at the build root.
 * `PUBLIC_BUNDLE_HASH` is read via `$env/dynamic/public` — it lands in
 * prerendered HTML and Worker-resolved env, but does NOT bake into the
 * hashed JS chunks. So pass 1 (placeholder) and pass 2 (real digest)
 * produce byte-identical manifests, which makes the build a fixed
 * point under H = aggregate(manifest(chunks)). The CI two-pass step
 * asserts this fixed-point property.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BUILD_DIR = join(ROOT, '.svelte-kit', 'cloudflare');
const IMMUTABLE_DIR = join(BUILD_DIR, '_app', 'immutable');
const MANIFEST_OUT = join(IMMUTABLE_DIR, 'bundle-manifest.json');
const DIGEST_OUT = join(ROOT, '.bundle-digest');

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const e of entries) {
		const full = join(dir, e.name);
		if (e.isDirectory()) {
			files.push(...(await walk(full)));
		} else if (e.isFile()) {
			files.push(full);
		}
	}
	return files;
}

function sha384Hex(bytes) {
	return createHash('sha384').update(bytes).digest('hex');
}

function toPublicPath(absPath) {
	// Convert absolute fs path -> the `/_app/immutable/...` URL the
	// runtime fetches. Always uses forward slashes.
	const rel = relative(BUILD_DIR, absPath);
	return '/' + rel.split(sep).join('/');
}

async function main() {
	let immutableExists = true;
	try {
		await stat(IMMUTABLE_DIR);
	} catch {
		immutableExists = false;
	}
	if (!immutableExists) {
		console.error('build-manifest: ' + IMMUTABLE_DIR + ' does not exist. Run `npm run build` first.');
		process.exit(1);
	}

	const files = await walk(IMMUTABLE_DIR);
	// Skip a stale manifest from a previous run.
	const filtered = files.filter((f) => f !== MANIFEST_OUT);

	// PWA service worker — emitted at the build root, not under
	// _app/immutable/, but it is executable code shipped to every
	// client, so it belongs in the integrity manifest (the runtime
	// verifier fetches manifest keys generically). Its content does
	// not depend on PUBLIC_BUNDLE_HASH (no $env import in
	// src/service-worker.ts), so two-pass convergence is preserved:
	// pass-1 and pass-2 workers are byte-identical.
	const swPath = join(BUILD_DIR, 'service-worker.js');
	try {
		await stat(swPath);
		filtered.push(swPath);
	} catch {
		// No service worker in this build output — nothing to add.
	}

	const hashes = {};
	for (const abs of filtered) {
		const buf = await readFile(abs);
		hashes[toPublicPath(abs)] = sha384Hex(buf);
	}

	// Sort keys for canonical, byte-stable JSON.
	const sortedHashes = Object.fromEntries(
		Object.keys(hashes)
			.sort()
			.map((k) => [k, hashes[k]])
	);

	// Deterministic timestamp for reproducible builds. SOURCE_DATE_EPOCH
	// is the standard UNIX-timestamp env var that reproducible-build
	// tooling expects. Anything else falls back to wall clock.
	const epochRaw = process.env.SOURCE_DATE_EPOCH;
	const epoch = epochRaw != null && epochRaw !== '' ? Number.parseInt(epochRaw, 10) : Number.NaN;
	const generatedAt = Number.isFinite(epoch)
		? new Date(epoch * 1000).toISOString()
		: new Date().toISOString();

	const manifest = {
		version: 1,
		algorithm: 'SHA-384',
		generatedAt,
		hashes: sortedHashes
	};

	const json = JSON.stringify(manifest) + '\n';
	const aggregate = sha384Hex(Buffer.from(json, 'utf8'));

	await writeFile(MANIFEST_OUT, json, 'utf8');
	await writeFile(DIGEST_OUT, aggregate + '\n', 'utf8');

	// adapter-cloudflare appends an autogenerated block to the build's
	// _headers AFTER the static one, mapping '/_app/immutable/*' to
	// '! Cache-Control' + 'Cache-Control: public, immutable,
	// max-age=31536000' — which supersedes the static no-store rule
	// for bundle-manifest.json. Appending our override after the
	// autogenerated block restores no-store wherever the platform
	// resolves conflicts in favor of later rules (production Pages);
	// wrangler pages dev resolves the other way and keeps immutable.
	//
	// DEFENSE-IN-DEPTH ONLY — correctness does not depend on it:
	// every first-party consumer bypasses the HTTP cache at the
	// request level (verifyBundleIntegrity uses {cache:'no-store'},
	// the service worker's install/repair use {cache:'reload'}), and
	// Cloudflare Pages serves assets per-deployment, so a new deploy
	// cannot serve the previous deploy's manifest.
	const headersPath = join(BUILD_DIR, '_headers');
	const HEADERS_MARK = 'build-manifest.mjs: integrity manifest must never be cached';
	const HEADERS_OVERRIDE =
		'\n# ' + HEADERS_MARK + ' —\n' +
		"# must come AFTER adapter-cloudflare's autogenerated immutable rule.\n" +
		'/_app/immutable/bundle-manifest.json\n' +
		'  ! Cache-Control\n' +
		'  Cache-Control: no-store\n';
	try {
		const headers = await readFile(headersPath, 'utf8');
		if (!headers.includes(HEADERS_MARK)) {
			await writeFile(headersPath, headers + HEADERS_OVERRIDE, 'utf8');
			console.log('build-manifest: appended no-store override to _headers');
		}
	} catch {
		// No _headers in this build output — nothing to override.
	}

	console.log(
		'build-manifest: hashed ' +
			filtered.length +
			' files; aggregate SHA-384 = ' +
			aggregate
	);
}

main().catch((err) => {
	console.error('build-manifest failed:', err);
	process.exit(1);
});
