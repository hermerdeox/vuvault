/**
 * US billing-address intelligence — pure, local, zero network.
 *
 * Parses a single-line address ("1234 Market St, San Francisco, CA
 * 94103"), validates it structurally (street → city → state → ZIP,
 * with a ZIP3-prefix → state consistency table), and offers local
 * autocomplete for the "City, ST" segment from a bundled list of
 * major US cities. No API, no dependency — the dataset ships in the
 * bundle like any other code.
 */

export const US_STATES: Record<string, string> = {
	AL: 'Alabama',
	AK: 'Alaska',
	AZ: 'Arizona',
	AR: 'Arkansas',
	CA: 'California',
	CO: 'Colorado',
	CT: 'Connecticut',
	DE: 'Delaware',
	DC: 'District of Columbia',
	FL: 'Florida',
	GA: 'Georgia',
	HI: 'Hawaii',
	ID: 'Idaho',
	IL: 'Illinois',
	IN: 'Indiana',
	IA: 'Iowa',
	KS: 'Kansas',
	KY: 'Kentucky',
	LA: 'Louisiana',
	ME: 'Maine',
	MD: 'Maryland',
	MA: 'Massachusetts',
	MI: 'Michigan',
	MN: 'Minnesota',
	MS: 'Mississippi',
	MO: 'Missouri',
	MT: 'Montana',
	NE: 'Nebraska',
	NV: 'Nevada',
	NH: 'New Hampshire',
	NJ: 'New Jersey',
	NM: 'New Mexico',
	NY: 'New York',
	NC: 'North Carolina',
	ND: 'North Dakota',
	OH: 'Ohio',
	OK: 'Oklahoma',
	OR: 'Oregon',
	PA: 'Pennsylvania',
	RI: 'Rhode Island',
	SC: 'South Carolina',
	SD: 'South Dakota',
	TN: 'Tennessee',
	TX: 'Texas',
	UT: 'Utah',
	VT: 'Vermont',
	VA: 'Virginia',
	WA: 'Washington',
	WV: 'West Virginia',
	WI: 'Wisconsin',
	WY: 'Wyoming'
};

/** ZIP 3-digit-prefix ranges per state (inclusive, approximate USPS map). */
const ZIP3_RANGES: Record<string, Array<[number, number]>> = {
	AL: [[350, 369]],
	AK: [[995, 999]],
	AZ: [[850, 865]],
	AR: [[716, 729]],
	CA: [[900, 961]],
	CO: [[800, 816]],
	CT: [[60, 69]],
	DE: [[197, 199]],
	DC: [[200, 205]],
	FL: [[320, 349]],
	GA: [
		[300, 319],
		[398, 399]
	],
	HI: [[967, 968]],
	ID: [[832, 838]],
	IL: [[600, 629]],
	IN: [[460, 479]],
	IA: [[500, 528]],
	KS: [[660, 679]],
	KY: [[400, 427]],
	LA: [[700, 714]],
	ME: [[39, 49]],
	MD: [[206, 219]],
	MA: [
		[10, 27],
		[55, 55]
	],
	MI: [[480, 499]],
	MN: [[550, 567]],
	MS: [[386, 397]],
	MO: [[630, 658]],
	MT: [[590, 599]],
	NE: [[680, 693]],
	NV: [[889, 898]],
	NH: [[30, 38]],
	NJ: [[70, 89]],
	NM: [[870, 884]],
	NY: [
		[5, 5],
		[100, 149]
	],
	NC: [[270, 289]],
	ND: [[580, 588]],
	OH: [[430, 459]],
	OK: [[730, 749]],
	OR: [[970, 979]],
	PA: [[150, 196]],
	RI: [[28, 29]],
	SC: [[290, 299]],
	SD: [[570, 577]],
	TN: [[370, 385]],
	TX: [
		[733, 733],
		[750, 799],
		[885, 885]
	],
	UT: [[840, 847]],
	VT: [[50, 59]],
	VA: [
		[201, 201],
		[220, 246]
	],
	WA: [[980, 994]],
	WV: [[247, 268]],
	WI: [[530, 549]],
	WY: [[820, 831]]
};

/** Major US cities for the "City, ST" autocomplete segment. */
export const US_CITIES: ReadonlyArray<{ city: string; state: string }> = [
	{ city: 'New York', state: 'NY' },
	{ city: 'Los Angeles', state: 'CA' },
	{ city: 'Chicago', state: 'IL' },
	{ city: 'Houston', state: 'TX' },
	{ city: 'Phoenix', state: 'AZ' },
	{ city: 'Philadelphia', state: 'PA' },
	{ city: 'San Antonio', state: 'TX' },
	{ city: 'San Diego', state: 'CA' },
	{ city: 'Dallas', state: 'TX' },
	{ city: 'Austin', state: 'TX' },
	{ city: 'Jacksonville', state: 'FL' },
	{ city: 'San Jose', state: 'CA' },
	{ city: 'Fort Worth', state: 'TX' },
	{ city: 'Columbus', state: 'OH' },
	{ city: 'Charlotte', state: 'NC' },
	{ city: 'Indianapolis', state: 'IN' },
	{ city: 'San Francisco', state: 'CA' },
	{ city: 'Seattle', state: 'WA' },
	{ city: 'Denver', state: 'CO' },
	{ city: 'Oklahoma City', state: 'OK' },
	{ city: 'Nashville', state: 'TN' },
	{ city: 'Washington', state: 'DC' },
	{ city: 'El Paso', state: 'TX' },
	{ city: 'Las Vegas', state: 'NV' },
	{ city: 'Boston', state: 'MA' },
	{ city: 'Detroit', state: 'MI' },
	{ city: 'Portland', state: 'OR' },
	{ city: 'Louisville', state: 'KY' },
	{ city: 'Memphis', state: 'TN' },
	{ city: 'Baltimore', state: 'MD' },
	{ city: 'Milwaukee', state: 'WI' },
	{ city: 'Albuquerque', state: 'NM' },
	{ city: 'Tucson', state: 'AZ' },
	{ city: 'Fresno', state: 'CA' },
	{ city: 'Sacramento', state: 'CA' },
	{ city: 'Mesa', state: 'AZ' },
	{ city: 'Kansas City', state: 'MO' },
	{ city: 'Atlanta', state: 'GA' },
	{ city: 'Colorado Springs', state: 'CO' },
	{ city: 'Omaha', state: 'NE' },
	{ city: 'Raleigh', state: 'NC' },
	{ city: 'Miami', state: 'FL' },
	{ city: 'Virginia Beach', state: 'VA' },
	{ city: 'Long Beach', state: 'CA' },
	{ city: 'Oakland', state: 'CA' },
	{ city: 'Minneapolis', state: 'MN' },
	{ city: 'Tampa', state: 'FL' },
	{ city: 'Tulsa', state: 'OK' },
	{ city: 'Arlington', state: 'TX' },
	{ city: 'Wichita', state: 'KS' },
	{ city: 'Bakersfield', state: 'CA' },
	{ city: 'Aurora', state: 'CO' },
	{ city: 'New Orleans', state: 'LA' },
	{ city: 'Cleveland', state: 'OH' },
	{ city: 'Anaheim', state: 'CA' },
	{ city: 'Honolulu', state: 'HI' },
	{ city: 'Henderson', state: 'NV' },
	{ city: 'Stockton', state: 'CA' },
	{ city: 'Riverside', state: 'CA' },
	{ city: 'Lexington', state: 'KY' },
	{ city: 'Corpus Christi', state: 'TX' },
	{ city: 'Orlando', state: 'FL' },
	{ city: 'Irvine', state: 'CA' },
	{ city: 'Cincinnati', state: 'OH' },
	{ city: 'Santa Ana', state: 'CA' },
	{ city: 'Newark', state: 'NJ' },
	{ city: 'Saint Paul', state: 'MN' },
	{ city: 'Pittsburgh', state: 'PA' },
	{ city: 'Greensboro', state: 'NC' },
	{ city: 'Durham', state: 'NC' },
	{ city: 'Lincoln', state: 'NE' },
	{ city: 'Jersey City', state: 'NJ' },
	{ city: 'Plano', state: 'TX' },
	{ city: 'Anchorage', state: 'AK' },
	{ city: 'North Las Vegas', state: 'NV' },
	{ city: 'St. Louis', state: 'MO' },
	{ city: 'Madison', state: 'WI' },
	{ city: 'Chandler', state: 'AZ' },
	{ city: 'Gilbert', state: 'AZ' },
	{ city: 'Reno', state: 'NV' },
	{ city: 'Buffalo', state: 'NY' },
	{ city: 'Chula Vista', state: 'CA' },
	{ city: 'Fort Wayne', state: 'IN' },
	{ city: 'Lubbock', state: 'TX' },
	{ city: 'Toledo', state: 'OH' },
	{ city: 'St. Petersburg', state: 'FL' },
	{ city: 'Laredo', state: 'TX' },
	{ city: 'Irving', state: 'TX' },
	{ city: 'Chesapeake', state: 'VA' },
	{ city: 'Glendale', state: 'AZ' },
	{ city: 'Winston-Salem', state: 'NC' },
	{ city: 'Scottsdale', state: 'AZ' },
	{ city: 'Garland', state: 'TX' },
	{ city: 'Boise', state: 'ID' },
	{ city: 'Norfolk', state: 'VA' },
	{ city: 'Spokane', state: 'WA' },
	{ city: 'Richmond', state: 'VA' },
	{ city: 'Fremont', state: 'CA' },
	{ city: 'Huntsville', state: 'AL' },
	{ city: 'Frisco', state: 'TX' },
	{ city: 'Cape Coral', state: 'FL' },
	{ city: 'Santa Clarita', state: 'CA' },
	{ city: 'San Bernardino', state: 'CA' },
	{ city: 'Tacoma', state: 'WA' },
	{ city: 'Hialeah', state: 'FL' },
	{ city: 'Baton Rouge', state: 'LA' },
	{ city: 'Modesto', state: 'CA' },
	{ city: 'Fontana', state: 'CA' },
	{ city: 'McKinney', state: 'TX' },
	{ city: 'Moreno Valley', state: 'CA' },
	{ city: 'Des Moines', state: 'IA' },
	{ city: 'Fayetteville', state: 'NC' },
	{ city: 'Salt Lake City', state: 'UT' },
	{ city: 'Yonkers', state: 'NY' },
	{ city: 'Worcester', state: 'MA' },
	{ city: 'Rochester', state: 'NY' },
	{ city: 'Sioux Falls', state: 'SD' },
	{ city: 'Little Rock', state: 'AR' },
	{ city: 'Portland', state: 'ME' },
	{ city: 'Providence', state: 'RI' },
	{ city: 'Charleston', state: 'SC' },
	{ city: 'Billings', state: 'MT' },
	{ city: 'Fargo', state: 'ND' },
	{ city: 'Burlington', state: 'VT' },
	{ city: 'Manchester', state: 'NH' },
	{ city: 'Wilmington', state: 'DE' },
	{ city: 'Cheyenne', state: 'WY' },
	{ city: 'Jackson', state: 'MS' },
	{ city: 'Bridgeport', state: 'CT' },
	{ city: 'Albany', state: 'NY' },
	{ city: 'Savannah', state: 'GA' },
	{ city: 'Knoxville', state: 'TN' },
	{ city: 'Chattanooga', state: 'TN' },
	{ city: 'Augusta', state: 'GA' },
	{ city: 'Columbia', state: 'SC' },
	{ city: 'Mobile', state: 'AL' },
	{ city: 'Birmingham', state: 'AL' },
	{ city: 'Grand Rapids', state: 'MI' },
	{ city: 'Ann Arbor', state: 'MI' },
	{ city: 'Salem', state: 'OR' },
	{ city: 'Eugene', state: 'OR' },
	{ city: 'Bellevue', state: 'WA' },
	{ city: 'Pasadena', state: 'CA' },
	{ city: 'Berkeley', state: 'CA' },
	{ city: 'Santa Monica', state: 'CA' },
	{ city: 'Cambridge', state: 'MA' },
	{ city: 'Alexandria', state: 'VA' },
	{ city: 'Arlington', state: 'VA' },
	{ city: 'Brooklyn', state: 'NY' },
	{ city: 'Queens', state: 'NY' },
	{ city: 'Bronx', state: 'NY' },
	{ city: 'Staten Island', state: 'NY' }
];

export type ParsedAddress = {
	street: string;
	city: string;
	state: string;
	zip: string;
};

export type AddressValidation = {
	/** All segments present and mutually consistent. */
	valid: boolean;
	/** Human hint for the next missing/incorrect segment. */
	hint: string;
	parsed: ParsedAddress;
};

export function zipMatchesState(zip: string, state: string): boolean {
	const ranges = ZIP3_RANGES[state.toUpperCase()];
	if (!ranges || !/^\d{5}(-\d{4})?$/.test(zip)) return false;
	const prefix = Number(zip.slice(0, 3));
	return ranges.some(([lo, hi]) => prefix >= lo && prefix <= hi);
}

function normalizeState(raw: string): string {
	const upper = raw.trim().toUpperCase();
	if (US_STATES[upper]) return upper;
	const byName = Object.entries(US_STATES).find(
		([, name]) => name.toUpperCase() === upper
	);
	return byName ? byName[0] : '';
}

/**
 * Parse "street, city, ST zip" (state name accepted; ZIP optional
 * during typing). Tolerant of missing trailing segments.
 */
export function parseAddressLine(line: string): ParsedAddress {
	const parts = line.split(',').map((p) => p.trim());
	const street = parts[0] ?? '';
	const city = parts[1] ?? '';
	let state = '';
	let zip = '';
	const tail = (parts[2] ?? '').trim();
	if (tail) {
		const m = tail.match(/^([A-Za-z .]+?)\s*(\d{5}(?:-\d{4})?)?$/);
		if (m) {
			state = normalizeState(m[1] ?? '');
			zip = m[2] ?? '';
		}
	}
	return { street, city, state, zip };
}

export function validateAddressLine(line: string): AddressValidation {
	const parsed = parseAddressLine(line);
	const { street, city, state, zip } = parsed;

	if (!street || !/\d+\s+\S+/.test(street)) {
		return { valid: false, hint: 'Start with a street number and name', parsed };
	}
	if (!city) {
		return { valid: false, hint: 'Add a comma, then the city', parsed };
	}
	if (!state) {
		return { valid: false, hint: 'Add a comma, then the state (CA or California)', parsed };
	}
	if (!zip) {
		return { valid: false, hint: 'Finish with the 5-digit ZIP', parsed };
	}
	if (!/^\d{5}(-\d{4})?$/.test(zip)) {
		return { valid: false, hint: 'ZIP must be 5 digits (or ZIP+4)', parsed };
	}
	if (!zipMatchesState(zip, state)) {
		return {
			valid: false,
			hint: `ZIP ${zip} doesn't match ${US_STATES[state] ?? state}`,
			parsed
		};
	}
	return { valid: true, hint: '', parsed };
}

/**
 * Local autocomplete for the city/state segment. Activates once the
 * street segment is followed by a comma; suggests full lines
 * "street, City, ST " narrowed by what's typed after the comma.
 */
export function suggestAddressLine(line: string, limit = 10): string[] {
	const firstComma = line.indexOf(',');
	if (firstComma === -1) return [];
	const street = line.slice(0, firstComma).trim();
	if (!street) return [];
	const rest = line.slice(firstComma + 1).trimStart();
	if (rest.includes(',')) return []; // city chosen; user is on state/zip
	const q = rest.toLowerCase();
	const matches = US_CITIES.filter(({ city, state }) => {
		const label = `${city}, ${state}`.toLowerCase();
		return q === '' || city.toLowerCase().startsWith(q) || label.startsWith(q);
	});
	return matches.slice(0, limit).map(({ city, state }) => `${street}, ${city}, ${state} `);
}

/** Join stored billing fields back into the single-line format. */
export function joinAddressLine(parts: {
	billingAddress?: string;
	billingCity?: string;
	billingState?: string;
	billingZip?: string;
}): string {
	const cityStateZip = [
		parts.billingCity,
		[parts.billingState, parts.billingZip].filter(Boolean).join(' ')
	]
		.filter((s) => s && s.trim())
		.join(', ');
	return [parts.billingAddress, cityStateZip].filter((s) => s && s.trim()).join(', ');
}
