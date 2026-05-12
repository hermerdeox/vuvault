# VuVault Checkpoint Analysis

> Updated **2026-05-12** after the M3 production-readiness and full-workflow passes. The original 2026-05-08 audit prose is preserved below for re-review value; **closure notes are inlined per finding** and the current privacy-level source of truth is `docs/PRIVACY-LEVEL.md`.
>
> Net result: the one true Level-0 privacy breach (B0 — Google Fonts) is closed; M3 D1/R2 sync, OPAQUE login token minting, per-document encrypted blob storage, reproducible builds, and Sigstore/Rekor release publishing are now implemented. Remaining larger items are Tier-2+ features: CRDT field sync, MLS sharing, AKD/device transparency, and third-party security audit.

**Date of original analysis:** 2026-05-08, immediately after the Milestone 2 (crypto wiring) gate landed.
**Date of remediation pass:** 2026-05-08 (same day, follow-up sweep).
**Scope:** originally the live `main` branch after M2; current notes reflect the M3 implementation and quick-win hardening pass.
**Method:** every original finding below remains line-cited from the source it was written against so any reviewer can re-check independently. Closure notes (`✅ Closed:` / `🟡 Partial:` / `🔵 Tier 2:`) cite the remediation commit's source.

The structure follows the same nine sections the plan called for, in order.

---

## 1. Executive verdict

The promise on the public landing page reads, verbatim, from [src/routes/(landing)/_panels/Promise.svelte](../src/routes/(landing)/_panels/Promise.svelte) lines 67-71:

> **Architecturally untouchable.** Your vault is encrypted on your device. The server only ever sees an opaque blob. Nobody can read it — not us, not a court order, not a future quantum computer in 2032. **Mathematical, not promised.**
>
> `level 0 · zero-knowledge by construction`

Held against the live code, today, the verdict is:

- **One real privacy breach exists in the live build.** Every page render on every route — landing, onboarding, unlock, vault — fetches CSS from `fonts.googleapis.com` and WOFF2 from `fonts.gstatic.com` per [src/app.html](../src/app.html) lines 32-37. The CSP at [svelte.config.js](../svelte.config.js) lines 20-21 explicitly whitelists those hosts. Google's edge sees the user's IP, User-Agent, and `Referer` (which leaks the route — `/unlock`, `/vault`, etc.) before the first paint. The CI "Network-call guard" at [.github/workflows/ci.yml](../.github/workflows/ci.yml) lines 120-138 only inspects `fetch(` call sites, never `<link>`/`<script src>`/`@import url(...)`, so this slipped past every M1 and M2 review. This contradicts the in-product *"Telemetry: 0 bytes · ever"* badge at [src/routes/onboarding/_steps/StepVerify.svelte](../src/routes/onboarding/_steps/StepVerify.svelte) line 69 and *"Net 0 B sent"* footer at [src/lib/components/AuditFooter.svelte](../src/lib/components/AuditFooter.svelte) lines 30-32 and *is* a Level 0 breach by any reasonable reading of "the server only ever sees an opaque blob… nobody can read it." The fix is mechanical: self-host the three font families, drop the preconnects, tighten CSP.

- **The vault-at-rest crypto holds the VU 0 promise.** Real `@noble/post-quantum/ml-kem`, hybrid X25519 + ML-KEM-1024 envelope with header-bound AAD, AES-256-GCM, FIPS 203 KAT-locked under `npm run test:fips`, no plaintext on disk, lock-time zeroization keyed off a per-kind secret-fields map. This is the part of the architecture that actually delivers what the marketing claims.

- **The server promises are now falsifiable rather than vacuous.** The original audit was written before M3, when every API route returned 501 and the sync client was local-only. M3 now ships SvelteKit/Cloudflare API routes for OPAQUE registration/login, whole-vault blob upload/latest fetch, and per-document encrypted blob storage. The current claim is narrower and test-backed: server-side D1/R2 stores only OPAQUE protocol records, bearer sessions, sequence clocks, and opaque ciphertext; vault/document plaintext and password material remain client-side.

- **The release-integrity promises are now mechanically backed.** CI/release perform the two-pass bundle hash flow, verify convergence, sign the digest with keyless cosign, publish/attach Rekor metadata, and gate release deploys on the M3 D1/R2 E2E artifact plus `scripts/verify-production-runtime.mjs`.

- **Remaining roadmap claims are explicitly future-scoped.** Sync/recovery/sharing copy was corrected to mark shipped M3 ciphertext sync separately from Tier-2+ CRDT sync, MLS sharing, AKD/device logs, FROST recovery, and future signing workflows.

**Net: the current honest rating is Vu Level 1.** Vault and document plaintext are encrypted client-side, M3 sync stores opaque bytes, releases are reproducible/signed, and rate-limit configuration is verified. Vu Level 2 remains pending on CRDT sync, MLS sharing, AKD/device transparency, and external audit.

> ✅ **Post-remediation update (2026-05-08):** The Google Fonts breach is closed by self-hosting the three font families under `static/fonts/` with self-hosted `@font-face` registrations in `src/lib/styles/fonts.css`, dropping the three Google Fonts `<link>` tags from `src/app.html`, and tightening the CSP in `svelte.config.js` to `style-src 'self' 'unsafe-inline'` and `font-src 'self'`. A new CI guard (`Third-party URL guard` in `.github/workflows/ci.yml`) refuses to merge any PR that reintroduces a third-party `https://` host into shipped source, so this breach cannot silently return. Marketing-ahead-of-code copy is corrected per § 8 actions 7-10; remaining marketing-tier claims explicitly carry `Tier 2 · 2027` / `Tier 3 · 2028` badges.

---

## 2. The promise, decomposed into testable invariants

The prose promise is too broad to score directly. The nine invariants below are the falsifiable statements VU Level 0 makes when read strictly.

| # | Invariant |
| --- | --- |
| I1 | No plaintext vault content is persisted to disk. |
| I2 | No plaintext vault content is transmitted over the network. |
| I3 | The server cannot decrypt the vault even with full possession of every persisted byte. |
| I4 | The server cannot recover the password (offline or online) from anything it ever sees. |
| I5 | The vault is post-quantum-safe at rest against a 2032+ adversary. |
| I6 | The unlock pipeline refuses to operate on a tampered bundle. |
| I7 | No third-party scripts, no telemetry, no analytics. |
| I8 | Demo / weakened modes cannot ship to production. |
| I9 | The user can verify the running build against an independent transparency log. |

A "Hold" verdict means the invariant holds today against the live code. "Vacuous" means it cannot be falsified because the relevant component does not exist (e.g., no server). "Risk" means the mechanism is wired but a configuration or input-handling gap means the protection does not actually fire. "Broken" means the claim is currently false against the live code.

---

## 3. Per-invariant verdict

### I1 — No plaintext vault content on disk: **Hold**

[src/lib/services/vault-session.ts](../src/lib/services/vault-session.ts) seals every blob with AES-256-GCM under an HKDF-SHA512-derived vault key, and the AAD authenticates `formatVersion · authMode · deviceSalt(16) · SHA-384(credentialId)[..32] · SHA-384(header)[..32]` (the last clause is added in v2). For formatVersion 2 vaults the on-disk AES key is *not* the vault key — a fresh per-vault AES-256 key is generated and wrapped under the X25519 + ML-KEM-1024 hybrid envelope (see [src/lib/services/vault-envelope.ts](../src/lib/services/vault-envelope.ts) lines 105-135). `lock()` zeroizes every secret-bearing field per the per-kind map at [src/lib/types/vault-item.ts](../src/lib/types/vault-item.ts) lines 100-128.

**Caveat (R6 in §6):** `account.deviceLabel` is a user-typed plaintext string persisted unencrypted to IndexedDB. It's metadata, not vault content, but a forensic adversary with disk access reads "Sam's MacBook" verbatim.

### I2 — No plaintext vault content on the wire: **Vacuous Hold**

The original M2 finding was vacuous because [src/lib/services/sync-client.ts](../src/lib/services/sync-client.ts) returned `NOT_WIRED` for every method and no `fetch()` call carried vault material. The current M3 path is no longer vacuous: `sync-client.ts` is the single client-side network surface for OPAQUE and ciphertext sync, and CI still guards against stray fetch call sites.

> ✅ **M3 update (2026-05-12):** `sync-client.ts` now issues same-origin calls when `PUBLIC_SYNC_ORIGIN` is configured, but the payloads are OPAQUE protocol messages or AES-GCM ciphertext fragments. Whole-vault and document uploads are covered by `tests/integration/api-routes.spec.ts`, `tests/e2e/sync.spec.ts`, and `tests/e2e/full-workflow.spec.ts`, including IndexedDB/plaintext-leak assertions and R2 opaque-ciphertext round trips.

### I3 — Server cannot decrypt: **Vacuous Hold**

The original M2 finding was vacuous because there was no live server. The current M3 implementation ships concrete API routes under `src/routes/api/**`, making the claim falsifiable through handler tests and the live D1/R2 E2E path.

> ✅ **M3 update (2026-05-12):** The M3 Worker/API surface has shipped under `src/routes/api/**`. D1 stores OPAQUE account/session metadata and durable sequence clocks; R2 stores opaque whole-vault/document ciphertext. The latest-blob route now filters exact `vaults/<accountId>/<sequence>.bin` keys and paginates R2 listings; document endpoints require UUIDv4 blob IDs and pre-decode base64 caps.

### I4 — Server cannot recover password: **Client-only Hold**

OPAQUE RFC 9807 client end-to-end is real: [src/lib/services/opaque-client.ts](../src/lib/services/opaque-client.ts) wraps `@structured-id/opaque@1.0.4` behind a swappable `OpaqueTransport` interface, and [src/lib/services/mock-opaque-server.ts](../src/lib/services/mock-opaque-server.ts) implements the matching server-side primitives in-process so the round-trip is exercised in [src/lib/services/opaque-client.test.ts](../src/lib/services/opaque-client.test.ts) (4 tests, all green). The mock server retains only the RFC 9807 protocol state — `clientPublicKey`, `maskingKey`, `envelopeBytes`, server-side `oprfSecretKey`. Passwords never leave the client because `OpaqueClient.registrationStart`/`loginStart` blind locally before any transport call.

The live unlock flow does *not* invoke OPAQUE today. [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) derives the vault key directly from PRF + Secret Key against local IndexedDB. The "server never sees the password" claim is correct in the cryptographic sense; it just hasn't been exercised against any server.

### I5 — Post-quantum at rest: **Hold**

Real `@noble/post-quantum/ml-kem@^0.4.0`, hybrid X25519 + ML-KEM-1024 envelope with header-as-AAD ([src/lib/crypto/envelope.ts](../src/lib/crypto/envelope.ts) lines 60-160). KAT-locked under `npm run test:fips` against [src/lib/crypto/kat/ml-kem-1024.json](../src/lib/crypto/kat/ml-kem-1024.json) (5 deterministic regression vectors, 6 test cases including a baseline non-empty assertion).

**Brutally:** this only protects vault *contents at rest* and (post-M3) in transit. Release artifacts are not signed, so an adversary with quantum capability who can swap the served bundle at the CDN edge defeats L04 outright — see I6 / I9.

### I6 — Refuse tampered bundle: **Risk → Hold (post-M3)**

The verifier is real and the gate fires correctly:

- [src/lib/utils/env.ts](../src/lib/utils/env.ts) lines 128-253 fetch `/_app/immutable/bundle-manifest.json`, recompute SHA-384 for every chunk, recompute the canonical aggregate, and return one of `verified | mismatch | unsupported | placeholder`.
- [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) lines 89-101 refuse to call `openVault()` when `state === 'mismatch'` or `'unsupported'`, surface a forensic banner, and audit the block.

**However:** [.github/workflows/ci.yml](../.github/workflows/ci.yml) line 85 and [wrangler.toml](../wrangler.toml) line 7 hardcode `PUBLIC_BUNDLE_HASH = '9f4c7d2e8b16a4f122e0d5c83a7e91b4'`, which equals `PLACEHOLDER_BUNDLE_HASH` at [src/lib/utils/env.ts](../src/lib/utils/env.ts) line 26. So production builds short-circuit at line 132 of `env.ts` (`isPlaceholder = true`) and return `state: 'placeholder'`. The unlock screen labels this "(dev build · no published hash to verify)" and proceeds.

The build script at [scripts/build-manifest.mjs](../scripts/build-manifest.mjs) writes the *real* aggregate digest to `.bundle-digest` (current value: `f043c469fb1c9a9392e2842e17733d1d86853d45e93d87ae9ef5557403427a1041fd0f9d180746b8f57845e875b6728e`) but CI never feeds that back into a second build pass. **The verifier is alive; its input is dead.**

> ✅ **Closed (M3).** CI's `quality.Build` step now runs a two-pass build: pass 1 with empty `PUBLIC_BUNDLE_HASH` produces the real `.bundle-digest`, pass 2 rebuilds with that digest baked into the prerendered HTML / Worker env, and a convergence guard fails CI if the two passes disagree. `kit.version.name` in [svelte.config.js](../svelte.config.js) is pinned to `PUBLIC_VAULT_VERSION` so SvelteKit's per-build random `globalThis.__sveltekit_<hash>` namespace is now deterministic. `SOURCE_DATE_EPOCH` from `git log -1 --format=%ct HEAD` pins the manifest's `generatedAt`. A separate `reproducible-build` CI job (see [scripts/verify-reproducible.mjs](../scripts/verify-reproducible.mjs)) builds twice from a clean checkout and asserts byte-identity of the resulting `.bundle-digest`. Production deploys via [.github/workflows/release.yml](../.github/workflows/release.yml) inject the real hash into the `wrangler pages deploy` step, so the running bundle matches its own manifest aggregate at every unlock.

### I7 — No third-party scripts / no telemetry: **BROKEN → Hold (post-remediation)**

Zero matches in `src/` for `gtag`, `posthog`, `sentry`, `mixpanel`, `segment`, `datadog`, `google-analytics`. The CI no-telemetry guard at [.github/workflows/ci.yml](../.github/workflows/ci.yml) lines 106-118 enforces this on every PR.

**However:** [src/app.html](../src/app.html) lines 32-37 load Google Fonts on every page render, and the CSP at [svelte.config.js](../svelte.config.js) lines 20-21 explicitly whitelists `fonts.googleapis.com` and `fonts.gstatic.com`. The CI Network-call guard greps for `fetch(` only — it never inspects `<link>` tags. Google's edge sees the user's IP, User-Agent, and `Referer` (which leaks the route) before any in-product "0 bytes transmitted" badge has had a chance to be true.

**This is the single concrete VU 0 breach in the live build.** Fix detail in §8 action 1.

> ✅ **Closed.** The three Google Fonts `<link>` tags were removed from `src/app.html`; WOFF2 binaries for Instrument Sans / Instrument Serif / JetBrains Mono now live under `static/fonts/` (SIL OFL-1.1, see `static/fonts/README.md` for provenance). `src/lib/styles/fonts.css` registers the same `@font-face` rules pointing at the self-hosted files; `src/app.css` imports it before the token + globals modules. CSP in `svelte.config.js` no longer references `fonts.googleapis.com` / `fonts.gstatic.com`. The new `Third-party URL guard` CI step (`.github/workflows/ci.yml`) blocks any reintroduction of those hosts; the regenerator script is at `scripts/refresh-fonts.mjs` for future font-family bumps.

### I8 — Demo cannot ship: **Hold (with one slip)**

`isDemoAuthEnabled()` in [src/lib/utils/env.ts](../src/lib/utils/env.ts) lines 46-50 forces `false` in production. The CI guard at [.github/workflows/ci.yml](../.github/workflows/ci.yml) lines 140-161 fails the build if `PUBLIC_ENABLE_DEMO_AUTH` is truthy and source-asserts that both `StepTouch.svelte` and `vault-session.ts` reference `isDemoAuthEnabled`.

**However:** demo accounts derive `prfOutput = HMAC-SHA512(deviceSalt, credentialId)` (see [src/lib/services/vault-session.ts](../src/lib/services/vault-session.ts) lines 187-193), which is computable from data already on disk — anyone with disk access plus the Secret Key can unlock. This is disclosed in the unlock UI when `authMode === 'demo'`, but the **landing copy makes no demo-mode disclaimer**, so a user who only ever sees the marketing site walks away with the impression that PRF is a hardware factor (it is, in production mode; not in demo).

### I9 — Verifiable via independent transparency log: **Broken → Hold (post-M3)**

No `cosign`, no Sigstore, no Rekor publishing step in CI. The Rekor URL `https://search.sigstore.dev/?hash=${PUBLIC_BUNDLE_HASH}` constructed at [src/lib/utils/env.ts](../src/lib/utils/env.ts) line 129 points at the placeholder, so the user gets a Sigstore search results page for a hash that was never published.

> ✅ **Closed (M3).** [.github/workflows/release.yml](../.github/workflows/release.yml) signs every tagged release via keyless cosign (Sigstore Fulcio + Rekor): `permissions: id-token: write` unlocks the GitHub OIDC token, `sigstore/cosign-installer@v3.5.0` is pinned, `cosign sign-blob --yes` against `.bundle-digest` produces a Rekor entry whose UUID gets attached to the GitHub Release as `RELEASE.txt` alongside the signature + cert. A `Verify signature locally` step inside the workflow re-runs `cosign verify-blob` to catch OIDC / Fulcio / Rekor regressions before deploy. Users can independently verify by pasting the displayed `BUNDLE_HASH_SHORT` into <https://search.sigstore.dev/?hash=sha384:...> and reading the certificate identity off the Rekor entry. The dependency-pin guard in [.github/workflows/ci.yml](../.github/workflows/ci.yml) refuses to merge a release.yml that loosens the cosign version pin.

[README.md](../README.md) line 178 honestly marks this as `⚠️ M3`. [src/routes/(landing)/_panels/Trust.svelte](../src/routes/(landing)/_panels/Trust.svelte) lines 30-42 and [src/routes/onboarding/_steps/StepVerify.svelte](../src/routes/onboarding/_steps/StepVerify.svelte) lines 32-36 do not.

### Verdict summary (post-remediation)

| Invariant | Verdict | Severity | Notes |
| --- | --- | --- | --- |
| I1 No plaintext on disk | Hold | — | Unchanged. |
| I2 No plaintext on the wire | Hold | low | M3 same-origin sync sends OPAQUE protocol bytes and AES-GCM ciphertext only. |
| I3 Server cannot decrypt | Hold | low | D1/R2 API routes persist opaque OPAQUE records, sessions, sequence clocks, and ciphertext. |
| I4 Server cannot recover password | Hold | low | OPAQUE round-trip exercised against D1/R2 E2E and `MockOpaqueServer`. |
| I5 Post-quantum at rest | Hold | — | KAT-locked under `npm run test:fips`. |
| I6 Refuse tampered bundle | Hold | medium | Two-pass build, convergence guard, and release hash injection now ship. |
| I7 No third-party / no telemetry | **Hold** | low | ✅ Closed: B0 self-hosted fonts; new CI Third-party URL guard. |
| I8 Demo cannot ship to production | Hold | low | + Tier-1 disclaimer added to landing tech-audience view. |
| I9 Verifiable via independent log | Hold | medium | Release workflow signs `.bundle-digest` with keyless cosign and publishes Rekor metadata. |

---

## 4. Outright breaches — present-tense copy that is not currently true

Six entries. **B0 is a real privacy breach** (data leaks to a third party). **B1-B6 are honesty breaches** — the marketing or UI copy claims something the code does not deliver, but no user data is leaked as a result.

### B0. Google Fonts on every page render — third-party leak

**Severity: high. This is the headline finding.** ✅ **Closed** (see I7 closure note above for the full wire-up).

[src/app.html](../src/app.html) lines 32-37:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

These three tags execute before the first paint, on every route — including `/unlock` and `/vault`. The CSP at [svelte.config.js](../svelte.config.js) lines 17-28 explicitly whitelists `fonts.googleapis.com` (style-src) and `fonts.gstatic.com` (font-src). The page also sets `<meta name="referrer" content="no-referrer" />` at [src/app.html](../src/app.html) line 9, which mitigates the `Referer` leak somewhat, but Google's edge still sees:

- The user's IP address.
- The user's User-Agent string.
- The fact that *someone* loaded a VuVault page (via the SNI / Host header on the TLS handshake to `fonts.googleapis.com`).
- The `If-Modified-Since` headers on subsequent visits, building a coarse session fingerprint.

CI's `Network-call guard` greps for `fetch(` and never sees this. The `no-telemetry guard` greps for analytics library names and never sees this. Both guards are correct for what they check; neither was built to look at HTML resource directives.

**Fix:** copy the three font families (Instrument Sans, Instrument Serif, JetBrains Mono — all SIL Open Font License) into `static/fonts/`, register `@font-face` rules in [src/lib/styles/globals.css](../src/lib/styles/globals.css), drop the two preconnects + stylesheet from `app.html`, tighten CSP to `'style-src': ['self', 'unsafe-inline']` and `'font-src': ['self']`. Verify with the browser network panel: zero non-same-origin requests on first paint of `/`, `/onboarding`, `/unlock`, `/vault`. See §8 action 1.

### B1. Hard-coded "VERIFIED" pill in onboarding *(✅ closed)*

[src/routes/onboarding/_steps/StepVerify.svelte](../src/routes/onboarding/_steps/StepVerify.svelte) lines 33-37:

```svelte
<span class="pill">
    <IconCheck size={9} stroke={3} />
    VERIFIED
</span>
```

The pill is static HTML. There is no plumbing to `verifyBundleIntegrity()`'s actual result. It renders green regardless of whether the running bundle hash matches anything. Compare to the correctly gated [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) lines 336-348, which renders `(verified)`, `(mismatch — refusing unlock)`, `(verification unsupported — refusing unlock)`, or `(dev build · no published hash to verify)` based on `integrity.state`.

Severity: medium. Not a data leak; misleads the user into believing verification has happened during onboarding when it has not.

> ✅ **Closed.** `StepVerify.svelte` now imports `verifyBundleIntegrity` and `BundleIntegrity`, runs the verifier on mount, and renders one of `CHECKING…` / `VERIFIED` / `DEV BUILD · NOT VERIFIED` / `VERIFY UNSUPPORTED` / `MISMATCH` based on `integrity.state`. The "Looks right, continue" button is disabled when the verifier returns `mismatch` or `unsupported`. Pill colours track the same accent / warn / danger palette the unlock screen uses, so the two screens cannot disagree.

### B2. "Bundle hash verified at every unlock" in developer-facing docs *(✅ closed)*

[README.md](../README.md) line 24 and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) line 126 both describe bundle-integrity verification as a delivered feature. The verifier code is real, but it always returns `state: 'placeholder'` in production builds because of the placeholder-hash issue (I6).

Severity: low (developer-facing docs only).

> ✅ **Closed (M3).** The two-pass build + Sigstore Rekor publishing (see I6/I9 closure notes) means production deploys now bake the real `PUBLIC_BUNDLE_HASH` into the bundle. `verifyBundleIntegrity()` returns `state: 'verified'` against a real Rekor-published hash; the unlock + Trust panel + Emergency Kit all display the same value the release workflow signed. The developer-facing claim in README / ARCHITECTURE.md is now mechanically substantiated end-to-end.

### B3. "0 bytes transmitted" / "Net 0 B sent" UI claims *(✅ closed via copy edits + AuditFooter wire-up)*

Multiple call sites — all read from `audit.bytesSent` at [src/lib/stores/audit.svelte.ts](../src/lib/stores/audit.svelte.ts) line 27, which is `$state(0)` and **never incremented anywhere in `src/`**:

- [src/lib/components/AuditFooter.svelte](../src/lib/components/AuditFooter.svelte) lines 30-32 — "Net 0 B sent" footer.
- [src/routes/(landing)/_panels/Vault.svelte](../src/routes/(landing)/_panels/Vault.svelte) line 177 — "Zero-knowledge active · 0 bytes transmitted this session" inside the SVG mock.
- [src/routes/(landing)/_panels/Hero.svelte](../src/routes/(landing)/_panels/Hero.svelte) lines 63-66 — "0 servers contacted to load this page · 0 third-party scripts".
- [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) line 334 — "All decryption is local · zero bytes transmitted".

The literal "0 bytes" claim was false at the page-load layer (B0 above) and at the same-origin-fetch layer (`/argon2id/*.wasm`, `/_app/immutable/bundle-manifest.json` are fetched on every visit). The current copy avoids that phrasing; the strong form ("we have not exfiltrated your vault") is now tested against the M3 ciphertext-only sync path rather than relying on a missing server.

Severity: medium. This is the one that visually anchors the entire VU 0 brand line. Fixing B0 makes part of this defensible; the rest needs copy edits or a real fetch-interception measurement.

> ✅ **Closed.** `AuditFooter.svelte` now reads `isSyncWired()` and renders `Local-only` until the sync server ships in M3, at which point the byte counter wires to actual fetch interception. The Hero pill no longer claims "0 servers contacted" — it now reads "Same-origin only · no third-party hosts" and "No analytics tags shipped". The Vault SVG mock reads "Local · sync 2027" and "local-only mode". The unlock-screen "zero bytes transmitted" footer was retired alongside the AuditFooter changes. A new CI `Marketing-claim drift guard` blocks any reintroduction of the banned phrases (`0 bytes transmitted`, `0 servers contacted`, `Synced N min`, `matches release v[0-9]`) into shipped UI source.

### B4. Multi-device sync, family/team vaults, encrypted CRDT operations *(✅ closed via Tier-tag re-labelling)*

Landing copy in [src/routes/(landing)/_panels/Mobile.svelte](../src/routes/(landing)/_panels/Mobile.svelte) lines 165-167, [src/routes/(landing)/_panels/Documents.svelte](../src/routes/(landing)/_panels/Documents.svelte) lines 32-35, the comparison table at [src/lib/data/landing.ts](../src/lib/data/landing.ts) lines 60-63, and the "Synced 2 min ago" SVG mock in [src/routes/(landing)/_panels/Vault.svelte](../src/routes/(landing)/_panels/Vault.svelte) line 99 all describe these as live capabilities.

Reality: [package.json](../package.json) has no `yjs` (we removed it in M1 hardening), no MLS lib, no pairing UI, no shared-vault data model. `landing.ts` already self-tags MLS as `partial: 'Specced'`, but the visual mocks and the comparison table do not.

Severity: medium. Roadmap copy presented as present-tense fact.

> ✅ **Closed.** `Mobile.svelte` multi-device card now carries a `Tier 2 · 2027` badge and the body copy is rewritten in roadmap voice ("Tier 2 design: …"). `landing.ts` `COMPARE_ROWS` introduces `tier-2` / `tier-3` cell sentinels (rendered as forward-loaded badges by `Compare.svelte` instead of solid green checks) for OPAQUE deployment, transparency log, breach check, threshold recovery, and BYO storage. A footnote under the comparison table calls out what Tier 2/3 mean and that the cells map onto roadmap items, not present-tense facts.

### B5. Documents marketed as encrypted file blobs *(✅ closed via Tier-tag re-labelling)*

[src/routes/(landing)/_panels/Documents.svelte](../src/routes/(landing)/_panels/Documents.svelte) lines 32-35, 52-61, 71-87 describe documents as "chunked, padded to power-of-two buckets, encrypted under per-item HPKE keys" with "Sign in place. Verify forever." (Ed25519 signatures over document hashes anchored in an append-only Merkle log via VRF) and a tlock/drand time-lock for inheritance.

Reality: `DocumentItem` at [src/lib/types/vault-item.ts](../src/lib/types/vault-item.ts) lines 81-85 has only `docDescription` and `docExternalRef`. There is no file-blob storage, no per-doc HPKE key, no Ed25519 signing, no Merkle log, no VRF, no tlock-js dependency, no BLS12-381. Documents are descriptive metadata rows.

Severity: medium-high. The Documents panel is a major brand pillar and none of its specific technical claims are implemented.

> ✅ **Closed.** The Documents panel now carries a `Tier 2 · 2027` eyebrow pill. Each callout has a tier tag (Tier 2 for the Dropbox-comparison card, Tier 3 for in-vault signing + transparency log, Tier 4 for drand timelock). Body copy is rewritten in roadmap voice ("Tier 2 design: …" / "Tier 3 design: …" / "Tier 4 design: …"). The intro paragraph explicitly notes that the vault holds document *metadata* today and cross-origin storage + signing arrive with the Tier-2 sync server. The Dropbox-comparison framing is preserved per the plan; only the present-tense verbs are softened.

### B6. Placeholder hash baked into Emergency Kit and `.vukey` artifacts *(✅ closed)*

[src/routes/onboarding/_steps/StepSecret.svelte](../src/routes/onboarding/_steps/StepSecret.svelte) lines 53 and 76 embed the literal `9f4c7d2e8b16a4f122e0d5c83a7e91b4` as "Bundle SHA-384" inside the Emergency Kit `.txt` and the `.vukey` JSON download — the artifacts the user prints / saves as part of provisioning.

Once a real hash is baked into production, every Emergency Kit issued before that ships will print a hash that no longer matches the running build, which breaks the user's ability to verify their kit against the published release. This is a future-incompatibility breach that locks in the lie.

Fix: render `BUNDLE_HASH_SHORT` (or the full `PUBLIC_BUNDLE_HASH`) reactively from [src/lib/utils/env.ts](../src/lib/utils/env.ts), or omit the bundle-hash line from the kit until it is real.

Severity: medium (no live data leak today; deferred breach for everyone who provisions before a real hash is wired).

> ✅ **Closed.** `StepSecret.svelte` now imports `PUBLIC_BUNDLE_HASH`, `PUBLIC_VAULT_VERSION`, and `BUNDLE_HASH_SHORT` from `$lib/utils/env`. The Emergency Kit `.txt` reads `Bundle SHA-384 (verify against the published GitHub release):` followed by the canonical hash in 8-character groups, and the `.vukey` JSON now carries `build: { version, bundleHash, bundleHashShort }` instead of a hardcoded literal. When (post-M3) a real hash gets baked, every kit issued from that point forward prints the matching hash automatically.

---

## 5. Stale developer-doc claims

Locations where developer-facing docs explicitly contradict M1 / M2 shipped code. None of these are user-visible; they hurt code-review velocity and onboarding.

| # | Location | What it says | Reality | Closure |
| --- | --- | --- | --- | --- |
| S1 | [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) lines 118-126 | "L03 ML-KEM-1024 envelope: API shape complete, X25519 component working, ML-KEM portion marked TODO until @noble/post-quantum is verified" | Stale since M2. Real ML-KEM since the M1 hardening. KAT-locked. [src/lib/crypto/envelope.ts](../src/lib/crypto/envelope.ts) lines 33, 67-79, 105-107, 147 call real `ml_kem1024.{keygen,encapsulate,decapsulate}`. | ✅ Rewritten — § "What this implementation includes today" now reflects M2 ship state, including KAT lock + Argon2id third factor. |
| S2 | [CURSOR_PROMPT.md](../CURSOR_PROMPT.md) line 86 | `envelope.ts ⚠️ X25519 working; ML-KEM TODO` | Same staleness as S1. | ✅ Updated to `✅ Hybrid X25519 + ML-KEM-1024 (FIPS 203, KAT-locked)`. P1.1 section also rewritten as "shipped in M2". |
| S3 | [README.md](../README.md) line 111 | Directory listing says `storage.ts: Dexie schema v1` | Schema is v2 with the M1 upgrade hook ([src/lib/utils/storage.ts](../src/lib/utils/storage.ts) lines 50-79). | ✅ README already says v2; corresponding line in `CURSOR_PROMPT.md` updated to v2 with v1→v2 transparent upgrade note. |
| S4 | [src/lib/data/landing.ts](../src/lib/data/landing.ts) lines 114-194 (`STACK_LAYERS_TECH`) vs [src/routes/blueprint/+page.svelte](../src/routes/blueprint/+page.svelte) lines 31-189 | Two views of the architectural stack disagree on layer numbers | Landing's L01 = "WebAuthn PRF"; blueprint's L01 = "OPAQUE". Same product, two L-numbering schemes, inconsistent on every layer that follows. | ✅ `STACK_LAYERS_TECH` re-numbered against the canonical blueprint scheme (L01 = OPAQUE, L02 = PRF + Secret Key, L03 = hybrid envelope, L04 = XMSS, L05 = reproducible builds + Sigstore, L06 = MLS, L07 = CRDT sync, L08 = WebRTC + ECDH pairing, L09 = CONIKS / AKD, L10 = PIR + PSI). A header comment in `landing.ts` makes the blueprint authoritative. |

---

## 6. Risks not yet breaches

These are knife-edges where a small future mistake becomes a VU 0 breach.

- **R1.** The `audit` Dexie table schema exists at [src/lib/utils/storage.ts](../src/lib/utils/storage.ts) lines 37-43 but is unused by the runtime store ([src/lib/stores/audit.svelte.ts](../src/lib/stores/audit.svelte.ts) is memory-only). If anyone wires `audit.push` → `db.audit.put` without first redacting `context.title` and similar fields, per-account metadata leaks to disk under whatever account.deviceLabel the row carries. M1 hardening already redacted item titles from audit context (see `safeAuditLabel` in [src/lib/types/vault-item.ts](../src/lib/types/vault-item.ts) lines 144-149), so the redaction discipline exists; the risk is forgetting it during a future feature.

- **R2.** The v2 AAD includes `SHA-384(header)` but not `SHA-384(deviceLabel)` or `SHA-384(plan)`. A future schema bump that adds new account fields needs to remember to bind them, or the protection against account-row tampering only covers the already-bound fields.

- **R3.** Master-password rotation re-encrypts the entire vault in [src/lib/services/vault-session.ts](../src/lib/services/vault-session.ts) `rotateAuth`. The atomic write covers account + vault rows in one Dexie transaction (`saveAccountAndVault`), but if the Argon2id derivation succeeds and rotation crashes between deriving the new key and writing both rows, the user's session keeps using the new in-memory key while disk has the old one. Recoverable on next unlock, but a confusing failure mode.

- **R4.** The OPAQUE mock server is in-process and never transmits, but if anyone forgets to gate its import behind `dev` and ships [src/lib/services/mock-opaque-server.ts](../src/lib/services/mock-opaque-server.ts) into the production bundle, a test surface ends up reachable. There is no CI guard for this today.

- **R5.** [src/routes/(landing)/_panels/Trust.svelte](../src/routes/(landing)/_panels/Trust.svelte) lines 21-26 displays `9f4c7d2e 8b16a4f1 22e0d5c8` as "matches release v0.4.2" — hard-coded UI text not tied to anything. Once a real hash gets baked, this needs to live-render `BUNDLE_HASH_SHORT` from [src/lib/utils/env.ts](../src/lib/utils/env.ts) or it becomes a perpetual lie.
  > ✅ **Closed.** `Trust.svelte` now imports `PUBLIC_BUNDLE_HASH` and `PUBLIC_VAULT_VERSION`, derives 8-char chunks via a local `chunk8` helper, and renders `matches release v{PUBLIC_VAULT_VERSION}` so the text always tracks the live build. Once the M3 release tooling injects a real hash, the panel renders the real hash automatically.

- **R6.** `account.deviceLabel` is user-typed plaintext on disk. A real-name device nickname ("Sam's MacBook") is recoverable by anyone with filesystem access. Vault contents are still encrypted — but a forensic adversary who can read IndexedDB also gets the device name. Mitigation is awkward: either drop the field from auditable surfaces, or hash it before persistence (which loses the human-friendly UI label).

- **R7.** [src/routes/vault/CommandK.svelte](../src/routes/vault/CommandK.svelte) line 149's TOTP error path can route `parseTotpSeed`'s `Invalid Base32 character: ${ch}` into the in-memory audit feed, echoing one bad character of a malformed seed. Memory-only, never persisted, but worth noting as the only field-value-in-audit-feed path that survived M1 hardening.

- **R8.** The CI Network-call guard greps for `fetch(` only. It does NOT inspect `<link>`, `<script src>`, `<img src>`, `import()`, `new XMLHttpRequest()`, `navigator.sendBeacon`, or service-worker `Cache.add`. The Google Fonts breach (B0) is one example of what slips through. The guard needs an HTML/CSP-resource sweep step alongside the `fetch(` regex; see §8 action 2.
  > ✅ **Closed.** New `Third-party URL guard` step in `.github/workflows/ci.yml` sweeps `*.svelte`, `*.html`, `*.css`, `*.ts`, `*.js`, `*.tsx`, `*.jsx` under `src/` and `static/` for any `https?://` host that isn't `localhost`/`127.0.0.1`/`::1` and isn't on a small whitelist of well-known doc / standards / source-repo hosts (RFCs, NIST, MDN, Sigstore, etc.). A targeted dedicated check fails the build if `fonts.googleapis.com` / `fonts.gstatic.com` reappears anywhere in shipped source.

---

## 7. What is defensibly real today

Bullets a user-facing checkpoint can stand behind without footnotes:

- **Hybrid post-quantum vault encryption** — real ML-KEM-1024 hybrid envelope, FIPS 203 KAT-locked under `npm run test:fips`. Source: [src/lib/crypto/envelope.ts](../src/lib/crypto/envelope.ts), [src/lib/services/vault-envelope.ts](../src/lib/services/vault-envelope.ts), [src/lib/crypto/kat/ml-kem-1024.json](../src/lib/crypto/kat/ml-kem-1024.json).
- **Header-bound AAD on every blob** — header substitution is a guaranteed `decrypt` failure. Source: [src/lib/services/vault-session.ts](../src/lib/services/vault-session.ts) `makeAad`.
- **Real WebAuthn PRF binding in production mode** (fail-closed), with explicit `rp.id` pinning. Source: [src/lib/crypto/webauthn-prf.ts](../src/lib/crypto/webauthn-prf.ts), [src/lib/utils/env.ts](../src/lib/utils/env.ts) `getRpId()`.
- **OPAQUE RFC 9807 client correctness** — proven against `MockOpaqueServer` end-to-end in [src/lib/services/opaque-client.test.ts](../src/lib/services/opaque-client.test.ts). The protocol implementation works; only the live server is missing.
- **Argon2id RFC 9106 master-password third factor** — opt-in, `VAULT_HIGH_PARAMS` preset (256 MiB, 4 passes, p=1; well above OWASP's published Argon2id minimums and libsodium INTERACTIVE, below libsodium SENSITIVE), rotation re-encrypts the vault atomically. Source: [src/lib/crypto/argon2.ts](../src/lib/crypto/argon2.ts), [src/lib/services/vault-session.ts](../src/lib/services/vault-session.ts) `rotateAuth`.
- **Aggressive zeroization on lock and on every error path** — driven by a per-kind `SECRET_FIELDS_BY_KIND` map so a new kind that forgets to declare its secret fields fails review.
- **Format-version migration with non-data-losing v1→v2 upgrade-on-write** — old M1 vaults still unlock and transparently rewrite as v2 on first save.
- **Multi-tab coordination via BroadcastChannel** — lock in tab A propagates to all unlocked tabs; `/recover` wipe broadcasts and force-locks peers.
- **Demo mode is opt-in, gated by `isDemoAuthEnabled`, refused in production builds via CI guard.**
- **CI-enforced invariants**: no telemetry tag (`gtag`/`posthog`/etc.) anywhere in `src/`, no stray `fetch(` outside the four whitelisted files, no `$2.56` pricing rounding, pinned exact versions for `@structured-id/opaque` and `argon2id`, FIPS KAT regression gate, demo-auth disabled assertion.

---

## 8. Recommended actions before any public-facing checkpoint or launch

Ordered by severity. **Action 1 is the only Level 0 breach fix; the rest are honesty fixes.** None require design-token / color edits. None are crypto changes.

> ✅ **Status (post-remediation):** Actions 1, 2, 3, 4, 6, 7, 8, 9, 10 landed in this pass plus the F1 marketing-claim drift guard and the E1 blueprint Five-Invariants port. Action 5 (Sigstore Rekor publishing in CI) is explicitly deferred to M3 release tooling and remains the Tier-2 dependency for I6 / I9.

1. **PRIORITY (closes B0 / I7): Self-host the Google Fonts.** Drop the two preconnect links and the stylesheet link in [src/app.html](../src/app.html) lines 32-37. Place the WOFF2 files for Instrument Sans, Instrument Serif, and JetBrains Mono under `static/fonts/` with a license-attribution `LICENSE` file alongside (all three are SIL Open Font License). Register `@font-face` rules in [src/lib/styles/globals.css](../src/lib/styles/globals.css). Tighten CSP in [svelte.config.js](../svelte.config.js) lines 20-21 to `'style-src': ['self', 'unsafe-inline']` and `'font-src': ['self']`. Verify with the browser network panel: zero non-same-origin requests on first paint of `/`, `/onboarding`, `/unlock`, `/vault`. **This closes the only live Level 0 breach.**
   > ✅ **Landed.** WOFF2 binaries in `static/fonts/` (12 files, ~154 KB, SIL OFL-1.1; provenance in `static/fonts/README.md`). `@font-face` rules in `src/lib/styles/fonts.css`, imported first by `src/app.css`. `<link>` tags removed from `src/app.html`. CSP tightened. Refresh script at `scripts/refresh-fonts.mjs`.

2. **Extend the CI Network-call guard** at [.github/workflows/ci.yml](../.github/workflows/ci.yml) lines 120-138 to also reject `https://` URLs in `src/**/*.svelte`, `src/**/*.html`, and `src/**/*.css` (with an explicit allowlist for the Sigstore Rekor URL constructor and any same-origin path strings). The current grep only catches `fetch(`; B0 slipped past every prior review because none of the guards looked at `<link>` / `<script>` / `@import url(...)`.
   > ✅ **Landed.** New `Third-party URL guard` step in `.github/workflows/ci.yml` with a small whitelist of doc / RFC / source hosts and a targeted block on `fonts.googleapis.com` / `fonts.gstatic.com`.

3. **Replace the hard-coded "VERIFIED" pill** in [src/routes/onboarding/_steps/StepVerify.svelte](../src/routes/onboarding/_steps/StepVerify.svelte) lines 33-37 with the same `integrity.state`-driven labels that [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) lines 336-348 already renders correctly. Same-shape change as the Phase B1 hardening already in place at the unlock screen.
   > ✅ **Landed.** `StepVerify.svelte` runs the verifier on mount and renders one of `CHECKING…` / `VERIFIED` / `DEV BUILD · NOT VERIFIED` / `VERIFY UNSUPPORTED` / `MISMATCH`. The "Looks right, continue" CTA is disabled when state is `mismatch` or `unsupported`.

4. **Stop hardcoding the placeholder hash into Emergency Kit + `.vukey` artifacts.** [src/routes/onboarding/_steps/StepSecret.svelte](../src/routes/onboarding/_steps/StepSecret.svelte) lines 53 and 76 currently embed the literal placeholder. Render `BUNDLE_HASH_SHORT` reactively from [src/lib/utils/env.ts](../src/lib/utils/env.ts), or omit the bundle-hash line from the kit until it is real.
   > ✅ **Landed.** Emergency Kit `.txt` and `.vukey` JSON now read from `PUBLIC_BUNDLE_HASH` + `PUBLIC_VAULT_VERSION` via `$lib/utils/env`.

5. **Wire the bundle-hash injection in CI.** [scripts/build-manifest.mjs](../scripts/build-manifest.mjs) already emits `.bundle-digest`. Add a second build pass that exports the digest as `PUBLIC_BUNDLE_HASH` for the prerender step, *or* accept the M3 Sigstore step as the proper fix and label the present text honestly until then.
   > 🔵 **Deferred to Tier 2 / M3.** This is part of the Sigstore Rekor publishing deliverable. Until then `verifyBundleIntegrity()` correctly returns `state: 'placeholder'` and the UI labels it honestly.

6. **Update [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) lines 118-126** and [CURSOR_PROMPT.md](../CURSOR_PROMPT.md) line 86 to reflect that ML-KEM-1024 is real (M2 complete), and [README.md](../README.md) line 111 to reflect Dexie v2.
   > ✅ **Landed.** ARCHITECTURE.md L03 paragraph + "What this implementation includes today" rewritten. CURSOR_PROMPT.md `envelope.ts` line + P1.1 section rewritten as M2-shipped. README + CURSOR_PROMPT.md storage line confirmed v2.

7. **Either wire `audit.bytesSent` to actual fetch interception, or change the "0 bytes transmitted" copy** in [src/lib/components/AuditFooter.svelte](../src/lib/components/AuditFooter.svelte) lines 30-32, [src/routes/(landing)/_panels/Vault.svelte](../src/routes/(landing)/_panels/Vault.svelte) line 177, [src/routes/(landing)/_panels/Hero.svelte](../src/routes/(landing)/_panels/Hero.svelte) lines 63-66, and [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) line 334 to "Local-only · sync not enabled" until M3. **Action 1 must land first** or this copy stays misleading regardless.
   > ✅ **Landed via copy edits.** `AuditFooter` now reads `Local-only` (driven by `isSyncWired()`); ZK status indicator wired to `vault.status`. `Hero.svelte` rewritten to "Same-origin only · no third-party hosts" / "No analytics tags shipped" / "Crypto runs in your browser, not ours". Vault SVG mock + onboarding fallback updated. CI marketing-claim drift guard blocks reintroduction.

8. **Clarify multi-device / family-vault / document-storage copy** in [src/routes/(landing)/_panels/Mobile.svelte](../src/routes/(landing)/_panels/Mobile.svelte), [src/routes/(landing)/_panels/Documents.svelte](../src/routes/(landing)/_panels/Documents.svelte), and [src/lib/data/landing.ts](../src/lib/data/landing.ts) to match the M2/M3 reality. `landing.ts` already self-tags MLS as `partial: 'Specced'` — same treatment everywhere.
   > ✅ **Landed.** Mobile + Documents panels carry tier badges and roadmap-voice copy. `landing.ts` `COMPARE_ROWS` introduces `tier-2` / `tier-3` cell sentinels rendered as forward-loaded badges by `Compare.svelte` with a tier-footnote. Reproducible-builds row is `partial` (manifest now / Rekor Tier 2). FROST is `tier-3` (matches blueprint L11).

9. **Add a demo-mode disclaimer to landing copy** OR ensure no production build path can render the landing page in dev/demo mode. Today CI gates the build but the landing copy makes no caveat for the user who only ever sees the marketing site.
   > ✅ **Landed.** Hero tech-audience view now includes the small-print line "Production builds require WebAuthn PRF · demo mode is dev-only and gated behind an explicit env flag."

10. **Reconcile the L01-L10 numbering disagreement** between [src/lib/data/landing.ts](../src/lib/data/landing.ts) `STACK_LAYERS_TECH` and the canonical blueprint at [src/routes/blueprint/+page.svelte](../src/routes/blueprint/+page.svelte). One of them is wrong. The blueprint is the older / more authoritative document; recommend treating it as the source of truth and renumbering the landing-page stack to match.
   > ✅ **Landed.** `STACK_LAYERS_TECH` re-numbered against the canonical blueprint scheme. A header comment in `landing.ts` makes the blueprint authoritative. Landing's L01 is now `OPAQUE`, L03 is `Hybrid envelope`, L05 is `Reproducible builds + Sigstore`, etc. The Five Non-Negotiable Invariants block from the prototype blueprint (`docs/prototypes/blueprint.html` lines 864-899) is now ported into `src/routes/blueprint/+page.svelte` with mechanically self-assessed status badges (`held` / `partial` / `pending`).

> 🆕 **Beyond § 8.** A new `Marketing-claim drift guard` CI step (per the F1 follow-up in the close-the-gap plan) blocks any reintroduction of the banned phrases (`0 bytes transmitted`, `0 bytes streamed`, `0 servers contacted`, `Synced N min`, `matches release v[0-9]`, etc.) into shipped UI source. The brand line stays defensible by mechanical guard, not by reviewer vigilance.

---

## 9. Document scope notes

- This file is non-normative — it does not change source code, design tokens, dependencies, or tests. It is a snapshot of the gap between marketing claims and live code at a single point in time.
- Every claim is line-cited so a reviewer can re-check independently.
- The document lives at [docs/CHECKPOINT-ANALYSIS.md](./CHECKPOINT-ANALYSIS.md). It is intentionally **NOT** linked from [README.md](../README.md) until §8 actions 1, 3, 4, and 7 are addressed; circulating it externally before that creates a credibility liability for the project.
- The companion documents are [docs/SECURITY.md](./SECURITY.md) (the threat model and zero-knowledge scope) and [docs/ARCHITECTURE.md](./ARCHITECTURE.md) (the layer-by-layer cryptographic design). This checkpoint is the bridge between the two — the place that says, of those two documents, what is currently delivered and what is currently aspirational.

When the breach in B0 is closed and the priorities in §8 1-7 land, this document should be revised in place rather than re-issued, with the verdict labels in §3 updated accordingly. The structure (9 sections, 9 invariants, 6 breaches, ~8 risks) is intended to be re-runnable as a quarterly checkpoint.
