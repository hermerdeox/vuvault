#!/usr/bin/env node
/**
 * Seed the D1-backed OPAQUE server identity.
 *
 * The seed is a 32-byte long-lived server secret. Rotating it invalidates
 * every existing OPAQUE registration, so production defaults to an
 * idempotent insert-only mode and requires `--rotate=true` to replace it.
 */

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { DEFAULT_SUITE, getGroup, getSuite } from '@structured-id/opaque';

const args = new Map();
for (const raw of process.argv.slice(2)) {
	const [key, value = 'true'] = raw.replace(/^--/, '').split('=');
	args.set(key, value);
}

const envName = args.get('env') ?? 'production';
const rotate = ['true', '1', 'yes'].includes((args.get('rotate') ?? 'false').toLowerCase());
const local =
	args.has('local') ||
	envName === 'local' ||
	['true', '1', 'yes'].includes((args.get('local') ?? 'false').toLowerCase());
const remote = !local;

if (remote && !envName) {
	console.error('::error::--env=<name> is required for remote D1 seeding');
	process.exit(1);
}

if (remote && rotate && !['true', '1', 'yes'].includes((process.env.ALLOW_OPAQUE_ROTATION ?? '').toLowerCase())) {
	console.error(
		'::error::Refusing remote OPAQUE identity rotation without ALLOW_OPAQUE_ROTATION=true'
	);
	process.exit(1);
}

function generateServerSecretHex() {
	const suite = getSuite(DEFAULT_SUITE);
	const group = getGroup(suite.curve);
	const { secretKey } = group.generateKeypair();
	return Array.from(secretKey, (b) => b.toString(16).padStart(2, '0')).join('');
}

const hex = generateServerSecretHex();
const sql = rotate
	? `INSERT OR REPLACE INTO server_identity (id, oprf_seed, created_at) VALUES (1, X'${hex}', unixepoch())`
	: `INSERT INTO server_identity (id, oprf_seed, created_at)
SELECT 1, X'${hex}', unixepoch()
WHERE NOT EXISTS (SELECT 1 FROM server_identity WHERE id = 1)`;

const wranglerArgs = ['wrangler', 'd1', 'execute', 'AUTH_DB'];
if (remote) wranglerArgs.push('--env', envName, '--remote');
else wranglerArgs.push('--local');
wranglerArgs.push('--command', sql);

const result = spawnSync('npx', wranglerArgs, {
	stdio: 'inherit',
	env: process.env
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

console.log(
	`seed-opaque-identity: ${rotate ? 'rotated' : 'seeded if absent'} ${local ? 'local' : envName} AUTH_DB`
);
