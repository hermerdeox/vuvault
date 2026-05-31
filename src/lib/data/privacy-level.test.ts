import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
	PRIVACY_LEVELS,
	EVIDENCE,
	THREATS,
	CURRENT_LEVEL,
	currentLevel,
	evidenceStats
} from './privacy-level';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRIVACY_DOC = join(__dirname, '../../../docs/PRIVACY-LEVEL.md');

describe('privacy-level data module', () => {
	it('CURRENT_LEVEL is a valid level id', () => {
		const ids = PRIVACY_LEVELS.map((l) => l.id);
		expect(ids).toContain(CURRENT_LEVEL);
	});

	it('every evidence row has a non-empty claim and evidence pointer', () => {
		for (const row of EVIDENCE) {
			expect(row.id).toMatch(/^E\d{2}$/);
			expect(row.claim.trim()).not.toBe('');
			expect(row.evidence.trim()).not.toBe('');
			expect(['shipped', 'partial', 'pending']).toContain(row.status);
		}
	});

	it('every threat row has a non-empty name and mitigation note', () => {
		for (const row of THREATS) {
			expect(row.id).toMatch(/^T\d{2}$/);
			expect(row.threat.trim()).not.toBe('');
			expect(row.how.trim()).not.toBe('');
		}
	});

	it('current level always has the shipped count > 0', () => {
		const stats = evidenceStats();
		expect(stats.shipped + stats.partial + stats.pending).toBe(EVIDENCE.length);
		expect(stats.shipped).toBeGreaterThan(0);
	});

	it('current level matches `docs/PRIVACY-LEVEL.md` table for the shipped level', async () => {
		const doc = await readFile(PRIVACY_DOC, 'utf8');
		const lvl = currentLevel();
		// The honest doc must reference the same level number and the
		// same headline phrase as the data module. If either drifts
		// — change the number here, forget to update the doc, or vice
		// versa — the test fails CI before a stale claim ships.
		expect(doc).toContain(`**${lvl.short}**`);
		expect(doc).toContain('Today (M3, post this pass)');
		// Lock in the post-inversion direction: lower-number = more
		// private. A future inverter who flips this back without
		// migrating the rest of the codebase will fail here.
		expect(CURRENT_LEVEL).toBe(2);
	});

	it('ladder is inverted: lower id = stronger privacy claim', () => {
		// Cardinality: 6 levels (0..5) post-2026-05-20 inversion.
		expect(PRIVACY_LEVELS).toHaveLength(6);
		const ids = PRIVACY_LEVELS.map((l) => l.id);
		expect(ids).toEqual([0, 1, 2, 3, 4, 5]);
		// Vu Level 5 is the banned floor.
		const banned = PRIVACY_LEVELS.find((l) => l.id === 5);
		expect(banned?.when).toMatch(/NOT ALLOWED/i);
	});

	it('docs/PRIVACY-LEVEL.md lists every level on the ladder', async () => {
		const doc = await readFile(PRIVACY_DOC, 'utf8');
		for (const lvl of PRIVACY_LEVELS) {
			// Each level appears as `**Vu Level N**` somewhere in the
			// ladder table.
			expect(doc).toContain(`**${lvl.short}**`);
		}
	});
});
