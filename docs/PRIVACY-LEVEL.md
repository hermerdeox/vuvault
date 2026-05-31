# Vu Privacy Level — Honest Assessment

> An accurate snapshot of what the shipped code protects today, what it
> does not, and what is still on the roadmap. Updated alongside the
> Full App Workflow E2E + document file encryption pass.
>
> This document is the truth source for marketing copy: do not claim
> anything here lists as **partial** or **pending** as if it were
> shipped.

---

## TL;DR

VuVault today is best described as:

> **High architectural privacy for vault contents and document file
> bytes, with minimized relay metadata — no per-user blob inventory,
> no persistent device set, no cross-account sequence clock; not yet
> multi-device, not yet sharing-enabled.**

If you only need a number, call it **Vu Level 1** (vault + documents
end-to-end encrypted, M3 sync gated and verified, AND relay metadata
minimized: blobs keyed by random UUID with no account prefix, the
latest-pointer kept in a client-side encrypted inventory the passive
server cannot address, no persistent device set, no server-side
sequence clock). The §L07b metadata-minimization pass closed the last
two V1 criteria (V1-C1, V1-C3) by wiring the random-UUID blob + client
inventory path into the live save/restore and document flows; V1-C2
closed earlier with `migrations/0004_metadata_minimization.sql`. The
mechanical gap analysis — every criterion, the code that closes it,
and the open spec work — lives in
[`docs/VU-LEVEL-MIGRATION-MAP.md`](./VU-LEVEL-MIGRATION-MAP.md).
The path to **Vu Level 0** (zero-knowledge — no server-visible
account correlation at all, including unlinkable routing identifiers
that replace the deterministic Candidate-1 bootstrap address) is the
Tier 2+ AKD + CRDT padding work in
[`docs/TIER2-ARCHITECTURE.md`](./TIER2-ARCHITECTURE.md).

> **2026-05-22 Phase 2 update.** The **V1-C2** criterion ("no
> persistent device set") **has closed**: as of the session-mint
> redesign that ships with `migrations/0004_metadata_minimization.sql`,
> the server's `sessions` table no longer carries `device_id` and the
> `accounts` table no longer carries `last_login_at`. The
> `device_pairings` table is dropped.
>
> **2026-05-25 Vu0 full-crypto update.** The remaining V0-C1/C2/C3
> closures are implemented in this build:
>
> - **V0-C1** unlinkable routing — AKD epochs
>   ([`migrations/0006_akd_epochs.sql`](../migrations/0006_akd_epochs.sql),
>   Ed25519-VRF in [`src/lib/crypto/ed25519-vrf.ts`](../src/lib/crypto/ed25519-vrf.ts))
>   + VOPRF capability handles (RFC 9497 / Ristretto255 in
>   [`src/lib/crypto/voprf.ts`](../src/lib/crypto/voprf.ts)) +
>   per-epoch OPRF keys
>   ([`migrations/0007_oprf_keys.sql`](../migrations/0007_oprf_keys.sql)) +
>   capability_index lookup
>   ([`migrations/0008_capability_index.sql`](../migrations/0008_capability_index.sql)).
>   V2 routes accept `X-Vu0-Capability` alongside Bearer.
> - **V0-C2** bucketed blob sizes — `padPlaintext`/`unpadPlaintext`
>   wired into `saveItems`/`sealDocument`/`openDocument` with
>   format-version bump v2 → v3.
> - **V0-C3** no account-existence oracle — `/api/opaque/login/ke1`
>   performs dummy OPRF work on the unknown-clientId path and
>   returns a generic `"invalid login request"` 401 instead of the
>   legacy `"unknown clientId"` string.
>
> **Residual gap (documented, NOT closed):** the OPAQUE handshake
> still requires SOME stable per-account identifier so the server
> can load the OPAQUE envelope. We replaced the user-chosen
> `clientId` with `accountSeed`-derived handles but the handle is
> stable per account during the OPAQUE round-trip itself. Full
> per-handshake unlinkability requires a Tier-3+ ZK-proof layer
> (see TIER2-ARCHITECTURE.md §"Tier 3+"). The honest V0-C1 framing
> in this build: **"after OPAQUE login, the server cannot link a
> session's subsequent requests to the account that logged in."**
>
> **2026-05-31 Vu1 closure update.** The remaining V1 criteria —
> **V1-C1** ("no per-user blob inventories") and **V1-C3** ("no
> cross-account sequence-clock correlation") — are now **closed in the
> live data path**, not merely prototyped. An earlier build had the v2
> blob/inventory primitives but never wired them into save/restore; the
> §L07b pass connects them. The whole-vault save/restore flow and the
> document attach/read flow write to random-UUID blobs at
> `/api/v2/blobs/<uuid>` (no account prefix) with the latest-pointer in
> a client-side encrypted inventory at `/api/v2/inv/<addr>` whose
> address the passive server cannot compute. The legacy per-account
> routes are **deleted**, and `migrations/0009_drop_sequence_clock.sql`
> drops the server-side sequence clock. This is verified *behaviorally*
> — not just by route shape — by `scripts/release-probe-vu1.mjs` (the
> deleted routes return no handler) plus request-interception in
> `tests/e2e/sync.spec.ts`. With V1-C1/C2/C3 all closed, **`CURRENT_LEVEL`
> moves from 2 to 1.** Accepted residual: the inventory bootstrap
> address is deterministically derived from the secret vault key
> (Candidate 1), so a holder of that key can confirm an inventory
> exists — moot, since holding the key already discloses the vault.
> CRDT sync, MLS sharing, AKD pairing, and PIR breach checks remain
> Tier-2 futures and are **not** claimed at Vu Level 1.
>
> See
> [`docs/verifications/2026-05-22-vu1-phase2.md`](./verifications/2026-05-22-vu1-phase2.md),
> [`docs/verifications/2026-05-26-vu0-uplift.md`](./verifications/2026-05-26-vu0-uplift.md),
> and
> [`docs/verifications/2026-05-31-vu1-closure.md`](./verifications/2026-05-31-vu1-closure.md)
> for the audited evidence.

> **Scale direction (2026-05-20 inversion).** Lower numbers are
> stronger. **Vu Level 0 = most private** (zero-knowledge);
> **Vu Level 5 = least private** ("we promise" — REFUSED in the
> Vu ecosystem). This matches the canonical taxonomy in
> [`PRIVACY_AUDIT.md`](../PRIVACY_AUDIT.md) §15.
>
> **Note on audits.** Third-party audits are a *trust signal*, not a
> *privacy capability* — they do not change what the cryptography
> can do, only what externally-verified evidence exists for it. The
> Vu Privacy Level ladder is defined exclusively by which guarantees
> the shipped code holds today. Audit status is tracked separately
> in [`docs/AUDIT-CHECKLIST.md`](./AUDIT-CHECKLIST.md) and on the
> M4 launch-prep section of [`docs/ROADMAP.md`](./ROADMAP.md).

---

## What is shipped and verified

Each row in this table maps to actual code paths exercised by
`npm run test`, `npm run test:e2e`, and the integration tests under
[`tests/integration/`](../tests/integration/).

| Guarantee | Status | Evidence |
| --- | --- | --- |
| Vault item plaintext never leaves the device unencrypted | ✅ shipped | [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts) `provisionVault` / `saveItems`; verified by [`tests/e2e/full-workflow.spec.ts`](../tests/e2e/full-workflow.spec.ts) (zero-knowledge IDB inspection) |
| Document file plaintext never leaves the device unencrypted | ✅ shipped | [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts) `sealDocument` / `openDocument` with document-scoped AAD; verified by [`tests/e2e/full-workflow.spec.ts`](../tests/e2e/full-workflow.spec.ts) and the `document blob crypto` block in [`src/lib/services/vault-session.test.ts`](../src/lib/services/vault-session.test.ts) |
| AES-256-GCM under a per-vault key wrapped in an X25519 + ML-KEM-1024 hybrid envelope | ✅ shipped | [`src/lib/services/vault-envelope.ts`](../src/lib/services/vault-envelope.ts); KAT-locked under `npm run test:fips` |
| Argon2id (RFC 9106) optional master-password third factor | ✅ shipped | [`src/lib/crypto/argon2.ts`](../src/lib/crypto/argon2.ts), [`src/lib/crypto/argon2id-rfc9106.kat.test.ts`](../src/lib/crypto/argon2id-rfc9106.kat.test.ts) |
| OPAQUE (RFC 9807) registration + login against D1; server never sees a password equivalent | ✅ shipped | [`src/routes/api/opaque/`](../src/routes/api/opaque/), [`src/lib/server/api/server-opaque.ts`](../src/lib/server/api/server-opaque.ts); integration tests in [`tests/integration/worker.spec.ts`](../tests/integration/worker.spec.ts) |
| Local Recovery Envelope for passkey-loss recovery with Secret Key + Recovery Password | ✅ shipped | [`src/lib/crypto/recovery-envelope.ts`](../src/lib/crypto/recovery-envelope.ts), [`src/lib/services/recovery-envelope.ts`](../src/lib/services/recovery-envelope.ts), [`src/routes/recover/+page.svelte`](../src/routes/recover/+page.svelte) |
| Whole-vault encrypted blob sync against R2; server stores ciphertext only, keyed by random UUID with no account prefix | ✅ shipped | [`src/routes/api/v2/blobs/[uuid]/+server.ts`](../src/routes/api/v2/blobs/[uuid]/+server.ts), [`src/routes/api/v2/inv/[addr]/+server.ts`](../src/routes/api/v2/inv/[addr]/+server.ts), [`src/lib/services/inventory-session.ts`](../src/lib/services/inventory-session.ts), [`tests/e2e/sync.spec.ts`](../tests/e2e/sync.spec.ts) |
| Per-document encrypted blob storage against R2; server stores ciphertext only, keyed by random UUID with no account prefix | ✅ shipped | [`src/routes/api/v2/blobs/[uuid]/+server.ts`](../src/routes/api/v2/blobs/[uuid]/+server.ts), [`src/lib/services/document-blobs.ts`](../src/lib/services/document-blobs.ts), [`tests/integration/v2-blobs.spec.ts`](../tests/integration/v2-blobs.spec.ts) |
| Production rate-limit bindings fail-closed | ✅ shipped | [`src/lib/server/api/rate-limit-d1.ts`](../src/lib/server/api/rate-limit-d1.ts) `applyRateLimit` + [`env.ts`](../src/lib/server/api/env.ts) `getRateLimitMode`; mode `OPAQUE_RATE_LIMIT_MODE` is `fail-closed` in `[env.production.vars]`. Verified by [`rate-limit-d1.test.ts`](../src/lib/server/api/rate-limit-d1.test.ts) + [`.github/workflows/release.yml`](../.github/workflows/release.yml) post-deploy burst probe. |
| Server-side session revocation on lock | ✅ shipped | [`/api/opaque/logout`](../src/routes/api/opaque/logout/+server.ts), wired into `lockSession()` in [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts) as a fire-and-forget call. |
| Per-environment OPAQUE serverIdentity (preview cannot replay against production) | ✅ shipped | [`wrangler.toml`](../wrangler.toml) `[vars]` (`preview.vuvault.app`) vs `[env.production.vars]` (`vuvault.app`); `OPAQUE_SERVER_ID` mixes into every AKE transcript via [`server-opaque.ts`](../src/lib/server/api/server-opaque.ts). |
| Opportunistic D1 cleanup of pending state / sessions / rate-limit windows | ✅ shipped | [`src/lib/server/api/cleanup.ts`](../src/lib/server/api/cleanup.ts); [`cleanup.test.ts`](../src/lib/server/api/cleanup.test.ts). |
| Opportunistic R2 garbage collection of superseded blobs by reference counting — no per-account prefix walk | ✅ shipped | [`src/lib/server/api/r2-gc.ts`](../src/lib/server/api/r2-gc.ts) (`maybeGcV2` / `gcV2Now` reaping `blob_references` / `inv_references`); [`r2-gc.test.ts`](../src/lib/server/api/r2-gc.test.ts). |
| Production preflight refuses to deploy without the `m3-sync-e2e` CI artifact | ✅ shipped | [`scripts/verify-production-runtime.mjs`](../scripts/verify-production-runtime.mjs) |
| Formal threat model + audit checklist + CycloneDX SBOM | ✅ shipped | [`docs/THREAT-MODEL.md`](./THREAT-MODEL.md), [`docs/AUDIT-CHECKLIST.md`](./AUDIT-CHECKLIST.md), `npm run sbom` ([`scripts/build-sbom.mjs`](../scripts/build-sbom.mjs)) |
| Bundle integrity verification on every unlock; mismatch refuses decryption | ✅ shipped | [`src/lib/utils/env.ts`](../src/lib/utils/env.ts) `verifyBundleIntegrity`, `.bundle-digest` |
| Reproducible builds (two-pass digest verified in CI) | ✅ shipped | [`scripts/verify-reproducible.mjs`](../scripts/verify-reproducible.mjs), [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) `reproducible-build` job |
| Sigstore + Rekor keyless publishing on every release | ✅ shipped | [`.github/workflows/release.yml`](../.github/workflows/release.yml) `cosign` step |
| Lock zeroizes every secret-bearing field, tears down session keys, clears sync bearer token, and hides revealed fields | ✅ shipped | [`src/lib/types/vault-item.ts`](../src/lib/types/vault-item.ts) `SECRET_FIELDS_BY_KIND`, `lockSession` in [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts), [`src/lib/stores/vault.svelte.ts`](../src/lib/stores/vault.svelte.ts) |
| Auto-lock reduces unlocked-session exposure on idle, hidden tab, and pagehide/freeze | ✅ shipped | [`src/lib/services/auto-lock.ts`](../src/lib/services/auto-lock.ts), mounted from [`src/routes/vault/+page.svelte`](../src/routes/vault/+page.svelte) |
| Auto-clear of clipboard after copy (best-effort, browser-permission-dependent) | ✅ shipped | [`src/lib/services/secure-clipboard.ts`](../src/lib/services/secure-clipboard.ts) |

---

## What is partial or pending

| Guarantee | Status | Evidence / blocker |
| --- | --- | --- |
| Field-level encrypted CRDT sync (no item-shape leakage from sync deltas) | ⚠️ pending | Tier 2 (2027). Today the sync server still sees the size of the whole-vault blob and the size of each document blob. See [`docs/L07-CRDT-SYNC-PLAN.html`](./L07-CRDT-SYNC-PLAN.html) |
| Document blob size + upload timing privacy | ⚠️ partial | Ciphertext is sealed at natural length; no padding to bucketed sizes. An on-path observer can distinguish a 4 KB note attachment from a 4 MB scan. Tier 2 design adds bucketed padding |
| Multi-device pairing without server-side device-set knowledge | ⚠️ pending | L08 (Tier 2). Today every successful OPAQUE login mints a session token that the server logs |
| Sharing (family / team vaults) | ⚠️ pending | L06 MLS sharing — Tier 2 (2027). The current product is single-user |
| Cross-device document recovery without re-uploading | ⚠️ partial | The R2 fetch path for documents works when sync is wired and the user has a valid session token, but there is no UI for "this device, no local row" prompting. Today VaultDetail's download will surface a typed error and the user can re-attach |
| Threshold / FROST account recovery | ⚠️ pending | L11 (Tier 3, 2028). Today recovery is local-only: Secret Key + Recovery Password + local/exported Recovery Envelope |
| PIR-based breach checks (HIBP without leakage) | ⚠️ pending | L10 (Tier 2). Today no breach-check service is shipped — local "weak / reused" detection only |
| zkSNARK selective disclosure | ⚠️ pending | L15 (Tier 4, 2029–2030) |

---

## What VuVault explicitly does NOT defend against

| Threat | Why we cannot defend | Mitigation today |
| --- | --- | --- |
| Endpoint compromise (the device the user is on) | If the device is owned, the unlocked vault is owned. JavaScript cannot defeat persistent endpoint malware | Aggressive zeroize on lock; idle/hidden/pagehide auto-lock; secret-field UI is masked-by-default; field-scoped auto-hide after 30 s; clipboard clear after 60 s and on lock |
| Coercion of the user (rubber-hose attacks) | Cryptography does not solve consent | Plausible-deniability decoy vault is on the Tier 3 roadmap |
| Side-channel attacks against the platform's WebCrypto implementation | Browser-vendor problem | We only call constant-time noble primitives where we control the impl |
| Implementation bugs in our code | Defended by audits + fuzzing, not architecture | KAT-locked crypto, fail-closed production gates, deterministic E2E |
| The account-existence oracle from OPAQUE | Unavoidable from RFC 9807 | Explicitly documented in [`docs/SECURITY.md`](./SECURITY.md) §scope |
| Total sync-volume / upload-cadence side channels | Inherent to operating a sync server | Out of ZK scope; explicitly documented |
| Demo-mode onboarding (deterministic PRF) | Designed for dev / CI only | `PUBLIC_ENABLE_DEMO_AUTH` is **false** in production and verified by [`scripts/verify-production-runtime.mjs`](../scripts/verify-production-runtime.mjs); CI fails the release if it leaks |
| `PUBLIC_M3_E2E_AUTH` HMAC shim for WebAuthn PRF | CI-only deterministic factor for the M3 sync E2E | Same release-gate as demo mode; production refuses to ship with it enabled |
| Offline attack against exported Recovery Envelope | If an attacker gets the `.vukey`/IndexedDB recovery row and the Secret Key, the Recovery Password is brute-forceable offline | Argon2id high preset, central creation/rotation policy, explicit UX warning, and guidance to store Recovery Password separately |

---

## How the document-file pass changes the picture

Before this pass, a "document" in the vault stored only a description
and an optional external reference. The plan explicitly chose to add
real encrypted file storage rather than test the metadata-only
placeholder. After this pass:

1. **Plaintext file bytes are only present in memory** inside
   `attachDocumentFile()` ([`src/lib/services/document-blobs.ts`](../src/lib/services/document-blobs.ts))
   and inside the caller's `Blob` when downloading
   ([`src/routes/vault/VaultDetail.svelte`](../src/routes/vault/VaultDetail.svelte) `downloadDocument`).
2. **Encrypted bytes** are written to the local `documentBlobs` store
   and uploaded as opaque blobs to `/api/v2/blobs/<blobId>` in R2 — a
   random UUID with no account prefix, with the blob id recorded in the
   client-side encrypted inventory rather than a per-account listing.
3. **AES-256-GCM** seals each document with the active session AES
   key under a **distinct AAD domain** (`vuvault-doc-aad-v1`) bound to
   the document's UUID, the account's device salt, and the WebAuthn
   credential id. A document blob cannot be replayed as a whole-vault
   blob or swapped between accounts.
4. **A SHA-256 of the plaintext** is captured at upload time, stored in
   the encrypted vault item, and displayed in both the editor and the
   detail view. Anyone who knows the original plaintext can verify
   that the bytes haven't drifted.
5. **The E2E test [`tests/e2e/full-workflow.spec.ts`](../tests/e2e/full-workflow.spec.ts)
   programmatically inspects IndexedDB after the workflow** and asserts
   that none of the seven plaintext secrets the user typed appear
   anywhere in the encrypted vault blob or the encrypted document
   blob — the shipped zero-knowledge claim against a local-disk
   exfiltration attack.

---

## How to verify any of this yourself

```bash
# All unit + integration tests (200+ tests)
npm run test

# FIPS-locked crypto KATs (ML-KEM-1024 + Argon2id RFC 9106 + ACVP)
npm run test:fips

# Type check and linter
npm run check
npm run lint

# Full workflow E2E (Chromium) — requires dev server on :5173
npm run test:e2e -- tests/e2e/full-workflow.spec.ts

# Live M3 sync E2E (requires Wrangler + D1/R2 local bindings)
M3_E2E=1 npm run test:e2e -- tests/e2e/sync.spec.ts
```

Verifying the on-the-wire / on-disk privacy claim yourself:

1. Run `npm run dev` and complete a full demo onboarding.
2. Open DevTools → Application → IndexedDB → `vuvault` → `vault` and
   `documentBlobs`.
3. Inspect the rows. Every byte you see should be opaque ciphertext
   — no JSON, no file names, no passwords. The full-workflow E2E test
   asserts exactly this programmatically.

---

## Vu Privacy Levels reference

This is a deliberately small ladder. Each level is exhaustively
defined by which **cryptographic capabilities** the shipped code
holds today. Lower numbers are stronger; an **unaudited Vu Level 1
system is still a Vu Level 1 system** in terms of what it can
protect. Third-party audits are an *evidence* concern tracked in
[`docs/AUDIT-CHECKLIST.md`](./AUDIT-CHECKLIST.md) + M4 of
[`docs/ROADMAP.md`](./ROADMAP.md), not a privacy-ladder property.

| Level | What holds | When |
| --- | --- | --- |
| **Vu Level 0** | Zero-knowledge: no server-visible account / session / device correlation; routing identifiers unlinkable; blob sizes bucketed; metadata minimized to delivery-only. A server compromise reveals, by construction, nothing useful. | **Aspirational — Tier 2+ redesign target** |
| **Vu Level 1** | E2E content **and** minimized relay metadata — no per-user blob inventories (random-UUID blobs + client-side encrypted inventory), no persistent device set, no cross-account sequence-clock correlation. The deterministic Candidate-1 bootstrap address is the accepted residual. CRDT sync, MLS sharing, AKD pairing, and PIR breach checks are **not** part of this level — they remain Tier-2 futures. | **Today (M3 — §L07b metadata-minimization pass)** |
| **Vu Level 2** | Vault + document plaintext E2E encrypted under X25519 + ML-KEM-1024 hybrid envelope, local Recovery Envelope, M3 sync gated and verified, fail-closed rate limits, reproducible + signed builds. Server still retains per-account blob inventories, a persistent device set, and a cross-account sequence clock. | Superseded by Vu Level 1 in the §L07b pass |
| **Vu Level 3** | Partial E2E with recoverable metadata — server can correlate or partially decrypt metadata, holds recovery material, or operates a key-escrow path. Common shape for incumbent password managers offering "account recovery." | Refused for VuVault; listed for comparison |
| **Vu Level 4** | Weakened or legacy cryptography — E2E labels are claimed, but cipher choices or key management are brute-forceable in practice, or the server retains a key-recovery path under "operational" cover. | Refused; below the ecosystem floor |
| **Vu Level 5** | Policy privacy: TLS + same-origin sync + standard "we promise not to look." The server holds plaintext or session keys; privacy is policy, not architecture. | **NOT ALLOWED in the Vu ecosystem** |

**SubZero (honorary).** The canonical taxonomy in
[`PRIVACY_AUDIT.md`](../PRIVACY_AUDIT.md) §15 reserves a tier
*above* Vu Level 0 called **SubZero**: a system that holds every
Vu-Level-0 invariant **AND** has a documented enforced CSP with
zero `unsafe-inline` / `unsafe-eval`, a published independent third-
party security review covering the cryptographic boundary, and
formal-verification-grade evidence for the OPAQUE / envelope path.
SubZero is not a level you ship through gradual hardening; it's a
recognition tag for a system that has earned an externally-anchored
provable-ZK claim. M4 audit prep (`AUDIT-CHECKLIST.md`) is the
path. Today VuVault is not SubZero.

If the UI ever claims a level numerically lower than what holds in
this document (i.e. claims more privacy than the shipped code has),
that's a bug — file it.
