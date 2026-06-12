import { describe, it, expect } from 'vitest';
import {
	parseAddressLine,
	validateAddressLine,
	suggestAddressLine,
	joinAddressLine,
	zipMatchesState
} from './address';

describe('address · parse', () => {
	it('parses a full line', () => {
		expect(parseAddressLine('1234 Market St, San Francisco, CA 94103')).toEqual({
			street: '1234 Market St',
			city: 'San Francisco',
			state: 'CA',
			zip: '94103'
		});
	});

	it('accepts full state names and ZIP+4', () => {
		const p = parseAddressLine('1 Main St, Boston, Massachusetts 02108-1234');
		expect(p.state).toBe('MA');
		expect(p.zip).toBe('02108-1234');
	});

	it('tolerates partial input while typing', () => {
		expect(parseAddressLine('1234 Market St, San Fr').city).toBe('San Fr');
		expect(parseAddressLine('1234 Market St').city).toBe('');
	});
});

describe('address · validate', () => {
	it('walks the user through missing segments', () => {
		expect(validateAddressLine('').hint).toMatch(/street number/i);
		expect(validateAddressLine('1234 Market St').hint).toMatch(/city/i);
		expect(validateAddressLine('1234 Market St, San Francisco').hint).toMatch(/state/i);
		expect(validateAddressLine('1234 Market St, San Francisco, CA').hint).toMatch(/ZIP/i);
	});

	it('validates a correct line', () => {
		expect(validateAddressLine('1234 Market St, San Francisco, CA 94103').valid).toBe(true);
	});

	it('rejects a ZIP that belongs to a different state', () => {
		const v = validateAddressLine('1234 Market St, San Francisco, CA 10001');
		expect(v.valid).toBe(false);
		expect(v.hint).toMatch(/doesn't match/i);
	});

	it('zip3 table covers the classics', () => {
		expect(zipMatchesState('94103', 'CA')).toBe(true);
		expect(zipMatchesState('10001', 'NY')).toBe(true);
		expect(zipMatchesState('02108', 'MA')).toBe(true);
		expect(zipMatchesState('73301', 'TX')).toBe(true);
		expect(zipMatchesState('94103', 'NY')).toBe(false);
	});
});

describe('address · suggest', () => {
	it('suggests nothing before the street comma', () => {
		expect(suggestAddressLine('1234 Market St')).toEqual([]);
	});

	it('suggests top cities after the comma, capped at 10', () => {
		const s = suggestAddressLine('1234 Market St, ');
		expect(s.length).toBe(10);
		expect(s[0]).toBe('1234 Market St, New York, NY ');
	});

	it('narrows as the city is typed', () => {
		const s = suggestAddressLine('1234 Market St, san f');
		expect(s).toEqual(['1234 Market St, San Francisco, CA ']);
	});

	it('stops suggesting once the city segment is complete', () => {
		expect(suggestAddressLine('1234 Market St, San Francisco, CA 9')).toEqual([]);
	});
});

describe('address · join', () => {
	it('rebuilds the single line from stored fields', () => {
		expect(
			joinAddressLine({
				billingAddress: '1234 Market St',
				billingCity: 'San Francisco',
				billingState: 'CA',
				billingZip: '94103'
			})
		).toBe('1234 Market St, San Francisco, CA 94103');
	});
});
