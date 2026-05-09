# VuVault Roadmap

A living document. The cadence is *standards land first, ship after audit*. We do not ship pre-standardization crypto.

---

## Q3 2026 — Tier 1 production launch

The minimum credible product. Everything below is on the critical path to public release.

### Milestone 1 — Vault foundation (now → Aug 2026)

- ✅ SvelteKit scaffold complete
- ✅ Dual-theme system shipping
- ✅ Onboarding flow with real CSPRNG + WebAuthn
- ✅ Landing prototype converted to 11 Svelte panels (`docs/prototypes/landing.html`)
- ✅ Vault store wired to real Dexie persistence with AAD-bound AES-GCM (whole-vault envelope; AAD binds `formatVersion`, auth-mode tag, deviceSalt, credentialId digest, and v2-wrapped-header digest)
- ✅ Password generator panel in vault top-bar (standalone `QuickGenerator` popover, copy-to-clipboard) with class-coverage policy; in-modal generator stays available inside the new-item editor
- ✅ Add/edit modal for all 7 item kinds with per-kind validation and secret-safe inputs
- ✅ Search ⌘K command palette (combobox/listbox a11y, ranked, disabled-aware)
- ✅ Health categories: local Weak / Reused detection (no plaintext leaves memory)

### Milestone 2 — Crypto wiring (Aug → Sep 2026)

- ✅ Verify `@noble/post-quantum` against deterministic regression vectors locked to `@noble/post-quantum@0.4.1` (5 ML-KEM-1024 cases under `npm run test:fips`; FIPS 203 sizes, not NIST-CAVP-published vectors — pulling official ACVP vectors is M4 audit prep)
- ✅ Implement OPAQUE client (RFC 9807) via `@structured-id/opaque` behind a swappable transport facade
- ✅ End-to-end vault encryption: vault store → hybrid envelope → IndexedDB (formatVersion 2 wraps a fresh AES-256 key under X25519 + ML-KEM-1024)
- ✅ Argon2id (RFC 9106) master-password fallback as an opt-in third factor; `VAULT_HIGH_PARAMS` preset (256 MiB, 4 passes, p=1 — well above OWASP's published Argon2id minimums and libsodium INTERACTIVE, below libsodium SENSITIVE)
- ✅ Bundle integrity check at every unlock — refuses decryption on mismatch; renders a per-build Rekor link in the unlock footer for out-of-band verification

### Milestone 3 — Server-side stack (Sep 2026)

- ✅ Cloudflare Pages Functions + D1 OPAQUE record storage (see [functions/api/opaque/](../functions/api/opaque/), [functions/api/_shared/migrations/0001_init.sql](../functions/api/_shared/migrations/0001_init.sql), [d1-storage.ts](../functions/api/_shared/d1-storage.ts))
- ✅ R2 bucket for opaque encrypted vault blobs (see [functions/api/blobs/](../functions/api/blobs/), [wrangler.toml](../wrangler.toml) `VAULT_BLOBS` binding)
- ✅ Worker routes for OPAQUE register + login flow — server only ever stores the RFC 9807 envelope, never password-equivalent material (see [server-opaque.ts](../functions/api/_shared/server-opaque.ts) `OpaqueServerEngine`)
- ✅ Sigstore + Rekor keyless publishing in CI (see [.github/workflows/release.yml](../.github/workflows/release.yml) — pinned `sigstore/cosign-installer@v3.5.0` + `cosign@v2.4.0`, `id-token: write` OIDC flow, attaches signature + cert + Rekor index to every published release)
- ✅ Reproducible build verification job — two-pass build with `SOURCE_DATE_EPOCH`-pinned `generatedAt` and a deterministic `kit.version.name`, asserts byte-identical `.bundle-digest` across independent builds (see [scripts/verify-reproducible.mjs](../scripts/verify-reproducible.mjs), [.github/workflows/ci.yml](../.github/workflows/ci.yml) `reproducible-build` job)

### Milestone 4 — Audits & launch prep (Oct → Q4 2026)

- ⏳ Third-party crypto audit (firm TBD — Cure53, NCC, or Trail of Bits)
- ⏳ Public threat model document
- ⏳ Apple App Store, Play Store, Firefox/Chrome extension submissions
- ⏳ Marketing site live at vault.vu

---

## 2027 — Tier 2: sync & sharing

The "more than one device" tier.

- L06 MLS-based family/team vaults — first quarter
- L07 Encrypted CRDT sync (Yjs over HPKE) — second quarter
- L08 Local WebRTC pairing — second quarter
- L09 CONIKS-derived AKD log — third quarter
- L10 PIR breach-check service (HIBP-equivalent without leakage) — fourth quarter

Subscription tier ($25.60/yr) becomes meaningful at Tier 2 — it pays for sync infrastructure and the AKD log.

---

## 2028 — Tier 3: recovery & enterprise

- L11 FROST t-of-n recovery — first half
- L12 Nitro/Confidential TEE for server-side metadata operations — second half
- L13 Noise-channel agentic autofill (1Password+Browserbase pattern) — second half
- L14 FN-DSA compact signatures once FIPS 206 finalizes

This is when enterprise becomes viable. Designated recoverers replace the IT-helpdesk-with-master-password pattern.

---

## 2029–2030 — Tier 4: frontier

These ship as the underlying cryptographic standards finalize:

- L15 zkSNARK selective disclosure for ID/credential verification
- L16 drand timelock for inheritance / dead-man releases
- L17 Threshold stateful HBS (Haystack) once libraries production-harden
- L18 Pure-PQ threshold recovery

---

## Non-roadmap principles

We do **not** ship:

- 🚫 Engagement / addiction mechanics
- 🚫 Telemetry, analytics, or "anonymized usage data"
- 🚫 Per-user pricing tiers or feature gates beyond Free vs Unlimited
- 🚫 Browser-extension-only paywalls
- 🚫 Closed-source "premium" components
- 🚫 Anything that would let the server read user data — *ever*

The competitive advantage is genuine architectural privacy. Eroding it for growth metrics is a fatal product mistake.
