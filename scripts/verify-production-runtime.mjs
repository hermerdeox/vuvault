#!/usr/bin/env node
/**
 * Production runtime preflight.
 *
 * Pages deploys cannot receive per-deployment vars via
 * `wrangler pages deploy`; the release job must build with the same
 * public env it expects production to expose and must refuse to deploy
 * if the operator has not explicitly configured the runtime-critical
 * values.
 */

import { readFile } from 'node:fs/promises';
import process from 'node:process';

const PLACEHOLDER_BUNDLE_HASH = '9f4c7d2e8b16a4f122e0d5c83a7e91b4';

function fail(message) {
	console.error(`::error::${message}`);
	process.exitCode = 1;
}

const digest = (await readFile('.bundle-digest', 'utf8')).trim();
const bundleHash = (process.env.PUBLIC_BUNDLE_HASH ?? '').trim();
const syncOrigin = (process.env.PUBLIC_SYNC_ORIGIN ?? '').trim();
const releaseSha = (process.env.GITHUB_SHA ?? process.env.RELEASE_SHA ?? '').trim();
const demoAuth = (process.env.PUBLIC_ENABLE_DEMO_AUTH ?? '').trim().toLowerCase();
const m3E2eAuth = (process.env.PUBLIC_M3_E2E_AUTH ?? '').trim().toLowerCase();
const allowLocalSyncOrigin = (process.env.ALLOW_LOCAL_SYNC_ORIGIN ?? '')
	.trim()
	.toLowerCase();

if (!digest) fail('.bundle-digest is empty');
if (!bundleHash) fail('PUBLIC_BUNDLE_HASH is not set for production preflight');
if (bundleHash && bundleHash !== digest) {
	fail(`PUBLIC_BUNDLE_HASH does not match .bundle-digest (${bundleHash} !== ${digest})`);
}
if (bundleHash === PLACEHOLDER_BUNDLE_HASH) {
	fail('PUBLIC_BUNDLE_HASH is the placeholder digest');
}
if (!syncOrigin) {
	fail('PUBLIC_SYNC_ORIGIN must be non-empty for production M3 sync builds');
}
if (['true', '1', 'yes'].includes(demoAuth)) {
	fail('PUBLIC_ENABLE_DEMO_AUTH must be false for production builds');
}
if (['true', '1', 'yes'].includes(m3E2eAuth)) {
	fail('PUBLIC_M3_E2E_AUTH must be false for production builds');
}
const isHttpsOrigin = /^https:\/\/[^/]+$/.test(syncOrigin);
const isLocalOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(syncOrigin);
if (!isHttpsOrigin && !(isLocalOrigin && ['true', '1', 'yes'].includes(allowLocalSyncOrigin))) {
	fail('PUBLIC_SYNC_ORIGIN must be an HTTPS origin without a path');
}

let artifact = '';
try {
	artifact = await readFile('.m3-e2e-passed', 'utf8');
} catch {
	fail('.m3-e2e-passed artifact is missing; run the CI m3-sync-e2e job for this commit');
}
if (artifact) {
	const values = Object.fromEntries(
		artifact
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const i = line.indexOf('=');
				return i === -1 ? [line, ''] : [line.slice(0, i), line.slice(i + 1)];
			})
	);
	if (!values.sha) {
		fail('.m3-e2e-passed artifact is missing sha=<commit>');
	}
	if (releaseSha && values.sha !== releaseSha) {
		fail(`.m3-e2e-passed was produced for ${values.sha}, not ${releaseSha}`);
	}
}

if (process.exitCode) process.exit(process.exitCode);

console.log('verify-production-runtime: OK');
