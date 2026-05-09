#!/usr/bin/env node
/**
 * Build src/lib/crypto/kat/ml-kem-1024-acvp.json from cached NIST ACVP
 * files at /tmp/acvp-prompt.json and /tmp/acvp-expected.json.
 *
 * Reproducibility recipe (run from the repo root):
 *
 *   1. Capture today's HEAD SHA on github.com/usnistgov/ACVP-Server
 *      (the GitHub UI shows it on every commit; or use the API).
 *   2. curl the keyGen prompt + expectedResults files into /tmp/.
 *   3. ACVP_SHA=<sha> node scripts/build-acvp-kat.mjs
 *
 * The downloaded files MUST be at /tmp/acvp-prompt.json and
 * /tmp/acvp-expected.json. The committed pin lives in this file's
 * sibling JSON via the `sourceCommit` field.
 *
 * Picks 5 ML-KEM-1024 cases (tcId 51-55) from `tgId 3` and ships the
 * full {z, d, ek, dk} hex per case. Total file weight ~47 KB. The
 * runtime test in `src/lib/crypto/ml-kem-1024.acvp.test.ts` runs
 * `ml_kem1024.keygen(d || z)` and asserts byte-for-byte equality with
 * the ACVP-published ek/dk — the strongest possible FIPS 203
 * conformance assertion this codebase can make against NIST-published
 * material.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

const ACVP_SHA = process.env.ACVP_SHA ?? 'ACVP_SHA-not-set';
const SOURCE_PROMPT = `https://raw.githubusercontent.com/usnistgov/ACVP-Server/${ACVP_SHA}/gen-val/json-files/ML-KEM-keyGen-FIPS203/prompt.json`;
const SOURCE_EXPECTED = `https://raw.githubusercontent.com/usnistgov/ACVP-Server/${ACVP_SHA}/gen-val/json-files/ML-KEM-keyGen-FIPS203/expectedResults.json`;
const KEEP = [51, 52, 53, 54, 55];

const prompt = JSON.parse(await readFile('/tmp/acvp-prompt.json', 'utf8'));
const expected = JSON.parse(await readFile('/tmp/acvp-expected.json', 'utf8'));

const promptGroup = prompt.testGroups.find((g) => g.parameterSet === 'ML-KEM-1024');
const expectedGroup = expected.testGroups.find((g) => g.tgId === promptGroup.tgId);
if (!promptGroup || !expectedGroup) {
	throw new Error('ACVP files do not contain an ML-KEM-1024 testGroup');
}

const promptByTcId = new Map(promptGroup.tests.map((t) => [t.tcId, t]));
const expectedByTcId = new Map(expectedGroup.tests.map((t) => [t.tcId, t]));

const cases = KEEP.map((tcId) => {
	const p = promptByTcId.get(tcId);
	const e = expectedByTcId.get(tcId);
	if (!p || !e) throw new Error(`tcId ${tcId} missing from ACVP files`);
	return {
		tcId,
		tgId: promptGroup.tgId,
		parameterSet: 'ML-KEM-1024',
		z: p.z.toLowerCase(),
		d: p.d.toLowerCase(),
		ek: e.ek.toLowerCase(),
		dk: e.dk.toLowerCase()
	};
});

const out = {
	source: 'NIST ACVP-Server / FIPS 203 keyGen',
	algorithm: 'ML-KEM-1024',
	fips: 'FIPS 203',
	sourceCommit: ACVP_SHA,
	promptUrl: SOURCE_PROMPT,
	expectedUrl: SOURCE_EXPECTED,
	extractedAt: new Date(0).toISOString(),
	hexCase: 'lowercase',
	notes:
		'Vectors are an unmodified slice (tcId 51-55) of NIST ACVP-Server ML-KEM-keyGen-FIPS203. ' +
		'`z` and `d` come from prompt.json; `ek` and `dk` come from expectedResults.json. ' +
		"Noble's `ml_kem1024.keygen()` consumes a 64-byte seed in the order `d || z` (verified empirically; FIPS 203 §6.2 conventions). " +
		'The runtime test asserts byte-for-byte equality against the ACVP-published ek/dk, so any silent upstream change to either noble or this file fails CI.',
	cases
};

const target = join(process.cwd(), 'src/lib/crypto/kat/ml-kem-1024-acvp.json');
await writeFile(target, JSON.stringify(out, null, '\t') + '\n', 'utf8');
console.log(`Wrote ${cases.length} ACVP cases to ${target}`);
console.log(`File size: ${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
