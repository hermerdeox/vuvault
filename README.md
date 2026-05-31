# VuVault

> **Mathematical privacy. Not policy.**
> A zero-knowledge password manager and document vault. The company that runs it cannot read your data, hand it to a court, or be coerced by anyone — by construction, not by promise.

VuVault is part of the [VU ecosystem](https://github.com/vuvault) of privacy-first PWAs unified by the philosophy: **YOUR data. YOUR device. YOUR control.**

---

## What's in this repository

This is the **SvelteKit application scaffold** for VuVault — the production codebase derived from the design prototypes in `docs/prototypes/`. It contains:

- The full UI shell across five routes: landing (`/`), onboarding (`/onboarding`), unlock (`/unlock`), vault (`/vault`), and architectural blueprint (`/blueprint`).
- The dual-theme design system (VU-MODERN dark glass + VU-BRUTALIST stark white), parity-equal, switched via `[data-theme]` attribute.
- Production browser hardening: CSP, HSTS, no-sniff/referrer/frame protections, locked-down permissions policy, COOP/CORP, and release smoke checks over dynamic and static routes.
- Crypto Layers L01–L05 from the blueprint, all real:
  - L01 WebAuthn-PRF passkey binding (RP id explicit; production fail-closed; demo mode dev-only)
  - L02 HKDF-SHA512 vault-key derivation (PRF · Secret Key · optional Argon2id · optional OPAQUE export key)
  - L03 hybrid X25519 + ML-KEM-1024 envelope (real keygen / encapsulate / decapsulate; FIPS 203 deterministic vectors locked in `npm run test:fips`)
  - L04 OPAQUE (RFC 9807) client via `@structured-id/opaque` behind a swappable facade; SvelteKit API routes persist opaque records in D1 and mint short-lived blob-sync bearer tokens after KE3
  - L05 Argon2id (RFC 9106) opt-in master-password third factor (`VAULT_HIGH_PARAMS`: 256 MiB, 4 passes, p=1)
  - Local Recovery Envelope: Secret Key + separate, policy-enforced Recovery Password can recover after passkey loss without server-held key material.
- Local persistence under formatVersion 2: a fresh AES-256-GCM key encrypts each vault, the AES key is wrapped under the hybrid envelope, and the AAD authenticates `formatVersion · authMode · deviceSalt · SHA-384(credentialId) · SHA-384(header)`.
- Per-document encrypted file storage: document items carry a `docBlobId` UUID; plaintext file bytes are sealed client-side under the same vault session key with a distinct AAD domain (`vuvault-doc-aad-v1` bound to the document UUID, device salt, and credential id) and persisted to a separate Dexie `documentBlobs` table. When sync is wired the encrypted bytes upload to `vaults/<accountId>/documents/<blobId>.bin` in R2 — server stores ciphertext only. End-to-end coverage in [`tests/e2e/full-workflow.spec.ts`](tests/e2e/full-workflow.spec.ts); honest level claim in [`docs/PRIVACY-LEVEL.md`](docs/PRIVACY-LEVEL.md).
- formatVersion 1 vaults from Milestone 1 still unlock; the first save after a v1 unlock transparently rewrites them as v2.
- Bundle integrity at every unlock: a build-time SHA-384 manifest of every immutable chunk is fetched, recomputed in-browser, and compared to a baked aggregate digest; a mismatch refuses decryption and surfaces a Sigstore Rekor link for out-of-band verification.
- Vault exposure limits: idle/hidden/pagehide auto-lock, sync-token clearing on lock, field-scoped reveal TTLs, and centralized best-effort clipboard clearing.
- Two explicit auth modes:
  - **production**: WebAuthn PRF passkey-bound vault key, with optional local Recovery Envelope for passkey-loss recovery.
  - **demo**: deterministic stand-in PRF derived from local device data. Clearly weaker, used for browsers without PRF support and scaffold evaluations. Surfaced in the unlock screen so users always know which mode they are in.
- Svelte 5 runes-based stores for theme, audience, audit feed, vault state, and onboarding.
- A 24-icon flat SVG library.
- Dexie + IndexedDB storage with v2 schema (account ↔ vault written atomically).
- Cloudflare Pages deployment config with D1, R2, fail-closed production rate-limit mode, idempotent OPAQUE identity bootstrap, and post-deploy API smoke.
- Vitest unit tests for crypto primitives, vault codec, pricing invariants, and API handler contracts.
- Playwright smoke tests for landing render, `/vault` redirect guard, and a Wrangler-backed D1/R2 sync round-trip in the M3 CI job.
- GitHub Actions CI gating lint / check / test / build / e2e / FIPS / M3 D1/R2 E2E on every PR or mainline push.

The visual sources of truth — what the finished UI is supposed to look like pixel-for-pixel — live in **`docs/prototypes/`** as four self-contained HTML files.

---

## Quick start

```bash
# 1. Install dependencies (Node 22 — see .nvmrc)
npm install

# 2. Start dev server (localhost:5173)
npm run dev

# 3. Type-check
npm run check

# 4. Unit tests
npm run test

# 5. End-to-end smoke (requires `npx playwright install chromium` once)
npm run test:e2e

# 6. Build for production
npm run build

# 7. Deploy to Cloudflare Pages
npm run deploy
```

Requires **Node.js 22+** and a modern browser with WebCrypto, WebAuthn, and IndexedDB. Safari 17+, Firefox 122+, Chrome 121+, Edge 121+ for the production mode; demo mode runs anywhere with WebCrypto.

---

## Directory layout

```
vuvault/
├── src/
│   ├── app.html                       # Root template + FOUC inline script
│   ├── app.css                        # Imports tokens + globals
│   ├── app.d.ts                       # Cloudflare platform types
│   │
│   ├── lib/
│   │   ├── styles/
│   │   │   ├── tokens-modern.css      # VU-MODERN dark glass tokens
│   │   │   ├── tokens-brutalist.css   # VU-BRUTALIST stark white parity
│   │   │   └── globals.css            # Theme-agnostic resets
│   │   ├── crypto/
│   │   │   ├── secret-key.ts          # 256-bit gen, Crockford Base32, vukey parser
│   │   │   ├── webauthn-prf.ts        # Passkey + PRF + capability detection
│   │   │   ├── envelope.ts            # X25519 + ML-KEM-1024 hybrid + AES-GCM (header bound as AAD)
│   │   │   ├── argon2.ts              # Argon2id RFC 9106 master-password third factor (M2)
│   │   │   ├── kat/ml-kem-1024.json   # FIPS 203 deterministic regression vectors (M2)
│   │   │   ├── derive.ts              # HKDF vault-key derivation
│   │   │   ├── totp.ts                # RFC 6238 + otpauth:// parser
│   │   │   ├── vault-codec.ts         # Versioned vault payload format
│   │   │   ├── passgen.ts             # CSPRNG with rejection sampling
│   │   │   └── *.test.ts              # Vitest coverage
│   │   ├── server/api/                # D1/R2 API helpers for OPAQUE + blob sync
│   │   ├── services/
│   │   │   ├── opaque-client.ts       # RFC 9807 client facade + fetch transport
│   │   │   ├── sync-client.ts         # Typed API client for OPAQUE + R2 blob sync
│   │   │   ├── document-blobs.ts      # attach / read / purge document file encryption
│   │   │   └── vault-session.ts       # provision / open / saveItems / sync / lock / sealDocument
│   │   ├── stores/
│   │   │   ├── theme.svelte.ts        # [data-theme] runtime API
│   │   │   ├── audience.svelte.ts     # landing user/tech toggle
│   │   │   ├── landing.svelte.ts      # 11-panel pager state
│   │   │   ├── audit.svelte.ts        # Append-only audit feed
│   │   │   ├── vault.svelte.ts        # Decrypted item cache + persistence
│   │   │   └── onboarding.svelte.ts   # 7-step state machine (incl. authMode)
│   │   ├── components/                # Button, Modal, Stepper, Card, etc.
│   │   ├── icons/                     # 24 flat SVG components
│   │   ├── data/
│   │   │   ├── pricing.ts             # $25.60/year canonical strings
│   │   │   └── landing.ts             # competitor/stack data
│   │   └── utils/
│   │       ├── storage.ts             # Dexie v2 schema + atomic save
│   │       └── env.ts                 # Bundle hash + version constants
│   │
│   └── routes/
│       ├── +layout.svelte             # Loads app.css
│       ├── +layout.ts                 # Prerender hints
│       ├── api/                       # SvelteKit Worker API: capabilities, OPAQUE, blobs
│       ├── (landing)/                 # 11-panel landing pager
│       │   ├── +page.svelte
│       │   └── _panels/               # Hero, Problem, Promise, ...
│       ├── onboarding/
│       │   ├── +page.svelte
│       │   ├── +page.ts               # ssr=false
│       │   └── _steps/                # Welcome … Provision (real crypto)
│       ├── unlock/
│       │   ├── +page.svelte           # Secret Key + Touch ID re-unlock
│       │   └── +page.ts
│       ├── vault/
│       │   ├── +page.svelte           # Three-pane vault UI
│       │   ├── +page.ts               # Account/session route guards
│       │   ├── VaultSidebar.svelte    # Categories + health (Phase 6)
│       │   ├── VaultList.svelte       # Filtered list driven by store
│       │   ├── VaultDetail.svelte     # Per-kind detail renderers
│       │   ├── ItemEditor.svelte      # Modal editor (all kinds)
│       │   ├── GeneratorPanel.svelte  # Inline password generator
│       │   └── CommandK.svelte        # Cmd/Ctrl+K palette
│       └── blueprint/
│           └── +page.svelte           # 18-layer architectural blueprint
│
├── tests/e2e/                         # Playwright smoke + M3 sync E2E tests
├── docs/                              # Prototype HTML + design guides
├── .github/workflows/ci.yml           # Lint/check/test/build/e2e/M3 sync CI
├── playwright.config.ts
├── vite.config.ts
├── svelte.config.js
├── tsconfig.json
├── wrangler.toml                       # Cloudflare Pages deploy
├── eslint.config.js
├── .nvmrc
├── .gitignore
├── LICENSE
├── CURSOR_PROMPT.md
└── README.md
```

---

## What's done vs what's pending

| Area | Status |
| --- | --- |
| Project config (Vite, SvelteKit, TS strict, CF adapter) | ✅ Done |
| Dual-theme token system (`[data-theme]`) | ✅ Done |
| 11-panel landing page (Hero → Final, J/K/T nav) | ✅ Done |
| Onboarding flow (7 steps, real WebAuthn, real CSPRNG, demo-mode opt-in) | ✅ Done |
| Vault UI shell (3-pane, top bar, audit footer) | ✅ Done |
| Vault: real local persistence (AES-GCM + bound AAD) | ✅ Done |
| Vault: search + sidebar filters wired to store | ✅ Done |
| Vault: detail renderers for all item kinds | ✅ Done |
| Vault: lock flushes pending writes before zeroizing | ✅ Done |
| Item add/edit modal + password generator | ✅ Done |
| Cmd/Ctrl+K command palette (search + 5 quick actions) | ✅ Done |
| Unlock route (Secret Key paste + .vukey JSON parser + Touch ID) | ✅ Done |
| Blueprint route (18 layers × 4 tiers) | ✅ Done |
| Vitest unit tests for crypto primitives + pricing | ✅ Done |
| Playwright smoke (landing render, /vault redirect guard) | ✅ Done |
| GitHub Actions CI (lint/check/test/build/e2e/fips) | ✅ Done |
| Real ML-KEM-1024 envelope + bundle-integrity verifier | ✅ M2 |
| OPAQUE client (RFC 9807) + Argon2id third factor | ✅ M2 |
| OPAQUE server (SvelteKit API + D1) | ✅ M3 — stable D1 server identity, release bootstrap, fail-closed production rate limits, same-SHA E2E artifact gate |
| R2 encrypted blob sync | ✅ M3 — KE3 bearer token path, upload/fetch routes, client `syncNow()`, Wrangler-backed D1/R2 E2E gate |
| Sigstore Rekor publishing in CI | ✅ M3 release workflow |
| Tier 2 layers (L06 MLS sharing, L07 CRDT sync, etc.) | ❌ Not started |
| Document item metadata | ✅ Done |
| Encrypted document file storage | ✅ M3 — AES-256-GCM per-document blobs in Dexie + R2 under `vuvault-doc-aad-v1` AAD; full-workflow E2E asserts no plaintext leak in IndexedDB |

See [`CURSOR_PROMPT.md`](./CURSOR_PROMPT.md) for the original handoff and the broader build queue. The full phased plan lives in `.cursor/plans/vuvault-development-roadmap_*.plan.md`.

---

## Auth modes

### Production mode

- Real WebAuthn passkey registration with `prf` extension.
- 32-byte PRF output bound to the platform authenticator + a 16-byte device salt.
- Vault key = HKDF-SHA512( PRF ‖ Secret Key, salt = device salt, info = "vuvault-vault-key-v1" ).
- Normal unlock requires the original platform authenticator. If the local/exported Recovery Envelope is enabled, Secret Key + Recovery Password can recover and re-bind a new passkey.

### Demo mode

- Available if WebAuthn is missing or PRF is unsupported, and the user explicitly opts in with a confirmation step.
- The "PRF" stand-in is `HMAC-SHA512( deviceSalt, credentialId )`, which means anyone with disk access AND the Secret Key can unlock — clearly weaker.
- The unlock screen surfaces the demo banner so the user is never confused about which mode they registered in.

Both modes use the same on-disk format, the same Secret Key entry path, and the same atomic provisioning flow. Only the PRF derivation differs.

---

## Pricing

VuVault is **$25.60 / year**, flat. One price. Every device. Every feature. No per-user multipliers, no tiers, no upsells.

Why $25.60? **256 bits × $0.10 = honest math.** The price equals the encryption strength. Cancel any time.

(Compared to: 1Password $35.88/yr · Dashlane $59.88/yr · Proton Pass $47.88/yr · NordPass $26.85/yr.)

---

## License

To be determined. See [`LICENSE`](./LICENSE) — likely GPLv3 or AGPLv3 for the client + MIT/Apache-2.0 for the protocol specifications.

---

## Links

- Architecture: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)
- Roadmap: [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- Security model: [`docs/SECURITY.md`](./docs/SECURITY.md)
- Design system: [`docs/VU-MODERN-DESIGN.md`](./docs/VU-MODERN-DESIGN.md), [`docs/VU-BRUTALIST-DESIGN.md`](./docs/VU-BRUTALIST-DESIGN.md)
- Cursor handoff: [`CURSOR_PROMPT.md`](./CURSOR_PROMPT.md)
