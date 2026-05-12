/**
 * Vu Ecosystem — catalog of apps announced for the VuVault privacy-first
 * suite, grouped by category. Drives the global VuEcosystemLauncher
 * surface mounted in the root layout. Source of truth for app names,
 * categories, short descriptions, and shipping status.
 *
 * The data lives in TypeScript (not JSON) so editors get autocomplete
 * on category/status enums and so the CI marketing-claim guard can
 * statically scan the strings.
 */

export type AppStatus = 'available' | 'shipping-next' | 'concept';

/** Apps that ship with a renderable inline mockup on the detail view. */
export type MockupKind = 'vault' | 'blink' | 'journal' | 'tunnel' | 'ledger';

export type EcosystemApp = {
	/** Public-facing app name, e.g. `VuVault`. */
	name: string;
	/** One-liner used on cards and detail headers. */
	tagline: string;
	/** Longer privacy-focused promise rendered on the detail view. */
	promise: string;
	/** Lifecycle stage — controls the badge on the card and detail page. */
	status: AppStatus;
	/** If present, the detail view shows an Enable button + inline mockup. */
	mockup?: MockupKind;
};

export type EcosystemCategory = {
	/** Stable id used for keyed iteration. */
	id: string;
	/** Display label, e.g. `Productivity`. */
	label: string;
	/** One-line group description. */
	description: string;
	/** Single short-form glyph (one emoji-free char or 2-letter code). */
	glyph: string;
	/** Per-category accent colors — drive cards, strip chips, and detail glow. */
	color: {
		/** Solid accent for borders, dots, badges. */
		accent: string;
		/** Gradient `from` color for card backgrounds. */
		from: string;
		/** Gradient `to` color for card backgrounds. */
		to: string;
		/** Soft halo used as a card hover shadow / detail glow. */
		halo: string;
	};
	apps: EcosystemApp[];
};

const CATEGORIES: EcosystemCategory[] = [
	{
		id: 'productivity',
		label: 'Productivity',
		description: 'Personal workflow tools that keep your day off the cloud.',
		glyph: 'Pr',
		color: {
			accent: '#7dd3fc',
			from: 'rgba(125, 211, 252, 0.18)',
			to: 'rgba(59, 130, 246, 0.04)',
			halo: 'rgba(125, 211, 252, 0.35)'
		},
		apps: [
			{
				name: 'VuNotes',
				tagline: 'Encrypted notes',
				promise: 'Long-form notes encrypted on device. The provider only ever sees ciphertext.',
				status: 'concept'
			},
			{
				name: 'VuTask',
				tagline: 'Private to-dos',
				promise: 'Task lists, projects, and reminders without analytics, ads, or third-party trackers.',
				status: 'concept'
			},
			{
				name: 'VuCalendar',
				tagline: 'Offline schedule',
				promise: 'Local-first calendar with optional encrypted sync. No invitee metadata leaks.',
				status: 'concept'
			},
			{
				name: 'VuHabit',
				tagline: 'Streaks, no trail',
				promise: 'Habit streaks that live on your device. Daily check-ins never leave hardware you control.',
				status: 'concept'
			},
			{
				name: 'VuTime',
				tagline: 'Pomodoro timer',
				promise: 'Focus timer with on-device session history. No cross-site identifiers, ever.',
				status: 'concept'
			},
			{
				name: 'VuFocus',
				tagline: 'Distraction blocker',
				promise: 'Block lists and quiet hours enforced locally. The blocklist itself stays private.',
				status: 'concept'
			}
		]
	},
	{
		id: 'communication',
		label: 'Communication',
		description: 'End-to-end conversations and shares with zero server visibility.',
		glyph: 'Co',
		color: {
			accent: '#c4b5fd',
			from: 'rgba(196, 181, 253, 0.18)',
			to: 'rgba(139, 92, 246, 0.04)',
			halo: 'rgba(167, 139, 250, 0.35)'
		},
		apps: [
			{
				name: 'VuChat',
				tagline: 'E2E messaging',
				promise: 'Group messaging with forward-secret keys. The transport sees only opaque ciphertext.',
				status: 'concept'
			},
			{
				name: 'VuText',
				tagline: 'Self-destruct chat',
				promise: 'Ephemeral one-to-one threads. Messages vanish from every device by policy.',
				status: 'concept'
			},
			{
				name: 'VuMail',
				tagline: 'Encrypted email',
				promise: 'Email with envelope encryption you can verify. Sender, subject, and body stay sealed.',
				status: 'concept'
			},
			{
				name: 'VuShare',
				tagline: 'P2P file drops',
				promise: 'Peer-to-peer transfers via short-lived links. Files never sit on a server in plaintext.',
				status: 'concept'
			},
			{
				name: 'VuCall',
				tagline: 'P2P video calls',
				promise: 'Direct video sessions over end-to-end encrypted transport. No call recordings retained.',
				status: 'concept'
			},
			{
				name: 'VuSocial',
				tagline: 'Trusted-circle feed',
				promise: 'Posts to people you authorize. Cryptographic circles instead of follower graphs.',
				status: 'concept'
			}
		]
	},
	{
		id: 'finance',
		label: 'Finance',
		description: 'Money tracking without a bank, exchange, or broker holding your ledger.',
		glyph: 'Fi',
		color: {
			accent: '#86efac',
			from: 'rgba(134, 239, 172, 0.18)',
			to: 'rgba(16, 185, 129, 0.04)',
			halo: 'rgba(134, 239, 172, 0.35)'
		},
		apps: [
			{
				name: 'VuWallet',
				tagline: 'Spending tracker',
				promise: 'Categorize spending on-device. Bank statements never get uploaded for analysis.',
				status: 'concept'
			},
			{
				name: 'VuCrypto',
				tagline: 'Anonymous portfolio',
				promise: 'Track crypto holdings without revealing addresses or balances to an exchange.',
				status: 'concept'
			},
			{
				name: 'VuReceipt',
				tagline: 'OCR receipts',
				promise: 'Scan receipts locally with OCR. Photos and parsed totals stay in the encrypted vault.',
				status: 'concept'
			},
			{
				name: 'VuTax',
				tagline: 'Tax organizer',
				promise: 'Year-end documents grouped privately. Filing exports happen only when you say so.',
				status: 'concept'
			},
			{
				name: 'VuAssets',
				tagline: 'Net worth, private',
				promise: 'Aggregate net worth across accounts without giving a service read access.',
				status: 'concept'
			}
		]
	},
	{
		id: 'health',
		label: 'Health',
		description: 'Personal health data that stays personal, including from us.',
		glyph: 'He',
		color: {
			accent: '#fda4af',
			from: 'rgba(253, 164, 175, 0.18)',
			to: 'rgba(244, 63, 94, 0.04)',
			halo: 'rgba(253, 164, 175, 0.35)'
		},
		apps: [
			{
				name: 'VuHealth',
				tagline: 'Medical records',
				promise: 'Lab results, prescriptions, and care notes encrypted on the device that captured them.',
				status: 'concept'
			},
			{
				name: 'VuFit',
				tagline: 'Workout log',
				promise: 'Track lifts, runs, and rest days without selling biometric trends to advertisers.',
				status: 'concept'
			},
			{
				name: 'VuMood',
				tagline: 'Private journal',
				promise: 'Mood and mental-health entries protected by your passkey and Secret Key.',
				status: 'concept'
			},
			{
				name: 'VuDiet',
				tagline: 'Meal tracker',
				promise: 'Log meals and macros without joining a nutrition platform that profiles your habits.',
				status: 'concept'
			},
			{
				name: 'VuSleep',
				tagline: 'Sleep and dreams',
				promise: 'Sleep windows and dream notes locked to your device. No background uploads.',
				status: 'concept'
			}
		]
	},
	{
		id: 'creative',
		label: 'Creative',
		description: 'Drafts and works-in-progress that nobody else gets to mine.',
		glyph: 'Cr',
		color: {
			accent: '#fcd34d',
			from: 'rgba(252, 211, 77, 0.18)',
			to: 'rgba(245, 158, 11, 0.04)',
			halo: 'rgba(252, 211, 77, 0.35)'
		},
		apps: [
			{
				name: 'VuPhoto',
				tagline: 'Encrypted gallery',
				promise: 'Photos sealed before backup. Albums sync without exposing EXIF or thumbnails.',
				status: 'concept'
			},
			{
				name: 'VuDraw',
				tagline: 'Private sketchpad',
				promise: 'Pressure-sensitive sketches and notes encrypted side-by-side with your text.',
				status: 'concept'
			},
			{
				name: 'VuMusic',
				tagline: 'Offline player',
				promise: 'Local-first music library with no listening history shared upstream.',
				status: 'concept'
			},
			{
				name: 'VuWrite',
				tagline: 'Distraction-free',
				promise: 'Focus-mode writing with autosaved encrypted drafts. Manuscripts never leak.',
				status: 'concept'
			}
		]
	},
	{
		id: 'learning',
		label: 'Learning',
		description: 'Knowledge work and reference tools that stay between you and the page.',
		glyph: 'Le',
		color: {
			accent: '#67e8f9',
			from: 'rgba(103, 232, 249, 0.18)',
			to: 'rgba(6, 182, 212, 0.04)',
			halo: 'rgba(103, 232, 249, 0.35)'
		},
		apps: [
			{
				name: 'VuLearn',
				tagline: 'Knowledge base',
				promise: 'Personal wiki with encrypted cross-links. Search runs locally over your ciphertext.',
				status: 'concept'
			},
			{
				name: 'VuCode',
				tagline: 'Snippets vault',
				promise: 'Code snippets and tokens stored next to your passwords with the same crypto.',
				status: 'concept'
			},
			{
				name: 'VuBook',
				tagline: 'Encrypted reader',
				promise: 'Library and reading progress encrypted. Recommendation engines stay outside.',
				status: 'concept'
			},
			{
				name: 'VuMentor',
				tagline: 'Privacy education',
				promise: 'Step-by-step lessons on threat models and crypto primitives. No sign-up needed.',
				status: 'concept'
			}
		]
	},
	{
		id: 'utility',
		label: 'Utility',
		description: 'Day-to-day power tools wired to the same Vu Level 0 trust floor.',
		glyph: 'Ut',
		color: {
			accent: '#00d4ff',
			from: 'rgba(0, 212, 255, 0.22)',
			to: 'rgba(14, 165, 233, 0.04)',
			halo: 'rgba(0, 212, 255, 0.45)'
		},
		apps: [
			{
				name: 'VuVault',
				tagline: 'Password vault',
				promise:
					'Post-quantum password and document vault. Available today at vuvault.app — the rest of the suite layers on top.',
				status: 'available',
				mockup: 'vault'
			},
			{
				name: 'VuScan',
				tagline: 'OCR scanner',
				promise: 'Document and ID scanning with on-device OCR. Scans go straight into the vault.',
				status: 'concept'
			},
			{
				name: 'VuConvert',
				tagline: 'Format conversion',
				promise: 'Convert files locally between formats. No drag-and-drop into a third-party service.',
				status: 'concept'
			}
		]
	},
	{
		id: 'shipping-next',
		label: 'Shipping Next',
		description: 'The next wave in active design — these graduate to their own categories at launch.',
		glyph: 'Nx',
		color: {
			accent: '#f0abfc',
			from: 'rgba(240, 171, 252, 0.20)',
			to: 'rgba(217, 70, 239, 0.04)',
			halo: 'rgba(240, 171, 252, 0.40)'
		},
		apps: [
			{
				name: 'VuBlink',
				tagline: 'Ephemeral photos',
				promise: 'Short-lived photo shares with cryptographic expiry. Recipients cannot persist them.',
				status: 'shipping-next',
				mockup: 'blink'
			},
			{
				name: 'VuJournal',
				tagline: 'Private diary',
				promise: 'Daily journaling with per-entry keys. Even export needs your local keys to unlock.',
				status: 'shipping-next',
				mockup: 'journal'
			},
			{
				name: 'VuTunnel',
				tagline: 'Private tunneling',
				promise: 'On-demand encrypted tunnels for your other apps. No connection logs by design.',
				status: 'shipping-next',
				mockup: 'tunnel'
			},
			{
				name: 'VuLedger',
				tagline: 'Encrypted ledger',
				promise: 'Double-entry accounting with encrypted books. Reports decrypt only on your device.',
				status: 'shipping-next',
				mockup: 'ledger'
			}
		]
	}
];

export const VU_ECOSYSTEM_CATEGORIES: readonly EcosystemCategory[] = CATEGORIES;

/** Stable lookup used by tests and analytics-free debugging utilities. */
export function findAppByName(name: string): EcosystemApp | undefined {
	for (const category of CATEGORIES) {
		const match = category.apps.find((app) => app.name === name);
		if (match) return match;
	}
	return undefined;
}

/**
 * Reverse-lookup for the category an app belongs to. Used by the
 * launcher to drive per-card gradients without forcing the consumer
 * to plumb the parent category alongside every render of a card.
 */
export function findCategoryOf(name: string): EcosystemCategory | undefined {
	return CATEGORIES.find((cat) => cat.apps.some((a) => a.name === name));
}

/** Human-readable label for a status badge. */
export function statusLabel(status: AppStatus): string {
	switch (status) {
		case 'available':
			return 'Available now';
		case 'shipping-next':
			return 'Shipping next';
		case 'concept':
			return 'In design';
	}
}
