import { describe, it, expect } from 'vitest';
import {
	detectNetwork,
	formatCardNumber,
	luhnValid,
	cardNumberComplete,
	maskCardNumber,
	formatExpiry,
	expiryComplete,
	cvcLengthFor,
	maxLengthFor
} from './card';

// Standard industry test numbers (public, non-chargeable).
const VISA = '4111111111111111';
const VISA_13 = '4222222222222';
const MC = '5555555555554444';
const MC_2SERIES = '2223003122003222';
const AMEX = '378282246310005';
const DISCOVER = '6011111111111117';
const DINERS = '30569309025904';
const JCB = '3530111333300000';
const UNIONPAY = '6200000000000005';

describe('card · network detection', () => {
	it('detects every major network from the IIN prefix', () => {
		expect(detectNetwork(VISA)).toBe('visa');
		expect(detectNetwork(VISA_13)).toBe('visa');
		expect(detectNetwork(MC)).toBe('mastercard');
		expect(detectNetwork(MC_2SERIES)).toBe('mastercard');
		expect(detectNetwork(AMEX)).toBe('amex');
		expect(detectNetwork(DISCOVER)).toBe('discover');
		expect(detectNetwork(DINERS)).toBe('diners');
		expect(detectNetwork(JCB)).toBe('jcb');
		expect(detectNetwork(UNIONPAY)).toBe('unionpay');
	});

	it('detects from partial prefixes and formatted input', () => {
		expect(detectNetwork('4')).toBe('visa');
		expect(detectNetwork('37')).toBe('amex');
		expect(detectNetwork('5500 12')).toBe('mastercard');
		expect(detectNetwork('')).toBe('unknown');
		expect(detectNetwork('9999')).toBe('unknown');
	});
});

describe('card · formatting', () => {
	it('groups 4-4-4-4 for visa/mastercard', () => {
		expect(formatCardNumber(VISA)).toBe('4111 1111 1111 1111');
		expect(formatCardNumber(MC)).toBe('5555 5555 5555 4444');
	});

	it('groups 4-6-5 for amex and 4-6-4 for diners', () => {
		expect(formatCardNumber(AMEX)).toBe('3782 822463 10005');
		expect(formatCardNumber(DINERS)).toBe('3056 930902 5904');
	});

	it('formats partial input progressively', () => {
		expect(formatCardNumber('41111')).toBe('4111 1');
		expect(formatCardNumber('3782822463')).toBe('3782 822463');
	});

	it('clamps to the network max length', () => {
		expect(formatCardNumber(AMEX + '999')).toBe('3782 822463 10005');
		expect(maxLengthFor(AMEX)).toBe(15);
		expect(maxLengthFor(VISA)).toBe(19);
	});

	it('masks all but the last group', () => {
		expect(maskCardNumber(VISA)).toBe('•••• •••• •••• 1111');
		expect(maskCardNumber(AMEX)).toBe('•••• •••••• 10005');
	});
});

describe('card · luhn + completion', () => {
	it('validates correct numbers and rejects corrupted ones', () => {
		for (const n of [VISA, MC, AMEX, DISCOVER, DINERS, JCB]) {
			expect(luhnValid(n)).toBe(true);
		}
		expect(luhnValid('4111111111111112')).toBe(false);
	});

	it('completes at a valid length with a clean Luhn', () => {
		expect(cardNumberComplete(VISA)).toBe(true);
		expect(cardNumberComplete(VISA.slice(0, 15))).toBe(false);
		expect(cardNumberComplete(AMEX)).toBe(true);
		expect(cardNumberComplete('4111111111111112')).toBe(false);
	});

	it('completes unionpay on length alone (non-Luhn ranges exist)', () => {
		expect(cardNumberComplete('6212345678901232')).toBe(true);
	});

	it('exposes per-network cvc length', () => {
		expect(cvcLengthFor(AMEX)).toBe(4);
		expect(cvcLengthFor(VISA)).toBe(3);
	});
});

describe('card · expiry', () => {
	it('pads an unambiguous first month digit', () => {
		expect(formatExpiry('4')).toBe('04');
		expect(formatExpiry('9')).toBe('09');
		expect(formatExpiry('1')).toBe('1'); // ambiguous: 01-12
	});

	it('inserts the slash and clamps invalid months', () => {
		expect(formatExpiry('1229')).toBe('12/29');
		expect(formatExpiry('0429')).toBe('04/29');
		expect(formatExpiry('13')).toBe('01/3');
		expect(formatExpiry('00')).toBe('0');
	});

	it('stays deletable (no forced slash at two digits)', () => {
		expect(formatExpiry('12')).toBe('12');
	});

	it('detects completion', () => {
		expect(expiryComplete('12/29')).toBe(true);
		expect(expiryComplete('12/2')).toBe(false);
		expect(expiryComplete('13/29')).toBe(false);
	});
});
