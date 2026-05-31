/**
 * Vu Privacy Level — single source of truth.
 *
 * The currently-shipped level, the ladder of available levels, and the
 * evidence map for the current level. Read by:
 *
 *   - `src/routes/privacy/+page.svelte`         (in-app /privacy page)
 *   - `src/lib/components/PrivacyBadge.svelte`  (audit footer badge)
 *   - `tests/e2e/privacy-level.spec.ts`         (regression test that
 *      asserts the UI claim matches this table)
 *
 * NEVER hard-code a privacy level NUMERICALLY LOWER than `CURRENT_LEVEL`
 * in any UI string, marketing copy, or documentation — under the
 * inverted scale a lower number is a STRONGER claim. The in-app badge
 * and the `/privacy` page are the only places that quote the level,
 * and both pull from here.
 *
 * --- Scale direction (post-2026-05-20 inversion) ---
 *
 * The numeric scale is INVERTED from the legacy in-app ladder. The
 * canonical taxonomy (PRIVACY_AUDIT.md §15) is directional:
 *
 *     Vu Level 0  =  MOST private  (zero-knowledge, no server-visible
 *                                   account/session correlation)
 *     Vu Level 5  =  LEAST private (policy privacy, "we promise" —
 *                                   REFUSED in this ecosystem)
 *
 * `CURRENT_LEVEL = 2` reflects the verdict in PRIVACY_AUDIT.md: vault
 * and document bytes are E2E ciphertext, but the server retains
 * stable account / session / device / blob metadata in D1 + R2, which
 * caps the project at canonical Vu2 until that metadata plane is
 * redesigned (Tier 2+).
 *
 * The mirror at [docs/PRIVACY-LEVEL.md](../../../docs/PRIVACY-LEVEL.md)
 * is the human-readable expansion of this data. When you change the
 * shipped level here, update that document in the same commit.
 */

export type PrivacyLevelId = 0 | 1 | 2 | 3 | 4 | 5;
export type Status = 'shipped' | 'partial' | 'pending';

export type PrivacyLevel = {
	id: PrivacyLevelId;
	short: string;
	headline: string;
	when: string;
	summary: string;
};

/**
 * Ordered from MOST private (id 0) to LEAST private (id 5).
 * Inverted on 2026-05-20 to match the canonical taxonomy in
 * PRIVACY_AUDIT.md §15. The list order intentionally mirrors the
 * numeric order so the UI can render `PRIVACY_LEVELS` top-down
 * without needing an extra sort.
 */
export const PRIVACY_LEVELS: readonly PrivacyLevel[] = [
	{
		id: 0,
		short: 'Vu Level 0',
		headline: 'Zero-knowledge',
		when: 'Aspirational — Tier 2+ redesign target',
		summary:
			'Server cannot correlate accounts, sessions, devices, or blob inventories. Routing identifiers are unlinkable; blob sizes are bucketed; metadata is minimized to what the protocol strictly needs to deliver bytes. Vu Level 0 is the canonical zero-knowledge tier — what a server compromise reveals is, by construction, useless. VuVault reaches this tier when the metadata plane (D1 accounts, sessions, sequence clocks) is redesigned around unlinkable identifiers and blinded routing, gated by the L09 AKD log + L07 CRDT padding work in docs/TIER2-ARCHITECTURE.md.'
	},
	{
		id: 1,
		short: 'Vu Level 1',
		headline: 'End-to-end + minimal relay metadata',
		when: 'Tier 2 (2027)',
		summary:
			'Vault and document bytes are end-to-end encrypted, AND server-visible metadata is reduced to only what is strictly necessary for delivery (no per-user blob inventories, no persistent device set, no sequence-clock correlation across accounts). Tier 2 brings field-level CRDT sync with HPKE + ML-KEM-768, bucketed-padding deltas, MLS sharing, AKD-anchored device pairing, and PIR breach checks.'
	},
	{
		id: 2,
		short: 'Vu Level 2',
		headline: 'Architectural privacy for vault + documents',
		when: 'Today (M3, post this pass)',
		summary:
			'Vault items and document file bytes are end-to-end encrypted under a per-vault AES-256-GCM key wrapped in an X25519 + ML-KEM-1024 hybrid envelope. OPAQUE (RFC 9807) authenticates without a password-equivalent hitting the server. Local Recovery Envelope supports passkey-loss recovery without server-held key material. Reproducible builds, SHA-384 manifest verified at every unlock, fail-closed production rate-limit gates, Sigstore + Rekor on every release. Server still retains persistent account / session / device / blob metadata in D1 + R2 — that is what holds the project at Vu Level 2 vs. Vu Level 1. The level is defined by cryptographic capability — third-party audit status is tracked separately in docs/AUDIT-CHECKLIST.md.'
	},
	{
		id: 3,
		short: 'Vu Level 3',
		headline: 'Partial E2E with recoverable metadata',
		when: 'Common at incumbent password managers',
		summary:
			'Content is encrypted client-side, but the server can correlate or partially decrypt some metadata, holds recovery material, or operates a key-escrow path. Common shape for managers that offer "account recovery" without explicitly storing only ciphertext-only recovery envelopes. VuVault never operates at this level.'
	},
	{
		id: 4,
		short: 'Vu Level 4',
		headline: 'Weakened or legacy cryptography',
		when: 'Refused — only listed for comparison',
		summary:
			'End-to-end labels are claimed, but cipher choices or key management are weak enough to be brute-forceable in practice, or the server retains a key-recovery path under "operational" cover. This is below the floor we will accept from any system in our ecosystem.'
	},
	{
		id: 5,
		short: 'Vu Level 5',
		headline: 'Policy privacy — REFUSED',
		when: 'NOT ALLOWED in our ecosystem',
		summary:
			'TLS + same-origin sync + a "we promise not to look" privacy policy. The server holds plaintext or session keys; privacy is policy, not architecture. This is the baseline most password managers ship and the floor VuVault — and any system in the Vu ecosystem — refuses to occupy. SubZero from the PRIVACY_AUDIT.md taxonomy is the inverse of this floor: an above-Vu-Level-0 honorary tier reserved for systems with provably-enforced CSP, public third-party review, and formal-verification-grade evidence of the cryptographic boundary.'
	}
];

/**
 * The level currently held by the shipped code.
 *
 * Under the inverted scale a LOWER value is a STRONGER claim. Moving
 * `CURRENT_LEVEL` from 2 to 1 requires redesigning the D1/R2
 * metadata plane (see PRIVACY_AUDIT.md F-003); to 0 requires that
 * plus unlinkable routing identifiers. Both moves must update every
 * entry in `EVIDENCE` to a higher status AND `docs/PRIVACY-LEVEL.md`
 * in the same commit. CI's privacy regression test refuses to pass
 * otherwise.
 */
export const CURRENT_LEVEL: PrivacyLevelId = 2;

export function currentLevel(): PrivacyLevel {
	const found = PRIVACY_LEVELS.find((l) => l.id === CURRENT_LEVEL);
	if (!found) {
		throw new Error(`CURRENT_LEVEL ${CURRENT_LEVEL} not in PRIVACY_LEVELS`);
	}
	return found;
}

// -----------------------------------------------------------------------------
// Evidence map — what each guarantee maps to in the codebase.
// -----------------------------------------------------------------------------

export type EvidenceRow = {
	id: string;
	claim: string;
	status: Status;
	evidence: string;
};

export const EVIDENCE: readonly EvidenceRow[] = [
	{
		id: 'E01',
		claim: 'Vault item plaintext never leaves the device unencrypted',
		status: 'shipped',
		evidence:
			'src/lib/services/vault-session.ts (provisionVault / saveItems); E2E IDB-inspection assertion in tests/e2e/full-workflow.spec.ts'
	},
	{
		id: 'E02',
		claim: 'Document file plaintext never leaves the device unencrypted',
		status: 'shipped',
		evidence:
			'src/lib/services/vault-session.ts (sealDocument / openDocument) with document-scoped AAD; E2E byte-match in tests/e2e/full-workflow.spec.ts'
	},
	{
		id: 'E03',
		claim: 'AES-256-GCM under a per-vault key wrapped in X25519 + ML-KEM-1024 hybrid envelope',
		status: 'shipped',
		evidence: 'src/lib/services/vault-envelope.ts; KAT-locked under npm run test:fips'
	},
	{
		id: 'E04',
		claim: 'OPAQUE (RFC 9807) authentication — server never holds a password equivalent',
		status: 'shipped',
		evidence:
			'src/routes/api/opaque/, src/lib/server/api/server-opaque.ts; tests/integration/worker.spec.ts'
	},
	{
		id: 'E05',
		claim: 'Local Recovery Envelope — Secret Key + Recovery Password can recover after passkey loss without server-held recovery material',
		status: 'shipped',
		evidence:
			'src/lib/crypto/recovery-envelope.ts, src/lib/services/recovery-envelope.ts, src/routes/recover/+page.svelte'
	},
	{
		id: 'E06',
		claim: 'Per-document encrypted blob storage in R2 — server stores ciphertext only',
		status: 'shipped',
		evidence:
			'src/routes/api/documents/[blobId]/+server.ts, tests/integration/api-routes.spec.ts'
	},
	{
		id: 'E07',
		claim: 'Production rate-limit bindings fail-closed; release refuses to deploy without the M3 E2E artifact',
		status: 'shipped',
		evidence:
			'src/lib/server/api/env.ts (checkRateLimit), scripts/verify-production-runtime.mjs, .github/workflows/release.yml'
	},
	{
		id: 'E08',
		claim: 'Bundle integrity verified at every unlock — mismatch refuses decryption',
		status: 'shipped',
		evidence: 'src/lib/utils/env.ts (verifyBundleIntegrity), .bundle-digest'
	},
	{
		id: 'E09',
		claim: 'Reproducible builds + Sigstore + Rekor transparency log on every release',
		status: 'shipped',
		evidence:
			'scripts/verify-reproducible.mjs, .github/workflows/ci.yml (reproducible-build), .github/workflows/release.yml (cosign)'
	},
	{
		id: 'E10',
		claim: 'Lock zeroizes every secret-bearing field and tears down the session key',
		status: 'shipped',
		evidence:
			'src/lib/types/vault-item.ts (SECRET_FIELDS_BY_KIND), src/lib/services/vault-session.ts (lockSession)'
	},
	{
		id: 'E11',
		claim: 'Field-level encrypted CRDT sync — no item-shape leakage from sync deltas',
		status: 'pending',
		evidence: 'Tier 2 (2027) — see docs/L07-CRDT-SYNC-PLAN.html'
	},
	{
		id: 'E12',
		claim: 'Document blob size + upload timing privacy (bucketed padding)',
		status: 'partial',
		evidence: 'Tier 2 design — sealing today writes ciphertext at natural length'
	},
	{
		id: 'E13',
		claim: 'Family / team sharing via MLS',
		status: 'pending',
		evidence: 'Tier 2 (2027) — L06 MLS sharing'
	},
	{
		id: 'E14',
		claim: 'FROST t-of-n account recovery',
		status: 'pending',
		evidence: 'Tier 3 (2028) — L11 FROST recovery'
	},
	{
		id: 'E15',
		claim: 'PIR breach checks (HIBP without leakage)',
		status: 'pending',
		evidence: 'Tier 2 — L10 PIR + unbalanced PSI'
	}
];

// -----------------------------------------------------------------------------
// Threat model — what we do and do not defend against today.
// -----------------------------------------------------------------------------

export type ThreatRow = {
	id: string;
	threat: string;
	defended: boolean;
	how: string;
};

export const THREATS: readonly ThreatRow[] = [
	{
		id: 'T01',
		threat: 'Passive network observer (TLS-MITM, ISP, hostile WiFi)',
		defended: true,
		how: 'TLS 1.3 + HSTS + OPAQUE — no password-equivalent on the wire'
	},
	{
		id: 'T02',
		threat: 'Active MITM with cert substitution',
		defended: true,
		how: 'Subresource Integrity + Sigstore-attested bundles + in-page SHA-384 verifier'
	},
	{
		id: 'T03',
		threat: 'Compromised server / coerced operator',
		defended: true,
		how: 'Client-side AES-256-GCM under per-vault key — server holds opaque ciphertext only'
	},
	{
		id: 'T04',
		threat: 'Harvest-now-decrypt-later quantum adversary',
		defended: true,
		how: 'Hybrid X25519 + ML-KEM-1024 envelope (FIPS 203)'
	},
	{
		id: 'T05',
		threat: 'Phishing of the master password',
		defended: true,
		how: 'OPAQUE prevents the server from ever seeing it; WebAuthn-PRF is the actual unlock factor'
	},
	{
		id: 'T06',
		threat: 'Malicious update / targeted backdoor',
		defended: true,
		how: 'Reproducible builds + Rekor transparency log + bundle hash refused at unlock'
	},
	{
		id: 'T07',
		threat: 'Endpoint compromise (malware on the device)',
		defended: false,
		how: 'No cryptographic mitigation possible; reveal auto-hides at 30 s, clipboard auto-clears at 60 s'
	},
	{
		id: 'T08',
		threat: 'Coercion of the user (rubber-hose attacks)',
		defended: false,
		how: 'Plausible-deniability decoy vault is on the Tier 3 roadmap'
	},
	{
		id: 'T09',
		threat: 'Implementation bugs in our own code',
		defended: false,
		how: 'Defended by reviews, fuzzing, and FIPS-locked KAT vectors — not by architecture. Audit status is a separate evidence concern (see docs/AUDIT-CHECKLIST.md).'
	},
	{
		id: 'T10',
		threat: 'Total sync volume / upload cadence side channels',
		defended: false,
		how: 'Out of zero-knowledge scope; explicitly documented in SECURITY.md'
	},
	{
		id: 'T11',
		threat: 'Document size + timing side channels',
		defended: false,
		how: 'Partial — ciphertext is at natural length today; bucketed padding ships in Tier 2'
	}
];

/** Count of shipped / partial / pending guarantees in the evidence map. */
export function evidenceStats(): { shipped: number; partial: number; pending: number } {
	const out = { shipped: 0, partial: 0, pending: 0 };
	for (const row of EVIDENCE) out[row.status]++;
	return out;
}
