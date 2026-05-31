/**
 * Bucketed padding for vault blob ciphertext lengths.
 *
 * Purpose (V0-C2 — `docs/VU-LEVEL-MIGRATION-MAP.md`): a passive
 * observer of R2 should not be able to distinguish two accounts'
 * vault sizes from each other once ciphertext lengths fall into one
 * of a small finite set of buckets.
 *
 * Strategy: pad every plaintext up to the next power-of-two ≥ 256
 * bytes, with a 4-byte big-endian length prefix preserved INSIDE the
 * padded plaintext (so the receiver can recover the original length
 * without expanding the AAD format).
 *
 * Why a length prefix instead of an AAD field:
 *
 *   - The current v2 vault envelope's AAD (see `makeAad` in
 *     `vault-session.ts`) is a stable, signed-off shape. Adding a
 *     new AAD field would bump the format version (v3) and force a
 *     migration of every existing v2 vault. That's a separate PR.
 *   - A length prefix lives ENTIRELY inside the encrypted plaintext.
 *     It is invisible to any observer with only ciphertext access,
 *     and the AAD format remains v2. Wiring into `saveItems`
 *     therefore needs no envelope-format change.
 *
 * Threat scope:
 *
 *   - Defends against: passive R2-observer bucket-fingerprinting that
 *     would otherwise let an adversary distinguish "small vault"
 *     (<1KB) from "large vault" (>10KB) ciphertexts.
 *   - Does NOT defend against: an active observer who can correlate
 *     write timestamps across accounts. Phase 4 §L07b (per-blob
 *     random keys + non-prefixed R2 layout) covers that.
 *
 * This module is the V0-C2 primitive. Wiring it into `saveItems` is
 * a follow-up PR (see the §"Deferred" note at the end of this file).
 */

export const MIN_BUCKET_BYTES = 256;

/**
 * Maximum bucket size in bytes. Above this, the caller should fail
 * rather than allocate a 2^31-byte buffer. 2 GiB is a soft ceiling
 * far above any expected vault size; in practice we never even
 * approach the 64-MiB bucket.
 */
// 2 ** 31 (not `1 << 31`, which is the 32-bit-signed `-0x80000000`).
export const MAX_BUCKET_BYTES = 2 ** 31; // 2 GiB

/**
 * The 4-byte length prefix consumes 4 bytes of every padded
 * plaintext. The smallest plaintext is therefore 1 byte (which still
 * pads up to the 256-byte bucket).
 */
const LENGTH_PREFIX_BYTES = 4;

/**
 * Return the next power-of-two ≥ max(length + 4, MIN_BUCKET_BYTES).
 * The +4 accounts for the LENGTH_PREFIX_BYTES we always prepend.
 *
 * The buckets are therefore:
 *
 *   256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
 *   131072, 262144, 524288, 1048576, 2097152, … up to MAX_BUCKET_BYTES
 *
 * The V0-C2 probe asserts that 10 random sizes drawn from a wide
 * range fall into at most 14 distinct buckets (so the probe is
 * tight: 14 buckets covers MIN_BUCKET through 2 MiB).
 */
export function bucketSize(plaintextLength: number): number {
	if (!Number.isInteger(plaintextLength) || plaintextLength < 0) {
		throw new Error('bucketSize: plaintextLength must be a non-negative integer');
	}
	const target = Math.max(plaintextLength + LENGTH_PREFIX_BYTES, MIN_BUCKET_BYTES);
	if (target > MAX_BUCKET_BYTES) {
		throw new Error(
			`bucketSize: target ${target} exceeds MAX_BUCKET_BYTES ${MAX_BUCKET_BYTES}`
		);
	}
	// Next power of two ≥ target. JavaScript numbers are double-
	// precision so bit shifts are safe up to 2^53.
	let size = MIN_BUCKET_BYTES;
	while (size < target) size *= 2;
	return size;
}

/**
 * Pad `plaintext` for sealing. Returns a new Uint8Array of length
 * `bucketSize(plaintext.length)` whose first 4 bytes encode the
 * original length (big-endian), bytes 4..4+plaintext.length hold the
 * original payload, and the tail is zero-filled.
 *
 * The caller seals the RETURNED buffer (not the original) and the
 * receiver passes the unsealed output through `unpadPlaintext` to
 * recover the original payload.
 */
export function padPlaintext(plaintext: Uint8Array): Uint8Array {
	if (plaintext.length > MAX_BUCKET_BYTES - LENGTH_PREFIX_BYTES) {
		throw new Error('padPlaintext: plaintext exceeds maximum bucket size');
	}
	const size = bucketSize(plaintext.length);
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	view.setUint32(0, plaintext.length, false); // big-endian
	out.set(plaintext, LENGTH_PREFIX_BYTES);
	// Bytes [LENGTH_PREFIX_BYTES + plaintext.length, size) stay 0.
	return out;
}

/**
 * Recover the original plaintext from a padded buffer produced by
 * `padPlaintext`. Throws on malformed input — specifically when the
 * declared original length would overflow the padded buffer or when
 * the padded buffer's length is not a valid bucket size.
 *
 * Defensive: we do NOT trust the length prefix to be ≤ the buffer.
 * An attacker who can produce malformed plaintexts (e.g., by
 * forging AAD-bypass paths) might claim original_length = 0xFFFFFFFF
 * to trigger a slice that walks past memory. We validate
 * `originalLength + 4 ≤ padded.length`.
 */
export function unpadPlaintext(padded: Uint8Array): Uint8Array {
	if (padded.length < MIN_BUCKET_BYTES) {
		throw new Error(
			`unpadPlaintext: padded buffer ${padded.length} < MIN_BUCKET_BYTES ${MIN_BUCKET_BYTES}`
		);
	}
	if (padded.length > MAX_BUCKET_BYTES) {
		// Defense-in-depth: a length > 2 GiB shouldn't appear in
		// practice (the encryption envelope wouldn't fit), but if it
		// did we'd be at risk of treating an attacker-controlled
		// buffer as a "valid" bucket and reading 32-bit lengths off
		// it. Reject before any DataView access.
		throw new Error(
			`unpadPlaintext: padded buffer ${padded.length} > MAX_BUCKET_BYTES ${MAX_BUCKET_BYTES}`
		);
	}
	if (!isPowerOfTwo(padded.length)) {
		// Bucket sizes are exactly powers of two — see `bucketSize`.
		// Anything else is malformed.
		throw new Error(
			`unpadPlaintext: padded buffer length ${padded.length} is not a valid bucket size`
		);
	}
	const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
	const originalLength = view.getUint32(0, false);
	if (originalLength + LENGTH_PREFIX_BYTES > padded.length) {
		throw new Error(
			`unpadPlaintext: declared length ${originalLength} exceeds bucket ${padded.length}`
		);
	}
	// Defensive copy — do not return a slice of the caller's buffer
	// because subsequent zeroize calls in vault-session.ts assume the
	// returned plaintext is independently owned.
	const out = new Uint8Array(originalLength);
	out.set(padded.subarray(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + originalLength));
	return out;
}

function isPowerOfTwo(n: number): boolean {
	return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Enumerate every bucket from MIN_BUCKET_BYTES up to (and including)
 * the next-power-of-two ≥ `maxSize`. Used by the V0-C2 probe and the
 * unit tests to count distinct buckets across a sample of payload
 * sizes.
 */
export function enumerateBuckets(maxSize: number): number[] {
	if (!Number.isInteger(maxSize) || maxSize < 0) {
		throw new Error('enumerateBuckets: maxSize must be a non-negative integer');
	}
	const top = bucketSize(maxSize);
	const out: number[] = [];
	for (let size = MIN_BUCKET_BYTES; size <= top; size *= 2) {
		out.push(size);
	}
	return out;
}

// Deferred wiring note:
//
// `saveItems` in `src/lib/services/vault-session.ts` does NOT call
// `padPlaintext` yet. Wiring is intentionally a separate PR because:
//
//   1. Padding becomes effective only if every WRITER in the
//      account's history padded — otherwise the bucket distribution
//      mixes padded and unpadded sizes. We need a feature-flag /
//      format-version handshake so older clients keep reading.
//   2. The recovery + rotation flows (`rotateAuth`, `saveExistingAccountAndVault`)
//      both seal payloads; all of them need to pad.
//   3. The deserialization side (`openBlob` in `vault-session.ts`)
//      must call `unpadPlaintext`. Wiring is mechanical but it
//      touches every read path.
//
// V0-C2 closure REQUIRES that wiring. The Vu1 flip in Phase 6 does
// not (V0-C2 is a Vu0 criterion). Padding ships as an isolated
// primitive here; the wiring PR can then land alongside the
// format-version bump if needed.
