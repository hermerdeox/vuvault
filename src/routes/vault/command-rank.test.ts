import { describe, expect, it } from 'vitest';
import { rankItems, scoreItem } from './command-rank';
import type { VaultItem } from '$lib/stores/vault.svelte';

function login(partial: Partial<VaultItem>): VaultItem {
	return {
		id: partial.id ?? 'x',
		kind: 'login',
		title: partial.title ?? 't',
		createdAt: 1,
		updatedAt: 1,
		...partial
	};
}

describe('scoreItem', () => {
	it('exact title match wins', () => {
		expect(scoreItem({ title: 'GitHub' }, 'github')).toBe(100);
	});
	it('title prefix beats title contains', () => {
		const a = scoreItem({ title: 'GitHub' }, 'git');
		const b = scoreItem({ title: 'My GitHub backup' }, 'git');
		expect(a).toBeGreaterThan(b);
	});
	it('username prefix scores high', () => {
		expect(scoreItem({ title: 'X', username: 'rlopez' }, 'rl')).toBeGreaterThan(50);
	});
	it('url contains scores when title misses', () => {
		expect(scoreItem({ title: 'X', url: 'https://github.com/me' }, 'github')).toBeGreaterThan(
			0
		);
	});
	it('returns 0 for no match', () => {
		expect(scoreItem({ title: 'a', subtitle: 'b' }, 'zzz')).toBe(0);
	});
	it('empty query keeps everything', () => {
		expect(scoreItem({ title: 'a' }, '')).toBeGreaterThan(0);
	});
	it('tags participate in matching', () => {
		expect(scoreItem({ title: 'X', tags: ['work'] }, 'work')).toBeGreaterThan(0);
	});
});

describe('rankItems', () => {
	const items = [
		login({ id: '1', title: 'GitHub', username: 'r-lopez', url: 'https://github.com' }),
		login({ id: '2', title: 'GitLab', url: 'https://gitlab.com' }),
		login({ id: '3', title: 'My GitHub backup' }),
		login({ id: '4', title: 'Netflix', subtitle: 'streaming' })
	];

	it('orders by score descending', () => {
		const out = rankItems(items, 'github').map((i) => i.id);
		// Exact title 'GitHub' should beat 'My GitHub backup' (contains).
		expect(out[0]).toBe('1');
		expect(out).toContain('3');
		expect(out).not.toContain('2'); // GitLab does not match 'github'
		expect(out).not.toContain('4');
	});

	it('respects the limit', () => {
		const padded = Array.from({ length: 30 }, (_, i) =>
			login({ id: String(i), title: `GitHub${i}` })
		);
		const out = rankItems(padded, 'gith', 5);
		expect(out).toHaveLength(5);
	});

	it('empty query returns the entire list up to the limit', () => {
		const out = rankItems(items, '', 100);
		expect(out).toHaveLength(items.length);
	});
});
