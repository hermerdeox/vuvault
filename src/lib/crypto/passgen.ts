/**
 * Password generator — cryptographically random with entropy calculation.
 *
 * Uses `crypto.getRandomValues` with rejection sampling to avoid modulo
 * bias, then guarantees that every enabled character class appears at
 * least once in the output (so a 16-char "lower+digit" password always
 * contains both a lower and a digit, not 16 lowers by chance).
 *
 * The class-coverage pass is itself uniform over the enabled classes
 * (each class slot is filled by a uniformly random pick from that
 * class), and the final positions of those required characters are
 * shuffled with Fisher-Yates over CSPRNG bytes. This both meets common
 * site policies and avoids the trivial "first char is always lower"
 * bias that comes from the shorter generators.
 */

export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGIT = '0123456789';
export const SYMBOL = '!@#$%^&*()-_=+[]{};:,.<>?';
const AMBIGUOUS = /[0O1lI]/g;

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 256;

export type GeneratorOpts = {
	length: number;
	upper?: boolean;
	lower?: boolean;
	digit?: boolean;
	symbol?: boolean;
	excludeAmbiguous?: boolean; // strip 0/O, 1/l/I from each enabled class
};

type EnabledClass = {
	id: 'lower' | 'upper' | 'digit' | 'symbol';
	chars: string;
};

function applyAmbiguous(chars: string, exclude: boolean): string {
	return exclude ? chars.replace(AMBIGUOUS, '') : chars;
}

function enabledClasses(opts: GeneratorOpts): EnabledClass[] {
	const out: EnabledClass[] = [];
	const exclude = opts.excludeAmbiguous === true;
	if (opts.lower !== false) out.push({ id: 'lower', chars: applyAmbiguous(LOWER, exclude) });
	if (opts.upper !== false) out.push({ id: 'upper', chars: applyAmbiguous(UPPER, exclude) });
	if (opts.digit !== false) out.push({ id: 'digit', chars: applyAmbiguous(DIGIT, exclude) });
	if (opts.symbol === true) out.push({ id: 'symbol', chars: applyAmbiguous(SYMBOL, exclude) });
	return out.filter((c) => c.chars.length > 0);
}

/**
 * Pick one CSPRNG-uniform character from `chars`. Uses rejection
 * sampling: any random byte ≥ floor(256 / N) * N is rejected so the
 * accepted bytes map 1:1 onto `[0, N)` without modulo bias. Reads
 * additional CSPRNG bytes as needed.
 */
function pickOne(chars: string): string {
	const N = chars.length;
	if (N === 0) throw new Error('pickOne: empty alphabet');
	const cap = Math.floor(256 / N) * N;
	const buf = new Uint8Array(8);
	while (true) {
		crypto.getRandomValues(buf);
		for (const byte of buf) {
			if (byte < cap) return chars[byte % N]!;
		}
	}
}

/**
 * In-place Fisher-Yates shuffle using CSPRNG bytes. For arrays up to
 * 256 elements (our `MAX_LENGTH`), one byte per swap is sufficient and
 * unbiased via rejection sampling.
 */
function shuffleInPlace<T>(arr: T[]): void {
	const n = arr.length;
	if (n <= 1) return;
	if (n > 256) throw new Error('shuffleInPlace: array too large for byte-indexed shuffle');
	const buf = new Uint8Array(1);
	for (let i = n - 1; i > 0; i--) {
		const cap = Math.floor(256 / (i + 1)) * (i + 1);
		let byte: number;
		do {
			crypto.getRandomValues(buf);
			byte = buf[0]!;
		} while (byte >= cap);
		const j = byte % (i + 1);
		const tmp = arr[i]!;
		arr[i] = arr[j]!;
		arr[j] = tmp;
	}
}

export function generate(opts: GeneratorOpts): string {
	if (
		typeof opts.length !== 'number' ||
		!Number.isFinite(opts.length) ||
		opts.length < MIN_LENGTH ||
		opts.length > MAX_LENGTH ||
		!Number.isInteger(opts.length)
	) {
		throw new Error(
			`Password length must be an integer in [${MIN_LENGTH}, ${MAX_LENGTH}]`
		);
	}

	const classes = enabledClasses(opts);
	if (classes.length === 0) {
		throw new Error('Empty alphabet — enable at least one character class');
	}
	if (classes.length > opts.length) {
		// Shouldn't happen with sensible UI (length defaults to 24, max 4
		// classes), but defend in depth: we cannot guarantee coverage of
		// more classes than there are characters.
		throw new Error(
			`Length ${opts.length} too short to cover ${classes.length} character classes`
		);
	}

	// 1) Reserve one slot per enabled class with a uniform pick from
	//    that class. This guarantees coverage.
	const out: string[] = classes.map((c) => pickOne(c.chars));

	// 2) Build the merged alphabet for the remaining positions. Drop
	//    duplicates that may arise across classes (none today, but
	//    defensive against future config).
	const merged = Array.from(new Set(classes.flatMap((c) => c.chars.split('')))).join('');

	// 3) Fill remaining positions from the merged alphabet.
	while (out.length < opts.length) {
		out.push(pickOne(merged));
	}

	// 4) Shuffle so the reserved class characters don't all cluster at
	//    the start.
	shuffleInPlace(out);

	return out.join('');
}

/**
 * Information-theoretic entropy of the merged-alphabet model. This is
 * an upper bound when class coverage is enforced (because the first
 * `k` slots are constrained to one class), but the per-position bias
 * is small at typical lengths (≥ 12) and the headline number is the
 * one users compare to other tools.
 */
export function entropyBits(opts: GeneratorOpts): number {
	const classes = enabledClasses(opts);
	const merged = new Set(classes.flatMap((c) => c.chars.split(''))).size;
	if (merged === 0) return 0;
	const len = Math.max(0, Math.floor(opts.length || 0));
	return Math.log2(merged) * len;
}

/**
 * Test-only helper exposing the merged alphabet so unit tests can
 * verify that excludeAmbiguous actually strips the ambiguous chars.
 */
export function _alphabetFor(opts: GeneratorOpts): string {
	return Array.from(
		new Set(enabledClasses(opts).flatMap((c) => c.chars.split('')))
	).join('');
}
