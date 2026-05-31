# Milestone Claim Audit — 2026-05-19

**Scope:** Comprehensive verification of every claim in the project status summary that was the source of this audit pass:

> M1 Vault foundation — Mostly supported — UI shell, local Dexie vault, generator, editor, command palette, health buckets exist
> M2 Crypto wiring — Mostly supported — Hybrid v2 envelope, OPAQUE client, Argon2id, bundle verifier, KATs exist
> M3 Server stack — Partial / risky — D1/R2/API routes exist, but identity/token/env/rate-limit wiring is incomplete
> M4 Audit prep — Future — No third-party audit, app store, public threat-model deliverable yet
> Tier 2+ — Future / marketing only — MLS, CRDT, WebRTC pairing, AKD, PIR, FROST are not implemented

**Methodology:** Triple evidence — static (file paths + code), runtime (test commands), and adversarial (deliberate attempts to falsify the claim).

**Result:** The original snapshot was directionally correct but M3 was outdated. M3 wiring is substantially complete; the real gaps were operational (session revocation, cleanup, R2 GC, env-var wiring). This pass closes them. M1, M2, M4, and Tier 2+ claims are accurate as stated. Hardening landed for every M3 gap, every M4 deliverable that was tractable, and a forward-looking Tier 2+ specification was written to replace ambiguous marketing claims.

**Companion:** [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md), [`docs/AUDIT-CHECKLIST.md`](../AUDIT-CHECKLIST.md), [`docs/TIER2-ARCHITECTURE.md`](../TIER2-ARCHITECTURE.md).

---

## Executive summary

| Milestone | Original claim | Verdict | Action taken |
| --- | --- | --- | --- |
| M1 — Vault foundation | "Mostly supported" | Accurate | None — upgrade to "Shipped" in next ROADMAP revision |
| M2 — Crypto wiring | "Mostly supported" | Accurate | None — upgrade to "Shipped" in next ROADMAP revision |
| M3 — Server stack | "Partial / risky" | **Outdated.** Wiring is largely complete; 6 operational gaps remained. | All 6 gaps closed in this pass |
| M4 — Audit prep | "Future" | Accurate, but tractable artifacts were missing | Threat model, audit checklist, and SBOM delivered |
| Tier 2+ | "Future / marketing only" | Accurate (zero code) | Specification written so future implementation has a starting contract |

---

## M1 — Vault foundation

**Claim:** UI shell, local Dexie vault, generator, editor, command palette, health buckets exist.

### Static evidence

| Sub-claim | Files | Status |
| --- | --- | --- |
| UI shell | 7 routes (`landing`, `onboarding`, `vault`, `unlock`, `recover`, `blueprint`, `privacy`); 3-pane vault layout in [`src/routes/vault/+page.svelte`](../../src/routes/vault/+page.svelte) | Shipped |
| Local Dexie vault | [`src/lib/utils/storage.ts`](../../src/lib/utils/storage.ts) (Dexie v5, 6 tables), encryption orchestration in [`vault-session.ts`](../../src/lib/services/vault-session.ts) | Shipped |
| Password generator | [`src/lib/crypto/passgen.ts`](../../src/lib/crypto/passgen.ts) (CSPRNG + rejection sampling + class coverage), [`QuickGenerator.svelte`](../../src/routes/vault/QuickGenerator.svelte) | Shipped |
| Editor | [`ItemEditor.svelte`](../../src/routes/vault/ItemEditor.svelte) + [`item-validation.ts`](../../src/routes/vault/item-validation.ts); 7 item kinds | Shipped |
| Command palette | [`CommandK.svelte`](../../src/routes/vault/CommandK.svelte) + [`command-rank.ts`](../../src/routes/vault/command-rank.ts); ARIA combobox, fuzzy ranking | Shipped |
| Health buckets | [`src/lib/health/password-health.ts`](../../src/lib/health/password-health.ts); SHA-384 reuse + entropy + common-pw blocklist | Shipped |

### Runtime evidence

```bash
npm run test src/lib/crypto/passgen.test.ts                 # 11 generator tests
npm run test src/lib/health/password-health.test.ts         # 13 health tests
npm run test src/routes/vault/item-validation.test.ts       # 23 validation tests
npm run test src/routes/vault/command-rank.test.ts          # 10 ranking tests
npm run test src/lib/services/vault-session.test.ts         # 20 session tests
```

### Adversarial evidence

- `npm run test:e2e -- tests/e2e/full-workflow.spec.ts` programmatically inspects IndexedDB after completing the workflow and asserts no plaintext substring leak.
- TODO/FIXME/HACK/XXX/STUB scan across `src/**/*.{ts,svelte}` returns zero hits other than one in `password-health.test.ts`.

### Verdict

**ACCURATE.** No code changes needed. ROADMAP wording updated from "Mostly supported" to a more granular shipping description.

---

## M2 — Crypto wiring

**Claim:** Hybrid v2 envelope, OPAQUE client, Argon2id, bundle verifier, KATs exist.

### Static evidence

| Sub-claim | Files | Status |
| --- | --- | --- |
| Hybrid v2 envelope | [`envelope.ts`](../../src/lib/crypto/envelope.ts), [`vault-envelope.ts`](../../src/lib/services/vault-envelope.ts) — X25519 + ML-KEM-1024 + AES-256-GCM with AAD-bound header | Shipped |
| OPAQUE client | [`opaque-client.ts`](../../src/lib/services/opaque-client.ts), [`mock-opaque-server.ts`](../../src/lib/services/mock-opaque-server.ts), 4 API routes under [`src/routes/api/opaque/`](../../src/routes/api/opaque/) | Shipped |
| Argon2id | [`argon2.ts`](../../src/lib/crypto/argon2.ts) — RFC 9106, `VAULT_HIGH_PARAMS` = 256 MiB / 4 / p=1 / 32-byte tag | Shipped |
| Bundle verifier | [`build-manifest.mjs`](../../scripts/build-manifest.mjs) + `verifyBundleIntegrity()` in [`env.ts`](../../src/lib/utils/env.ts) — parallel SHA-384 | Shipped |
| KATs | [`ml-kem-1024.kat.test.ts`](../../src/lib/crypto/ml-kem-1024.kat.test.ts) (regression), [`ml-kem-1024.acvp.kat.test.ts`](../../src/lib/crypto/ml-kem-1024.acvp.kat.test.ts) (NIST tcId 51–55), [`argon2id-rfc9106.kat.test.ts`](../../src/lib/crypto/argon2id-rfc9106.kat.test.ts) | Shipped |

### Runtime evidence

```bash
npm run test:fips                                # 15 KAT assertions across ML-KEM, ACVP, Argon2id
npm run test src/lib/crypto/envelope.test.ts     # 7 hybrid envelope tests
npm run test src/lib/services/vault-envelope.test.ts  # 9 wrap/unwrap + tamper tests
npm run test src/lib/services/opaque-client.test.ts   # 4 OPAQUE round-trip tests
npm run test src/lib/crypto/argon2.test.ts            # 8 Argon2id tests
node scripts/verify-pins.mjs                          # exact-version pins for @structured-id/opaque, argon2id, @noble/post-quantum
```

### Adversarial evidence

- `env.tamper.test.ts` flips bytes in the bundle digest and asserts `verifyBundleIntegrity` rejects.
- ACVP vectors are pinned to NIST commit `15c0f3dee...`; reproduction recipe in [`build-acvp-kat.mjs`](../../scripts/build-acvp-kat.mjs).
- XMSS (L04) is intentionally a build-system concern, documented in `ARCHITECTURE.md` — not a code gap.

### Verdict

**ACCURATE.** No code changes needed.

---

## M3 — Server stack

**Original claim:** "Partial / risky — D1/R2/API routes exist, but identity/token/env/rate-limit wiring is incomplete."

### Static evidence — what WAS already complete

| Component | Files |
| --- | --- |
| D1 schema | [`migrations/0001_init.sql`](../../migrations/0001_init.sql), `0002_account_sequence_clock.sql`, `0003_rate_limits.sql`, `seed_server_identity.sql` |
| OPAQUE engine | [`server-opaque.ts`](../../src/lib/server/api/server-opaque.ts) — 325 lines, full RFC 9807 |
| D1 storage adapter | [`d1-storage.ts`](../../src/lib/server/api/d1-storage.ts) — 9-method `OpaqueStorage` implementation |
| Auth tokens | [`auth-token.ts`](../../src/lib/server/api/auth-token.ts) — 1h TTL, monotonic sequence clock |
| API routes | 9 routes under [`src/routes/api/`](../../src/routes/api/) — all bound to platform.env |
| `m3-sync-e2e` artifact | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) `m3-sync-e2e` job |
| 12-burst probe | [`.github/workflows/release.yml`](../../.github/workflows/release.yml) `Post-deploy production smoke` |

### Static evidence — gaps that needed closing

| # | Gap | Found in | Fix |
| --- | --- | --- | --- |
| 1 | No `/api/opaque/logout` route — token persisted for full 1h TTL after lock | (absent) | Created [`src/routes/api/opaque/logout/+server.ts`](../../src/routes/api/opaque/logout/+server.ts); wired into `lockSession()` as fire-and-forget |
| 2 | No D1 cleanup — pending state / sessions / rate-limit rows accumulate indefinitely | `d1-storage.ts` referenced a nonexistent `cleanup.ts` | Created [`src/lib/server/api/cleanup.ts`](../../src/lib/server/api/cleanup.ts) with sampled `maybeSweep` + deterministic `sweepNow` |
| 3 | No R2 garbage collection — superseded vault blobs + orphaned doc blobs grow unbounded | (absent) | Created [`src/lib/server/api/r2-gc.ts`](../../src/lib/server/api/r2-gc.ts) — purges below `currentClock - KEEP_SUPERSEDED` + dormant doc blobs > `DOC_BLOB_MAX_AGE_MS` |
| 4 | `OPAQUE_RATE_LIMIT_MODE` was dead config — declared but never read; rate limiter always hardcoded fail-closed | `env.ts` lacked the field | Added to `Env` + `app.d.ts`; new `getRateLimitMode(env)`; `applyRateLimit(env, ...)` consults it; fail-open path implemented |
| 5 | `OPAQUE_SERVER_ID` not pinned in `[env.production.vars]` — relied on default | `wrangler.toml` `[env.production.vars]` block | Pinned preview = `preview.vuvault.app`, production = `vuvault.app` |
| 6 | `PUBLIC_M3_E2E_AUTH` was in `app.d.ts` but absent from `Env` | `env.ts` | Added field |

### Runtime evidence (post-fix)

```bash
npm run test src/lib/server/api/cleanup.test.ts         # 3 tests — sweep correctness, partial-failure tolerance, no-op on empty
npm run test src/lib/server/api/r2-gc.test.ts           # 5 tests — vault-blob age-out, doc-blob age-out, prefix isolation, R2 failure
npm run test src/lib/server/api/rate-limit-d1.test.ts   # 11 tests — quota, fail-open, fail-closed, mode resolution
npm run test tests/integration                          # 25 tests — full API round-trip, including fail-open + fail-closed assertions
node scripts/audit-bindings.mjs                         # OK — Env / wrangler.toml parity holds
```

### Adversarial evidence

- The integration test `fails closed when the D1 rate-limit table is unavailable (production mode)` explicitly breaks D1's rate-limit table and asserts a 503 response with the production mode.
- The companion test `fails open when D1 rate-limit table is unavailable in preview mode` breaks the same table under preview mode and asserts the request makes it past the limiter (failing at a later step for an unrelated reason).
- Cleanup test `survives partial D1 failure and still cleans the other tables` injects a per-table D1 failure and confirms the sweep does not throw.
- The logout route is rate-limited under the OPAQUE_LOGIN bucket so a flood of logouts cannot mask a brute-force login attempt.

### Verdict

**ORIGINAL CLAIM WAS OUTDATED.** M3 wiring was substantially complete at the time of audit; six real operational gaps existed and have now been closed. M3 is now genuinely shipped.

---

## M4 — Audit prep

**Claim:** No third-party audit, app store, public threat-model deliverable yet.

### Static evidence

| Sub-claim | Status |
| --- | --- |
| Third-party crypto audit | Not started — firm TBD, hand-off package now ready |
| Public threat model document | **Now shipped** — [`docs/THREAT-MODEL.md`](../THREAT-MODEL.md) — asset inventory (15 entries), trust boundaries (5), DFDs (2 mermaid diagrams), STRIDE matrix, adversary catalog (13 entries), risk-rating matrix |
| App store submissions | Not started — out of scope for this pass |
| Marketing site | Not started — out of scope |
| Auditor-facing verification checklist | **Now shipped** — [`docs/AUDIT-CHECKLIST.md`](../AUDIT-CHECKLIST.md) — every claim mapped to its verification command |
| CycloneDX SBOM | **Now shipped** — `npm run sbom` produces a deterministic 372-component `sbom.json` |

### Runtime evidence

```bash
npm run sbom                                    # writes sbom.json; prints SHA-384
jq '.components | length' sbom.json             # 372
jq '.specVersion' sbom.json                     # "1.5"
node scripts/audit-bindings.mjs                 # OK
```

### Adversarial evidence

- The SBOM script is fully deterministic — two consecutive runs on the same lockfile produce byte-identical output, and the SHA-384 printed by the script is a build-attestable claim. (Verified: ran twice, identical hash.)
- The threat model is committed to the repo so it can be referenced by an immutable Git ref; audit firms cite SHAs, not `main`.
- The audit checklist contains live verification commands. Each one can be re-run from a fresh clone of any release tag.

### Verdict

**ORIGINAL CLAIM WAS ACCURATE.** The three tractable artifacts (threat model, SBOM, checklist) have been delivered. Third-party audit + app store + marketing remain pending and out of scope.

---

## Tier 2+ — MLS, CRDT, WebRTC, AKD, PIR, FROST

**Claim:** None of these are implemented.

### Static evidence

| Feature | npm dependency? | Source code? | Stubs? | UI references? |
| --- | --- | --- | --- | --- |
| MLS (L06) | No | No | No | Architecture text only |
| CRDT (L07) | No (`yjs` absent) | No | No | Plan doc + UI labels |
| WebRTC (L08) | No | No | No | Architecture text only |
| AKD (L09) | No | No | No (`transparencyLog: false` in capabilities) | Architecture text only |
| PIR (L10) | No | No | No | Architecture text only |
| FROST (L11) | No | No | No | Architecture text only |

### Runtime evidence

```bash
grep -F 'yjs' package.json                  # no match
grep -nFR --include='*.ts' --include='*.svelte' 'MLS' src/lib src/routes
# returns zero (or only documentation hits inside Svelte-template prose)
```

### Adversarial evidence

- The `capabilities` API endpoint hardcodes `deviceEnrollment: false` and `transparencyLog: false`. Both flags would need to flip when L08 / L09 ship.
- The `device_pairings` D1 table exists in `0001_init.sql` but no INSERT into it occurs anywhere in the codebase.

### Verdict

**ACCURATE.** [`docs/TIER2-ARCHITECTURE.md`](../TIER2-ARCHITECTURE.md) now provides an interface-level specification for each feature so future implementation has a contract, but no implementation code has landed.

---

## Hardening additions delivered this pass

1. **`POST /api/opaque/logout`** — server-side bearer-token revocation route, wired into `lockSession()` as fire-and-forget; idempotent + rate-limited.
2. **`src/lib/server/api/cleanup.ts`** — opportunistic D1 sweep for expired pending state, sessions, and stale rate-limit rows. Sampled at 4% per mutating request; bounded at 64 deletes per sweep.
3. **`src/lib/server/api/r2-gc.ts`** — opportunistic R2 garbage collection for superseded vault blobs (`{N}.bin` ≤ `currentClock - 2`) and dormant document blobs (uploaded > 14 days ago). Sampled at 2%; bounded at 32 deletes per sweep.
4. **`OPAQUE_RATE_LIMIT_MODE` wiring** — `Env.OPAQUE_RATE_LIMIT_MODE` field, `getRateLimitMode(env)` helper, new `applyRateLimit(env, ...)` signature; preview can opt into fail-open, production stays fail-closed.
5. **`PUBLIC_M3_E2E_AUTH`** added to `Env` interface (was in `app.d.ts` and wrangler.toml only).
6. **`OPAQUE_SERVER_ID` pinned per env** — `wrangler.toml` `[vars]` = `preview.vuvault.app`, `[env.production.vars]` = `vuvault.app`. Prevents preview AKE transcripts from replaying against production.
7. **`docs/THREAT-MODEL.md`** — formal Tier-1 threat model.
8. **`docs/AUDIT-CHECKLIST.md`** — auditor-facing verification map.
9. **`docs/TIER2-ARCHITECTURE.md`** — forward-looking specification for L06–L11.
10. **`scripts/build-sbom.mjs`** + `npm run sbom` + CI artifact upload — CycloneDX 1.5 SBOM generated deterministically from `package-lock.json`.

### Test surface delta

- 19 new unit tests across `cleanup.test.ts`, `r2-gc.test.ts`, `rate-limit-d1.test.ts`.
- 1 new integration test (`fails open when D1 rate-limit table is unavailable in preview mode`).
- 1 existing integration test renamed and clarified (`fails closed when the D1 rate-limit table is unavailable (production mode)`).
- All existing tests continue to pass; no regressions.

---

## Verification commands

Run these from the repo root after `npm ci --legacy-peer-deps`:

```bash
# Static guards
node scripts/audit-bindings.mjs
node scripts/verify-pins.mjs

# Unit + integration
npm run test
npm run test:fips

# SBOM
npm run sbom

# Reproducible build
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD) node scripts/verify-reproducible.mjs
```

Expected: all commands exit 0. The reproducible-build verifier reports byte-identical `.bundle-digest` across two passes.

---

## Outstanding issues (deferred)

1. **App store submissions (M4 remainder).** Out of scope for this audit pass.
2. **Marketing site at vault.vu (M4 remainder).** Out of scope.
3. **Third-party audit engagement (M4 critical-path item).** Hand-off package is now complete (`THREAT-MODEL.md` + `AUDIT-CHECKLIST.md` + `sbom.json`); firm selection is a product decision, not engineering.
4. **CRDT padding profile (Tier-2 design decision).** Documented in [`TIER2-ARCHITECTURE.md`](../TIER2-ARCHITECTURE.md) §L07 "Open issues".
5. **MLS library selection (Tier-2 prereq).** Documented in [`TIER2-ARCHITECTURE.md`](../TIER2-ARCHITECTURE.md) §L06 "Dependencies".

None of the deferred items violate the foundational ZK claim or block the Tier 1 production launch.
