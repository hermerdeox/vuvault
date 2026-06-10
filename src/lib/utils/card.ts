/**
 * Payment-card intelligence — pure, local, zero network.
 *
 * Network detection (IIN prefix ranges), per-network grouping for
 * display formatting, Luhn validation, and completion detection that
 * drives the editor's auto-advance (number → expiry → CVC). All of
 * it runs on-device; a card number never leaves the input handler.
 */

export type CardNetwork =
	| 'visa'
	| 'mastercard'
	| 'amex'
	| 'discover'
	| 'diners'
	| 'jcb'
	| 'unionpay'
	| 'unknown';

type NetworkSpec = {
	network: CardNetwork;
	label: string;
	match: RegExp;
	/** Valid total lengths, ascending. */
	lengths: number[];
	/** Digit group sizes for display, e.g. Amex 4-6-5. */
	gaps: number[];
	cvcLength: number;
};

const SPECS: NetworkSpec[] = [
	{
		network: 'visa',
		label: 'Visa',
		match: /^4/,
		lengths: [13, 16, 19],
		gaps: [4, 4, 4, 4, 3],
		cvcLength: 3
	},
	{
		network: 'mastercard',
		label: 'Mastercard',
		match: /^(5[1-5]|2(22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/,
		lengths: [16],
		gaps: [4, 4, 4, 4],
		cvcLength: 3
	},
	{
		network: 'amex',
		label: 'American Express',
		match: /^3[47]/,
		lengths: [15],
		gaps: [4, 6, 5],
		cvcLength: 4
	},
	{
		network: 'discover',
		label: 'Discover',
		match: /^(6011|65|64[4-9])/,
		lengths: [16, 19],
		gaps: [4, 4, 4, 4, 3],
		cvcLength: 3
	},
	{
		network: 'diners',
		label: 'Diners Club',
		match: /^3(0[0-5]|[68])/,
		lengths: [14, 16, 19],
		gaps: [4, 6, 4, 5],
		cvcLength: 3
	},
	{
		network: 'jcb',
		label: 'JCB',
		match: /^35(2[89]|[3-8]\d)/,
		lengths: [16, 17, 18, 19],
		gaps: [4, 4, 4, 4, 3],
		cvcLength: 3
	},
	{
		network: 'unionpay',
		label: 'UnionPay',
		match: /^62/,
		lengths: [16, 17, 18, 19],
		gaps: [4, 4, 4, 4, 3],
		cvcLength: 3
	}
];

const UNKNOWN: NetworkSpec = {
	network: 'unknown',
	label: 'Card',
	match: /^/,
	lengths: [12, 13, 14, 15, 16, 17, 18, 19],
	gaps: [4, 4, 4, 4, 3],
	cvcLength: 4
};

export function stripDigits(value: string): string {
	return value.replace(/\D/g, '');
}

function specFor(digits: string): NetworkSpec {
	return SPECS.find((s) => s.match.test(digits)) ?? UNKNOWN;
}

export function detectNetwork(value: string): CardNetwork {
	const digits = stripDigits(value);
	return digits.length === 0 ? 'unknown' : specFor(digits).network;
}

export function networkLabel(network: CardNetwork): string {
	return (SPECS.find((s) => s.network === network) ?? UNKNOWN).label;
}

export function maxLengthFor(value: string): number {
	const spec = specFor(stripDigits(value));
	return spec.lengths[spec.lengths.length - 1] ?? 19;
}

export function cvcLengthFor(value: string): number {
	return specFor(stripDigits(value)).cvcLength;
}

/** Group digits per the detected network (4-4-4-4, Amex 4-6-5, …). */
export function formatCardNumber(value: string): string {
	const spec = specFor(stripDigits(value));
	const digits = stripDigits(value).slice(0, spec.lengths[spec.lengths.length - 1]);
	const parts: string[] = [];
	let i = 0;
	for (const gap of spec.gaps) {
		if (i >= digits.length) break;
		parts.push(digits.slice(i, i + gap));
		i += gap;
	}
	return parts.join(' ');
}

export function luhnValid(value: string): boolean {
	const digits = stripDigits(value);
	if (digits.length < 12) return false;
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let d = digits.charCodeAt(i) - 48;
		if (double) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
		double = !double;
	}
	return sum % 10 === 0;
}

/**
 * True when the number is finished — a valid length for its network
 * AND Luhn-clean (UnionPay issues non-Luhn ranges, so length alone
 * completes it). Drives the number → expiry auto-advance.
 */
export function cardNumberComplete(value: string): boolean {
	const digits = stripDigits(value);
	const spec = specFor(digits);
	if (!spec.lengths.includes(digits.length)) return false;
	return spec.network === 'unionpay' ? true : luhnValid(digits);
}

/** Masked display groups for the card face: •••• •••• •••• 4242. */
export function maskCardNumber(value: string): string {
	const formatted = formatCardNumber(value);
	if (!formatted) return '';
	const groups = formatted.split(' ');
	return groups
		.map((g, i) => (i === groups.length - 1 ? g : '•'.repeat(g.length)))
		.join(' ');
}

/**
 * MM/YY input formatter. Digits-only in, canonical partial format
 * out: '4' → '04/', '12' → '12/', '1229' → '12/29'. A lone '1' stays
 * ambiguous (could be 01-12), so it is left as-is until disambiguated.
 */
export function formatExpiry(value: string): string {
	let digits = stripDigits(value);
	if (digits.length === 0) return '';
	if (digits[0]! >= '2') digits = '0' + digits; // '4…' → '04…'
	if (digits.length >= 2) {
		const month = digits.slice(0, 2);
		if (month === '00') digits = '0' + digits.slice(2); // '00…' → '0…'
		else if (Number(month) > 12) digits = '0' + digits[0] + digits.slice(1); // '13' → '01/3'
	}
	digits = digits.slice(0, 4);
	if (digits.length <= 2) return digits;
	return digits.slice(0, 2) + '/' + digits.slice(2);
}

export function expiryComplete(value: string): boolean {
	return /^(0[1-9]|1[0-2])\/\d{2}$/.test(value.trim());
}
