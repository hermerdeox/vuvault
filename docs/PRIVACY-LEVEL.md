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
> bytes; not yet audit-complete, not yet multi-device, not yet
> sharing-enabled.**

If you only need a number, call it **Vu Level 1** (vault + documents
end-to-end encrypted, M3 sync gated and verified, no third-party
audit). Vu Level 2 (multi-device CRDT sync, MLS sharing, AKD log)
ships in Tier 2 — see [docs/ROADMAP.md](./ROADMAP.md).

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
| Whole-vault encrypted blob sync against R2; server stores ciphertext only | ✅ shipped | [`src/routes/api/blobs/upload/+server.ts`](../src/routes/api/blobs/upload/+server.ts), [`src/routes/api/blobs/latest/+server.ts`](../src/routes/api/blobs/latest/+server.ts), [`tests/e2e/sync.spec.ts`](../tests/e2e/sync.spec.ts) |
| Per-document encrypted blob storage against R2; server stores ciphertext only | ✅ shipped (this pass) | [`src/routes/api/documents/[blobId]/+server.ts`](../src/routes/api/documents/[blobId]/+server.ts), [`tests/integration/api-routes.spec.ts`](../tests/integration/api-routes.spec.ts) |
| Production rate-limit bindings fail-closed | ✅ shipped | [`src/lib/server/api/env.ts`](../src/lib/server/api/env.ts) `checkRateLimit`, [`.github/workflows/release.yml`](../.github/workflows/release.yml) post-deploy burst probe |
| Production preflight refuses to deploy without the `m3-sync-e2e` CI artifact | ✅ shipped | [`scripts/verify-production-runtime.mjs`](../scripts/verify-production-runtime.mjs) |
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
| Third-party crypto audit | ⚠️ pending | Tier 1 launch gate; audit firm TBD. Until then claims are based on standards-compliance and KAT vectors, not external review |
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
2. **Encrypted bytes** are written to the new `documentBlobs` Dexie
   table and, when sync is wired, uploaded as opaque blobs to
   `vaults/<accountId>/documents/<blobId>.bin` in R2.
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
defined by which guarantees from the tables above hold today.

| Level | What holds | When |
| --- | --- | --- |
| **Vu Level 0** | TLS + same-origin sync + standard "we promise" privacy policy | Never; not a level we ship |
| **Vu Level 1** | Vault + document plaintext end-to-end encrypted, local Recovery Envelope, M3 sync gated, fail-closed rate limits, reproducible + signed builds, *no third-party audit* | **Today (M3, post this pass)** |
| **Vu Level 2** | Level 1 plus field-level CRDT sync, MLS sharing, AKD-anchored device pairing, breach checks without leakage | Tier 2 (2027) |
| **Vu Level 3** | Level 2 plus FROST t-of-n recovery, TEE-attested metadata operations, agentic-autofill over Noise IK channels | Tier 3 (2028) |
| **Vu Level 4** | Level 3 plus zkSNARK selective disclosure, drand timelock, threshold HBS | Tier 4 (2029–2030) |

If the UI ever claims a level higher than what's holding in this
document, that's a bug — file it.
