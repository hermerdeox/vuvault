/**
 * Public env constants and runtime bundle-integrity verifier.
 *
 * `PUBLIC_BUNDLE_HASH` is the canonical SHA-384 of the per-chunk
 * manifest (see scripts/build-manifest.mjs). CI computes this hash
 * during `npm run build`, then runs the build a second time with the
 * value injected into `PUBLIC_BUNDLE_HASH`. The runtime verifier in
 * `verifyBundleIntegrity()` fetches `/_app/immutable/bundle-manifest.json`
 * (same-origin only — explicitly whitelisted in CI's network-call
 * guard), recomputes each chunk's SHA-384 in the browser, and
 * compares the canonical aggregate to `PUBLIC_BUNDLE_HASH`.
 *
 * Honest framing: the verifier runs inside the bundle it is verifying,
 * so a fully malicious origin can lie. This is a tripwire against
 * silent CDN/middlebox swaps; the printed bundle hash + Sigstore Rekor
 * link gives users an out-of-band path for high-assurance verification.
 *
 * `PUBLIC_ENABLE_DEMO_AUTH` is an opt-in dev flag that allows demo-mode
 * provisioning. Production builds MUST leave this unset/false. The CI
 * pipeline asserts this for production deploys.
 */

import { browser, dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';

const PLACEHOLDER_BUNDLE_HASH = '9f4c7d2e8b16a4f122e0d5c83a7e91b4';

export const PUBLIC_BUNDLE_HASH =
	publicEnv.PUBLIC_BUNDLE_HASH || PLACEHOLDER_BUNDLE_HASH;
export const PUBLIC_VAULT_VERSION = publicEnv.PUBLIC_VAULT_VERSION || '0.1.0';
export const PUBLIC_M3_E2E_AUTH = publicEnv.PUBLIC_M3_E2E_AUTH || 'false';

// Fingerprint-style short version for UI
export const BUNDLE_HASH_SHORT = PUBLIC_BUNDLE_HASH.slice(0, 8);

/**
 * The runtime public env is served by the adapter as `/_app/env.js`,
 * which the CDN edge may cache across releases (observed: a week-old
 * copy, `cf-cache-status: HIT`). The module import above is therefore
 * only a *hint*: the authoritative per-release hash is read from the
 * same origin-served module with a cache-busting query, which the edge
 * cannot answer from its cache. `verifyBundleIntegrity` compares the
 * recomputed digest against that; the baked value is the fallback when
 * the fresh read fails (offline, captive portal).
 *
 * This does not weaken the tripwire: both the manifest (`no-store`) and
 * the fresh env come from the origin, so an attacker who can only poison
 * the edge cache cannot make a tampered bundle verify, and one who
 * controls the origin already defeats an in-bundle verifier (see the
 * honest framing above).
 */
const ENV_PATH = '/_app/env.js';
const ENV_HASH_RE = /"PUBLIC_BUNDLE_HASH"\s*:\s*"([0-9a-f]{96})"/;
let resolvedBundleHash = PUBLIC_BUNDLE_HASH;
let freshEnvHashPromise: Promise<string | null> | null = null;

async function fetchFreshEnvHash(): Promise<string | null> {
	if (!browser || typeof fetch !== 'function') return null;
	try {
		const bust = Math.random().toString(36).slice(2, 12);
		const res = await fetch(`${ENV_PATH}?integrity=${bust}`, { cache: 'no-store' });
		if (!res.ok) return null;
		const hash = ENV_HASH_RE.exec(await res.text())?.[1] ?? null;
		if (hash) resolvedBundleHash = hash;
		return hash;
	} catch {
		return null;
	}
}

/**
 * Resolve this release's bundle hash past any stale edge copy of the
 * runtime env. One fetch per page load; `null` when it cannot be read.
 */
export function ensureFreshBundleHash(): Promise<string | null> {
	if (!freshEnvHashPromise) freshEnvHashPromise = fetchFreshEnvHash();
	return freshEnvHashPromise;
}

/** The bundle hash to print or display: fresh when known, baked otherwise. */
export function currentBundleHash(): string {
	return resolvedBundleHash;
}

/**
 * Whether demo auth (the deterministic-PRF stand-in) is permitted in
 * this build. Defaults to OFF. Demo auth is only enabled when:
 *
 *   1. `dev` is true (vite dev / SvelteKit dev mode), OR
 *   2. `PUBLIC_ENABLE_DEMO_AUTH=true` is set at build time.
 *
 * The build/CI pipeline must NOT set the env var for production
 * deployments. A dedicated CI guard fails if production-tagged builds
 * embed `PUBLIC_ENABLE_DEMO_AUTH=true`.
 */
export function isDemoAuthEnabled(): boolean {
	if (dev) return true;
	const v = (publicEnv.PUBLIC_ENABLE_DEMO_AUTH ?? '').toLowerCase();
	return v === 'true' || v === '1' || v === 'yes';
}

/**
 * CI-only authenticator shim for the M3 D1/R2 E2E path. It lets
 * Playwright exercise the production OPAQUE branch without depending
 * on host biometric hardware. Production preflight rejects this flag.
 */
export function isM3E2eAuthEnabled(): boolean {
	const v = PUBLIC_M3_E2E_AUTH.toLowerCase();
	return v === 'true' || v === '1' || v === 'yes';
}

/**
 * The Cloudflare Worker origin the client talks to for OPAQUE +
 * blob sync. Empty string (or unset) means local-only mode —
 * `sync-client.ts` short-circuits every method to `NOT_WIRED` and
 * `vault-session.ts` operates against IndexedDB only.
 *
 * Production deploys set this from the deploy step (release.yml)
 * to the same origin the SPA is served from. Preview builds leave
 * it empty.
 */
export function getSyncOrigin(): string {
	const v = (publicEnv.PUBLIC_SYNC_ORIGIN ?? '').trim();
	// In dev mode, default to the current origin so a developer
	// running both `npm run dev` and a local Wrangler dev server
	// can flip on sync without rebuilding. Empty string still wins
	// in dev if the user explicitly set it to nothing.
	if (!v && dev) {
		if (typeof window !== 'undefined' && window.location?.origin) {
			return window.location.origin;
		}
	}
	return v;
}

/**
 * Whether sync is wired in the build. The dev/preview default is
 * empty; the release workflow sets `PUBLIC_SYNC_ORIGIN` to the
 * deployed origin so production unconditionally returns true.
 */
export function isSyncOriginConfigured(): boolean {
	return getSyncOrigin() !== '';
}

/**
 * The WebAuthn Relying Party ID (`rp.id`) bound to every passkey we
 * register. Critical invariant: a passkey registered with one rp.id
 * is permanently unusable from another rp.id. Hardcode the production
 * domain here; dev / preview builds fall back to the current origin's
 * hostname so localhost development works, but those passkeys are
 * intentionally non-portable to production.
 *
 * Set `PUBLIC_RP_ID` to override (e.g. for staging at `staging.vuvault.app`).
 * The chosen id MUST be either the page's origin or a registrable
 * suffix of it; the browser rejects anything else.
 */
const PRODUCTION_RP_ID = 'vuvault.app';

export function getRpId(): string {
	const override = (publicEnv.PUBLIC_RP_ID ?? '').trim();
	if (override) return override;
	if (dev) {
		// On dev/localhost, return the current hostname so the
		// browser accepts the registration. We deliberately don't
		// fall back to PRODUCTION_RP_ID here — using `vuvault.app` from
		// localhost would be rejected as not-an-origin-suffix.
		if (typeof window !== 'undefined' && window.location?.hostname) {
			return window.location.hostname;
		}
		return 'localhost';
	}
	return PRODUCTION_RP_ID;
}

export type BundleManifest = {
	version: number;
	algorithm: 'SHA-384';
	generatedAt: string;
	hashes: Record<string, string>;
};

export type BundleIntegrity = {
	expected: string;
	expectedShort: string;
	state: 'placeholder' | 'verified' | 'mismatch' | 'unsupported';
	rekorUrl: string;
	/** Manifest path that failed the per-chunk check, when state === 'mismatch'. */
	mismatchedChunk?: string;
	/** Recomputed aggregate digest, regardless of state. */
	computed?: string;
	/**
	 * True when the runtime env module the page loaded carried a
	 * different hash than the origin serves now — a stale edge copy. The
	 * comparison then ran against the fresh value.
	 */
	staleEnv?: boolean;
};

const MANIFEST_PATH = '/_app/immutable/bundle-manifest.json';

function bytesToHex(bytes: Uint8Array): string {
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i]!.toString(16).padStart(2, '0');
	}
	return hex;
}

async function digestSha384(bytes: BufferSource): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-384', bytes);
	return bytesToHex(new Uint8Array(buf));
}

/**
 * In dev or when the build-time `PUBLIC_BUNDLE_HASH` was never
 * injected we return `placeholder` so the unlock UI shows an honest
 * "verification not yet wired" badge instead of a fake green check.
 *
 * In a real build, fetches the manifest, verifies every chunk's
 * SHA-384, and returns `verified` only if the canonical aggregate
 * digest matches `PUBLIC_BUNDLE_HASH`. Anything else returns `mismatch`
 * with the offending chunk path attached.
 *
 * Environments without `crypto.subtle.digest` (very old WebViews) get
 * `unsupported`; the unlock screen treats that as a hard refuse.
 */
export async function verifyBundleIntegrity(): Promise<BundleIntegrity> {
	if (!browser) {
		// SSR pre-render passes never have a real hash to compare against.
		return {
			expected: PUBLIC_BUNDLE_HASH,
			expectedShort: BUNDLE_HASH_SHORT,
			state: 'placeholder',
			rekorUrl: `https://search.sigstore.dev/?hash=${PUBLIC_BUNDLE_HASH}`
		};
	}

	// Read the per-release hash past any stale edge copy (see ENV_PATH).
	const fresh = await ensureFreshBundleHash();
	const expected = fresh ?? PUBLIC_BUNDLE_HASH;
	const staleEnv = fresh !== null && fresh !== PUBLIC_BUNDLE_HASH;
	const rekorUrl = `https://search.sigstore.dev/?hash=${expected}`;
	const expectedShort = expected.slice(0, 8);

	if (expected === PLACEHOLDER_BUNDLE_HASH) {
		// `dev` builds never have a real build-time hash. Surface honestly.
		return { expected, expectedShort, state: 'placeholder', rekorUrl, staleEnv };
	}

	if (typeof crypto === 'undefined' || !crypto.subtle) {
		return { expected, expectedShort, state: 'unsupported', rekorUrl, staleEnv };
	}

	let manifest: BundleManifest;
	try {
		const res = await fetch(MANIFEST_PATH, { cache: 'no-store' });
		if (!res.ok) {
			return {
				expected,
				expectedShort,
				state: 'mismatch',
				rekorUrl,
				mismatchedChunk: MANIFEST_PATH,
				staleEnv
			};
		}
		manifest = (await res.json()) as BundleManifest;
	} catch {
		return {
			expected,
			expectedShort,
			state: 'mismatch',
			rekorUrl,
			mismatchedChunk: MANIFEST_PATH,
			staleEnv
		};
	}

	if (
		!manifest ||
		manifest.algorithm !== 'SHA-384' ||
		typeof manifest.hashes !== 'object'
	) {
		return {
			expected,
			expectedShort,
			state: 'mismatch',
			rekorUrl,
			mismatchedChunk: MANIFEST_PATH,
			staleEnv
		};
	}

	// Parallel chunk verification — the per-chunk SHA-384 work runs
	// independently and `crypto.subtle.digest` is heavily optimized.
	// Sequential awaiting added 50–200 ms per unlock on cold cache for
	// no security benefit; the first mismatch wins regardless.
	const entries = Object.entries(manifest.hashes);
	const chunkResults = await Promise.all(
		entries.map(async ([path, expected]): Promise<string | null> => {
			try {
				const res = await fetch(path, { cache: 'force-cache' });
				if (!res.ok) return path;
				const buf = await res.arrayBuffer();
				const got = await digestSha384(buf);
				return got === expected ? null : path;
			} catch {
				return path;
			}
		})
	);
	const firstMismatch = chunkResults.find((r): r is string => r !== null);
	if (firstMismatch) {
		return {
			expected,
			expectedShort,
			state: 'mismatch',
			rekorUrl,
			mismatchedChunk: firstMismatch,
			staleEnv
		};
	}

	// Recompute the aggregate over the canonicalized manifest text.
	// `JSON.stringify(manifest) + '\n'` matches the build-time emitter
	// in scripts/build-manifest.mjs byte-for-byte.
	const canonical = JSON.stringify({
		version: manifest.version,
		algorithm: manifest.algorithm,
		generatedAt: manifest.generatedAt,
		hashes: manifest.hashes
	}) + '\n';
	const computed = await digestSha384(new TextEncoder().encode(canonical));

	if (computed !== expected) {
		return {
			expected,
			expectedShort,
			state: 'mismatch',
			rekorUrl,
			mismatchedChunk: MANIFEST_PATH,
			computed,
			staleEnv
		};
	}

	return { expected, expectedShort, state: 'verified', rekorUrl, computed, staleEnv };
}
