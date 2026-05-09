/**
 * Landing page data — Compare table rows, Stack steps/layers, etc.
 * Keeps templates declarative and centralizes the prose so copy
 * changes don't touch component files.
 */

/**
 * Compare-table cell sentinels. Beyond the binary yes/no/partial set,
 * `tier-2` and `tier-3` mark capabilities that are *designed* for the
 * VuVault stack but not yet shipped — they correspond to the roadmap
 * tiers in `docs/ROADMAP.md` (Tier 2 = M3 sync server / 2027, Tier 3 =
 * 2028 transparency log + PIR breach check). Rendering them as
 * forward-loaded badges instead of solid green checks closes Breach B4
 * from `docs/CHECKPOINT-ANALYSIS.md` (marketing claims that don't yet
 * substantiate against the codebase).
 */
export type CompareCell =
	| 'yes'
	| 'no'
	| 'partial'
	| 'tier-2'
	| 'tier-3'
	| { text: string };

export type CompareRow = {
	label: string;
	sub: string;
	cells: [CompareCell, CompareCell, CompareCell, CompareCell, CompareCell];
};

export const COMPARE_HEADERS = [
	'VuVault',
	'1Password',
	'Bitwarden',
	'Proton Pass',
	'Apple Passwords'
] as const;

export const COMPARE_ROWS: CompareRow[] = [
	{
		// Client-side OPAQUE (RFC 9807) is shipped behind a facade with
		// a mock in-process server (Milestone 2). The real cross-origin
		// server lands with the Tier-2 sync ship — the *guarantee* is
		// architectural today, the deployment that exercises it is
		// roadmap-bound.
		label: 'Server cannot see master password',
		sub: 'OPAQUE / aPAKE — Tier 2 deployment',
		cells: ['tier-2', 'no', 'no', 'no', 'partial']
	},
	{
		label: 'Post-quantum vault encryption',
		sub: 'ML-KEM-1024 hybrid (FIPS 203, KAT-locked)',
		cells: ['yes', 'no', 'no', 'no', 'no']
	},
	{
		label: 'Master-password-free unlock',
		sub: 'WebAuthn PRF',
		cells: ['yes', 'no', 'no', 'no', 'partial']
	},
	{
		// L09 CONIKS / AKD lands in Tier 2 (2027) per the canonical
		// blueprint at src/routes/blueprint/+page.svelte.
		label: 'Verifiable transparency log',
		sub: 'CONIKS-style key log — Tier 2',
		cells: ['tier-2', 'no', 'no', 'no', 'no']
	},
	{
		// L10 PIR + PSI breach checks land in Tier 2 (2027) per the
		// canonical blueprint at src/routes/blueprint/+page.svelte.
		label: 'Private breach check',
		sub: 'PIR — server learns zero — Tier 2',
		cells: ['tier-2', 'partial', 'partial', 'partial', 'no']
	},
	{
		// L11 FROST threshold recovery is Tier 3 (2028) per the
		// canonical blueprint at src/routes/blueprint/+page.svelte.
		label: 'Threshold-recovery without server',
		sub: 'FROST t-of-n — Tier 3',
		cells: ['tier-3', 'no', 'no', 'no', 'no']
	},
	{
		// SHA-384 manifest + in-page verifier are shipped today
		// (`scripts/build-manifest.mjs` + `verifyBundleIntegrity()`).
		// Sigstore Rekor publishing lands with Tier 2 release tooling.
		label: 'Reproducible builds + transparency',
		sub: 'SHA-384 manifest now · Rekor publish Tier 2',
		cells: ['partial', 'no', 'partial', 'partial', 'no']
	},
	{
		// BYO storage requires the Tier-2 sync server.
		label: 'Self-hosting / BYO storage',
		sub: 'Point at your own R2 / S3 — Tier 2',
		cells: ['tier-2', 'no', 'yes', 'no', 'no']
	},
	{
		label: 'Open source',
		sub: 'Apache 2.0, fully forkable',
		cells: ['yes', 'no', 'yes', 'partial', 'no']
	},
	{
		label: 'Lifetime price',
		sub: 'One time, no subscription',
		cells: [
			{ text: '$25.60/yr' },
			{ text: '$35.88' },
			{ text: '$19.80' },
			{ text: '$23.88' },
			{ text: 'free' }
		]
	}
];

export const STACK_STEPS_USER = [
	{
		num: '01',
		title: 'You sign up',
		body: 'Pick a Secret Key. Touch your authenticator. No master password to memorize.'
	},
	{
		num: '02',
		title: 'Your device generates keys',
		body: 'A 256-bit Secret Key + WebAuthn PRF derive your vault key locally. The server never sees them.'
	},
	{
		num: '03',
		title: 'Vault encrypts itself',
		body: 'Hybrid X25519 + ML-KEM-1024 envelope encrypts your data before any byte leaves the device.'
	},
	{
		num: '04',
		title: 'Sync without trust',
		body: 'Encrypted blobs travel through the cloud. The provider holds opaque ciphertext only.'
	}
];

export type StackLayer = {
	num: string;
	name: string;
	role: string;
	prim: string;
	tag: 'shipped' | 'partial' | 'alone';
	tagText: string;
};

/**
 * Numbering follows the canonical layer index in
 * `src/routes/blueprint/+page.svelte` (L01 = OPAQUE … L18 = pure-PQ
 * threshold recovery). The landing surface only exposes the first ten
 * layers, drawn directly from the blueprint, so promotional copy and
 * the architectural blueprint never disagree on what L## means.
 */
export const STACK_LAYERS_TECH: StackLayer[] = [
	{
		num: 'L01',
		name: 'OPAQUE',
		role: 'aPAKE — server never sees password equivalents',
		prim: 'RFC 9807',
		tag: 'partial',
		tagText: 'Client + mock server'
	},
	{
		num: 'L02',
		name: 'PRF + Secret Key',
		role: 'WebAuthn-PRF ‖ Secret Key ‖ deviceSalt → HKDF-SHA512',
		prim: 'WebAuthn L3 · RFC 5869',
		tag: 'shipped',
		tagText: 'Shipped'
	},
	{
		num: 'L03',
		name: 'Hybrid envelope',
		role: 'X25519 + ML-KEM-1024 KEM, AES-256-GCM AEAD',
		prim: 'FIPS 203 · RFC 7748',
		tag: 'shipped',
		tagText: 'KAT-locked'
	},
	{
		num: 'L04',
		name: 'XMSS release signatures',
		role: 'Stateful hash-based signatures over release artifacts',
		prim: 'NIST SP 800-208',
		tag: 'partial',
		tagText: 'Build pipeline'
	},
	{
		num: 'L05',
		name: 'Reproducible builds + Sigstore',
		role: 'SHA-384 manifest verified in-page; Rekor entry per release',
		prim: 'SLSA L3 · Sigstore',
		tag: 'partial',
		tagText: 'Manifest now · Rekor Tier 2'
	},
	{
		num: 'L06',
		name: 'MLS sharing',
		role: 'Group encryption with forward secrecy',
		prim: 'RFC 9420 / 9750',
		tag: 'partial',
		tagText: 'Tier 2 spec'
	},
	{
		num: 'L07',
		name: 'CRDT sync',
		role: 'Encrypted blob diffs over hybrid PQ envelope',
		prim: 'Yjs · HPKE · ML-KEM-768',
		tag: 'partial',
		tagText: 'Tier 2 spec'
	},
	{
		num: 'L08',
		name: 'WebRTC + ECDH pairing',
		role: 'Local-first device pairing without server intermediation',
		prim: 'WebRTC · X25519',
		tag: 'partial',
		tagText: 'Tier 2 spec'
	},
	{
		num: 'L09',
		name: 'CONIKS / AKD',
		role: 'Authenticated key directory with verifiable transparency',
		prim: 'CONIKS · WhatsApp AKD',
		tag: 'alone',
		tagText: 'Tier 2 spec'
	},
	{
		num: 'L10',
		name: 'PIR + PSI breach checks',
		role: 'Server learns nothing about which password you queried',
		prim: 'RFC 9497 VOPRF · OPRF-PSI',
		tag: 'alone',
		tagText: 'Tier 2 spec'
	}
];
