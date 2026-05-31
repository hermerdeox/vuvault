/**
 * Self-test for `scripts/audit-bindings.mjs` Rule 4 — V1-C2
 * metadata-minimization.
 *
 * The rule rejects any post-0004 migration that re-adds a column
 * whose name matches the device-/account-correlating regex set. We
 * exercise the rule by writing a synthetic forbidden migration into
 * `migrations/`, running audit-bindings, asserting it exits 1 with
 * the expected message, and cleaning up.
 *
 * Vitest can't easily inject a fixture into the workspace migrations
 * directory because audit-bindings reads from CWD. We use Node's
 * child_process directly and run as a `.mjs` test outside vitest:
 *
 *   node scripts/audit-bindings.test.mjs
 *
 * Exit 0 if all assertions pass. Exit 1 otherwise.
 *
 * Also runnable as part of the CI gate — see `.github/workflows/ci.yml`.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SYNTHETIC = join(ROOT, 'migrations/9999_synthetic_forbidden_migration_DO_NOT_COMMIT.sql');
let failures = 0;

function fail(msg) {
	failures += 1;
	console.error(`::error::audit-bindings.test: ${msg}`);
}

function pass(msg) {
	console.log(`✓ ${msg}`);
}

function runAuditBindings() {
	return spawnSync('node', ['scripts/audit-bindings.mjs'], {
		cwd: ROOT,
		encoding: 'utf8'
	});
}

function withSyntheticMigration(body, fn) {
	if (existsSync(SYNTHETIC)) {
		throw new Error('synthetic migration already exists; aborting to avoid clobber');
	}
	writeFileSync(SYNTHETIC, body, 'utf8');
	try {
		fn();
	} finally {
		if (existsSync(SYNTHETIC)) unlinkSync(SYNTHETIC);
	}
}

// Pre-check: with no synthetic migration in place, audit-bindings
// MUST pass. This is the steady-state assertion.
{
	const r = runAuditBindings();
	if (r.status !== 0) {
		fail(`baseline run failed (status=${r.status}); stderr:\n${r.stderr}`);
	} else {
		pass('baseline audit-bindings exits 0');
	}
}

// Test 1: a synthetic migration that re-adds `sessions.device_fingerprint`
// MUST be rejected by Rule 4.
withSyntheticMigration(
	`-- synthetic forbidden migration; cleaned up by the test runner
ALTER TABLE sessions ADD COLUMN device_fingerprint TEXT NOT NULL DEFAULT '';
`,
	() => {
		const r = runAuditBindings();
		if (r.status === 0) {
			fail('synthetic device_fingerprint migration was NOT rejected by Rule 4');
		} else if (!r.stderr.includes('device_fingerprint')) {
			fail(`Rule 4 rejected but error message did not mention 'device_fingerprint': ${r.stderr}`);
		} else if (!r.stderr.includes('V1-C2')) {
			fail(`Rule 4 rejected but error message did not cite 'V1-C2': ${r.stderr}`);
		} else {
			pass('Rule 4 rejects sessions.device_fingerprint');
		}
	}
);

// Test 2: synthetic `accounts.last_login_attempted_at` MUST be rejected.
withSyntheticMigration(
	`-- synthetic forbidden migration; cleaned up by the test runner
ALTER TABLE accounts ADD COLUMN last_login_attempted_at INTEGER;
`,
	() => {
		const r = runAuditBindings();
		if (r.status === 0) {
			fail('synthetic accounts.last_login_attempted_at was NOT rejected');
		} else if (!r.stderr.includes('last_login_attempted_at')) {
			fail(`Rule 4 rejected but message did not mention column name: ${r.stderr}`);
		} else {
			pass('Rule 4 rejects accounts.last_login_attempted_at');
		}
	}
);

// Test 3: synthetic CREATE TABLE that re-introduces a forbidden
// column via a fresh `sessions_v2` table SHOULD pass — the rule
// only protects `sessions` and `accounts` by name. (This documents
// the rule's scope; if we later want to extend it to all session-
// like tables, the rule and this test update together.)
withSyntheticMigration(
	`-- synthetic forbidden-looking but allowed (different table)
CREATE TABLE sessions_v2_archive (
  device_id TEXT,
  account_id TEXT NOT NULL,
  archived_at INTEGER
);
`,
	() => {
		const r = runAuditBindings();
		if (r.status !== 0) {
			fail(`Rule 4 false-positive on sessions_v2_archive: ${r.stderr}`);
		} else {
			pass('Rule 4 correctly scopes to `sessions` and `accounts` by name');
		}
	}
);

// Test 4: a CREATE TABLE sessions (...) that re-includes
// `device_id` is rejected. This exercises the CREATE TABLE branch
// of the regex (vs the ALTER TABLE branch from Tests 1+2).
withSyntheticMigration(
	`-- synthetic CREATE TABLE attempt
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  device_id TEXT,
  account_id TEXT
);
`,
	() => {
		const r = runAuditBindings();
		if (r.status === 0) {
			fail('Rule 4 missed CREATE TABLE sessions with device_id');
		} else if (!r.stderr.includes('device_id')) {
			fail(`Rule 4 rejected but message did not mention device_id: ${r.stderr}`);
		} else {
			pass('Rule 4 rejects CREATE TABLE sessions with device_id');
		}
	}
);

// Post-check: cleanup actually worked.
if (existsSync(SYNTHETIC)) {
	fail('synthetic migration still exists after test; cleanup failed');
} else {
	pass('synthetic migration cleaned up');
}

if (failures > 0) {
	console.error(`audit-bindings.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log('audit-bindings.test: OK');
process.exit(0);
