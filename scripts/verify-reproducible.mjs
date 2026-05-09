#!/usr/bin/env node
/**
 * Reproducible-build verification.
 *
 * Builds VuVault twice from the same source tree (using identical
 * `SOURCE_DATE_EPOCH` and `PUBLIC_VAULT_VERSION`) and asserts the
 * resulting `.bundle-digest` aggregates are byte-identical. This is
 * the public-facing "anyone can rebuild and get the same hash"
 * promise from `docs/SECURITY.md`'s "What 'verifiable' means here"
 * section.
 *
 * Convergence requirements (each one is necessary):
 *   - `kit.version.name` is pinned (see `svelte.config.js`).
 *   - `SOURCE_DATE_EPOCH` is set so manifest `generatedAt` is fixed.
 *   - No floating timestamps / random seeds in the bundled JS.
 *
 * Failure mode: prints the two divergent digests and exits 1. The
 * reproducible-build CI job invokes this script.
 *
 * Usage:
 *
 *   SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD) \
 *   PUBLIC_VAULT_VERSION=0.1.0 \
 *   node scripts/verify-reproducible.mjs
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

function run(cmd, args, env) {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			env: { ...process.env, ...env },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '';
		let err = '';
		child.stdout.on('data', (b) => (out += b.toString('utf8')));
		child.stderr.on('data', (b) => (err += b.toString('utf8')));
		child.on('close', (code) => {
			if (code === 0) resolve({ out, err });
			else reject(new Error(`${cmd} exited ${code}\n${err}\n${out}`));
		});
	});
}

async function readDigest() {
	const raw = await readFile('.bundle-digest', 'utf8');
	return raw.replace(/\s/g, '');
}

async function buildOnce(label) {
	const env = {
		PUBLIC_BUNDLE_HASH: '',
		PUBLIC_VAULT_VERSION: process.env.PUBLIC_VAULT_VERSION || '0.1.0',
		PUBLIC_ENABLE_DEMO_AUTH: 'false'
	};
	if (!process.env.SOURCE_DATE_EPOCH) {
		throw new Error(
			'SOURCE_DATE_EPOCH must be set for reproducible-build verification.\n' +
				'Set it from the HEAD commit author time:\n' +
				'  export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD)'
		);
	}
	console.log(`[${label}] building...`);
	await run('npm', ['run', 'build'], env);
	const digest = await readDigest();
	console.log(`[${label}] digest: ${digest}`);
	return digest;
}

async function main() {
	const a = await buildOnce('build A');
	const b = await buildOnce('build B');
	if (a !== b) {
		console.error('::error::reproducible-build verification FAILED');
		console.error(`  build A: ${a}`);
		console.error(`  build B: ${b}`);
		console.error('  builds of the same SHA produce different aggregate digests.');
		console.error('  inspect svelte.config.js (kit.version.name pin) and');
		console.error('  any new floating-timestamp / random-seed inputs.');
		process.exit(1);
	}
	console.log(`Reproducible-build verification PASSED at digest ${a}`);
}

main().catch((err) => {
	console.error('reproducible-build verification crashed:', err);
	process.exit(1);
});
