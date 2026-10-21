#!/usr/bin/env node
/**
 * Build and serve the app with the real API (`npm run dev:api`): the
 * wrangler Pages runtime on http://localhost:8788 with local D1 and R2.
 *
 * Mirrors the CI `m3 d1/r2 sync e2e` job so a local run behaves like the
 * one CI tests. The parts that are easy to get wrong by hand:
 *
 *   - `.dev.vars` (gitignored) must hold AKD_SIGNING_KEY_HEX, or token
 *     issuance answers 503 and sync cannot authorize. Created from
 *     `.dev.vars.example` with a fresh random key when missing.
 *   - The PUBLIC_* values go to BOTH the build and the serve. The client
 *     reads them through `$env/dynamic/public`, which wrangler resolves
 *     when it serves, so setting them only at build time ships a client
 *     with no sync origin and onboarding fails with "Registration failed".
 *   - OPAQUE_SERVER_ID must be `vuvault.app` to match the client's
 *     getRpId(); the top-level wrangler.toml value fails the OPAQUE AKE
 *     MAC verify at login with a misleading error.
 *   - The OPAQUE identity is seeded only if absent, so local accounts
 *     survive restarts.
 *
 * PUBLIC_M3_E2E_AUTH defaults to `true` (a deterministic PRF shim in
 * place of WebAuthn, so headless browsers can onboard). Run with
 * `PUBLIC_M3_E2E_AUTH=false npm run dev:api` to use a real passkey.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const PORT = '8788';

const PUBLIC_VARS = {
	PUBLIC_BUNDLE_HASH: '9f4c7d2e8b16a4f122e0d5c83a7e91b4',
	PUBLIC_VAULT_VERSION: '0.1.0',
	PUBLIC_ENABLE_DEMO_AUTH: 'false',
	PUBLIC_M3_E2E_AUTH: process.env.PUBLIC_M3_E2E_AUTH ?? 'true',
	PUBLIC_SYNC_ORIGIN: `http://localhost:${PORT}`
};

const SERVER_VARS = {
	OPAQUE_SERVER_ID: 'vuvault.app',
	OPAQUE_RATE_LIMIT_MODE: 'fail-open'
};

function run(cmd, args, env = {}) {
	const result = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync('.dev.vars')) {
	const template = readFileSync('.dev.vars.example', 'utf8');
	const key = randomBytes(32).toString('hex');
	writeFileSync(
		'.dev.vars',
		template.replace(/^AKD_SIGNING_KEY_HEX=.*$/m, `AKD_SIGNING_KEY_HEX=${key}`),
		{ mode: 0o600 }
	);
	console.log('dev-api: created .dev.vars with a fresh AKD_SIGNING_KEY_HEX');
} else if (!/^AKD_SIGNING_KEY_HEX=[0-9a-fA-F]{64}\s*$/m.test(readFileSync('.dev.vars', 'utf8'))) {
	console.warn(
		'dev-api: .dev.vars has no 64-hex AKD_SIGNING_KEY_HEX; sync will answer 503 (see .dev.vars.example)'
	);
}

run('npm', ['run', 'build'], PUBLIC_VARS);
run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'AUTH_DB', '--local']);
run('node', ['scripts/seed-opaque-identity.mjs', '--env=local']);

const bindings = Object.entries({ ...PUBLIC_VARS, ...SERVER_VARS }).flatMap(([key, value]) => [
	'--binding',
	`${key}=${value}`
]);
console.log(`dev-api: serving http://localhost:${PORT} (Ctrl-C to stop)`);
run('npx', ['wrangler', 'pages', 'dev', '.svelte-kit/cloudflare', '--port', PORT, ...bindings]);
