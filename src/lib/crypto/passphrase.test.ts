import { describe, it, expect } from 'vitest';
import {
	WORDLIST,
	generatePassphrase,
	passphraseEntropyBits
} from './passphrase';

describe('passphrase generator', () => {
	it('produces the requested number of words', () => {
		const phrase = generatePassphrase({ words: 5 });
		expect(phrase.split('-')).toHaveLength(5);
	});

	it('clamps word count to the sane 3–9 range', () => {
		expect(generatePassphrase({ words: 1 }).split('-')).toHaveLength(3);
		expect(generatePassphrase({ words: 99 }).split('-')).toHaveLength(9);
	});

	it('appends a two-digit number group when requested', () => {
		const parts = generatePassphrase({ words: 4, number: true }).split('-');
		expect(parts).toHaveLength(5);
		expect(parts[4]).toMatch(/^\d{2}$/);
	});

	it('capitalises each word when requested', () => {
		const parts = generatePassphrase({ words: 4, capitalize: true }).split('-');
		for (const p of parts) expect(p[0]).toBe(p[0]!.toUpperCase());
	});

	it('honours a custom separator', () => {
		expect(generatePassphrase({ words: 3, separator: ' ' }).split(' ')).toHaveLength(3);
	});

	it('only emits words from the wordlist', () => {
		const set = new Set(WORDLIST);
		for (const w of generatePassphrase({ words: 9 }).split('-')) {
			expect(set.has(w)).toBe(true);
		}
	});

	it('draws from across the list (not a single fixed word)', () => {
		// 200 single-word draws should surface well over one distinct word
		// if the CSPRNG selection is unbiased.
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) seen.add(generatePassphrase({ words: 3 }).split('-')[0]!);
		expect(seen.size).toBeGreaterThan(20);
	});

	it('reports entropy as words × log2(listLength) plus the number group', () => {
		const perWord = Math.log2(WORDLIST.length);
		expect(passphraseEntropyBits({ words: 5 })).toBeCloseTo(5 * perWord, 6);
		expect(passphraseEntropyBits({ words: 5, number: true })).toBeCloseTo(
			5 * perWord + Math.log2(90),
			6
		);
	});

	it('has a wordlist of distinct, lowercase, non-trivial words', () => {
		expect(new Set(WORDLIST).size).toBe(WORDLIST.length);
		for (const w of WORDLIST) {
			expect(w).toBe(w.toLowerCase());
			expect(w.length).toBeGreaterThanOrEqual(2);
		}
	});
});
