import { describe, expect, it } from 'vitest';
import {
	serializeItems,
	deserializeItems,
	VAULT_FORMAT_V1
} from './vault-codec';
import type { VaultItem, LoginItem } from '$lib/types/vault-item';

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
});
