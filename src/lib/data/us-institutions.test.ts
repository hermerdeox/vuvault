import { describe, it, expect } from 'vitest';
import { US_INSTITUTIONS, searchInstitutions } from './us-institutions';

describe('us-institutions', () => {
	it('ships a meaningful top-250 dataset with no duplicates', () => {
		expect(US_INSTITUTIONS.length).toBeGreaterThanOrEqual(250);
		expect(new Set(US_INSTITUTIONS.map((n) => n.toLowerCase())).size).toBe(
			US_INSTITUTIONS.length
		);
	});

	it('caps results at 10 by default', () => {
		expect(searchInstitutions('').length).toBe(10);
		expect(searchInstitutions('a').length).toBeLessThanOrEqual(10);
	});

	it('narrows as the query grows', () => {
		const one = searchInstitutions('w').length;
		const two = searchInstitutions('wells').length;
		expect(two).toBeLessThanOrEqual(one);
		expect(searchInstitutions('wells fargo')).toEqual(['Wells Fargo']);
	});

	it('ranks prefix matches before substring matches', () => {
		const results = searchInstitutions('first');
		expect(results.length).toBeGreaterThan(0);
		const firstSubstringIdx = results.findIndex((r) => !r.toLowerCase().startsWith('first'));
		const lastPrefixIdx = results.reduce(
			(acc, r, i) => (r.toLowerCase().startsWith('first') ? i : acc),
			-1
		);
		if (firstSubstringIdx !== -1) expect(lastPrefixIdx).toBeLessThan(firstSubstringIdx);
	});

	it('is case- and whitespace-insensitive', () => {
		expect(searchInstitutions('  CHASE  ')).toContain('JPMorgan Chase');
		expect(searchInstitutions('navy federal')).toContain('Navy Federal Credit Union');
	});

	it('returns no matches for nonsense', () => {
		expect(searchInstitutions('zzzzqqq')).toEqual([]);
	});
});
