/**
 * WebAuthn PRF — passkey-bound key derivation.
 *
 * Per WebAuthn Level 3, the `prf` extension lets a relying party
 * derive a stable 32-byte secret bound to the authenticator and
 * a salt. This is the foundation for "Touch ID derives the vault key
 * without round-trip to a server".
 *
 * Coverage as of 2026:
 *   - Apple iOS 18 / macOS 15+ (platform authenticator)
 *   - Windows 11 25H2 (Hello)
 *   - Chrome 147+ on Android with Play Services
 *   - YubiKey 5+ (cross-platform)
 *
 * If the browser/device doesn't support WebAuthn at all, callers must
 * surface that and offer the explicit `demo` path. Production builds
 * fail closed — there is no silent fallback.
 */

import { getRpId, isM3E2eAuthEnabled } from '$lib/utils/env';

const RP_NAME = 'VuVault';
const M3_E2E_SECRET = new TextEncoder().encode('vuvault-m3-e2e-prf-shim-v1');

export type PasskeyResult = {
	credentialId: ArrayBuffer;
	publicKey: ArrayBuffer;
	prfSupported: boolean;
	/**
	 * Some authenticators return a PRF output during registration when
	 * the `prf.eval` extension is present. When non-null, callers can
	 * skip a second user-verification ceremony at provision time.
	 */
	prfOutput: Uint8Array | null;
};

export type RegisterFailure =
	| { kind: 'unsupported' } // no WebAuthn API in this environment
	| { kind: 'declined'; cause?: unknown } // user dismissed / canceled
	| { kind: 'failed'; cause: unknown }; // unexpected error

export type RegisterOutcome =
	| { ok: true; result: PasskeyResult }
	| { ok: false; reason: RegisterFailure };

export function isWebAuthnSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'PublicKeyCredential' in window &&
		typeof navigator !== 'undefined' &&
		!!navigator.credentials
	);
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
	if (!isWebAuthnSupported()) return false;
	try {
		const fn = (
			PublicKeyCredential as unknown as {
				isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
			}
		).isUserVerifyingPlatformAuthenticatorAvailable;
		if (typeof fn !== 'function') return false;
		return await fn.call(PublicKeyCredential);
	} catch {
		return false;
	}
}

/**
 * Register a passkey. If `prfSalt` is provided, also requests a PRF
 * eval at registration so the caller can immediately derive a vault
 * key without a second user-verification ceremony.
 */
export async function registerPasskey(opts: {
	deviceLabel: string;
	userId?: Uint8Array;
	prfSalt?: Uint8Array;
}): Promise<RegisterOutcome> {
	if (isM3E2eAuthEnabled() && opts.prfSalt) {
		const credentialId = crypto.getRandomValues(new Uint8Array(32));
		const prfOutput = await deriveM3E2ePrf(credentialId, opts.prfSalt);
		return {
			ok: true,
			result: {
				credentialId: credentialId.buffer.slice(
					credentialId.byteOffset,
					credentialId.byteOffset + credentialId.byteLength
				),
				publicKey: new ArrayBuffer(0),
				prfSupported: true,
				prfOutput
			}
		};
	}
	if (!isWebAuthnSupported()) {
		return { ok: false, reason: { kind: 'unsupported' } };
	}

	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const userId = opts.userId ?? crypto.getRandomValues(new Uint8Array(16));

	const prfExt = opts.prfSalt
		? { prf: { eval: { first: opts.prfSalt as BufferSource } } }
		: { prf: {} };

	try {
		const cred = (await navigator.credentials.create({
			publicKey: {
				challenge: challenge as BufferSource,
				// `rp.id` MUST be set explicitly — see env.ts. A passkey
				// registered without an explicit id binds to the
				// origin's hostname. If we ever moved hosts (vuvault.app
				// → app.vuvault.app) without setting rp.id, every
				// existing passkey would be invalidated. Hardcoding
				// the production rp.id here makes that invariant
				// auditable in code review.
				rp: { id: getRpId(), name: RP_NAME },
				user: {
					id: userId as BufferSource,
					name: 'vault-user',
					displayName: opts.deviceLabel || 'Vault user'
				},
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 }, // ES256
					{ type: 'public-key', alg: -257 } // RS256
				],
				// Note: `authenticatorAttachment` is intentionally NOT
				// set to 'platform' here. Restricting to platform
				// authenticators would exclude documented YubiKey 5+
				// support. Leaving it unset lets the user pick either
				// the platform authenticator (Touch ID, Windows Hello)
				// or a roaming security key.
				authenticatorSelection: {
					userVerification: 'required',
					residentKey: 'preferred'
				},
				timeout: 30_000,
				extensions: prfExt as AuthenticationExtensionsClientInputs
			} as PublicKeyCredentialCreationOptions
		})) as PublicKeyCredential | null;

		if (!cred) {
			return { ok: false, reason: { kind: 'declined' } };
		}

		const ext = cred.getClientExtensionResults?.();
		const prf = ext as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
		const prfSupported = Boolean(prf?.prf?.enabled);
		const firstOutput = prf?.prf?.results?.first;

		const result: PasskeyResult = {
			credentialId: cred.rawId,
			publicKey:
				(cred.response as AuthenticatorAttestationResponse).getPublicKey?.() ??
				new ArrayBuffer(0),
			prfSupported,
			prfOutput: firstOutput ? new Uint8Array(firstOutput) : null
		};
		return { ok: true, result };
	} catch (err) {
		const name = (err as { name?: string })?.name;
		if (name === 'NotAllowedError' || name === 'AbortError') {
			return { ok: false, reason: { kind: 'declined', cause: err } };
		}
		console.warn('Passkey registration failed:', err);
		return { ok: false, reason: { kind: 'failed', cause: err } };
	}
}

export async function evaluatePRF(opts: {
	credentialId: ArrayBuffer;
	salt: Uint8Array;
}): Promise<Uint8Array | null> {
	if (isM3E2eAuthEnabled()) {
		return deriveM3E2ePrf(new Uint8Array(opts.credentialId), opts.salt);
	}
	if (!isWebAuthnSupported()) return null;

	const challenge = crypto.getRandomValues(new Uint8Array(32));

	try {
		const assertion = (await navigator.credentials.get({
			publicKey: {
				challenge: challenge as BufferSource,
				allowCredentials: [{ id: opts.credentialId, type: 'public-key' }],
				userVerification: 'required',
				timeout: 30_000,
				extensions: {
					prf: { eval: { first: opts.salt as BufferSource } }
				} as AuthenticationExtensionsClientInputs
			} as PublicKeyCredentialRequestOptions
		})) as PublicKeyCredential | null;

		if (!assertion) return null;

		const ext = assertion.getClientExtensionResults?.();
		const prfResults = (ext as { prf?: { results?: { first?: ArrayBuffer } } })?.prf?.results;
		if (!prfResults?.first) return null;

		return new Uint8Array(prfResults.first);
	} catch (err) {
		console.warn('PRF evaluation failed:', err);
		return null;
	}
}

async function deriveM3E2ePrf(credentialId: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		M3_E2E_SECRET,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const input = new Uint8Array(credentialId.length + salt.length);
	input.set(credentialId, 0);
	input.set(salt, credentialId.length);
	const mac = await crypto.subtle.sign('HMAC', key, input);
	return new Uint8Array(mac).slice(0, 32);
}
