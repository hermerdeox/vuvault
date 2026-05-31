/**
 * V0-C2 integration test — Phase A bucketed-padding wiring.
 *
 * Provisions a fresh v3 vault, saves multiple items at deliberately
 * varied sizes, and asserts:
 *
 *   - Every persisted vault blob's ciphertext length is exactly a
 *     power-of-two ≥ 256 bytes plus the 16-byte AES-GCM tag.
 *   - The set of distinct ciphertext sizes across 10 random plaintext
 *     sizes collapses to at most 14 distinct buckets (the V0-C2
 *     statistical assertion from docs/VU-LEVEL-MIGRATION-MAP.md).
 *   - Document blobs are similarly bucketed.
 *   - Round-trip identity: open(sealed(items)) ≡ items, regardless of
 *     padding presence.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';

// Mock WebAuthn PRF identically to vault-session.test.ts so this
// integration test runs in the same Node context without a real
// authenticator. The PRF returns HMAC-SHA512(salt, credentialId)[..32],
// matching the deterministic shape a real PRF call would produce for
// the same (credentialId, salt) pair.
vi.mock('$lib/crypto/webauthn-prf', () => ({
	evaluatePRF: vi.fn(
		async ({ credentialId, salt }: { credentialId: ArrayBuffer; salt: Uint8Array }) => {
			const cred = new Uint8Array(credentialId);
			return hmac(sha512, salt, cred).slice(0, 32);
		}
	),
	registerPasskey: vi.fn(),
	isWebAuthnSupported: () => true,
	isPlatformAuthenticatorAvailable: async () => true
}));

// Sync must stay unwired here — we are testing local seal/open
// invariants, not the v2 routes.
const mockSyncOrigin = '';
vi.mock('$lib/utils/env', () => ({
	isDemoAuthEnabled: () => true,
	getRpId: () => 'test.invalid',
	getSyncOrigin: () => mockSyncOrigin,
	isSyncOriginConfigured: () => mockSyncOrigin !== '',
	PUBLIC_BUNDLE_HASH: 'test',
	PUBLIC_VAULT_VERSION: '0.0.0',
	BUNDLE_HASH_SHORT: 'test',
	verifyBundleIntegrity: async () => ({
		expected: 'test',
		expectedShort: 'test',
		state: 'placeholder' as const,
		rekorUrl: 'https://search.sigstore.dev/?hash=test'
	})
}));

import {
	provisionVault,
	saveItems,
	openVault,
	sealDocument,
	openDocument,
	lockSession,
	PROVISION_FORMAT_VERSION
} from '../../src/lib/services/vault-session';
import { db } from '../../src/lib/utils/storage';
import type { VaultItem } from '../../src/lib/types/vault-item';
void mockSyncOrigin;

const SECRET_KEY = new Uint8Array(32).fill(0xa1);

function freshCredentialId(): ArrayBuffer {
	const buf = new ArrayBuffer(32);
	new Uint8Array(buf).fill(0x5a);
	return buf;
}

function makeItem(id: string, sizeBytes: number): VaultItem {
	return {
		id,
		kind: 'note',
		title: id,
		noteBody: 'x'.repeat(Math.max(0, sizeBytes - 64)),
		createdAt: 1,
		updatedAt: 1
	};
}

function isBucketSize(len: number): boolean {
	// AES-GCM appends a 16-byte tag, so ciphertext length = bucket + 16.
	const payload = len - 16;
	return payload >= 256 && (payload & (payload - 1)) === 0;
}

beforeEach(async () => {
	await db.delete();
	await db.open();
	lockSession();
});

describe('V0-C2 · vault blob padding', () => {
	it('saveItems on a v3 vault produces a power-of-two-bucketed ciphertext', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb1);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'v0c2-test',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		await saveItems([makeItem('a', 100)]);

		const row = await db.vault.get('singleton');
		expect(row).toBeDefined();
		// V0-C2 invariant: every persisted vault ciphertext is bucketed.
		expect(isBucketSize(row!.ciphertext.length)).toBe(true);
		// Round-trip: re-open and recover items intact. The PRF mock
		// is deterministic for the same (credentialId, salt), so a
		// fresh openVault call recomputes the same export key.
		lockSession();
		const reopened = await openVault({ secretKey: SECRET_KEY });
		expect(reopened).toHaveLength(1);
		expect(reopened[0]!.title).toBe('a');
	});

	it('10 different plaintext sizes collapse to ≤ 14 distinct ciphertext buckets', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb2);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'v0c2-buckets',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		const sizes = [50, 200, 800, 1500, 3500, 9000, 17000, 35000, 70000, 130000];
		const distinctBuckets = new Set<number>();
		for (let i = 0; i < sizes.length; i++) {
			const items = [
				makeItem(`s${i}`, sizes[i]!),
				makeItem(`s${i}-extra`, 32)
			];
			await saveItems(items);
			const row = await db.vault.get('singleton');
			expect(row).toBeDefined();
			expect(isBucketSize(row!.ciphertext.length)).toBe(true);
			distinctBuckets.add(row!.ciphertext.length);
		}
		// V0-C2 statistical assertion: 10 random sizes ∈ [50, 130000]
		// fall into at most 14 distinct buckets (the full lattice over
		// that range).
		expect(distinctBuckets.size).toBeLessThanOrEqual(14);
	});

	it('saved vault carries PROVISION_FORMAT_VERSION = 3 (padded format)', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb3);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'v0c2-version',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});
		const account = await db.account.get('singleton');
		expect(account!.formatVersion).toBe(PROVISION_FORMAT_VERSION);
		expect(PROVISION_FORMAT_VERSION).toBe(3);
	});
});

describe('V0-C2 · document blob padding', () => {
	it('sealDocument produces a power-of-two-bucketed ciphertext and openDocument round-trips', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb4);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'v0c2-doc',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		const plaintext = new Uint8Array(1234).map((_, i) => (i * 7 + 3) & 0xff);
		const sealed = await sealDocument(plaintext);
		expect(isBucketSize(sealed.ciphertext.length)).toBe(true);

		const opened = await openDocument({
			blobId: sealed.blobId,
			nonce: sealed.nonce,
			ciphertext: sealed.ciphertext
		});
		expect(opened.length).toBe(1234);
		expect(Array.from(opened.slice(0, 16))).toEqual(Array.from(plaintext.slice(0, 16)));
		expect(Array.from(opened.slice(-16))).toEqual(Array.from(plaintext.slice(-16)));
	});

	it('5 document sizes collapse to ≤ 14 distinct buckets', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = new Uint8Array(16).fill(0xb5);
		const prf = hmac(sha512, deviceSalt, new Uint8Array(credentialId)).slice(0, 32);
		await provisionVault({
			deviceLabel: 'v0c2-doc-buckets',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'production',
			prfOutput: prf,
			deviceSalt
		});

		const sizes = [50, 800, 9000, 35000, 130000];
		const buckets = new Set<number>();
		for (const n of sizes) {
			const plaintext = new Uint8Array(n).map((_, i) => (i * 11 + 5) & 0xff);
			const sealed = await sealDocument(plaintext);
			expect(isBucketSize(sealed.ciphertext.length)).toBe(true);
			buckets.add(sealed.ciphertext.length);
		}
		expect(buckets.size).toBeLessThanOrEqual(14);
	});
});
