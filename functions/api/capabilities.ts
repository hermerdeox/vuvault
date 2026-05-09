/**
 * GET /api/capabilities
 *
 * Returns `SyncCapabilities` so clients can discover what this
 * deployment supports. Public (no auth required) so onboarding can
 * decide whether to attempt OPAQUE registration.
 */

import type { Env } from './_shared/env';
import { jsonError, jsonOk } from './_shared/http';

const CAPS = {
	opaque: true,
	blobSync: true,
	// L08 ECDH device pairing arrives in a follow-up PR within
	// Tier 2; today the Worker only knows about devices through
	// the `deviceId` claim attached to login.
	deviceEnrollment: false,
	// L09 CONIKS / AKD transparency log is Tier 3 (2028).
	transparencyLog: false
};

export const onRequestGet: PagesFunction<Env> = async () => {
	return jsonOk(CAPS);
};

export const onRequest: PagesFunction<Env> = async () => jsonError(405, 'method not allowed');
