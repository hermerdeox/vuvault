import { describe, expect, it } from 'vitest';
import {
	serializeItems,
	deserializeItems,
	VAULT_FORMAT_V1
} from './vault-codec';
import type {
	VaultItem,
	LoginItem,
	DocumentItem
} from '$lib/types/vault-item';

function makeLogin(): LoginItem {
	return {
		id: 'item-1',
		kind: 'login',
		title: 'GitHub',
		createdAt: 1_000,
		updatedAt: 1_000,
		username: 'r-lopez',
		password: 'demo'
	};
}

describe('vault-codec', () => {
	it('round-trips an item array', () => {
		const items: VaultItem[] = [makeLogin()];
		const bytes = serializeItems(items);
		expect(bytes[0]).toBe(VAULT_FORMAT_V1);
		const back = deserializeItems(bytes);
		expect(back).toHaveLength(1);
		expect(back[0]?.id).toBe('item-1');
		expect(back[0]?.kind === 'login' ? back[0].password : null).toBe('demo');
	});

	it('rejects an empty buffer', () => {
		expect(() => deserializeItems(new Uint8Array(0))).toThrow(/empty payload/);
	});

	it('rejects an unknown version byte', () => {
		const payload = serializeItems([]);
		payload[0] = 0xff;
		expect(() => deserializeItems(payload)).toThrow(/unsupported version/);
	});

	it('rejects a non-array body', () => {
		const json = new TextEncoder().encode('{"not":"an array"}');
		const payload = new Uint8Array(1 + json.length);
		payload[0] = VAULT_FORMAT_V1;
		payload.set(json, 1);
		expect(() => deserializeItems(payload)).toThrow(/not an array/);
	});

	it('rejects items with unknown kinds', () => {
		const json = new TextEncoder().encode(
			JSON.stringify([
				{ id: 'a', kind: 'mystery', title: 't', createdAt: 1, updatedAt: 2 }
			])
		);
		const payload = new Uint8Array(1 + json.length);
		payload[0] = VAULT_FORMAT_V1;
		payload.set(json, 1);
		expect(() => deserializeItems(payload)).toThrow(/unknown kind/);
	});

	it('rejects items missing required fields', () => {
		const json = new TextEncoder().encode(
			JSON.stringify([{ kind: 'login', id: 'x', title: 1, createdAt: 0, updatedAt: 0 }])
		);
		const payload = new Uint8Array(1 + json.length);
		payload[0] = VAULT_FORMAT_V1;
		payload.set(json, 1);
		expect(() => deserializeItems(payload)).toThrow(/title must be a string/);
	});

	it('round-trips card billing fields and drops unknown ones', () => {
		const card = {
			id: 'c1',
			kind: 'card',
			createdAt: 1,
			updatedAt: 2,
			title: 'Sapphire',
			cardholder: 'DIMITRI LOPEZ',
			cardNumber: '4111 1111 1111 1111',
			cardExpiry: '12/29',
			cardCvc: '423',
			billingAddress: '1234 Market Street, Apt 5',
			billingCity: 'San Francisco',
			billingState: 'CA',
			billingZip: '94103',
			billingCountry: 'United States',
			billingPhone: 'should-be-dropped'
		} as never;
		const out = deserializeItems(serializeItems([card]));
		const restored = out[0] as Record<string, unknown>;
		expect(restored.billingAddress).toBe('1234 Market Street, Apt 5');
		expect(restored.billingCity).toBe('San Francisco');
		expect(restored.billingState).toBe('CA');
		expect(restored.billingZip).toBe('94103');
		expect(restored.billingCountry).toBe('United States');
		expect('billingPhone' in restored).toBe(false);
	});

	it('round-trips a document item with attachment metadata', () => {
		const doc: DocumentItem = {
			id: 'doc-1',
			kind: 'document',
			title: 'Lease',
			createdAt: 1_000,
			updatedAt: 2_000,
			docDescription: 'Greenville office',
			docExternalRef: '',
			docBlobId: '11111111-2222-3333-4444-555555555555',
			docFileName: 'lease.pdf',
			docMimeType: 'application/pdf',
			docSize: 4096,
			docSha256:
				'0000000000000000000000000000000000000000000000000000000000000000',
			docRemote: true
		};
		const back = deserializeItems(serializeItems([doc]));
		expect(back).toHaveLength(1);
		const restored = back[0]!;
		expect(restored.kind).toBe('document');
		if (restored.kind === 'document') {
			expect(restored.docBlobId).toBe(doc.docBlobId);
			expect(restored.docFileName).toBe('lease.pdf');
			expect(restored.docMimeType).toBe('application/pdf');
			expect(restored.docSize).toBe(4096);
			expect(restored.docSha256).toHaveLength(64);
			expect(restored.docRemote).toBe(true);
		}
	});

	it('drops unsupported document fields on round-trip', () => {
		const json = new TextEncoder().encode(
			JSON.stringify([
				{
					id: 'd',
					kind: 'document',
					title: 'x',
					createdAt: 1,
					updatedAt: 2,
					docBlobId: 'abc',
					backdoor: 'unknown-field'
				}
			])
		);
		const payload = new Uint8Array(1 + json.length);
		payload[0] = VAULT_FORMAT_V1;
		payload.set(json, 1);
		const back = deserializeItems(payload);
		expect(back).toHaveLength(1);
		expect(back[0] as unknown as { backdoor?: string }).not.toHaveProperty(
			'backdoor'
		);
	});
});
