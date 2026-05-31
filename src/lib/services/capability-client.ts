/**
 * Client-side §L09cap capability minting + cache.
 *
 * Public API:
 *   - `mintCapability(accountSeed)` — runs the three-message VOPRF
 *     protocol against the server's current epoch, derives a 32-byte
 *     capability handle, commits it to the server, and caches it
 *     by epoch in module scope.
 *
 *   - `currentCapability()` — returns the cached handle for the
 *     current epoch if one was minted, otherwise null.
 *
 *   - `clearCapabilityCache()` — drops the module-scope cache
 *     (called on lock).
 *
 * The cache is per-epoch: minting in epoch N caches under
 * `epoch:N`. When `mintCapability` is called and a fresh epoch has
 * rolled, the cache is invalidated automatically and a new
 * capability is minted.
 *
 * Cap derivation:
 *   capability = capabilityFromVoprfOutput(voprfFinalize(seed, …))
 *
 * The capability handle is 32 bytes; we hex-encode it for the
 * `X-Vu0-Capability` header.
 */

import { blind, finalize, capabilityFromVoprfOutput } from '$lib/crypto/voprf';
import { getSyncOrigin, isSyncOriginConfigured } from '$lib/utils/env';
import { bytesToHex } from '$lib/crypto/ed25519-vrf';

/**
 * The cached capability for an epoch. `epochId` matches the server-
 * published epoch the capability was minted against; `capabilityHex`
 * is what goes on the wire in the `X-Vu0-Capability` header.
 */
export type CapabilityRecord = {
	epochId: number;
	capabilityHex: string;
	mintedAt: number;
};

let cached: CapabilityRecord | null = null;

export function currentCapability(): CapabilityRecord | null {
	return cached;
}

export function clearCapabilityCache(): void {
	cached = null;
}

function b64encode(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function b64decode(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/**
 * Mint a fresh per-epoch capability handle for `accountSeed`.
 *
 * The handle is unlinkable to handles minted under different epoch
 * OPRF keys. The server stores the (epoch, capability) → account
 * mapping in `capability_index` (D1 table) so subsequent V2 route
 * requests can be authenticated by capability without recreating
 * the OPAQUE handshake.
 *
 * Requires:
 *   - `accountSeed`: 32 bytes (from `account.accountSeed`)
 *   - An active Bearer token in `sync-client.ts` module state, set
 *     by `setSessionToken` after OPAQUE login. The /api/v0/...
 *     route auth-checks this; the `mintCapability` helper just
 *     supplies it via the standard `call()` flow.
 *
 * Returns the freshly minted record, or throws on a server failure
 * (proof verification, network error, no published epoch). The
 * caller (sync-client) is responsible for retry logic.
 */
export async function mintCapability(
	accountSeed: Uint8Array,
	bearerToken: string
): Promise<CapabilityRecord> {
	if (!isSyncOriginConfigured()) {
		throw new Error('mintCapability: sync origin not configured');
	}
	if (accountSeed.length !== 32) {
		throw new Error('mintCapability: accountSeed must be 32 bytes');
	}
	const origin = getSyncOrigin();
	const headers: HeadersInit = {
		'content-type': 'application/json',
		authorization: `Bearer ${bearerToken}`
	};

	// Step 1: blind.
	const { blind: blindScalar, blindedElement } = blind(accountSeed);

	// Step 2: POST blinded element to server.
	const issueRes = await fetch(`${origin}/api/v0/capability/issue`, {
		method: 'POST',
		credentials: 'omit',
		cache: 'no-store',
		headers,
		body: JSON.stringify({ blindedElement: b64encode(blindedElement) })
	});
	if (!issueRes.ok) {
		throw new Error(`mintCapability: issue failed (status ${issueRes.status})`);
	}
	const issueBody = (await issueRes.json()) as {
		ok: boolean;
		data?: {
			epoch_id: number;
			evaluatedElement: string;
			proof: string;
			publicKey: string;
		};
	};
	if (!issueBody.ok || !issueBody.data) {
		throw new Error('mintCapability: malformed issue response');
	}
	const { epoch_id: epochId } = issueBody.data;
	const evaluatedElement = b64decode(issueBody.data.evaluatedElement);
	const proof = b64decode(issueBody.data.proof);
	const publicKey = b64decode(issueBody.data.publicKey);

	// Step 3: finalize locally. Verifies the DLEQ proof; returns
	// null if the server cheated.
	const oprfOutput = finalize(accountSeed, blindScalar, evaluatedElement, proof, publicKey);
	if (!oprfOutput) {
		throw new Error('mintCapability: server proof verification failed');
	}

	const capability = capabilityFromVoprfOutput(oprfOutput);
	const capabilityHex = bytesToHex(capability);

	// Step 4: POST commit so the server records the mapping.
	const commitRes = await fetch(`${origin}/api/v0/capability/issue`, {
		method: 'POST',
		credentials: 'omit',
		cache: 'no-store',
		headers,
		body: JSON.stringify({
			commit: { epoch_id: epochId, capability_hex: capabilityHex }
		})
	});
	if (!commitRes.ok) {
		throw new Error(`mintCapability: commit failed (status ${commitRes.status})`);
	}

	// Zeroize transient buffers (best-effort; the blindScalar may
	// linger in the GC heap but we own this buffer directly).
	blindScalar.fill(0);
	oprfOutput.fill(0);

	const record: CapabilityRecord = {
		epochId,
		capabilityHex,
		mintedAt: Date.now()
	};
	cached = record;
	return record;
}
