/**
 * Argon2id (RFC 9106) — Layer L05 master-password third factor.
 *
 * Optional. When a user opts into a master password (via the post-
 * onboarding Settings flow), `deriveMasterPasswordKey()` stretches
 * that password into a 32-byte key that gets folded into the
 * `deriveVaultKey()` IKM alongside the WebAuthn PRF and the Secret
 * Key. This is a defense in depth: even if both PRF and Secret Key
 * leak (e.g. a malicious browser extension on this exact device),
 * the attacker still has to brute-force Argon2id at the configured
 * cost to recover the vault.
 *
 * Cost preset: `VAULT_HIGH_PARAMS` = 256 MiB memory, 4 passes,
 * parallelism 1, 32-byte tag. This is well above OWASP's published
 * Argon2id minimum recommendations (m=46 MiB t=1 p=1) and above
 * libsodium's INTERACTIVE band (m=64 MiB t=2 p=1), but below
 * libsodium's SENSITIVE band (m=1024 MiB t=4 p=1). It is chosen so
 * the WASM allocation (~256 MiB linear memory + JIT/page overhead)
 * still survives the per-tab memory cap on iOS Safari, while
 * forcing serious GPU/ASIC cost on offline brute-force. p=1 is a
 * deliberate choice — multi-lane parallelism gives an attacker a
 * speedup on parallel-attack hardware, so the OWASP cheat sheet
 * recommends p=1 for stored credentials.
 *
 * Parameters are snapshotted into the account row at enable-time so
 * a future preset bump never locks an existing user out — the row
 * carries its own params.
 *
 * REVIEW: new runtime dep `argon2id@1.0.1` (OpenPGP.js, RFC 9106,
 * pre-approved for M2). The package ships SIMD + non-SIMD WASM with
 * automatic fallback for Safari. Pin is exact; CI guards against
 * silent upgrades.
 */

// REVIEW: new runtime dep — see header comment.
import setupWasm from 'argon2id/lib/setup.js';

export type Argon2idParams = {
	memoryKiB: number; // memorySize in KiB; VAULT_HIGH preset = 262144
	iterations: number; // passes; VAULT_HIGH = 4
	parallelism: number; // lanes; VAULT_HIGH = 1 (per OWASP cheat sheet)
	tagLength: number; // output bytes; we use 32
};

/**
 * VuVault's master-password preset. Intended for master-password
 * stretching where ~2–3s on a modern laptop and ~1 GiB peak browser
 * memory pressure is acceptable. Snapshotted into the account row
 * so a future preset bump never locks an existing user out — the
 * row carries its own params.
 */
export const VAULT_HIGH_PARAMS: Argon2idParams = {
	memoryKiB: 262144,
	iterations: 4,
	parallelism: 1,
	tagLength: 32
};

/**
 * Faster preset for tests and browsers that fall back to a non-WASM
 * polyfill. Do NOT use for real master passwords.
 */
export const TEST_PARAMS: Argon2idParams = {
	memoryKiB: 1024,
	iterations: 2,
	parallelism: 1,
	tagLength: 32
};

type ComputeHash = (input: {
	password: Uint8Array;
	salt: Uint8Array;
	parallelism: number;
	passes: number;
	memorySize: number;
	tagLength: number;
	ad?: Uint8Array;
	secret?: Uint8Array;
}) => Uint8Array;

/**
 * Lazy WASM loader. Runs once per process; subsequent calls reuse
 * the same `computeHash` function returned by `setupWasm`.
 *
 * - In the browser, fetches the WASM files from the static `/argon2id/`
 *   path (we copy them in at install via `static/argon2id/*.wasm`).
 * - In Node (tests), reads them from `node_modules/argon2id/dist`.
 *
 * Both branches funnel through the same `setupWasm(getSIMD, getNonSIMD)`
 * factory, which auto-detects SIMD support and falls back as needed.
 */
let computeHashPromise: Promise<ComputeHash> | null = null;

async function getComputeHash(): Promise<ComputeHash> {
	if (computeHashPromise) return computeHashPromise;
	computeHashPromise = (async () => {
		const isNode =
			typeof process !== 'undefined' &&
			!!(process as unknown as { versions?: { node?: string } }).versions
				?.node &&
			typeof window === 'undefined';

		if (isNode) {
			const fs = await import('node:fs/promises');
			const path = await import('node:path');
			const url = await import('node:url');
			// Resolve relative to argon2id's package.json so this works
			// from any cwd.
			const cwd = process.cwd();
			const simdPath = path.join(cwd, 'node_modules/argon2id/dist/simd.wasm');
			const nonSimdPath = path.join(cwd, 'node_modules/argon2id/dist/no-simd.wasm');
			const simdBytes = await fs.readFile(simdPath);
			const nonSimdBytes = await fs.readFile(nonSimdPath);
			void url; // keep import for future fallback resolution
			return setupWasm(
				(importObject) => WebAssembly.instantiate(simdBytes, importObject),
				(importObject) => WebAssembly.instantiate(nonSimdBytes, importObject)
			);
		}

		// Browser: stream-compile from /argon2id/. The files are
		// fingerprint-stable so the cache is durable. CI's
		// network-call guard whitelists this single path.
		return setupWasm(
			async (importObject) => {
				const res = await fetch('/argon2id/simd.wasm');
				const bytes = await res.arrayBuffer();
				return WebAssembly.instantiate(bytes, importObject);
			},
			async (importObject) => {
				const res = await fetch('/argon2id/no-simd.wasm');
				const bytes = await res.arrayBuffer();
				return WebAssembly.instantiate(bytes, importObject);
			}
		);
	})();
	return computeHashPromise;
}

/**
 * Reset the cached WASM module. Tests use this to re-deallocate
 * the 64MB Argon2id memory between large hashes per the upstream
 * recommendation.
 */
export function _resetArgon2(): void {
	computeHashPromise = null;
}

export type DeriveMasterPasswordOpts = {
	password: string;
	salt: Uint8Array; // 16 bytes recommended; we accept any non-empty
	params?: Argon2idParams;
	/**
	 * Optional Argon2id "secret" input (`K` in RFC 9106 §3.1). The
	 * production master-password flow does NOT use this — it is
	 * exposed only so the RFC 9106 §5.3 known-answer test can drive
	 * the WASM with the full RFC input set. When omitted, falls
	 * through to the same code path used in production.
	 */
	secret?: Uint8Array;
	/**
	 * Optional Argon2id "associated data" input (`X` in RFC 9106 §3.1).
	 * Same reasoning as `secret`.
	 */
	ad?: Uint8Array;
	/**
	 * Optional raw-bytes mode for KAT testing. When `true`, `password`
	 * is interpreted as a hex string and decoded byte-for-byte instead
	 * of UTF-8 encoded. Production callers should leave this `false`.
	 */
	rawHexPassword?: boolean;
};

function fromHex(s: string): Uint8Array {
	const out = new Uint8Array(s.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

/**
 * Stretch a master password into a 32-byte key suitable for the
 * `masterPasswordKey` slot in `deriveVaultKey`. The password and
 * salt are passed through untouched; the result lives in a fresh
 * `Uint8Array` that the caller is responsible for zeroizing once
 * folded into the HKDF chain.
 */
export async function deriveMasterPasswordKey(
	opts: DeriveMasterPasswordOpts
): Promise<Uint8Array> {
	if (!opts.password) {
		throw new Error('deriveMasterPasswordKey: password must be non-empty');
	}
	if (!opts.salt || opts.salt.length === 0) {
		throw new Error('deriveMasterPasswordKey: salt must be non-empty');
	}
	const params = opts.params ?? VAULT_HIGH_PARAMS;
	if (params.tagLength !== 32) {
		// We deliberately constrain the API to 32-byte output to keep
		// it drop-in compatible with `deriveVaultKey.masterPasswordKey`.
		throw new Error('deriveMasterPasswordKey: tagLength must be 32');
	}
	const compute = await getComputeHash();
	const passwordBytes = opts.rawHexPassword
		? fromHex(opts.password)
		: new TextEncoder().encode(opts.password);
	try {
		return compute({
			password: passwordBytes,
			salt: opts.salt,
			parallelism: params.parallelism,
			passes: params.iterations,
			memorySize: params.memoryKiB,
			tagLength: params.tagLength,
			ad: opts.ad,
			secret: opts.secret
		});
	} finally {
		passwordBytes.fill(0);
	}
}

export function generateMasterPasswordSalt(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(16));
}
