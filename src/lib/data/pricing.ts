/**
 * Pricing constants — single source of truth for the literal strings
 * referenced across the landing page. Greppable: search for `25.60`
 * and ensure all occurrences trace back to this module.
 *
 * The math: 256 bits of entropy × $0.10 per bit = honest math.
 * REVIEW: literal price — change here only after product approval.
 */

export const PRICE = '$25.60/year';
export const PRICE_NUM = '$25.60';
export const PRICE_PER = '/year';
export const PRICE_MATH = '256 bits of entropy × $0.10 = honest math';
export const PRICE_MONTHLY_EQUIV = '$2.13/mo';

export const COMPETITOR_PRICES = [
	{ name: '1Password', price: '$35.88/yr' },
	{ name: 'Dashlane', price: '$59.88/yr' },
	{ name: 'Proton Pass', price: '$47.88/yr' },
	{ name: 'NordPass', price: '$26.85/yr' }
];
