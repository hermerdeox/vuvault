import { describe, expect, it } from 'vitest';
import {
	PRICE,
	PRICE_NUM,
	PRICE_PER,
	PRICE_MATH,
	PRICE_MONTHLY_EQUIV,
	COMPETITOR_PRICES
} from './pricing';

describe('pricing invariants', () => {
	it('PRICE is the canonical $25.60/year string', () => {
		expect(PRICE).toBe('$25.60/year');
		expect(PRICE_NUM).toBe('$25.60');
		expect(PRICE_PER).toBe('/year');
	});

	it('PRICE never silently rounds to $2.56', () => {
		expect(PRICE).not.toContain('$2.56');
		expect(PRICE_NUM).not.toContain('$2.56');
		expect(PRICE_MONTHLY_EQUIV).not.toContain('$2.56');
	});

	it('PRICE_MATH preserves the bit-math line', () => {
		expect(PRICE_MATH).toMatch(/256 bits of entropy/);
		expect(PRICE_MATH).toMatch(/\$0\.10/);
		expect(PRICE_MATH).toMatch(/honest math/i);
	});

	it('lists at least four competitors', () => {
		expect(COMPETITOR_PRICES.length).toBeGreaterThanOrEqual(4);
		for (const c of COMPETITOR_PRICES) {
			expect(c.name).toBeTruthy();
			expect(c.price).toMatch(/\$\d/);
		}
	});
});
