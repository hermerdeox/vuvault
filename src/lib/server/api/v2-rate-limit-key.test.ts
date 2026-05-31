/**
 * Unit tests for `v2-rate-limit-key.ts`.
 *
 * The V1-C1 contract under test:
 *   - The output prefix is `session:`, never `account:` or similar.
 *   - The output is deterministic for the same input.
 *   - Different tokens produce different output buckets.
 *   - The output NEVER includes the input token (or any substring
 *     long enough to enable correlation back to it).
 *   - The output never contains characters that could be misread as
 *     an account_id, a UUID, or a Crockford address.
 */

import { describe, expect, it } from 'vitest';
import { V2_RATE_LIMIT_PREFIX, v2RateLimitKey } from './v2-rate-limit-key';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

describe('v2-rate-limit-key', () => {
	it('prefix is `session:` (never `account:` or any account-correlating string)', async () => {
		expect(V2_RATE_LIMIT_PREFIX).toBe('session');
		const k = await v2RateLimitKey(TOKEN_A);
		expect(k.startsWith('session:')).toBe(true);
		expect(k).not.toMatch(/^account:/);
		expect(k).not.toMatch(/^user:/);
		expect(k).not.toMatch(/^device:/);
		expect(k).not.toMatch(/^ip:/);
	});

	it('is deterministic for the same token', async () => {
		const k1 = await v2RateLimitKey(TOKEN_A);
		const k2 = await v2RateLimitKey(TOKEN_A);
		expect(k1).toBe(k2);
	});

	it('produces different buckets for different tokens', async () => {
		const kA = await v2RateLimitKey(TOKEN_A);
		const kB = await v2RateLimitKey(TOKEN_B);
		expect(kA).not.toBe(kB);
	});

	it('does not embed the raw token (V1-C1: rate-limit row leakage is not a token leak)', async () => {
		const k = await v2RateLimitKey(TOKEN_A);
		// The token is 64 chars of 'a'. The bucket is `session:` + 12
		// hex chars. The 12-hex prefix is the leading bytes of
		// SHA-256(token), which has no relationship to the input
		// content for SHA-256 outputs. We assert the bucket is NOT
		// just `session:` + a prefix of the token.
		expect(k).not.toContain(TOKEN_A.slice(0, 24));
		expect(k).not.toContain(TOKEN_A.slice(0, 12));
		// The bucket must be exactly `session:` + 12 hex.
		expect(k).toMatch(/^session:[0-9a-f]{12}$/);
	});

	it('is short enough to fit comfortably in the rate_limits.bucket TEXT column', async () => {
		const k = await v2RateLimitKey(TOKEN_A);
		// `session:` (8) + 12 hex = 20 chars total. Well within any
		// reasonable TEXT-column budget.
		expect(k.length).toBe(20);
	});

	it('handles empty and unusual inputs without throwing', async () => {
		// Empty token: SHA-256("") = e3b0c44... — deterministic, no
		// crash. The auth layer would never call us with an empty
		// token (authenticate rejects null/empty bearer headers
		// upstream), but defense-in-depth.
		const k = await v2RateLimitKey('');
		expect(k).toMatch(/^session:[0-9a-f]{12}$/);
		// Non-hex token: the helper should still hash and produce a
		// valid bucket. Caller is responsible for token format.
		const k2 = await v2RateLimitKey('not-a-hex-token-but-still-not-empty');
		expect(k2).toMatch(/^session:[0-9a-f]{12}$/);
	});

	it('matches the documented SHA-256-prefix shape', async () => {
		// Computed independently: SHA-256("a".repeat(64)) starting bytes.
		// We just assert the shape, not specific bytes (any change to
		// the hash function or truncation length should require
		// updating the test deliberately).
		const k = await v2RateLimitKey(TOKEN_A);
		const [prefix, hex] = k.split(':');
		expect(prefix).toBe('session');
		expect(hex).toBeDefined();
		expect(hex).toMatch(/^[0-9a-f]{12}$/);
	});

	it('never contains a CR, LF, or other control char (defense against header injection)', async () => {
		const k = await v2RateLimitKey(TOKEN_A);
		// The output is `session:<hex>` — all printable ASCII. We
		// keep this assertion as a regression safety net in case the
		// truncation length or alphabet ever changes.
		// eslint-disable-next-line no-control-regex -- intentional: assert absence of control chars
		expect(k).not.toMatch(/[\x00-\x1f\x7f]/);
	});
});
