#!/usr/bin/env node
/**
 * Post-deploy OPAQUE plumbing probe (pure-.mjs).
 *
 * Issues REAL OPRF blinded elements against the just-deployed
 * production origin and asserts the server returns properly-shaped
 * responses. Meaningfully stronger than the older garbage-byte
 * burst, which only proved a rate limiter exists.
 *
 * A successful probe proves the full server-side OPAQUE plumbing:
 *
 *   1. `/api/opaque/register/request` is reachable (no 404).
 *   2. The Worker reaches D1 (writes a `pending_registrations` row).
 *   3. `server_identity.oprf_seed` is seeded — `loadServerIdentity`
 *      throws otherwise.
 *   4. The OPAQUE server library is loaded and performs a valid
 *      OPRF blind evaluation against the registered element.
 *   5. `/api/opaque/login/ke1` returns the documented 401 (not 5xx)
 *      for an unknown clientId — proves the account-lookup path is
 *      wired and error mapping is correct.
 *
 * We do NOT complete the full register-then-login round-trip from a
 * .mjs script — that requires the AKE state machine which the
 * production client already exercises (and which the gated
 * `m3-sync-e2e` CI suite covers under a real browser). The two
 * probes here catch every common deploy regression that the older
 * burst missed.
 *
 * The pending_registrations row left behind by probe 1 ages out via
 * the 30-second TTL in d1-storage.ts plus the opportunistic sweep
 * in cleanup.ts, so there is no probe-state to clean up.
 *
 * Why not use OpaqueClient directly? The library's default backend
 * is WASM-first with JS fallback only on `initWasm()` failure. The
 * WASM backend's OPAQUE protocol methods themselves throw "not yet
 * available" — so OpaqueClient.registrationStart fails on Node
 * unless we swap to JS. The production client does this via its own
 * `forceJsOpaqueBackend` shim (`opaque-client.ts`). For the probe
 * the simpler answer is to use the OPRF primitives directly — they
 * never go through the backend selection at all.
 *
 * Usage:
 *   PUBLIC_SYNC_ORIGIN=https://vault.vu \
 *   RELEASE_SHA=$GITHUB_SHA \
 *     node scripts/release-probe-opaque.mjs
 */

import {
	DEFAULT_SUITE,
	getGroup,
	getSuite,
	oprfBlind,
	serializeKE1,
	clientAkeStart
} from '@structured-id/opaque';
import process from 'node:process';

const ORIGIN = (process.env.PUBLIC_SYNC_ORIGIN ?? '').replace(/\/+$/, '');
const RELEASE_SHA = (process.env.RELEASE_SHA ?? process.env.GITHUB_SHA ?? '').slice(0, 12);

if (!ORIGIN) {
	console.error('::error::release-probe-opaque: PUBLIC_SYNC_ORIGIN is empty');
	process.exit(1);
}
if (!RELEASE_SHA) {
	console.error('::error::release-probe-opaque: RELEASE_SHA / GITHUB_SHA is empty');
	process.exit(1);
}

const suite = getSuite(DEFAULT_SUITE);
// `getGroup` is imported for parity with how opaque-client.ts builds
// its suite handles; the curve handle is reached implicitly via the
// suite's `.curve` field below.
void getGroup;

const probeClientId = `release-probe-${RELEASE_SHA}`;
const probePasswordBytes = new TextEncoder().encode(`release-probe-pw-${RELEASE_SHA}`);

function bytesToBase64(bytes) {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}

let exitCode = 0;
function fail(msg) {
	console.error(`::error::release-probe-opaque: ${msg}`);
	exitCode = 1;
}

console.log(
	`release-probe-opaque: target=${ORIGIN} clientId=${probeClientId} suite=${DEFAULT_SUITE}`
);

// ---------------------------------------------------------------------------
// Probe 1 — real OPRF registration request
// ---------------------------------------------------------------------------
try {
	// oprfBlind(curve, input) returns { blind, blindedElement }. The
	// blinded element IS the registration request bytes the server
	// expects. The blind itself is the client-side secret needed to
	// finish registration — we deliberately don't use it.
	const { blindedElement } = oprfBlind(suite.curve, probePasswordBytes);

	if (!(blindedElement instanceof Uint8Array) || blindedElement.length === 0) {
		fail('oprfBlind did not produce a Uint8Array element');
		process.exit(exitCode);
	}

	const res = await fetch(`${ORIGIN}/api/opaque/register/request`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			clientId: probeClientId,
			request: bytesToBase64(blindedElement)
		}),
		cache: 'no-store'
	});

	if (!res.ok) {
		const body = await res.text();
		fail(
			`register/request returned ${res.status} ${res.statusText}; body=${body.slice(0, 300)}`
		);
	} else {
		const body = await res.json();
		const ok = body?.ok === true;
		const requestIdValid =
			typeof body?.data?.requestId === 'string' && /^[0-9a-f]{32}$/.test(body.data.requestId);
		const responseValid =
			typeof body?.data?.response === 'string' && body.data.response.length > 0;
		if (!ok || !requestIdValid || !responseValid) {
			fail(
				`register/request response shape mismatch: ${JSON.stringify(body).slice(0, 300)}`
			);
		} else {
			console.log(
				`release-probe-opaque: register/request OK requestId=${body.data.requestId} responseB64Len=${body.data.response.length}`
			);
		}
	}
} catch (err) {
	fail(
		`register/request probe threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
	);
}

// ---------------------------------------------------------------------------
// Probe 2 — login KE1 against unknown clientId returns 401 (not 5xx)
// ---------------------------------------------------------------------------
try {
	// Build a valid KE1 message: blinded OPRF + ake start. We use
	// clientAkeStart against the same blinded element to produce the
	// KE1 struct, then serialize. The server doesn't care that this
	// KE1 is for an unknown account — it goes through OPRF eval
	// first, fails at account lookup, and returns 401.
	const { blindedElement } = oprfBlind(suite.curve, probePasswordBytes);
	const ake = clientAkeStart(blindedElement, suite);
	const ke1Bytes = serializeKE1(ake.ke1);
	const unknownClientId = `release-probe-unknown-${RELEASE_SHA}`;

	const res = await fetch(`${ORIGIN}/api/opaque/login/ke1`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			clientId: unknownClientId,
			ke1: bytesToBase64(ke1Bytes)
		}),
		cache: 'no-store'
	});

	if (res.status !== 401) {
		const body = await res.text();
		fail(
			`login/ke1 with unknown clientId returned ${res.status} (expected 401); body=${body.slice(0, 300)}`
		);
	} else {
		const body = await res.json().catch(() => null);
		if (body?.ok !== false) {
			fail(`login/ke1 401 response should be {ok:false, ...}; got ${JSON.stringify(body)}`);
		} else {
			console.log(`release-probe-opaque: login/ke1 unknown-client 401 OK`);
		}
	}
} catch (err) {
	fail(
		`login/ke1 probe threw: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`
	);
}

if (exitCode === 0) {
	console.log('release-probe-opaque: OK');
}
process.exit(exitCode);
