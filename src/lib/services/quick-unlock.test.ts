import { beforeEach, describe, expect, it, vi } from 'vitest';

import 'fake-indexeddb/auto';

import { hmac } from '@noble/hashes/hmac';
import { sha512 } from '@noble/hashes/sha2';

vi.mock('$lib/crypto/webauthn-prf', () => ({
	evaluatePRF: vi.fn(
		async ({ credentialId, salt }: { credentialId: ArrayBuffer; salt: Uint8Array }) =>
			hmac(sha512, salt, new Uint8Array(credentialId)).slice(0, 32)
	)
}));

import { evaluatePRF } from '$lib/crypto/webauthn-prf';
import { generateDeviceSalt, provisionVault } from './vault-session';
import {
	clearAll,
	db,
	deleteQuickUnlock,
	getAccount,
	getQuickUnlock,
	saveAccount
} from '$lib/utils/storage';
import {
	disableQuickUnlock,
	enableQuickUnlock,
	hasQuickUnlock,
	openQuickUnlock,
	QuickUnlockCacheError
} from './quick-unlock';

const SECRET_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

function freshCredentialId(): ArrayBuffer {
	const buf = new Uint8Array(32);
	crypto.getRandomValues(buf);
	return buf.buffer;
}

async function provisionProductionAccount() {
	const credentialId = freshCredentialId();
	const deviceSalt = generateDeviceSalt();
	const prfOutput = (await evaluatePRF({ credentialId, salt: deviceSalt })) as Uint8Array;
	await provisionVault({
		deviceLabel: 'trusted-mac',
		secretKey: SECRET_KEY,
		credentialId,
		credentialPublicKey: new ArrayBuffer(0),
		authMode: 'production',
		prfOutput,
		deviceSalt
	});
	return { credentialId, deviceSalt, prfOutput };
}

beforeEach(async () => {
	await db.delete();
	await db.open();
	(evaluatePRF as ReturnType<typeof vi.fn>).mockClear();
});

describe('quick-unlock', () => {
	it('seals and opens the Secret Key with the same WebAuthn PRF context', async () => {
		const { prfOutput } = await provisionProductionAccount();

		await enableQuickUnlock(SECRET_KEY, { prfOutput });

		expect(await hasQuickUnlock()).toBe(true);
		const opened = await openQuickUnlock();
		expect(opened.secretKey).toEqual(SECRET_KEY);
		expect(opened.prfOutput).toEqual(prfOutput);

		const record = await getQuickUnlock();
		expect(record?.lastUsedAt).toBeTypeOf('number');

		opened.secretKey.fill(0);
		opened.prfOutput.fill(0);
	});

	it('fails closed and deletes the cache if account credential metadata changes', async () => {
		const { prfOutput } = await provisionProductionAccount();
		await enableQuickUnlock(SECRET_KEY, { prfOutput });

		const account = await getAccount();
		expect(account).toBeTruthy();
		await saveAccount({
			...account!,
			credentialId: freshCredentialId()
		});

		// A genuine cache invalidation raises the typed error AND deletes.
		await expect(openQuickUnlock()).rejects.toBeInstanceOf(QuickUnlockCacheError);
		expect(await getQuickUnlock()).toBeUndefined();
	});

	it('fails closed and deletes the cache if account salt changes', async () => {
		const { prfOutput } = await provisionProductionAccount();
		await enableQuickUnlock(SECRET_KEY, { prfOutput });

		const account = await getAccount();
		expect(account).toBeTruthy();
		await saveAccount({
			...account!,
			deviceSalt: generateDeviceSalt()
		});

		await expect(openQuickUnlock()).rejects.toBeInstanceOf(QuickUnlockCacheError);
		expect(await getQuickUnlock()).toBeUndefined();
	});

	it('keeps the cache when the passkey prompt is cancelled (transient PRF failure)', async () => {
		const { prfOutput } = await provisionProductionAccount();
		await enableQuickUnlock(SECRET_KEY, { prfOutput });
		expect(await hasQuickUnlock()).toBe(true);

		// Simulate the user dismissing the Touch ID / passkey prompt:
		// evaluatePRF swallows the WebAuthn NotAllowedError and yields null,
		// which resolvePrfOutput turns into a thrown Error. This must NOT
		// be treated as a cache invalidation.
		(evaluatePRF as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		const err = await openQuickUnlock().then(
			() => null,
			(e) => e
		);
		expect(err).toBeInstanceOf(Error);
		expect(err).not.toBeInstanceOf(QuickUnlockCacheError);

		// The cache survives a cancellation — one accidental Cancel must not
		// force a full Secret-Key unlock on a trusted device.
		expect(await getQuickUnlock()).toBeTruthy();
		expect(await hasQuickUnlock()).toBe(true);

		// And the very next genuine attempt still works end-to-end.
		const opened = await openQuickUnlock();
		expect(opened.secretKey).toEqual(SECRET_KEY);
		opened.secretKey.fill(0);
		opened.prfOutput.fill(0);
	});

	it('keeps the cache when the authenticator rejects (timeout/abort)', async () => {
		const { prfOutput } = await provisionProductionAccount();
		await enableQuickUnlock(SECRET_KEY, { prfOutput });

		(evaluatePRF as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new DOMException('The operation either timed out or was not allowed', 'NotAllowedError')
		);
		await expect(openQuickUnlock()).rejects.not.toBeInstanceOf(QuickUnlockCacheError);
		expect(await getQuickUnlock()).toBeTruthy();
		expect(await hasQuickUnlock()).toBe(true);
	});

	it('does not enable for demo accounts', async () => {
		const credentialId = freshCredentialId();
		const deviceSalt = generateDeviceSalt();
		await provisionVault({
			deviceLabel: 'demo',
			secretKey: SECRET_KEY,
			credentialId,
			credentialPublicKey: new ArrayBuffer(0),
			authMode: 'demo',
			prfOutput: null,
			deviceSalt
		});

		await enableQuickUnlock(SECRET_KEY);

		expect(await hasQuickUnlock()).toBe(false);
		expect(await getQuickUnlock()).toBeUndefined();
	});

	it('disables and clearAll removes the local cache', async () => {
		const { prfOutput } = await provisionProductionAccount();
		await enableQuickUnlock(SECRET_KEY, { prfOutput });
		expect(await hasQuickUnlock()).toBe(true);

		await disableQuickUnlock();
		expect(await hasQuickUnlock()).toBe(false);
		expect(await getQuickUnlock()).toBeUndefined();

		await enableQuickUnlock(SECRET_KEY, { prfOutput });
		expect(await hasQuickUnlock()).toBe(true);

		await clearAll();
		expect(await getQuickUnlock()).toBeUndefined();
	});

	it('treats a disabled row as unavailable', async () => {
		const { prfOutput } = await provisionProductionAccount();
		await enableQuickUnlock(SECRET_KEY, { prfOutput });
		const record = await getQuickUnlock();
		expect(record).toBeTruthy();
		await deleteQuickUnlock();
		await db.quickUnlock.put({ ...record!, enabled: false });

		expect(await hasQuickUnlock()).toBe(false);
		await expect(openQuickUnlock()).rejects.toThrow(/not enabled/i);
	});
});
