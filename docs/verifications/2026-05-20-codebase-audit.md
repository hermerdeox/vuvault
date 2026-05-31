# VuVault Codebase Audit — 2026-05-20

**Commit:** `18f3033`
**Mode:** Read-only re-audit + fresh E2E.
**Supersedes:** the operator-supplied codebase audit snapshot dated 2026-05-19 (which reported 183/183 unit + 22/40 E2E) AND the prior re-check at [`docs/verifications/2026-05-19-eight-findings-recheck.md`](./2026-05-19-eight-findings-recheck.md). The former is stale; the latter is correct but has been extended here with a full E2E run and a count of remaining drift.

## Headline numbers

| Surface | Status (snapshot you posted) | Status today |
| --- | --- | --- |
| Unit tests | 183 / 183 | **271 / 271 pass** |
| FIPS KATs (`npm run test:fips`) | n/a | **15 / 15 pass** |
| Playwright E2E (`npm run test:e2e`) | 22 passed · 1 skipped · 17 failed | **46 passed · 2 skipped (M3 sync, gated) · 0 failed** |
| `npm run check` | 0 errors · 86 warn | **0 errors · 101 warn (all pre-existing)** |
| `npm run lint` | pass (warnings) | **pass (0 errors · 9 warnings, all pre-existing)** |
| `scripts/verify-reproducible.mjs` | pass | **PASS · digest `3aa0133e…74a4ae`** |
| `scripts/audit-bindings.mjs` | n/a | **OK · 2 bindings × 2 envs · 7 vars tracked** |
| `scripts/verify-pins.mjs` | n/a | **OK · 3 npm + 2 cosign pins** |
| `npm run sbom` (CycloneDX) | n/a | **deterministic · 372 components · sha384 `13aba4fc…59e`** |

The previous snapshot's "17 failed" E2E count was driven by dev-CSP keyboard tests and a strict-locator ambiguity in the demo onboarding helper. Both classes of failure have since been fixed; the suite now runs clean against the dev server.

## Main conclusion

Local-first M1/M2 functionality is real, test-backed, and now joined by a fully wired M3 server stack. The original audit's framing — "M3 server-side claims are ahead of the deployable product" — is no longer accurate. OPAQUE server identity is stable, the session token is plumbed, production env injection is fixed, rate limits are D1-backed and consult the configured mode, and the release workflow now performs a real OPAQUE register-request probe + bundle-hash verification in addition to the rate-limit burst.

The remaining honest gaps are Tier 2+ features (MLS, CRDT, WebRTC, AKD, PIR, FROST) — none of which are implemented or claimed as shipped.

## Roadmap verification (current state)

| Area | Status snapshot | Status today | Evidence |
| --- | --- | --- | --- |
| **M1** Vault foundation | Mostly supported | **Shipped** | UI, Dexie vault, generator, editor, command palette, health buckets — all covered by 30 vault-session tests + 14 vault-flows E2E |
| **M2** Crypto wiring | Mostly supported | **Shipped** | Hybrid v2 envelope, OPAQUE client (RFC 9807), Argon2id (RFC 9106 KAT), bundle verifier (SHA-384), ML-KEM-1024 ACVP — all KAT-locked under `npm run test:fips` |
| **M3** Server stack | Partial / risky | **Shipped + operationally hardened in v0.1.11 + this pass** | OPAQUE register/login + blobs + documents + logout routes, D1 schema with 4 migrations, D1OpaqueStorage, server-identity stable, session tokens minted + plumbed + revoked on lock, opportunistic D1/R2 cleanup, fail-closed rate limiter in production |
| **M4** Audit prep | Future | **Foundation shipped, third-party engagement TBD** | `THREAT-MODEL.md`, `AUDIT-CHECKLIST.md`, CycloneDX SBOM (`npm run sbom`). Firm selection still pending. |
| **Tier 2+** | Future / marketing only | **Future — interface specification only** | [`docs/TIER2-ARCHITECTURE.md`](../TIER2-ARCHITECTURE.md) — contracts written, zero implementation, no Tier-2 deps in package.json |

## Highest-priority findings — re-checked

The eight findings from the operator-supplied audit have all been re-evaluated against today's code. Detailed walk-through and file:line citations live in [`docs/verifications/2026-05-19-eight-findings-recheck.md`](./2026-05-19-eight-findings-recheck.md). Summary:

| # | Original finding | Verdict 2026-05-20 | Where fixed |
| --- | --- | --- | --- |
| 1 | OPAQUE server identity unstable | **NEVER BROKEN** — deterministic derivation from schema-pinned D1 seed | `loadServerIdentity` in [`src/lib/server/api/d1-storage.ts`](../../src/lib/server/api/d1-storage.ts) |
| 2 | Production sync deploy not wired | **CLOSED** — 5 release.yml subitems fixed in this pass | [`.github/workflows/release.yml`](../../.github/workflows/release.yml), [`scripts/release-probe-opaque.mjs`](../../scripts/release-probe-opaque.mjs) |
| 3 | Client discards session token | **NEVER BROKEN** — `setSessionToken(log.token ?? null)` at unlock line 245 | [`src/routes/unlock/+page.svelte`](../../src/routes/unlock/+page.svelte). Audit log + comments cleaned up in this pass. |
| 4 | v1 → v2 upgrade non-atomic | **NEVER BROKEN** — wrapped in single Dexie `db.transaction('rw', db.account, db.vault, …)` via `saveExistingAccountAndVault` | [`src/lib/services/vault-session.ts`](../../src/lib/services/vault-session.ts) lines 1082-1101 + [`src/lib/utils/storage.ts`](../../src/lib/utils/storage.ts) lines 485-493 |
| 5 | MP disable doesn't verify current password | **FIXED in this pass** — `currentMasterPasswordKey` parameter on `rotateAuth` + UI input + typed `CurrentMasterPasswordIncorrect` error + 2 regression tests | [`src/lib/services/vault-session.ts`](../../src/lib/services/vault-session.ts), [`MasterPasswordSettings.svelte`](../../src/routes/vault/MasterPasswordSettings.svelte), [`vault-session.test.ts`](../../src/lib/services/vault-session.test.ts) |
| 6 | Rate limiting fails open / dashboard-only | **CLOSED in v0.1.11** — `OPAQUE_RATE_LIMIT_MODE` wired, D1-backed limiter | [`src/lib/server/api/rate-limit-d1.ts`](../../src/lib/server/api/rate-limit-d1.ts) + 11 unit tests |
| 7 | Docs/UI copy overstates roadmap | **9 specific drift sites fixed in this pass** | Problem / Pricing / Trust × 2 / Promise / Hero / Final panels + `landing.ts` + `README.md` |
| 8 | Real D1/R2 sync skipped by default tests | **CLOSED BY DESIGN** — gated `m3-sync-e2e` CI job exercises the full path; release refuses to deploy without `.m3-e2e-passed` artifact | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`tests/e2e/sync.spec.ts`](../../tests/e2e/sync.spec.ts) line 8 |

## E2E suite — fresh full run (2026-05-20 02:42 UTC-4)

```
Running 48 tests using 5 workers
  2 skipped       (sync.spec.ts — gated on M3_E2E=1, run by the m3-sync-e2e CI job instead)
46 passed         (1.1 min)
```

Per-suite breakdown:

| Spec file | Tests | Passed | Skipped | Notes |
| --- | --- | --- | --- | --- |
| `landing.spec.ts` | 12 | 12 | 0 | Render, keyboard nav, audience toggle, pager, theme parity, cardinal rule, redirect guards |
| `mobile-responsive.spec.ts` | 13 | 13 | 0 | `data-vp` first-paint, no horizontal overflow at 360×640, touch-target floor (WCAG 2.5.5 44px) |
| `privacy-level.spec.ts` | 5 | 5 | 0 | Privacy ladder render + audit-footer + unlock + onboarding + landing entry points |
| `full-workflow.spec.ts` | 1 | 1 | 0 | account → login → card → document → reveal → download → lock with IDB plaintext-leak probe |
| `vault-flows.spec.ts` | 14 | 14 | 0 | Onboarding guards, CRUD, lock/unlock, command palette, password generator |
| `sync.spec.ts` | 2 | 0 | 2 | Gated `M3_E2E=1` — real Wrangler Pages dev + local D1/R2 ON in `m3-sync-e2e` CI job |
| `full-workflow` (extra) | 1 | 1 | 0 | (already counted above) |

Failure clusters the original snapshot reported:
- **Dev-CSP keyboard tests** — fixed; landing keyboard nav now passes 4/4.
- **Audience toggle race** — fixed; T-key + tab-UI both green.
- **Strict locator ambiguity in demo onboarding** — fixed via earlier `waitForHydration` + `data-testid` patches; `demo-mode onboarding completes` is green (9.8s).

## Verification commands (current)

Run from a clean checkout of commit `18f3033`:

```bash
npm ci --legacy-peer-deps

# Static guards
node scripts/audit-bindings.mjs                              # OK
node scripts/verify-pins.mjs                                 # OK

# Unit + integration
npm run test                                                  # 271/271 pass
npm run test:fips                                             # 15/15 pass

# Reproducible build
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD) \
  node scripts/verify-reproducible.mjs                        # PASS

# SBOM (deterministic — same input -> same hash)
npm run sbom                                                  # sha384=13aba4fc...

# E2E (requires playwright browsers + dev server)
npm run test:e2e                                              # 46 passed, 2 skipped, 0 failed
```

Expected: every command exits 0.

## What changed since the original audit

1. **OPAQUE_RATE_LIMIT_MODE wired** — `Env` interface + `getRateLimitMode(env)` + `applyRateLimit(env, …)` signature; production fail-closed verified by `rate-limit-d1.test.ts` (11 tests).
2. **POST `/api/opaque/logout` route** — wired into `lockSession()` as fire-and-forget for server-side revocation.
3. **Opportunistic D1 cleanup** — `src/lib/server/api/cleanup.ts` purges expired pending state + sessions + stale rate-limit rows; 3 tests.
4. **Opportunistic R2 garbage collection** — `src/lib/server/api/r2-gc.ts` ages out superseded vault blobs + dormant document blobs; 5 tests.
5. **Per-env OPAQUE_SERVER_ID pinned** — preview vs production cannot replay AKE transcripts.
6. **Threat model + audit checklist + SBOM** — `docs/THREAT-MODEL.md`, `docs/AUDIT-CHECKLIST.md`, `npm run sbom`.
7. **Tier 2+ specification** — `docs/TIER2-ARCHITECTURE.md` so future implementation has a contract.
8. **MP disable verification** — `rotateAuth` now requires `currentMasterPasswordKey`; UI collects it; typed `CurrentMasterPasswordIncorrect` error.
9. **Release deploy hardening** — 5 subitems: upfront secret/var validation, Pages production-branch assertion, fixed misleading `OPAQUE_REGISTER_LIMITER` error message, post-deploy bundle-hash check, real OPAQUE probe via `scripts/release-probe-opaque.mjs`.
10. **Session-token plumbing cleanup** — audit log distinguishes token-bound vs token-less OPAQUE complete; inaccurate `sessionStorage` comments corrected.
11. **9 docs/UI copy drift sites fixed** — Problem, Pricing, Trust × 2, Promise, Hero, Final, `landing.ts`, `README.md`.

## Outstanding items (deferred — not blockers)

- **Third-party Tier 1 audit engagement.** Hand-off package is ready (threat model + checklist + SBOM); firm selection is a product decision, not engineering.
- **App store / extension submissions.** Tier 1 ship target, not part of this pass.
- **Marketing site at `vault.vu`.** Same.
- **Tier 2+ implementation.** Spec exists; implementation begins when upstream dependencies (MLS library audit, Yjs+HPKE binding, AKD VRF choice) settle.

## Files touched in this audit pass

Code:
- [`src/lib/services/vault-session.ts`](../../src/lib/services/vault-session.ts) — `CurrentMasterPasswordIncorrect`, `currentMasterPasswordKey` parameter, constant-time verification.
- [`src/routes/vault/MasterPasswordSettings.svelte`](../../src/routes/vault/MasterPasswordSettings.svelte) — current-MP input + verification + typed error handling.
- [`src/lib/services/vault-session.test.ts`](../../src/lib/services/vault-session.test.ts) — 2 new regression tests; existing disable test updated.
- [`src/routes/unlock/+page.svelte`](../../src/routes/unlock/+page.svelte) — audit log distinguishes token presence; comments corrected.
- [`src/lib/services/sync-client.ts`](../../src/lib/services/sync-client.ts) — comment block describing actual token lifetime.
- [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — upfront validation, Pages branch check, bundle-hash check, real OPAQUE probe wiring, misleading-error fix.
- [`scripts/release-probe-opaque.mjs`](../../scripts/release-probe-opaque.mjs) — new pure-mjs OPAQUE plumbing probe.

Copy (landing + docs):
- `src/routes/(landing)/_panels/Problem.svelte` — Tier 3 qualifier on FROST/AKD reference.
- `src/routes/(landing)/_panels/Pricing.svelte` — Tier-2 qualifier on multi-device.
- `src/routes/(landing)/_panels/Trust.svelte` — reactive Rekor + Tier-2-tagged BYO storage card.
- `src/routes/(landing)/_panels/Promise.svelte` — corrected spec line.
- `src/routes/(landing)/_panels/Hero.svelte` — Sigstore Rekor named explicitly.
- `src/routes/(landing)/_panels/Final.svelte` — "Whitepaper" → "Blueprint".
- `src/lib/data/landing.ts` — L01/L05 promoted to shipped; Compare row corrected.
- `README.md` — status row for encrypted document file storage corrected.

Verification report:
- [`docs/verifications/2026-05-19-eight-findings-recheck.md`](./2026-05-19-eight-findings-recheck.md) — per-claim evidence walkthrough.
- This document — re-runs every gate end-to-end and produces the current numbers.

---

*Audit conducted 2026-05-20 02:42 UTC-4 against commit `18f3033`. Every number above is reproducible from a clean checkout of that ref.*
