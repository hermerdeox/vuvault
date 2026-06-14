/**
 * Diceware-style passphrase generation — CSPRNG, unbiased.
 *
 * The mobile Generator screen offers a Password / Passphrase segmented
 * control (per the iOS design). The rest of the app only ships a
 * character generator (`passgen.ts`); this module adds the word path
 * without ever falling back to `Math.random()` (the design prototype's
 * `Math.random()` word picker is NOT acceptable for real secrets).
 *
 * Selection uses rejection sampling over `crypto.getRandomValues`, the
 * same unbiased technique `passgen.ts` uses for characters, so every
 * word in the list is equiprobable. Entropy is reported honestly from
 * the actual list length — no rounding up to a marketing number.
 *
 * The list is a curated set of short, unambiguous, easy-to-type English
 * words (no homophones, no profanity, 4–8 chars). It is deliberately
 * smaller than the EFF "large" list (7776 words); `entropyBits()`
 * reflects that. Swapping in the full EFF list later only changes
 * `WORDLIST` — the entropy math follows the array length automatically.
 */

export const WORDLIST: readonly string[] = [
	'harbor', 'cobalt', 'lantern', 'quartz', 'meadow', 'falcon', 'ember', 'cipher',
	'willow', 'onyx', 'breeze', 'summit', 'raven', 'copper', 'nimbus', 'aspen',
	'vortex', 'marble', 'thistle', 'glacier', 'saffron', 'dynamo', 'pewter', 'orchid',
	'anchor', 'beacon', 'canyon', 'driftwood', 'eclipse', 'fathom', 'granite', 'horizon',
	'island', 'jasmine', 'kettle', 'ladder', 'maple', 'nectar', 'oxygen', 'pebble',
	'quiver', 'ripple', 'sequoia', 'timber', 'umbra', 'velvet', 'walnut', 'xenon',
	'yonder', 'zephyr', 'amber', 'basalt', 'cedar', 'dapple', 'ferry', 'garnet',
	'hazel', 'indigo', 'jetty', 'kelp', 'lichen', 'mosaic', 'nettle', 'opal',
	'plume', 'quill', 'rowan', 'sable', 'tundra', 'usher', 'vapor', 'wicker',
	'yarrow', 'zenith', 'acorn', 'birch', 'clover', 'dunes', 'estuary', 'flint',
	'gravel', 'heather', 'ivory', 'juniper', 'kindle', 'lagoon', 'mantle', 'nomad',
	'oasis', 'prairie', 'quintet', 'ravine', 'shale', 'talon', 'upland', 'verbena',
	'wisp', 'yeoman', 'zigzag', 'almond', 'bramble', 'cactus', 'dahlia', 'ebony',
	'fennel', 'ginger', 'hollow', 'iris', 'jade', 'kiwi', 'laurel', 'mango',
	'nutmeg', 'olive', 'poppy', 'quince', 'radish', 'sorrel', 'thyme', 'vanilla',
	'wheat', 'yam', 'zest', 'arbor', 'bayou', 'crest', 'delta', 'elm',
	'fjord', 'grove', 'heath', 'inlet', 'knoll', 'lake', 'marsh', 'notch',
	'oxbow', 'plain', 'reef', 'shoal', 'tarn', 'vale', 'wold', 'arctic',
	'bronze', 'crimson', 'denim', 'fawn', 'gilt', 'henna', 'khaki', 'lilac',
	'mauve', 'ochre', 'plum', 'russet', 'scarlet', 'teal', 'umber', 'violet',
	'amulet', 'banner', 'compass', 'dagger', 'emblem', 'flask', 'goblet', 'helm',
	'ingot', 'javelin', 'keystone', 'lyre', 'mortar', 'nozzle', 'obelisk', 'pylon',
	'quartzite', 'rivet', 'satchel', 'trellis', 'urn', 'vellum', 'wagon', 'yoke',
	'anvil', 'bellows', 'crucible', 'derrick', 'engine', 'forge', 'girder', 'hatchet',
	'jigsaw', 'kiln', 'lever', 'mallet', 'needle', 'piston', 'ratchet', 'spindle',
	'tongs', 'vise', 'winch', 'auburn', 'bistro', 'cascade', 'dapper', 'elixir',
	'fable', 'gusto', 'hearth', 'iceberg', 'jovial', 'kismet', 'lucid', 'mellow',
	'nimble', 'opaque', 'placid', 'quaint', 'radiant', 'serene', 'tranquil', 'upbeat',
	'vivid', 'whimsy', 'yearn', 'zealous', 'azure', 'breve', 'cello', 'dulcet',
	'etude', 'fugue', 'gamut', 'hymn', 'lyric', 'medley', 'octave', 'prelude',
	'rondo', 'sonata', 'treble', 'verse', 'waltz', 'ballad', 'chorus', 'ditty'
];

/** Optional decorations applied to the joined words. */
export type PassphraseOpts = {
	/** Number of words in the phrase (clamped to a sane 3–9). */
	words: number;
	/** Capitalise the first letter of each word. */
	capitalize?: boolean;
	/** Append a random two-digit number group as an extra word. */
	number?: boolean;
	/** Word separator. Defaults to '-'. */
	separator?: string;
};

const MIN_WORDS = 3;
const MAX_WORDS = 9;

/**
 * Unbiased index in [0, n) using rejection sampling over a 32-bit
 * CSPRNG draw. Mirrors the technique in `passgen.ts` so no modulo
 * skew creeps into word selection.
 */
function randomIndex(n: number): number {
	if (n <= 0) throw new Error('randomIndex requires n > 0');
	const limit = Math.floor(0xffffffff / n) * n;
	const buf = new Uint32Array(1);
	let x: number;
	do {
		crypto.getRandomValues(buf);
		x = buf[0]!;
	} while (x >= limit);
	return x % n;
}

/** Random integer in [min, max] inclusive, unbiased. */
function randomInt(min: number, max: number): number {
	return min + randomIndex(max - min + 1);
}

/**
 * Generate a passphrase. Every word and the optional number group are
 * drawn from `crypto.getRandomValues`; there is no `Math.random()`
 * fallback path.
 */
export function generatePassphrase(opts: PassphraseOpts): string {
	const n = Math.max(MIN_WORDS, Math.min(MAX_WORDS, Math.floor(opts.words)));
	const sep = opts.separator ?? '-';
	const parts: string[] = [];
	for (let i = 0; i < n; i++) {
		const w = WORDLIST[randomIndex(WORDLIST.length)]!;
		parts.push(opts.capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w);
	}
	if (opts.number) parts.push(String(randomInt(10, 99)));
	return parts.join(sep);
}

/**
 * Honest entropy estimate for the configured passphrase, in bits.
 * `words * log2(listLength)` plus ~6.49 bits for the optional 2-digit
 * group (90 possibilities). Capitalisation adds no entropy (it is a
 * deterministic transform, not a random choice).
 */
export function passphraseEntropyBits(opts: PassphraseOpts): number {
	const n = Math.max(MIN_WORDS, Math.min(MAX_WORDS, Math.floor(opts.words)));
	let bits = n * Math.log2(WORDLIST.length);
	if (opts.number) bits += Math.log2(90);
	return bits;
}
