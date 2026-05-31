/**
 * GET /api/akd/epochs/latest — public AKD epoch metadata.
 *
 * Returns the most recently published epoch's root, VRF pubkey,
 * timestamp, and signature. Unauthenticated: every client needs the
 * current epoch to derive its capability handle (Phase D §L09cap).
 *
 * Returns 404 with `{epoch_id: null}` shape when no epoch has been
 * minted yet (preview / fresh-deploy state). Clients are expected
 * to treat that as "AKD not active; use legacy Bearer-token auth"
 * during the migration window.
 *
 * Response body shape (locked — V0-C1 probe consumes this):
 *
 *   {
 *     "ok": true,
 *     "data": {
 *       "epoch_id": <number>,
 *       "root_hex": "<96 hex>",      // SHA-384 of Merkle root
 *       "vrf_pubkey_hex": "<64 hex>",
 *       "signed_at": <unix seconds>,
 *       "signature_hex": "<128 hex>",
 *       "leaf_count": <number>
 *     }
 *   }
 *
 * The response body MUST NOT contain account-correlating data
 * (account_id, client_id, leaf positions for specific accounts).
 */

import type { RequestHandler } from './$types';
import type { Env } from '$lib/server/api/env';
import { currentEpoch } from '$lib/server/api/akd-server';
import { jsonError, jsonOk } from '$lib/server/api/http';

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform!.env as Env;
	try {
		const epoch = await currentEpoch(env);
		if (!epoch) {
			return jsonError(404, 'no epoch published');
		}
		return jsonOk({
			epoch_id: epoch.epochId,
			root_hex: epoch.rootHex,
			vrf_pubkey_hex: epoch.vrfPubkeyHex,
			signed_at: epoch.signedAt,
			signature_hex: epoch.signatureHex,
			leaf_count: epoch.leafCount
		});
	} catch {
		return jsonError(503, 'akd unavailable');
	}
};

export const fallback: RequestHandler = async () => jsonError(405, 'method not allowed');
