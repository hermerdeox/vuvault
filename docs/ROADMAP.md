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

- ✅ Verify `@noble/post-quantum` against deterministic regression vectors at the exact version `@noble/post-quantum@0.4.1` (enforced by [scripts/verify-pins.mjs](../scripts/verify-pins.mjs); 5 deterministic ML-KEM-1024 cases under `npm run test:fips`; the runtime version is asserted against `kat.nobleVersion` from [src/lib/crypto/ml-kem-1024.kat.test.ts](../src/lib/crypto/ml-kem-1024.kat.test.ts) so a silent lockfile drift fails the suite). NIST ACVP vectors (tcId 51–55) also run under `npm run test:fips` via [src/lib/crypto/ml-kem-1024.acvp.kat.test.ts](../src/lib/crypto/ml-kem-1024.acvp.kat.test.ts).
- ✅ Implement OPAQUE client (RFC 9807) via `@structured-id/opaque` behind a swappable transport facade
- ✅ End-to-end vault encryption: vault store → hybrid envelope → IndexedDB (formatVersion 2 wraps a fresh AES-256 key under X25519 + ML-KEM-1024)
- ✅ Argon2id (RFC 9106) master-password fallback as an opt-in third factor; `VAULT_HIGH_PARAMS` preset (256 MiB, 4 passes, p=1 — well above OWASP's published Argon2id minimums and libsodium INTERACTIVE, below libsodium SENSITIVE). RFC 9106 §5.3 KAT runs under `npm run test:fips` via [src/lib/crypto/argon2id-rfc9106.kat.test.ts](../src/lib/crypto/argon2id-rfc9106.kat.test.ts).
- ✅ Local Recovery Envelope: Secret Key + separate Recovery Password can unwrap a local/exported AES-key recovery envelope after passkey loss, then force a new passkey bind. This is not threshold recovery; it is the fastest zero-knowledge local recovery path.
- ✅ Bundle integrity check at every unlock — refuses decryption on mismatch; renders a per-build Rekor link in the unlock footer for out-of-band verification. Per-chunk SHA-384 verification runs in parallel via `Promise.all` so the unlock TTI stays small.

### Milestone 3 — Server-side stack (Sep 2026)

- ✅ SvelteKit API routes + D1 OPAQUE record storage are production-gated by stable D1 server identity derivation, idempotent release-time identity bootstrap, **fail-closed production rate-limit mode wired through `OPAQUE_RATE_LIMIT_MODE`** (`src/lib/server/api/rate-limit-d1.ts`, `src/lib/server/api/env.ts::getRateLimitMode`), explicit per-environment `OPAQUE_SERVER_ID` (preview vs production), and the `m3-sync-e2e` CI artifact (see [`src/routes/api/opaque/`](../src/routes/api/opaque/), [`migrations/0001_init.sql`](../migrations/0001_init.sql), [`src/lib/server/api/d1-storage.ts`](../src/lib/server/api/d1-storage.ts), [`scripts/seed-opaque-identity.mjs`](../scripts/seed-opaque-identity.mjs)).
- ✅ R2 binding + blob upload/fetch routes are wired through authenticated KE3 session tokens and release-time `PUBLIC_SYNC_ORIGIN` verification; production release requires a real local Wrangler D1/R2 round-trip artifact, post-deploy `/api/capabilities` smoke, and a **12-request burst probe against `/api/opaque/register/request` that asserts at least one 429/503 returns** (see [`.github/workflows/release.yml`](../.github/workflows/release.yml) `Post-deploy production smoke` step) so the dashboard rate-limiter is mechanically verified before traffic flows. See also [`tests/e2e/sync.spec.ts`](../tests/e2e/sync.spec.ts), [`wrangler.toml`](../wrangler.toml) `VAULT_BLOBS` binding. **(§L07b supersession, 2026-05-31:** the per-account `/api/blobs/*` upload/fetch routes shipped here were retired and replaced by random-UUID [`/api/v2/blobs/[uuid]`](../src/routes/api/v2/blobs/[uuid]/+server.ts) plus a client-side encrypted inventory at [`/api/v2/inv/[addr]`](../src/routes/api/v2/inv/[addr]/+server.ts), closing V1-C1/V1-C3 — see [`docs/PRIVACY-LEVEL.md`](./PRIVACY-LEVEL.md).)**
- ✅ Per-document encrypted blob storage shipped end-to-end. Document items carry a `docBlobId` UUID; plaintext file bytes are sealed client-side with AES-256-GCM under a document-scoped AAD domain (`vuvault-doc-aad-v1`) bound to the active vault session key, written to a new Dexie `documentBlobs` table, and (when sync is wired) uploaded as opaque bytes — originally through `PUT /api/documents/<blobId>`, retired in the §L07b pass (2026-05-31) and now through random-UUID [`/api/v2/blobs/[uuid]`](../src/routes/api/v2/blobs/[uuid]/+server.ts) with the pointer tracked in the client-side encrypted inventory. Download decrypts client-side and produces a `blob:` URL. End-to-end coverage in [`tests/e2e/full-workflow.spec.ts`](../tests/e2e/full-workflow.spec.ts) — includes a programmatic IndexedDB inspection that refuses any plaintext substring leak. See also [`docs/PRIVACY-LEVEL.md`](./PRIVACY-LEVEL.md).
- ✅ Worker routes for OPAQUE register + login flow are production-ready inside the SvelteKit Cloudflare Worker — server stores the RFC 9807 envelope, not password-equivalent material, and release preflight refuses deploys without a same-SHA `.m3-e2e-passed` artifact (see [`src/lib/server/api/server-opaque.ts`](../src/lib/server/api/server-opaque.ts) `OpaqueServerEngine`, [`scripts/verify-production-runtime.mjs`](../scripts/verify-production-runtime.mjs)). **Server-side session revocation** lands via [`POST /api/opaque/logout`](../src/routes/api/opaque/logout/+server.ts), wired into the client `lockSession()` as a fire-and-forget call so an intercepted bearer token stops working before the 1h TTL.
- ✅ Operational hardening — opportunistic D1 cleanup ([`cleanup.ts`](../src/lib/server/api/cleanup.ts)) prunes expired `pending_registrations`, `pending_logins`, `sessions`, and stale `rate_limits` rows; opportunistic R2 garbage collection ([`r2-gc.ts`](../src/lib/server/api/r2-gc.ts)) reaps unreferenced v2 blobs via the `blob_references`/`inv_references` tables (after the §L07b pass retired the per-account prefix walk). Both are sampled, bounded, and fire-and-forget — they never block or fail the originating request.
- ✅ Sigstore + Rekor keyless publishing in CI (see [.github/workflows/release.yml](../.github/workflows/release.yml) — pinned `sigstore/cosign-installer@v3.5.0` + `cosign@v2.4.0`, `id-token: write` OIDC flow, attaches signature + cert + Rekor index to every published release)
- ✅ Reproducible build verification job — two-pass build with `SOURCE_DATE_EPOCH`-pinned `generatedAt` and a deterministic `kit.version.name`, asserts byte-identical `.bundle-digest` across independent builds (see [scripts/verify-reproducible.mjs](../scripts/verify-reproducible.mjs), [.github/workflows/ci.yml](../.github/workflows/ci.yml) `reproducible-build` job)

### Performance baseline (May 2026)

Captured at the end of the Roadmap Audit + Perf + Mobile-First Overhaul pass. The full per-route byte inventory lives in [docs/PERFORMANCE-BASELINE.md](./PERFORMANCE-BASELINE.md). Headline numbers:

- `/unlock` ships **only** the lightweight unlock UI on cold cache; the ~155 KB Noble curves + ML-KEM-1024 + OPAQUE + Argon2id WASM payload defers until the user clicks "Unlock" (dynamic `import()` inside the handler in [`src/routes/unlock/+page.svelte`](../src/routes/unlock/+page.svelte)).
- `/vault` ships **only** the three-pane chrome on cold cache; `ItemEditor`, `CommandK`, `MasterPasswordSettings`, and `QuickGenerator` lazy-load on first open via `{#await import(...)}` in [`src/routes/vault/+page.svelte`](../src/routes/vault/+page.svelte).
- Landing-panel server chunk dropped from 99.74 KB to 59.36 KB after the three device-mock SVGs were extracted to `static/landing/{vault,documents,mobile}-mock.svg` and referenced via `<img loading="lazy">`.
- Five JetBrains Mono non-Latin subsets dropped (~35 KB font payload) — Latin and Latin-ext only.
- Two Latin font subsets are now `<link rel="preload">`-ed from [`src/app.html`](../src/app.html) so first-paint cuts ~300 ms on slow links.
- Production sourcemaps emit `'hidden'` — ~2.1 MB CDN egress per region saved on every release.
- Bundle-integrity verifier on `/unlock` parallelizes per-chunk SHA-384 via `Promise.all` (was sequential).
- Mobile chrome (landing TopBar, onboarding header, unlock topbar, blueprint topbar, recover topbar) honors `env(safe-area-inset-*)` and every primary interactive element (`.ico-btn`, `.add-btn`, `.lock-btn`, `.overflow-trigger`, `.head-btn`, `.row`, `.chip`, `.action`, `.toggle`, modal `.close`, `Button.sm`) hits the WCAG 2.5.5 44×44 floor on `[data-vp~='mobile']` / `[data-vp~='tablet']`.
- Manual chunking (`vendor-noble-pq`, `vendor-noble-ciphers`, `vendor-noble-core`, `vendor-opaque`, `vendor-dexie`) keeps the crypto stack in stable chunks so a Svelte component change does not invalidate them on every release.

### Milestone 4 — Audits & launch prep (Oct → Q4 2026)

- ⏳ Third-party crypto audit (firm TBD — Cure53, NCC, or Trail of Bits) — hand-off package ready via [`docs/AUDIT-CHECKLIST.md`](./AUDIT-CHECKLIST.md), [`docs/THREAT-MODEL.md`](./THREAT-MODEL.md), and `npm run sbom`.
- ✅ Public threat model document — formal STRIDE-style threat model with asset inventory, trust boundaries, data-flow diagrams, and risk ratings shipped at [`docs/THREAT-MODEL.md`](./THREAT-MODEL.md).
- ✅ CycloneDX SBOM (Software Bill of Materials) — deterministic generation via [`scripts/build-sbom.mjs`](../scripts/build-sbom.mjs); `npm run sbom` writes `sbom.json` with byte-stable output for the same lockfile.
- ✅ Auditor-facing verification checklist — every Tier-1 claim mapped to its verification command at [`docs/AUDIT-CHECKLIST.md`](./AUDIT-CHECKLIST.md).
- ⏳ Apple App Store, Play Store, Firefox/Chrome extension submissions
- ⏳ Marketing site live at vault.vu

---

## 2027 — Tier 2: sync & sharing

The "more than one device" tier. **Engineering specification:** [`docs/TIER2-ARCHITECTURE.md`](./TIER2-ARCHITECTURE.md) — interface contracts, persistence schemas, and threat-model deltas for every layer below. **No Tier 2 code ships today;** auditors should find zero Tier-2 dependencies in `package.json` and zero Tier-2 implementations in `src/`.

- L06 MLS-based family/team vaults — first quarter
- L07 Encrypted CRDT sync (Yjs over HPKE) — second quarter
- L08 Local WebRTC pairing — second quarter
- L09 CONIKS-derived AKD log — third quarter
- L10 PIR breach-check service (HIBP-equivalent without leakage) — fourth quarter

Subscription tier ($25.60/yr) becomes meaningful at Tier 2 — it pays for sync infrastructure and the AKD log.

---

## 2028 — Tier 3: recovery & enterprise

- L11 FROST t-of-n recovery — first half. This upgrades the current local Recovery Envelope into multi-party recovery without concentrating recovery power in one exported file.
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
