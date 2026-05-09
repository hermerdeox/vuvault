#!/usr/bin/env node
/**
 * Audit `wrangler.toml` against the Pages Functions `Env` interface.
 *
 * Catches the failure mode where a developer adds a new binding to
 * the TypeScript `Env` interface but forgets to wire it in
 * wrangler.toml (or vice versa) — the divergence would only show up
 * at deploy time, on production traffic.
 *
 * Specifically:
 *
 *   1. Every required (non-optional) field on `Env` MUST have a
 *      matching binding in wrangler.toml's default-env AND
 *      env.production block. (Optional fields are allowed to be
 *      absent — those are vars that the Worker tolerates being unset.)
 *   2. Every binding declared in wrangler.toml MUST appear on `Env`.
 *      An undeclared binding is a sign of dead config or a stale
 *      type declaration.
 *   3. Both blocks (default and `env.production`) must declare the
 *      same set of binding names — otherwise a deploy that targets
 *      production gets a different shape than preview, which has
 *      bitten us before.
 *
 * Run from the repo root:
 *
 *   node scripts/audit-bindings.mjs
 *
 * Exit code 0 if balanced. Exit code 1 (with `::error::` annotations)
 * on any drift.
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

const tomlText = await readFile(join(ROOT, 'wrangler.toml'), 'utf8');
const envText = await readFile(
	join(ROOT, 'functions/api/_shared/env.ts'),
	'utf8'
);

/**
 * Minimal wrangler.toml parser scoped to the binding shapes we care
 * about. We do NOT pull in a full TOML library — the file's structure
 * is small and stable, and a 200-line dependency for a CI lint is the
 * wrong tradeoff. If the file shape evolves, update this parser.
 *
 * Returns: { defaults: Set<binding-name>, production: Set<binding-name>, varsDefaults: Set<var-name>, varsProduction: Set<var-name> }
 */
function parseWranglerBindings(text) {
	const result = {
		defaults: new Set(),
		production: new Set(),
		varsDefaults: new Set(),
		varsProduction: new Set()
	};
	let inProduction = false;
	let inSection = null; // 'd1' | 'r2' | 'unsafe' | 'vars' | null
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;

		// Section / table headers.
		if (line.startsWith('[')) {
			inProduction = line.startsWith('[env.production') || line.startsWith('[[env.production');
			if (
				line === '[[d1_databases]]' ||
				line === '[[env.production.d1_databases]]'
			) {
				inSection = 'd1';
			} else if (
				line === '[[r2_buckets]]' ||
				line === '[[env.production.r2_buckets]]'
			) {
				inSection = 'r2';
			} else if (
				line === '[[unsafe.bindings]]' ||
				line === '[[env.production.unsafe.bindings]]'
			) {
				inSection = 'unsafe';
			} else if (line === '[vars]' || line === '[env.production.vars]') {
				inSection = 'vars';
			} else {
				inSection = null;
			}
			continue;
		}

		const target = inProduction ? result.production : result.defaults;
		const varTarget = inProduction ? result.varsProduction : result.varsDefaults;

		if (inSection === 'd1' || inSection === 'r2') {
			const m = line.match(/^binding\s*=\s*"([^"]+)"/);
			if (m) target.add(m[1]);
		} else if (inSection === 'unsafe') {
			const m = line.match(/^name\s*=\s*"([^"]+)"/);
			if (m) target.add(m[1]);
		} else if (inSection === 'vars') {
			const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
			if (m) varTarget.add(m[1]);
		}
	}
	return result;
}

/**
 * Pull the `Env` interface field set out of `env.ts`. Marks each
 * field as required or optional based on the trailing `?:` syntax.
 *
 * Naive parser — assumes the file uses `interface Env { ... }`
 * with one field per line (the format we control).
 */
function parseEnvInterface(text) {
	const fields = new Map();
	const start = text.indexOf('export interface Env');
	if (start === -1) {
		fail('functions/api/_shared/env.ts: missing `export interface Env` declaration');
		return fields;
	}
	const open = text.indexOf('{', start);
	const close = text.indexOf('}', open);
	if (open === -1 || close === -1) {
		fail('functions/api/_shared/env.ts: malformed `Env` interface body');
		return fields;
	}
	const body = text.slice(open + 1, close);
	for (const rawLine of body.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
		const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\?)?\s*:/);
		if (m) {
			fields.set(m[1], { required: m[2] !== '?' });
		}
	}
	return fields;
}

const wrangler = parseWranglerBindings(tomlText);
const env = parseEnvInterface(envText);

// All non-var Env fields are bindings (D1/R2/RateLimit/etc). Vars are
// the PUBLIC_* and OPAQUE_SERVER_ID strings that come out of [vars]
// blocks rather than [[d1_databases]] / [[r2_buckets]] / [[unsafe.bindings]].
const VAR_FIELD_NAMES = new Set([
	'PUBLIC_BUNDLE_HASH',
	'PUBLIC_VAULT_VERSION',
	'PUBLIC_ENABLE_DEMO_AUTH',
	'PUBLIC_SYNC_ORIGIN',
	'OPAQUE_SERVER_ID'
]);

const envBindings = new Map(
	[...env.entries()].filter(([name]) => !VAR_FIELD_NAMES.has(name))
);

// Rule 1: every REQUIRED Env field MUST exist in wrangler.toml in
// both the default and production blocks. OPTIONAL Env fields are
// allowed to be entirely absent from wrangler.toml — that's the
// runtime-fail-open contract honored by `checkRateLimit()` at
// functions/api/_shared/env.ts:78. Optional bindings that ARE wired
// in only one of the two envs still trigger Rule 3 (parity), so
// preview/production drift is caught regardless.
for (const [name, info] of envBindings) {
	if (info.required) {
		if (!wrangler.defaults.has(name)) {
			fail(`Env binding '${name}' is required but missing from default wrangler.toml`);
		}
		if (!wrangler.production.has(name)) {
			fail(`Env binding '${name}' is required but missing from [env.production] in wrangler.toml`);
		}
	}
	// Optional bindings: silently allowed to be absent. If they appear
	// in only one of the two envs, Rule 3 (parity) below catches it.
}

// Rule 2: every wrangler-declared binding exists on Env.
for (const name of [...wrangler.defaults, ...wrangler.production]) {
	if (!envBindings.has(name)) {
		fail(
			`Wrangler binding '${name}' is declared in wrangler.toml but missing from the Env interface`
		);
	}
}

// Rule 3: parity between defaults and production binding sets.
const onlyInDefaults = [...wrangler.defaults].filter(
	(n) => !wrangler.production.has(n)
);
const onlyInProduction = [...wrangler.production].filter(
	(n) => !wrangler.defaults.has(n)
);
for (const name of onlyInDefaults) {
	fail(
		`Binding '${name}' exists in default wrangler.toml but not in [env.production] — preview/production drift`
	);
}
for (const name of onlyInProduction) {
	fail(
		`Binding '${name}' exists in [env.production] but not in the default wrangler.toml block — preview will not have it`
	);
}

if (FAILURES.length === 0) {
	console.log(
		`audit-bindings: OK (${envBindings.size} Env bindings × 2 envs verified, ${env.size - envBindings.size} vars tracked)`
	);
	process.exit(0);
} else {
	console.error(`audit-bindings: ${FAILURES.length} failure(s)`);
	process.exit(1);
}
