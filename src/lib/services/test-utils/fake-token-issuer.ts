/**
 * Test double for the anonymous-token issuer (`/api/v0/tokens/*`), for
 * fetch-mocked client tests. Runs the real VOPRF math from
 * `$lib/crypto/voprf` under a fixed test key, so tokens minted through
 * it are verified exactly the way `anon-tokens.ts` verifies them, and
 * tracks spent inputs so tests can assert single use.
 */

import {
	blindEvaluate,
	deriveSecretKey,
	evaluate,
	publicKey as voprfPublicKey
} from '$lib/crypto/voprf';

function b64(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
	return btoa(bin);
}

function unb64(text: string): Uint8Array {
	const bin = atob(text);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

export function createFakeTokenIssuer(keyId = 1) {
	const secretKey = deriveSecretKey(new TextEncoder().encode('vuvault-test-token-key'));
	const publicKey = b64(voprfPublicKey(secretKey));
	const spent = new Set<string>();
	let issued = 0;

	return {
		get issuedCount(): number {
			return issued;
		},
		get spentCount(): number {
			return spent.size;
		},

		/**
		 * Answer the token routes; returns null for any other URL so the
		 * caller's own mock can handle it.
		 */
		handle(url: string, method: string, body: string | undefined): Response | null {
			if (url.endsWith('/api/v0/tokens/key') && method === 'GET') {
				return json(200, { ok: true, data: { keyId, publicKey } });
			}
			if (url.endsWith('/api/v0/tokens/issue') && method === 'POST') {
				const blinded = (JSON.parse(body ?? '{}') as { blinded?: string[] }).blinded ?? [];
				const evaluated: string[] = [];
				const proofs: string[] = [];
				for (const element of blinded) {
					const out = blindEvaluate(secretKey, unb64(publicKey), unb64(element));
					evaluated.push(b64(out.evaluatedElement));
					proofs.push(b64(out.proof));
				}
				issued += blinded.length;
				return json(200, { ok: true, data: { keyId, publicKey, evaluated, proofs } });
			}
			return null;
		},

		/** Verify and spend an `x-vu0-token` header value. */
		redeem(header: string | null): boolean {
			const m = /^v1\.(\d+)\.([^.]+)\.([^.]+)$/.exec(header ?? '');
			if (!m || Number(m[1]) !== keyId) return false;
			const input = unb64(m[2]!);
			const expected = b64(evaluate(secretKey, input));
			if (expected !== m[3] || spent.has(m[2]!)) return false;
			spent.add(m[2]!);
			return true;
		}
	};
}
