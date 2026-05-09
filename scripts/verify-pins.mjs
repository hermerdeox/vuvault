#!/usr/bin/env node
/**
 * Verify every dependency claimed "exact pin" actually is.
 *
 * The crypto deps `@structured-id/opaque` (RFC 9807 client) and
 * `argon2id` (RFC 9106) are unaudited new runtime deps; a silent
 * caret/tilde range slipping into `package.json` is a signal someone
 * bypassed the dep review.
 *
 * The CI release workflow pins `sigstore/cosign-installer` and the
 * `cosign-release` input; floating those would change the
 * certificate-chain or signature-format expectations between releases.
 *
 * Usage:
 *
 *   node scripts/verify-pins.mjs
 *
 * Exit code 0 if every claimed pin is exact. Exit code 1 (with
 * `::error::` annotations on stderr) on any drift.
 *
 * The CI `quality` job runs this script. Fixing a real upgrade is a
 * deliberate, documented action — do it by editing this file's PIN
 * list AND the matching package.json / release.yml line in the same
 * commit, with a justification in the commit message.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const FAILURES = [];
function fail(msg) {
	FAILURES.push(msg);
	console.error(`::error::${msg}`);
}

const NPM_EXACT_PINS = [
	{
		name: '@structured-id/opaque',
		field: 'dependencies',
		why: 'RFC 9807 OPAQUE client; unaudited new runtime dep'
	},
	{
		name: 'argon2id',
		field: 'dependencies',
		why: 'RFC 9106 master-password stretching; unaudited new runtime dep'
	}
];

const pkg = JSON.parse(
	await readFile(join(ROOT, 'package.json'), 'utf8')
);

for (const pin of NPM_EXACT_PINS) {
	const declared = pkg[pin.field]?.[pin.name];
	if (declared == null) {
		fail(`${pin.name}: missing from package.json ${pin.field}`);
		continue;
	}
	if (/^[\^~>]/.test(declared) || declared.includes('||') || declared.includes('-')) {
		// Note: `^`, `~`, `>=`, `>`, `||`, or pre-release ranges are all
		// disallowed for these deps. The `-` rejection covers things like
		// "1.0.0-beta.1" (pre-release) and tag aliases like "latest".
		fail(
			`${pin.name}: must be an exact version (no ^/~/>=/||/pre-release); package.json has '${declared}' — ${pin.why}`
		);
	} else if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(declared)) {
		fail(
			`${pin.name}: version '${declared}' does not look like a semver triple — ${pin.why}`
		);
	}
}

const releaseYmlPath = join(ROOT, '.github/workflows/release.yml');
let releaseYml;
try {
	releaseYml = await readFile(releaseYmlPath, 'utf8');
} catch {
	fail('release.yml: missing — sigstore/cosign pins cannot be checked');
}

if (releaseYml) {
	const installerMatch = releaseYml.match(
		/sigstore\/cosign-installer@(v\d+\.\d+\.\d+)\b/
	);
	const cosignMatch = releaseYml.match(
		/cosign-release:\s*['"]?(v\d+\.\d+\.\d+)['"]?/
	);
	if (!installerMatch) {
		fail(
			"release.yml: sigstore/cosign-installer must be pinned to an exact vX.Y.Z (no @v3, no @main)"
		);
	}
	if (!cosignMatch) {
		fail(
			"release.yml: cosign-release must be pinned to an exact vX.Y.Z (no v2, no latest)"
		);
	}
	if (installerMatch && cosignMatch) {
		console.log(
			`cosign pins OK: installer=${installerMatch[1]}, cosign=${cosignMatch[1]}`
		);
	}
}

if (FAILURES.length === 0) {
	console.log(`verify-pins: OK (${NPM_EXACT_PINS.length} npm pins + 2 cosign pins verified)`);
	process.exit(0);
} else {
	console.error(`verify-pins: ${FAILURES.length} failure(s)`);
	process.exit(1);
}
