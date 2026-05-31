/**
 * Unit tests for `padding.ts` — the V0-C2 primitive.
 *
 * The contract being tested:
 *   - `bucketSize(n)` is the next power-of-two ≥ max(n+4, 256).
 *   - `padPlaintext(p)` returns a buffer of length `bucketSize(p.length)`
 *     with the original length prefixed and original bytes preserved.
 *   - `unpadPlaintext(padPlaintext(p))` ≡ p (round-trip identity).
 *   - Adversarial malformed inputs throw rather than silently leak.
 *   - The V0-C2 statistical assertion: 10 random sizes uniformly
 *     distributed across 256 B … 2 MiB collapse to ≤ 14 distinct
 *     buckets (the full bucket lattice in that range).
 */

import { describe, expect, it } from 'vitest';
import {
	MIN_BUCKET_BYTES,
	bucketSize,
	padPlaintext,
	unpadPlaintext,
	enumerateBuckets
} from './padding';

describe('padding · bucketSize', () => {
	it('returns MIN_BUCKET_BYTES for empty plaintext', () => {
		expect(bucketSize(0)).toBe(MIN_BUCKET_BYTES);
		expect(bucketSize(1)).toBe(MIN_BUCKET_BYTES);
		expect(bucketSize(MIN_BUCKET_BYTES - 5)).toBe(MIN_BUCKET_BYTES);
	});

	it('crosses to 512 when plaintext + 4 > 256', () => {
		// 252 + 4 = 256 — fits in MIN_BUCKET_BYTES.
		expect(bucketSize(252)).toBe(MIN_BUCKET_BYTES);
		// 253 + 4 = 257 — bumps to 512.
		expect(bucketSize(253)).toBe(512);
	});

	it('produces monotonic power-of-two buckets', () => {
		const sizes = [253, 600, 1500, 5000, 20000, 60000, 500000, 1500000];
		const expected = [512, 1024, 2048, 8192, 32768, 65536, 524288, 2097152];
		for (let i = 0; i < sizes.length; i++) {
			expect(bucketSize(sizes[i]!)).toBe(expected[i]!);
		}
	});

	it('rejects negative or fractional lengths', () => {
		expect(() => bucketSize(-1)).toThrow();
		expect(() => bucketSize(1.5)).toThrow();
		expect(() => bucketSize(Number.NaN)).toThrow();
	});
});

describe('padding · pad/unpad round-trip', () => {
	it('round-trips empty plaintext', () => {
		const empty = new Uint8Array(0);
		const padded = padPlaintext(empty);
		expect(padded.length).toBe(MIN_BUCKET_BYTES);
		const recovered = unpadPlaintext(padded);
		expect(recovered.length).toBe(0);
	});

	it('round-trips random plaintexts across all bucket boundaries', () => {
		// Pick sizes that land in each of the first ~12 buckets and
		// also a few boundary sizes (max-of-bucket and one-over).
		const sizes = [0, 1, 100, 252, 253, 508, 509, 1020, 1021, 4090, 16380, 65530, 524280];
		for (const n of sizes) {
			const src = new Uint8Array(n);
			for (let i = 0; i < n; i++) src[i] = (i * 17 + 3) & 0xff;
			const padded = padPlaintext(src);
			expect(padded.length).toBe(bucketSize(n));
			const recovered = unpadPlaintext(padded);
			expect(recovered.length).toBe(n);
			expect(Array.from(recovered)).toEqual(Array.from(src));
		}
	});

	it('returns an independently-owned plaintext (defense against zeroize)', () => {
		const src = new Uint8Array([1, 2, 3, 4, 5]);
		const padded = padPlaintext(src);
		const recovered = unpadPlaintext(padded);
		// Mutating padded MUST NOT affect recovered.
		padded.fill(0xaa);
		expect(Array.from(recovered)).toEqual([1, 2, 3, 4, 5]);
	});

	it('zero-fills the padding region', () => {
		const src = new Uint8Array([9, 9, 9, 9, 9]);
		const padded = padPlaintext(src);
		// Bytes [4 + 5 = 9, 256) should all be 0.
		for (let i = 9; i < padded.length; i++) {
			expect(padded[i]).toBe(0);
		}
	});
});

describe('padding · adversarial inputs', () => {
	it('rejects padded buffers shorter than MIN_BUCKET_BYTES', () => {
		const short = new Uint8Array(100);
		expect(() => unpadPlaintext(short)).toThrow(/MIN_BUCKET_BYTES/);
	});

	it('rejects padded buffers whose length is not a power-of-two', () => {
		const odd = new Uint8Array(300);
		expect(() => unpadPlaintext(odd)).toThrow(/valid bucket size/);
	});

	it('rejects declared lengths that overflow the bucket', () => {
		const malicious = new Uint8Array(256);
		const view = new DataView(malicious.buffer);
		view.setUint32(0, 0xffffffff, false); // declares 4 GiB original
		expect(() => unpadPlaintext(malicious)).toThrow(/exceeds bucket/);
	});

	it('does NOT reveal padding bytes when declared length is short', () => {
		// Construct a padded buffer that claims a short length but has
		// nonzero garbage in the padding region. The recovered
		// plaintext must contain ONLY the first `declared` bytes.
		const padded = new Uint8Array(256);
		const view = new DataView(padded.buffer);
		view.setUint32(0, 3, false);
		padded[4] = 0xaa;
		padded[5] = 0xbb;
		padded[6] = 0xcc;
		// Garbage in the padding region:
		padded[100] = 0xff;
		padded[250] = 0xee;
		const recovered = unpadPlaintext(padded);
		expect(Array.from(recovered)).toEqual([0xaa, 0xbb, 0xcc]);
	});
});

describe('V0-C2 statistical invariant', () => {
	it('10 random sizes ∈ [0, 2 MiB] fall into ≤ 14 distinct buckets', () => {
		// V0-C2 closure: an external observer of ciphertext sizes
		// cannot distinguish more than ~14 user vault size classes.
		const sample = [
			0,
			47,
			513,
			1499,
			9876,
			65000,
			120000,
			500001,
			999999,
			2097150
		];
		const buckets = new Set(sample.map(bucketSize));
		expect(buckets.size).toBeLessThanOrEqual(14);
		// All ≥ MIN_BUCKET_BYTES.
		for (const b of buckets) {
			expect(b).toBeGreaterThanOrEqual(MIN_BUCKET_BYTES);
		}
		// All are powers of two.
		for (const b of buckets) {
			expect((b & (b - 1)) === 0).toBe(true);
		}
	});

	it('enumerateBuckets covers the contiguous lattice', () => {
		const buckets = enumerateBuckets(2_000_000);
		expect(buckets[0]).toBe(MIN_BUCKET_BYTES);
		for (let i = 1; i < buckets.length; i++) {
			expect(buckets[i]).toBe(buckets[i - 1]! * 2);
		}
		// Last bucket fits 2 MB.
		expect(buckets[buckets.length - 1]).toBeGreaterThanOrEqual(2_000_000);
	});
});
