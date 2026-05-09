import { describe, expect, it } from 'vitest';
import {
	generate,
	entropyBits,
	_alphabetFor,
	MIN_LENGTH,
	MAX_LENGTH,
	LOWER,
	UPPER,
	DIGIT,
	SYMBOL
} from './passgen';

const has = (s: string, alphabet: string) =>
	s.split('').some((c) => alphabet.includes(c));

describe('passgen — output policy', () => {
	it('produces the requested length', () => {
		const pw = generate({ length: 24, lower: true, upper: true, digit: true, symbol: true });
		expect(pw.length).toBe(24);
	});

	it('always includes a character from every enabled class', () => {
		// Run many trials at minimum length so coverage matters.
		for (let i = 0; i < 200; i++) {
			const pw = generate({
				length: MIN_LENGTH,
				lower: true,
				upper: true,
				digit: true,
				symbol: true
			});
			expect(has(pw, LOWER)).toBe(true);
			expect(has(pw, UPPER)).toBe(true);
			expect(has(pw, DIGIT)).toBe(true);
			expect(has(pw, SYMBOL)).toBe(true);
		}
	});

	it('does not emit characters from disabled classes', () => {
		const pw = generate({
			length: 32,
			lower: true,
			upper: false,
			digit: true,
			symbol: false
		});
		expect(has(pw, UPPER)).toBe(false);
		expect(has(pw, SYMBOL)).toBe(false);
	});

	it('excludeAmbiguous strips 0/O/1/l/I from the alphabet', () => {
		const alpha = _alphabetFor({
			length: 16,
			lower: true,
			upper: true,
			digit: true,
			excludeAmbiguous: true
		});
		expect(alpha).not.toMatch(/[0O1lI]/);
		// Sanity: we still have plenty of characters.
		expect(alpha.length).toBeGreaterThan(40);
		const pw = generate({
			length: 64,
			lower: true,
			upper: true,
			digit: true,
			excludeAmbiguous: true
		});
		expect(pw).not.toMatch(/[0O1lI]/);
	});

	it('first character is not always the lowercase class (no clustering bias)', () => {
		// 100 generations at length 4 with all classes; first char should
		// be a mix of classes when shuffled. We just assert the lowercase
		// class doesn't dominate.
		let lowerFirst = 0;
		for (let i = 0; i < 100; i++) {
			const pw = generate({
				length: 4,
				lower: true,
				upper: true,
				digit: true,
				symbol: true
			});
			if (LOWER.includes(pw[0]!)) lowerFirst++;
		}
		// Each class has ~equal share; lowercase as first should be
		// nowhere near 100. Allow generous bound for variance.
		expect(lowerFirst).toBeLessThan(70);
	});
});

describe('passgen — input validation', () => {
	it('rejects length < MIN_LENGTH', () => {
		expect(() => generate({ length: MIN_LENGTH - 1, lower: true })).toThrow(
			/length must be an integer/i
		);
	});

	it('rejects length > MAX_LENGTH', () => {
		expect(() => generate({ length: MAX_LENGTH + 1, lower: true })).toThrow(
			/length must be an integer/i
		);
	});

	it('rejects non-integer length', () => {
		expect(() => generate({ length: 12.5, lower: true })).toThrow(
			/length must be an integer/i
		);
	});

	it('rejects empty alphabet', () => {
		expect(() =>
			generate({ length: 12, lower: false, upper: false, digit: false, symbol: false })
		).toThrow(/Empty alphabet/);
	});
});

describe('passgen — entropy estimate', () => {
	it('grows linearly with length and logarithmically with alphabet size', () => {
		const a = entropyBits({ length: 12, lower: true, upper: true, digit: true });
		const b = entropyBits({ length: 24, lower: true, upper: true, digit: true });
		expect(b).toBeCloseTo(a * 2, 5);
	});

	it('returns 0 for an empty alphabet', () => {
		expect(
			entropyBits({ length: 12, lower: false, upper: false, digit: false, symbol: false })
		).toBe(0);
	});
});
