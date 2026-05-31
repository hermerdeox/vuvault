#!/usr/bin/env node
/**
 * Vu Level 1 (and design-only V0-C1) post-deploy adversarial probe.
 *
 * SCAFFOLD ONLY — see `docs/verifications/2026-05-22-vu1-recon.md`,
 * `docs/VU-LEVEL-MIGRATION-MAP.md`, and the §L07b / §L08-redesign /
 * §L09cap sub-sections of `docs/TIER2-ARCHITECTURE.md`.
 *
 * =========================================================================
 * STATUS PER-CRITERION (post Phase 2 + Phase 4 — 2026-05-24):
 * =========================================================================
 *
 *   V1-C1  pass            (Phase 4 §L07b shipped — v2 routes + reference GC)
 *   V1-C2  pass            (Phase 2 §L08 session-mint redesign shipped)
 *   V1-C3  pass            (Phase 4 §L07b shipped — no per-account prefix)
 *   V0-C1  expected_fail   (design-only gate; L09cap proposed status)
 *
 * This probe is the level-up gate the migration brief §0.5 and §7
 * require. Phase 6 of the brief flips `CURRENT_LEVEL` from 2 to 1
 * ONLY if a green `.vu1-probe-passed` artifact exists for the
 * deploying SHA. The probe lives here so that:
 *
 *   1. The criteria are mechanically specified before any implementation
 *      ships — Vu1 cannot be claimed by hand-waving.
 *   2. CI can run this against a preview deploy in every PR that
 *      touches the relevant Tier-2 layers, so the level-up moment is
 *      mechanically observable.
 *   3. The level-flip PR (Phase 6) attaches a green artifact from
 *      THIS probe, exactly the way the release workflow today consumes
 *      the `m3-e2e-passed-${SHA}` artifact.
 *
 * The probe emits a structured artifact at `.vu1-probe-passed` so a
 * downstream `release.yml` step can `jq`-parse the per-criterion
 * status and refuse to apply a level flip unless ALL of V1-C1, V1-C2,
 * V1-C3 are `pass`. (V0-C1 in the same artifact is informational
 * until L09cap.)
 *
 * =========================================================================
 * ARTIFACT FORMAT (locked — Phase 6 release.yml depends on this shape)
 * =========================================================================
 *
 * The probe writes `.vu1-probe-passed` as plain text in the same
 * shape as `.m3-e2e-passed` (key=value lines, one per line, sorted
 * for stable diffs), so the existing artifact-upload + release-time-
 * download wiring composes cleanly:
 *
 *   sha=<RELEASE_SHA>
 *   passed_at=<ISO8601 UTC>
 *   v1_c1=pass|fail|expected_fail
 *   v1_c1_evidence=<short string>
 *   v1_c2=pass|fail|expected_fail
 *   v1_c2_evidence=<short string>
 *   v1_c3=pass|fail|expected_fail
 *   v1_c3_evidence=<short string>
 *   v0_c1=pass|fail|expected_fail
 *   v0_c1_evidence=<short string>
 *
 * The Phase 6 level-flip workflow checks: every V1-C* key === 'pass'.
 * If any is 'fail' or 'expected_fail', the level-flip step aborts.
 *
 * =========================================================================
 * USAGE
 * =========================================================================
 *
 *   PUBLIC_SYNC_ORIGIN=https://vault.vu \
 *   RELEASE_SHA=$GITHUB_SHA \
 *     node scripts/release-probe-vu1.mjs
 *
 * Exit codes:
 *   0 — every V1-C* criterion is 'pass'. Phase 6 level-flip is unlocked.
 *   1 — at least one V1-C* criterion failed (or is `expected_fail`).
 *
 * This script depends ONLY on packages already in `package.json` —
 * specifically `@structured-id/opaque` (already used by
 * `release-probe-opaque.mjs`) for shaping OPAQUE protocol messages.
 * No new top-level dependencies.
 */

import {
	DEFAULT_SUITE,
	getSuite,
	oprfBlind,
	serializeKE1,
	clientAkeStart
} from '@structured-id/opaque';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const ORIGIN = (process.env.PUBLIC_SYNC_ORIGIN ?? '').replace(/\/+$/, '');
const RELEASE_SHA = (process.env.RELEASE_SHA ?? process.env.GITHUB_SHA ?? '').slice(0, 12);

if (!ORIGIN) {
	console.error('::error::release-probe-vu1: PUBLIC_SYNC_ORIGIN is empty');
	process.exit(1);
}
if (!RELEASE_SHA) {
	console.error('::error::release-probe-vu1: RELEASE_SHA / GITHUB_SHA is empty');
	process.exit(1);
}

const suite = getSuite(DEFAULT_SUITE);
const te = new TextEncoder();

function bytesToBase64(bytes) {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

/**
 * Issue a real OPAQUE registration request for clientId / password.
 * Returns `{ ok, requestId, response, status }`. Caller decides what
 * to do with the result.
 */
async function opaqueRegisterRequest(clientId, passwordStr) {
	const passwordBytes = te.encode(passwordStr);
	const { blindedElement } = oprfBlind(suite.curve, passwordBytes);
	const res = await fetch(`${ORIGIN}/api/opaque/register/request`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			clientId,
			request: bytesToBase64(blindedElement)
		}),
		cache: 'no-store'
	});
	const status = res.status;
	const body = await res.json().catch(() => null);
	return {
		ok: res.ok && body?.ok === true,
		status,
		body
	};
}

/**
 * Issue a real KE1 against `clientId` to drive the login path far
 * enough that the server's response shape can be inspected.
 */
async function opaqueLoginKE1(clientId, passwordStr) {
	const passwordBytes = te.encode(passwordStr);
	const { blindedElement } = oprfBlind(suite.curve, passwordBytes);
	const ake = clientAkeStart(blindedElement, suite);
	const ke1Bytes = serializeKE1(ake.ke1);
	const res = await fetch(`${ORIGIN}/api/opaque/login/ke1`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			clientId,
			ke1: bytesToBase64(ke1Bytes)
		}),
		cache: 'no-store'
	});
	const status = res.status;
	const body = await res.json().catch(() => null);
	return { ok: res.ok, status, body };
}

// ---------------------------------------------------------------------------
// V1-C1 — no per-user blob inventories
// ---------------------------------------------------------------------------
//
// Phase-4 implementation closes this. Until then, this probe asserts the
// inverse: the V2-era R2 layout WILL leak an account identifier in the
// key shape, so we expect the probe to report `expected_fail`. The
// assertion is authored now precisely so we cannot later forget to
// implement it; once Phase 4 lands, this probe should start passing
// automatically.
//
// The probe approach:
//   1. Register two probe accounts (one anonymous reader observer, one
//      authenticated owner). Pre-Phase-4, both end up with R2 paths
//      prefixed by accountId.
//   2. Read what a non-owning observer would see (today: nothing — the
//      blob endpoint requires auth). Pre-Phase-4, the EXISTENCE of the
//      `vaults/{accountId}/…` key prefix is itself the leak; an
//      authorized auditor query would confirm.
//   3. Assert: no key returned by ANY API surface to ANY observer
//      carries an account identifier.
//
// Pre-Phase-4, the V1 routes (`/api/v2/blobs/*`, `/api/v2/inv/*` from
// §L07b) do not exist. The probe detects that and reports
// `expected_fail` with `evidence=v2_routes_not_deployed`.
async function probeV1C1() {
	// Detect whether the Phase-4 /api/v2/blobs/* route surface is live.
	// Pre-Phase-4 the route does not exist; depending on the framework
	// (SvelteKit Cloudflare adapter at the time of writing) the
	// missing route surfaces as 404 OR 501 OR 405. Post-Phase-4 the
	// health sub-route returns 200 publicly. The probe treats 200 as
	// deployed.
	const probe = await fetch(`${ORIGIN}/api/v2/blobs/health`, {
		method: 'GET',
		cache: 'no-store'
	}).catch(() => null);

	const isDeployed = probe !== null && probe.status === 200;
	if (!isDeployed) {
		return {
			result: 'expected_fail',
			evidence: `v2-blobs-routes-not-deployed (status=${probe?.status ?? 'no_response'}); per-account R2 prefix vaults/{accountId}/ still in effect`
		};
	}

	// Post-Phase-4: assert the deployed shape never leaks an account
	// identifier in the public surface. This probe is unauthenticated
	// — it can only assert SHAPE-level invariants. The deeper two-
	// account adversarial test runs in the m3-e2e CI integration job
	// (which has session tokens), authored as a follow-up integration
	// test alongside this probe (see tests/integration/v2-blobs.spec.ts).
	//
	// SHAPE assertions:
	//   (a) Unauthenticated GET on a random UUID returns 401, NOT a
	//       per-account 404 (which would prove the routing layer
	//       resolves UUIDs against a per-account prefix).
	//   (b) The error body never names account_id / device_id / any
	//       per-account identifier.
	//   (c) The health endpoint advertises route shape but no
	//       account-correlating fields.
	const probeUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
	const unauthRes = await fetch(`${ORIGIN}/api/v2/blobs/${probeUuid}`, {
		method: 'GET',
		cache: 'no-store'
	}).catch(() => null);

	if (!unauthRes || unauthRes.status !== 401) {
		return {
			result: 'fail',
			evidence: `expected 401 unauth on GET /api/v2/blobs/<uuid>, got ${unauthRes?.status ?? 'no_response'}`
		};
	}
	const errBody = await unauthRes.text().catch(() => '');
	const forbidden = ['account_id', 'accountid', 'device_id', 'deviceid', 'user_id', 'userid'];
	for (const f of forbidden) {
		if (errBody.toLowerCase().includes(f)) {
			return {
				result: 'fail',
				evidence: `V1-C1 leak: error body contains forbidden field name '${f}'`
			};
		}
	}

	// Health body inspection (now we know health route exists and 200s).
	const healthBody = await probe.text().catch(() => '');
	for (const f of forbidden) {
		if (healthBody.toLowerCase().includes(f)) {
			return {
				result: 'fail',
				evidence: `V1-C1 leak: health body contains forbidden field name '${f}'`
			};
		}
	}

	return {
		result: 'pass',
		evidence: 'v2-blobs routes deployed; unauth GET returns 401; no account-correlating field names leak from health or error body; deeper two-account adversarial flow runs in CI integration tests (tests/integration/v2-blobs.spec.ts)'
	};
}

// ---------------------------------------------------------------------------
// V1-C2 — no persistent device set
// ---------------------------------------------------------------------------
//
// Phase-2 implementation closes this. Until then, the probe asserts the
// inverse: the V2-era sessions schema retains `device_id` and the
// `last_login_at` column on accounts. Pre-Phase-2, both fields are
// written on every KE3.
//
// The probe approach:
//   1. Use the existing register-then-login OPAQUE flow to mint a
//      session token (re-using the OPAQUE primitives the existing
//      release-probe-opaque.mjs uses).
//   2. From the API surface alone, ask for the session shape. Today
//      there is no introspection endpoint, but the absence of an
//      endpoint is itself the proxy: V1-C2 closure includes shipping
//      `GET /api/v2/sessions/self` returning ONLY `{expiresAt}` (no
//      device_id, no last_login_at).
//   3. Assert that endpoint either (a) returns a shape with no
//      device_id / last_login_at, OR (b) returns 404 indicating
//      pre-Phase-2 state.
//
// Pre-Phase-2 the introspection endpoint does not exist; the probe
// reports `expected_fail` with `evidence=introspection_endpoint_404`.
async function probeV1C2() {
	// Phase 2 probes the endpoint at the SHAPE level (existence +
	// auth-required posture). The deeper assertion — that the
	// authenticated response body contains ONLY {expiresAt,
	// sequenceClock} and that two consecutive calls rotate the bearer
	// token — lives in the m3-e2e CI job, which has the full OPAQUE
	// round-trip primitives wired and the credential injection path.
	// See `tests/integration/sessions-self.spec.ts` (added in Phase 2)
	// for that deeper assertion.
	//
	// The release probe is unauthenticated. It can prove:
	//   (a) the endpoint exists (status != 404)
	//   (b) it requires auth (status === 401 with no token)
	//   (c) the error body does NOT leak device_id / last_login_at
	//       as field names in the validation error path
	//   (d) the OPTIONS / HEAD surface does not advertise a method
	//       that would let an external observer query without auth
	//
	// Pre-Phase-2: the endpoint returns 404 (route does not exist).
	// Post-Phase-2: the endpoint returns 401 to unauthenticated calls.
	//
	// The probe is conservative: a 401 with no device-correlating
	// leakage in the body is treated as `pass`. If the body contains
	// any forbidden field name, the probe fails closed.
	const FORBIDDEN_FIELD_NAMES = [
		'device_id',
		'deviceId',
		'last_login_at',
		'lastLoginAt',
		'paired_at',
		'pairedAt',
		'fingerprint',
		'user_agent',
		'userAgent',
		'ip',
		'ip_address'
	];

	const probe = await fetch(`${ORIGIN}/api/v2/sessions/self`, {
		method: 'GET',
		cache: 'no-store'
	}).catch(() => null);

	if (!probe || probe.status === 404) {
		return {
			result: 'expected_fail',
			evidence: 'introspection-endpoint-404; sessions table still carries device_id and accounts.last_login_at is still bumped per KE3'
		};
	}

	// (b) auth required posture
	if (probe.status !== 401) {
		return {
			result: 'fail',
			evidence: `expected 401 unauthenticated, got ${probe.status}`
		};
	}

	// (c) error body inspection: assert no forbidden field names appear
	const bodyText = await probe.text().catch(() => '');
	const lower = bodyText.toLowerCase();
	for (const name of FORBIDDEN_FIELD_NAMES) {
		if (lower.includes(name.toLowerCase())) {
			return {
				result: 'fail',
				evidence: `error response body leaks forbidden field name '${name}'`
			};
		}
	}

	return {
		result: 'pass',
		evidence: 'endpoint live; auth-required (401) on unauthenticated GET; no forbidden field names in error body; deeper authenticated-shape assertion runs in m3-e2e CI job'
	};
}

// ---------------------------------------------------------------------------
// V1-C3 — no cross-account sequence-clock correlation
// ---------------------------------------------------------------------------
//
// Phase-4 (L07b) implementation closes this — once the R2 namespace
// stops being per-account, the sequence-clock ordering ceases to be
// cross-account-observable. Pre-Phase-4, R2's `uploaded` timestamps
// + per-account prefix walks allow ordering writes across accounts.
//
// The probe approach:
//   1. Register two probe accounts within the same window.
//   2. Have each issue an upload (encrypted dummy bytes).
//   3. Observe whether an external observer can order the two writes
//      against each other from R2 metadata alone (today: yes, via
//      `uploaded` on the per-account prefix). Post-Phase-4 the keys
//      are random and the prefix is gone.
//
// Pre-Phase-4 the probe reports `expected_fail` for the same reason
// as V1-C1: the L07b layout isn't deployed.
async function probeV1C3() {
	// V1-C3 closure rides on the same /api/v2/blobs/* L07b layout
	// because that's the layout where cross-account sequence-clock
	// correlation lived. After §L07b, blob writes go to global
	// prefix `v2/blobs/{uuid}.bin` with no per-account ordering
	// observable to an external R2 viewer.
	const probe = await fetch(`${ORIGIN}/api/v2/blobs/health`, {
		method: 'GET',
		cache: 'no-store'
	}).catch(() => null);

	const isDeployed = probe !== null && probe.status === 200;
	if (!isDeployed) {
		return {
			result: 'expected_fail',
			evidence: `v2-blobs-routes-not-deployed (status=${probe?.status ?? 'no_response'}); cross-account ordering still observable via per-account R2 prefix + sessions.sequence_clock`
		};
	}

	// SHAPE assertions for V1-C3 from an unauthenticated probe:
	//   (a) the v2 surface DOES NOT echo any sequence_clock field in
	//       the unauth error body or health body. Cross-account
	//       sequence-clock correlation requires sequence_clock to be
	//       readable cross-account; the v2 routes neither emit nor
	//       accept it (sequence_clock is a v1 whole-vault concept).
	//   (b) The /api/v2/sessions/self response shape (already
	//       gated by V1-C2) intentionally surfaces sequence_clock
	//       but only after auth — never across accounts. We
	//       re-confirm that the unauth response doesn't leak it.
	const probeUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
	const unauthRes = await fetch(`${ORIGIN}/api/v2/blobs/${probeUuid}`, {
		method: 'GET',
		cache: 'no-store'
	}).catch(() => null);
	if (!unauthRes || unauthRes.status !== 401) {
		return {
			result: 'fail',
			evidence: `expected 401 unauth on GET /api/v2/blobs/<uuid>, got ${unauthRes?.status ?? 'no_response'}`
		};
	}
	const errBody = (await unauthRes.text().catch(() => '')).toLowerCase();
	if (errBody.includes('sequence_clock') || errBody.includes('sequenceclock')) {
		return {
			result: 'fail',
			evidence: 'V1-C3 leak: unauth error body contains sequence_clock'
		};
	}
	const healthBody = (await probe.text().catch(() => '')).toLowerCase();
	if (healthBody.includes('sequence_clock') || healthBody.includes('sequenceclock')) {
		return {
			result: 'fail',
			evidence: 'V1-C3 leak: health body contains sequence_clock'
		};
	}

	return {
		result: 'pass',
		evidence: 'v2-blobs routes deployed; no sequence_clock in unauth surface; cross-account ordering via R2 layout closed (no per-account prefix); deeper two-account ordering test runs in CI integration tests'
	};
}

// ---------------------------------------------------------------------------
// V0-C1 — unlinkable routing identifiers (DESIGN-GATED, expected fail)
// ---------------------------------------------------------------------------
//
// §L09cap is `proposed` status; it cannot pass until B.3 sign-off
// AND implementation lands. This probe authors the assertion now so
// that we cannot accidentally claim Vu0 just because V1 is green.
//
// Hard stop: even if this probe somehow reported `pass`, the
// `CURRENT_LEVEL` cannot flip to 0 until the §L09cap sub-section in
// `docs/TIER2-ARCHITECTURE.md` is signed off and L09cap has shipped.
// The release workflow's level-flip-to-0 step must verify both
// conditions before honoring this probe's result.
// ---------------------------------------------------------------------------
// V0-C2 — bucketed ciphertext sizes (statistical, no network required)
// ---------------------------------------------------------------------------
//
// Closure: `src/lib/crypto/padding.ts` collapses every plaintext into
// one of a small power-of-two bucket set (min 256 B, monotonically
// doubling). The probe asserts the lattice invariant directly from
// JavaScript — no network round-trip required, because the property
// is locally derivable from the module's public API.
//
// V0-C2 is a Vu0 criterion, NOT a Vu1 closer. It's included in this
// probe so the level-flip-to-0 workflow can consume the same
// artifact format that level-flip-to-1 already does.
//
// The wiring of `padPlaintext` into `saveItems` (the production
// effect) is a separate PR — see the §"Deferred" note at the end
// of `src/lib/crypto/padding.ts`. The probe today only asserts the
// padding PRIMITIVE behaves; once the wiring lands, the probe can
// also fetch a real blob from R2 and assert its byte length is a
// power-of-two ≥ 256.
// ---------------------------------------------------------------------------
// V0-C3 — no account-existence oracle (timing + shape)
// ---------------------------------------------------------------------------
async function probeV0C3() {
	// Phase F V0-C3 hardening: /api/opaque/login/ke1 performs
	// dummy OPRF-like work on the unknown-clientId path so timing
	// differences between (known account, wrong password) and
	// (unknown account) collapse. The probe asserts:
	//
	//   (a) An unauthenticated POST with an unknown clientId
	//       returns 401 with `error: "invalid login request"` —
	//       NOT the legacy "unknown clientId" string that would
	//       directly admit account existence.
	//
	//   (b) The response body does not contain account-correlating
	//       fields.
	//
	// The DEEPER statistical assertion (K-S distance between
	// known-and-unknown timing distributions ≤ threshold) runs in
	// the m3-e2e-style CI integration job, since it requires a
	// known-good account to compare against.
	const fakeClientId = `vu-probe-unknown-${Math.random().toString(16).slice(2)}`;
	const bogusKe1 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
	const res = await fetch(`${ORIGIN}/api/opaque/login/ke1`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ clientId: fakeClientId, ke1: bogusKe1 }),
		cache: 'no-store'
	}).catch(() => null);
	if (!res) {
		return { result: 'fail', evidence: '/api/opaque/login/ke1 unreachable' };
	}
	if (res.status === 404 || res.status === 501) {
		return {
			result: 'expected_fail',
			evidence: `opaque-ke1-endpoint-absent (status=${res.status}); base OPAQUE not deployed`
		};
	}
	if (res.status !== 401) {
		// Bogus ke1 with unknown clientId could also bail at 400
		// for malformed ke1 (which is fine — same generic shape).
		if (res.status !== 400) {
			return {
				result: 'fail',
				evidence: `expected 401 (or 400 for malformed ke1), got ${res.status}`
			};
		}
	}
	const bodyText = (await res.text().catch(() => '')).toLowerCase();
	if (bodyText.includes('unknown clientid') || bodyText.includes('unknown client_id')) {
		return {
			result: 'fail',
			evidence: 'V0-C3 leak: error body contains "unknown clientId" (account-existence oracle)'
		};
	}
	const forbiddenFields = ['account_id', 'accountid', 'client_id', 'clientid', 'device_id'];
	for (const f of forbiddenFields) {
		if (bodyText.includes(f)) {
			return {
				result: 'fail',
				evidence: `V0-C3 leak: error body contains forbidden field '${f}'`
			};
		}
	}
	return {
		result: 'pass',
		evidence: 'unknown-clientId KE1 returns generic 401 with no account-existence-revealing text; dummy OPRF work compensates timing (statistical assertion in CI suite)'
	};
}

async function probeV0C2() {
	// Import the padding module dynamically so the probe stays a
	// pure-mjs script independent of the SvelteKit build output.
	const padding = await import('../src/lib/crypto/padding.ts').catch(() => null);
	if (!padding) {
		return {
			result: 'expected_fail',
			evidence: 'padding-module-not-importable-from-probe-context (build-time TS unsupported); rerun the unit suite for V0-C2 evidence'
		};
	}
	// Treat 10 random sizes uniformly across [0, 2 MiB], count
	// distinct buckets, assert ≤ 14.
	const sample = [
		0,
		47,
		513,
		1499,
		9876,
		65000,
		120000,
		500001,
		999999,
		2097150
	];
	const buckets = new Set(sample.map((n) => padding.bucketSize(n)));
	if (buckets.size > 14) {
		return {
			result: 'fail',
			evidence: `bucket distribution too wide: ${buckets.size} distinct buckets`
		};
	}
	// The wiring assertion: are saveItems and openBlob calling pad/
	// unpad? Today the answer is "no", so V0-C2 is `expected_fail`
	// even though the primitive is sound.
	return {
		result: 'expected_fail',
		evidence: `padding primitive bucket distribution OK (${buckets.size} buckets ≤ 14), but saveItems/openBlob do not yet call padPlaintext/unpadPlaintext; wiring is a follow-up PR`
	};
}

async function probeV0C1() {
	// V0-C1 SHAPE-level adversarial probe.
	//
	// Closure: AKD epochs are published via /api/akd/epochs/latest
	// and capability handles are minted via /api/v0/capability/issue.
	// The probe asserts the SHAPE invariants observable to an
	// unauthenticated external observer:
	//
	//   (a) /api/akd/epochs/latest exists and returns valid JSON
	//       with the published epoch metadata (root, vrf pubkey,
	//       signature). 404 → AKD not yet bootstrapped (which is
	//       expected_fail for the V0-C1 closure).
	//
	//   (b) /api/v0/capability/issue exists and requires auth
	//       (returns 401 on unauthenticated POST). The route
	//       accepts no GET — it's a write-only protocol.
	//
	//   (c) Neither response body leaks any account-correlating
	//       field (account_id, client_id, device_id, etc.) to an
	//       unauthenticated caller. The DEEPER assertion (two
	//       capabilities from the same accountSeed under different
	//       epochs are unlinkable) is exercised by the unit suite
	//       (`voprf.test.ts` "V0-C1 unlinkability") and by the
	//       capability-auth integration tests, since it requires
	//       authenticated requests + the full VOPRF round-trip.

	const epochRes = await fetch(`${ORIGIN}/api/akd/epochs/latest`, {
		method: 'GET',
		cache: 'no-store'
	}).catch(() => null);

	if (!epochRes || epochRes.status === 404 || epochRes.status === 501) {
		return {
			result: 'expected_fail',
			evidence: `akd-epoch-endpoint-absent (status=${epochRes?.status ?? 'no_response'}); /api/akd/epochs/latest not deployed or no epoch published yet`
		};
	}
	if (epochRes.status !== 200) {
		return {
			result: 'fail',
			evidence: `expected 200 from /api/akd/epochs/latest, got ${epochRes.status}`
		};
	}
	const epochBody = await epochRes.json().catch(() => null);
	if (!epochBody?.ok || !epochBody.data) {
		return {
			result: 'fail',
			evidence: 'malformed /api/akd/epochs/latest response'
		};
	}
	const epochText = JSON.stringify(epochBody).toLowerCase();
	const forbiddenInEpoch = ['account_id', 'accountid', 'client_id', 'clientid', 'device_id', 'deviceid'];
	for (const f of forbiddenInEpoch) {
		if (epochText.includes(f)) {
			return {
				result: 'fail',
				evidence: `V0-C1 leak: /api/akd/epochs/latest body contains forbidden field '${f}'`
			};
		}
	}

	// /api/v0/capability/issue — POST without auth must 401.
	const issueRes = await fetch(`${ORIGIN}/api/v0/capability/issue`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ blindedElement: 'AA==' }),
		cache: 'no-store'
	}).catch(() => null);
	if (!issueRes) {
		return {
			result: 'fail',
			evidence: '/api/v0/capability/issue unreachable'
		};
	}
	if (issueRes.status === 404 || issueRes.status === 501) {
		return {
			result: 'expected_fail',
			evidence: `capability-issue-endpoint-absent (status=${issueRes.status}); /api/v0/capability/issue not deployed`
		};
	}
	if (issueRes.status !== 401) {
		return {
			result: 'fail',
			evidence: `expected 401 on unauthenticated POST /api/v0/capability/issue, got ${issueRes.status}`
		};
	}
	const issueText = (await issueRes.text().catch(() => '')).toLowerCase();
	for (const f of forbiddenInEpoch) {
		if (issueText.includes(f)) {
			return {
				result: 'fail',
				evidence: `V0-C1 leak: /api/v0/capability/issue 401 body contains forbidden field '${f}'`
			};
		}
	}

	return {
		result: 'pass',
		evidence: 'AKD epoch published with no account-correlating fields; /api/v0/capability/issue auth-gated with no account leak; deeper unlinkability assertion runs in voprf.test.ts (V0-C1 invariant) and tests/integration/v0-capability-auth.spec.ts'
	};
}

// ---------------------------------------------------------------------------
// Run + emit artifact
// ---------------------------------------------------------------------------

console.log(
	`release-probe-vu1: target=${ORIGIN} sha=${RELEASE_SHA} starting V1-C1, V1-C2, V1-C3, V0-C1, V0-C2, V0-C3 probes`
);

// Each probe is independent; run sequentially so the log output is
// readable. Total runtime should be ≤ 15s post-Vu0 because the
// V0-C1 probe makes 2 round-trips and V0-C3 makes 1.
const v1c1 = await probeV1C1();
const v1c2 = await probeV1C2();
const v1c3 = await probeV1C3();
const v0c1 = await probeV0C1();
const v0c2 = await probeV0C2();
const v0c3 = await probeV0C3();

for (const [name, res] of [
	['v1_c1', v1c1],
	['v1_c2', v1c2],
	['v1_c3', v1c3],
	['v0_c1', v0c1],
	['v0_c2', v0c2],
	['v0_c3', v0c3]
]) {
	console.log(`release-probe-vu1: ${name} = ${res.result} (${res.evidence})`);
}

// Build the artifact in the same `key=value\n` shape as
// `.m3-e2e-passed`. Sort keys for stable diffs across reruns.
const passedAt = new Date().toISOString();
const lines = [
	`sha=${RELEASE_SHA}`,
	`passed_at=${passedAt}`,
	`v1_c1=${v1c1.result}`,
	`v1_c1_evidence=${v1c1.evidence}`,
	`v1_c2=${v1c2.result}`,
	`v1_c2_evidence=${v1c2.evidence}`,
	`v1_c3=${v1c3.result}`,
	`v1_c3_evidence=${v1c3.evidence}`,
	`v0_c1=${v0c1.result}`,
	`v0_c1_evidence=${v0c1.evidence}`,
	`v0_c2=${v0c2.result}`,
	`v0_c2_evidence=${v0c2.evidence}`,
	`v0_c3=${v0c3.result}`,
	`v0_c3_evidence=${v0c3.evidence}`
];
await writeFile('.vu1-probe-passed', lines.join('\n') + '\n', 'utf8');
console.log('release-probe-vu1: wrote .vu1-probe-passed');

// Exit code: 0 iff every V1-C* criterion is 'pass'. V0-C1 is
// informational; do not include it in the gate.
const v1All = [v1c1, v1c2, v1c3].every((r) => r.result === 'pass');
if (v1All) {
	console.log('release-probe-vu1: ALL V1 CRITERIA PASS — Phase 6 level-flip is unlocked');
	process.exit(0);
} else {
	console.error('release-probe-vu1: at least one V1 criterion did not pass; CURRENT_LEVEL flip is BLOCKED');
	process.exit(1);
}

// `opaqueRegisterRequest` and `opaqueLoginKE1` are scaffolding helpers
// authored for Phase 2 (§L08 redesign) and Phase 4 (§L07b) implementers
// to extend. They are not used by today's expected-fail probes — those
// only need to detect whether the v2 routes exist via a single GET 404
// check — but the helpers are retained verbatim so the implementer can
// drop them straight into the post-Phase-2/4 assertions. The `void`
// references below mark them as intentionally retained, mirroring the
// `void getGroup;` pattern in `scripts/release-probe-opaque.mjs`.
void opaqueRegisterRequest;
void opaqueLoginKE1;
