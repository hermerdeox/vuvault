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
 *   5. `/api/opaque/login/ke1` answers an unknown clientId with 200
 *      and a full-length KE2, exactly like a real account (V0-C3: the
 *      engine runs the AKE against a fake record) — proves the login
 *      path is wired and is not an account-existence oracle.
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
	envelopeSize,
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

	// GitHub runners share egress IPs, so the production register
	// rate bucket (10/min per IP, fail-closed) is regularly exhausted
	// before the probe's FIRST request — it has now failed four
	// release runs in a row while production was verifiably healthy.
	// On 429, wait out the sliding window and retry instead of
	// failing the deploy record. Any other status stays fatal.
	const RATE_LIMIT_RETRIES = 3;
	const RATE_WINDOW_MS = 65_000;
	let res;
	for (let attempt = 0; ; attempt++) {
		res = await fetch(`${ORIGIN}/api/opaque/register/request`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				clientId: probeClientId,
				request: bytesToBase64(blindedElement)
			}),
			cache: 'no-store'
		});
		if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES) break;
		console.log(
			`release-probe-opaque: register/request 429 (shared runner IP) — waiting ${RATE_WINDOW_MS / 1000}s for the rate window, retry ${attempt + 1}/${RATE_LIMIT_RETRIES}`
		);
		await new Promise((r) => setTimeout(r, RATE_WINDOW_MS));
	}

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
// Probe 2 — login KE1 against unknown clientId answers like a real account
// ---------------------------------------------------------------------------
try {
	// Build a valid KE1 message: blinded OPRF + ake start. We use
	// clientAkeStart against the same blinded element to produce the
	// KE1 struct, then serialize. An unknown clientId gets a fake
	// record (V0-C3), so the server must answer 200 with a KE2 of the
	// same length a real account's has. A 401 here would mean the
	// account-existence oracle is back.
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

	if (res.status !== 200) {
		const body = await res.text();
		fail(
			`login/ke1 with unknown clientId returned ${res.status} (expected 200, same as a real account); body=${body.slice(0, 300)}`
		);
	} else {
		const body = await res.json().catch(() => null);
		// KE2 = credential response (evaluated element, masking nonce,
		// masked server key + envelope) + server nonce, keyshare and MAC.
		const expectedKe2 =
			suite.elementSize + suite.nonceSize + suite.elementSize + envelopeSize(suite) +
			suite.nonceSize + suite.elementSize + suite.macSize;
		const ke2Len = typeof body?.data?.ke2 === 'string' ? atob(body.data.ke2).length : 0;
		if (body?.ok !== true || typeof body?.data?.requestId !== 'string') {
			fail(`login/ke1 unknown-client response shape mismatch: ${JSON.stringify(body).slice(0, 300)}`);
		} else if (ke2Len !== expectedKe2) {
			fail(`login/ke1 unknown-client KE2 is ${ke2Len} bytes, expected ${expectedKe2}`);
		} else {
			console.log(`release-probe-opaque: login/ke1 unknown-client 200 with ${ke2Len}-byte KE2 OK`);
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
