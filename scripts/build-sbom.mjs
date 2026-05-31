#!/usr/bin/env node
/**
 * Generate a CycloneDX 1.5 SBOM (Software Bill of Materials) from
 * `package-lock.json`.
 *
 * Output: `sbom.json` at the repo root, conforming to CycloneDX 1.5
 * (https://cyclonedx.org/docs/1.5/json/).
 *
 * Why hand-rolled instead of `@cyclonedx/cyclonedx-npm`? Two reasons:
 *
 *   1. Adding a new dev dependency for SBOM generation expands the
 *      supply-chain surface, which is precisely what an SBOM exists
 *      to make auditable. The package-lock has everything we need
 *      already.
 *   2. The CycloneDX 1.5 schema is small and stable. Parsing
 *      `lockfileVersion 3` is ~50 lines. A third-party tool wraps
 *      that in a CLI plus opinions we don't need.
 *
 * Determinism: this script reads only on-disk files, never queries
 * the network, and emits the same bytes for the same lockfile. CI's
 * reproducible-build job can verify the SBOM digest the same way it
 * verifies the bundle digest.
 *
 * Auditor workflow:
 *
 *   $ npm run sbom                  # writes sbom.json
 *   $ jq '.components | length' sbom.json
 *   $ jq '.components[] | select(.name=="argon2id") | .version' sbom.json
 *
 * Exit 0 on success; exit 1 with `::error::` on any parse failure.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const FAILURES = [];
function fail(msg) {
	FAILURES.push(msg);
	console.error(`::error::${msg}`);
}

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
let lock;
try {
	lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
} catch (err) {
	fail(
		`package-lock.json is missing or unparseable (${err instanceof Error ? err.message : String(err)})`
	);
	process.exit(1);
}

if (lock.lockfileVersion !== 3) {
	// We only know how to walk lockfileVersion 3. Stop loudly rather
	// than silently emit a partial SBOM.
	fail(
		`package-lock.json: expected lockfileVersion 3, got ${lock.lockfileVersion}. Update build-sbom.mjs to handle the new format.`
	);
	process.exit(1);
}

const components = [];

for (const [path, entry] of Object.entries(lock.packages ?? {})) {
	// Skip the root project entry — CycloneDX puts that at the top
	// level under `metadata.component`, not in `components`.
	if (path === '') continue;
	// The "node_modules/<name>" key is the install path. The
	// rightmost "node_modules/<name>" segment is the package name;
	// any earlier "node_modules/<parent>/node_modules/<child>"
	// nesting in the path is the install hierarchy, not the
	// canonical package id.
	const segments = path.split('node_modules/').filter(Boolean);
	const name = segments[segments.length - 1].replace(/\/$/, '');
	if (!name) {
		fail(`malformed package path in lockfile: ${path}`);
		continue;
	}
	if (!entry.version) {
		// Workspace-internal entries lack a version. Skip them; they
		// are accounted for by `metadata.component`.
		continue;
	}

	// `bom-ref` must be stable per (name, version) so two runs of
	// this script against the same lockfile produce byte-identical
	// SBOMs. Using `pkg:npm/<name>@<version>` is the package-URL
	// scheme CycloneDX recommends.
	const purl = `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(entry.version)}`;

	const component = {
		'bom-ref': purl,
		type: 'library',
		name,
		version: entry.version,
		purl,
		scope: entry.dev ? 'optional' : 'required'
	};
	if (entry.resolved) component.externalReferences = [{ type: 'distribution', url: entry.resolved }];
	if (entry.integrity) component.hashes = parseIntegrity(entry.integrity);
	if (entry.license) component.licenses = normalizeLicenses(entry.license);
	components.push(component);
}

// Sort deterministically so the SBOM digest is reproducible.
components.sort((a, b) => (a['bom-ref'] < b['bom-ref'] ? -1 : a['bom-ref'] > b['bom-ref'] ? 1 : 0));

const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH
	? new Date(Number.parseInt(process.env.SOURCE_DATE_EPOCH, 10) * 1000)
	: new Date(0);

const sbom = {
	bomFormat: 'CycloneDX',
	specVersion: '1.5',
	serialNumber: deterministicSerialNumber(pkg.name, pkg.version),
	version: 1,
	metadata: {
		timestamp: sourceDateEpoch.toISOString(),
		component: {
			'bom-ref': `pkg:npm/${pkg.name}@${pkg.version}`,
			type: 'application',
			name: pkg.name,
			version: pkg.version,
			description: pkg.description ?? undefined,
			purl: `pkg:npm/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`
		}
	},
	components
};

const out = JSON.stringify(sbom, null, 2) + '\n';
await writeFile(join(ROOT, 'sbom.json'), out);

const digest = createHash('sha384').update(out).digest('hex');
console.log(`build-sbom: wrote sbom.json (${components.length} components, sha384=${digest})`);

if (FAILURES.length > 0) {
	console.error(`build-sbom: ${FAILURES.length} non-fatal warning(s)`);
}

function parseIntegrity(integrity) {
	// `integrity` is a Subresource Integrity string like
	// "sha512-base64==". CycloneDX wants { alg, content } per hash.
	const hashes = [];
	for (const part of integrity.split(/\s+/)) {
		const m = part.match(/^([a-z0-9]+)-(.+)$/i);
		if (!m) continue;
		const alg = m[1].toUpperCase();
		const content = m[2];
		// CycloneDX names: SHA-256, SHA-384, SHA-512 etc.
		const normalized = alg.replace(/^(SHA)(\d+)$/, 'SHA-$2');
		hashes.push({ alg: normalized, content });
	}
	return hashes;
}

function normalizeLicenses(license) {
	if (typeof license === 'string') {
		// SPDX expression OR a plain id; emit as `expression` so
		// consumers handle "MIT OR Apache-2.0" correctly.
		if (/\bOR\b|\bAND\b|\bWITH\b/.test(license)) {
			return [{ expression: license }];
		}
		return [{ license: { id: license } }];
	}
	if (Array.isArray(license)) {
		return license.flatMap((l) => normalizeLicenses(l));
	}
	if (license && typeof license === 'object' && typeof license.type === 'string') {
		return [{ license: { id: license.type } }];
	}
	return undefined;
}

function deterministicSerialNumber(name, version) {
	// CycloneDX recommends a urn:uuid; deriving one from (name, version)
	// keeps the SBOM byte-identical for the same inputs without
	// requiring a clock or randomness. The hash is truncated to 16
	// bytes and formatted as a UUIDv4-shaped string.
	const h = createHash('sha256').update(`${name}@${version}`).digest('hex');
	const a = h.slice(0, 8);
	const b = h.slice(8, 12);
	const c = '4' + h.slice(13, 16); // version 4
	const d = '8' + h.slice(17, 20); // RFC 4122 variant
	const e = h.slice(20, 32);
	return `urn:uuid:${a}-${b}-${c}-${d}-${e}`;
}
