/**
 * GET /api/capabilities
 *
 * Returns `SyncCapabilities` so clients can discover what this
 * deployment supports. Public (no auth required) so onboarding can
 * decide whether to attempt OPAQUE registration.
 *
 * Migrated from `functions/api/capabilities.ts` to a SvelteKit
 * `+server.ts` route. The Cloudflare Pages Functions runtime cannot
 * coexist with SvelteKit's adapter-cloudflare `_worker.js`, so every
 * /api/* handler now lives inside the SvelteKit Worker and gets
 * bindings via `platform.env`.
 */

import type { RequestHandler } from './$types';
import { jsonError, jsonOk } from '$lib/server/api/http';

const CAPS = {
	opaque: true,
	blobSync: true,
	// L08 ECDH device pairing arrives in a follow-up PR within
	// Tier 2. Post-0004 the Worker stores no per-device identifier
	// at all — login mints a session token unbound to any device.
	// See `docs/VU-LEVEL-MIGRATION-MAP.md` V1-C2.
	deviceEnrollment: false,
	// L09 CONIKS / AKD transparency log is Tier 3 (2028).
	transparencyLog: false
};

export const GET: RequestHandler = async () => {
	return jsonOk(CAPS);
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
