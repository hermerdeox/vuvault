# VU PRIVACY LEVEL EARNED: Vu2

> **Project:** vuvault
> **Audited:** 2026-05-14T02:20:00Z
> **Auditor:** VU_Privacy_Level_Master_Prompt v2.0.0
> **Commit / Revision:** 4f2b054b680ed2e15b6c14a755cf378695f87f0b plus uncommitted working tree
> **Project Class:** Web Frontend (SvelteKit PWA/SPA) + Web Backend/API (SvelteKit Cloudflare Worker on Cloudflare Pages, D1, R2)

---

## VERDICT

> Code earns **Vu2** under the canonical taxonomy in this prompt. Vault items and document bytes are encrypted client-side before server egress, but production sync is account-based and the server persists stable account/session/device/blob metadata in D1 and R2. The project claims zero-knowledge in shipped UI and docs, so the Trust Gap is **1 level** against the canonical Vu0 claim. The older in-app "Vu Level 1" ladder is incompatible with the canonical SubZero/Vu0/Vu1/Vu2 scale and must be migrated.

## SUMMARY

| Field | Value |
|---|---|
| **Earned Level** | Vu2 |
| **Claimed Level** | Vu0 / zero-knowledge |
| **Trust Gap** | 1 |
| **Critical Findings** | 1 |
| **High Findings** | 4 |
| **Medium Findings** | 3 |
| **Low Findings** | 1 |
| **Indeterminate** | 1 |
| **Total Source Files Analyzed** | 235 tracked source/config/doc files, excluding generated/prototype/vendor output |
| **Total Routes / Entry Points** | 16 SvelteKit pages/API endpoints |
| **Forbidden Dependencies Detected** | 0 |

## WHY NOT HIGHER?

> **Why not Vu1?** Production sync creates persistent account metadata: D1 stores `account_id`, `client_id`, `last_login_at`, sessions with `device_id`, and R2 object paths/metadata under `vaults/<accountId>/...`; this is identifiable account/routing/timing/size metadata, not minimal relay metadata (`migrations/0001_init.sql:37`, `migrations/0001_init.sql:81`, `src/routes/api/blobs/upload/+server.ts:87`, `src/routes/api/documents/[blobId]/+server.ts:99`).

> **Why not Vu0?** Vu0 criterion #3 fails because the server can correlate accounts and sessions, and criterion #5/#9 are weakened by outbound links to GitHub/Rekor and same-origin API sync metadata (`src/routes/onboarding/_steps/StepVerify.svelte:147`, `src/lib/utils/env.ts:173`, `src/lib/services/sync-client.ts:180`).

> **Why not SubZero?** SubZero fails on enforced CSP because Cloudflare `_headers` permits `unsafe-inline` in `script-src`, and no third-party security review is published (`_headers:2`, `docs/SECURITY.md:146`).

## 1. Discovery Summary

─────────────────────────────────────────────────────────────
PROJECT DISCOVERY SUMMARY
─────────────────────────────────────────────────────────────
Root:                /Users/dimlo/Documents/vuvault
Workspaces:          none detected
Project Class(es):   Web Frontend (SvelteKit PWA/SPA) + Web Backend/API (SvelteKit Cloudflare Worker on Cloudflare Pages)
Primary Language(s): TypeScript/Svelte dominant; JavaScript build scripts; SQL migrations; Markdown docs
Framework(s):        SvelteKit 2, Svelte 5 runes, Vite 6, Cloudflare adapter
Storage:             Dexie/IndexedDB local; localStorage for UI preferences; sessionStorage for stale-build reload flag; Cloudflare D1 for auth/session/rate-limit metadata; Cloudflare R2 for encrypted blobs
Crypto Libs:         @noble/ciphers, @noble/curves, @noble/hashes, @noble/post-quantum, WebCrypto, argon2id, @structured-id/opaque
Deployment Target:   Cloudflare Pages/Workers with D1 and R2 (`wrangler.toml:1`, `wrangler.toml:36`, `wrangler.toml:46`)
Update Mechanism:    Cloudflare Pages release deploys; no service worker auto-update found; silent web redeploy remains possible at origin level
Claims Under Test:   zero-knowledge, mathematical privacy, no analytics/telemetry, same-origin only, reproducible/Rekor, legacy Vu Level ladder, VU pricing/design addendum
Estimated Scope:     medium
─────────────────────────────────────────────────────────────

## 2. Stack Verification

| Area | Evidence | Verdict |
|---|---|---|
| SvelteKit Cloudflare app | Cloudflare adapter configured in `svelte.config.js:1` and `svelte.config.js:29`; Pages output in `wrangler.toml:4` | Verified |
| CSP | SvelteKit CSP sets `script-src` to self/wasm/hash in `svelte.config.js:54`; deployed `_headers` permits `unsafe-inline` in `script-src` at `_headers:2` | SubZero blocker |
| Local encrypted storage | Dexie schema persists vault rows with nonce/ciphertext in `src/lib/utils/storage.ts:68`, `src/lib/utils/storage.ts:71`, `src/lib/utils/storage.ts:72` | Verified for content |
| Server metadata storage | D1 accounts/sessions/device tables in `migrations/0001_init.sql:37`, `migrations/0001_init.sql:81`, `migrations/0001_init.sql:97` | Vu2 metadata plane |
| Runtime sync | Production `PUBLIC_SYNC_ORIGIN` makes sync configured in `src/lib/utils/env.ts:88` and `src/lib/utils/env.ts:92`; sync client calls same-origin API in `src/lib/services/sync-client.ts:180` | Verified |
| Reproducible release | Two-pass build in `.github/workflows/release.yml:73`, convergence in `.github/workflows/release.yml:96`, Rekor signing in `.github/workflows/release.yml:141` | Strong, not sufficient for SubZero |
| Runtime audit | `npm audit --omit=dev --json` reported 0 low/moderate/high/critical runtime vulnerabilities during this audit | Verified at audit time |

## 3. Route / Entry-Point Behavior

| Entry | Runs On | Reads User Input | Storage / Egress |
|---|---|---|---|
| `/` landing | client | audience/theme interactions | Marketing claims at `src/routes/(landing)/+page.svelte:110` and `src/routes/(landing)/_panels/Hero.svelte:18`; no content storage |
| `/onboarding` | client | device label, secret key, recovery password, passkey, pricing choice | Device label claimed local-only at `src/routes/onboarding/_steps/StepIdentity.svelte:33`; provisioning later enrolls OPAQUE when configured via `StepProvision` |
| `/unlock` | client | Secret Key, optional master password, WebAuthn PRF | Verifies bundle before decrypt in `src/routes/unlock/+page.svelte:138`; fetches same-origin manifest in `src/lib/utils/env.ts:199` |
| `/vault` | client | vault item fields, documents, passwords, cards | Decrypted items live in memory while unlocked (`src/lib/stores/vault.svelte.ts:4`); mutations persist via encrypted `saveItems()` at `src/lib/stores/vault.svelte.ts:293` |
| `/recover` | client | Secret Key, Recovery Password, `.vukey` file | Rebinds vault locally through recovery envelope in `src/routes/recover/+page.svelte:99` and `src/routes/recover/+page.svelte:126` |
| `/privacy` | client | none | Displays older in-app level ladder from `src/lib/data/privacy-level.ts:33` and current level at `src/lib/data/privacy-level.ts:82` |
| `/api/capabilities` | edge/server | none | Public capability JSON; no auth, no user content (`src/routes/api/capabilities/+server.ts:18`) |
| `/api/opaque/register/request` | edge/server | `clientId`, OPAQUE blinded request | Rate-limited by IP (`src/routes/api/opaque/register/request/+server.ts:27`); stores pending OPAQUE state in D1 via `D1OpaqueStorage` |
| `/api/opaque/register/record` | edge/server | `clientId`, request id, OPAQUE record | Stores OPAQUE account metadata (`src/routes/api/opaque/register/record/+server.ts:54`, `migrations/0001_init.sql:37`) |
| `/api/opaque/login/ke1` | edge/server | `clientId`, KE1 | Unknown-client response documents account-existence oracle (`src/routes/api/opaque/login/ke1/+server.ts:52`) |
| `/api/opaque/login/ke3` | edge/server | `clientId`, KE3, optional device id | Mints session token and stores `device_id`/`last_login_at` (`src/routes/api/opaque/login/ke3/+server.ts:91`, `src/routes/api/opaque/login/ke3/+server.ts:99`) |
| `/api/blobs/upload` | edge/server | encrypted header/nonce/ciphertext | Stores R2 object under account id path and metadata (`src/routes/api/blobs/upload/+server.ts:87`, `src/routes/api/blobs/upload/+server.ts:104`) |
| `/api/blobs/latest` | edge/server | auth token only | Lists R2 by account prefix and returns ciphertext (`src/routes/api/blobs/latest/+server.ts:31`, `src/routes/api/blobs/latest/+server.ts:94`) |
| `/api/documents/[blobId]` | edge/server | encrypted document blob, blob id | Stores ciphertext by account id and document uuid (`src/routes/api/documents/[blobId]/+server.ts:46`, `src/routes/api/documents/[blobId]/+server.ts:99`) |
| `/api/[...rest]` | edge/server | path only | Catchall explicitly does not read body/query (`src/routes/api/[...rest]/+server.ts:5`, `src/routes/api/[...rest]/+server.ts:13`) |

## 4. Data Flow Map

| Input Source | In-Memory State | Persistent Storage | Egress |
|---|---|---|---|
| Vault item fields/passwords/cards/notes | Decrypted `items` while unlocked (`src/lib/stores/vault.svelte.ts:76`) | AES-GCM ciphertext in IndexedDB (`src/lib/utils/storage.ts:68`) | Whole-vault ciphertext only via `uploadBlob()` (`src/lib/services/sync-client.ts:321`) |
| Document file bytes | Plaintext buffer inside `attachDocumentFile()` (`src/lib/services/document-blobs.ts:63`) | Encrypted `documentBlobs` row (`src/lib/utils/storage.ts:114`) | Document ciphertext only (`src/lib/services/document-blobs.ts:83`, `src/lib/services/sync-client.ts:384`) |
| Secret Key quick unlock | Secret key buffer in memory | AES-GCM quick unlock ciphertext (`src/lib/services/quick-unlock.ts:105`, `src/lib/services/quick-unlock.ts:108`) | No server egress |
| Recovery envelope | AES key sealed from active session | Argon2id+HKDF+AES-GCM recovery ciphertext (`src/lib/crypto/recovery-envelope.ts:117`, `src/lib/crypto/recovery-envelope.ts:179`) | Exported only if user includes in `.vukey` path; no server storage path found |
| OPAQUE password | Client-side OPAQUE operations (`src/lib/services/opaque-client.ts:16`) | Server stores OPAQUE record fields, not plaintext password (`migrations/0001_init.sql:33`) | OPAQUE protocol messages and client id (`src/lib/services/sync-client.ts:241`, `src/lib/services/sync-client.ts:280`) |
| Device/account metadata | Account row in Dexie (`src/lib/utils/storage.ts:26`) | D1 account/session rows (`migrations/0001_init.sql:37`, `migrations/0001_init.sql:81`) | Same-origin API sees account/session metadata |

## 5. Cryptographic Audit

| Call Site | Algorithm / Library | Evidence | Verdict |
|---|---|---|---|
| Vault key derivation | HKDF-SHA512 via `@noble/hashes` | `src/lib/crypto/derive.ts:35`, `src/lib/crypto/derive.ts:136` | Acceptable; not memory-hard unless optional MPK used |
| Device salt | WebCrypto CSPRNG | `src/lib/crypto/derive.ts:144` | Acceptable |
| Vault blob sealing | AES-GCM via `@noble/ciphers`, random 12-byte nonce | `src/lib/services/vault-session.ts:371`, `src/lib/services/vault-session.ts:373` | Acceptable |
| Document sealing | AES-GCM via `@noble/ciphers`, random nonce, AAD-bound blob id | `src/lib/services/vault-session.ts:462`, `src/lib/services/vault-session.ts:464`, `src/lib/services/vault-session.ts:465` | Acceptable |
| Hybrid envelope | X25519 + ML-KEM-1024 + HKDF-SHA512 + AES-GCM | `src/lib/crypto/envelope.ts:29`, `src/lib/crypto/envelope.ts:33`, `src/lib/crypto/envelope.ts:124` | Acceptable primitives; note older comment says future use at `src/lib/crypto/envelope.ts:22` while active service wrapper is elsewhere |
| Master-password KDF | Argon2id 256 MiB, 4 passes, p=1 | `src/lib/crypto/argon2.ts:52` | Exceeds prompt threshold |
| Quick unlock | WebAuthn PRF-derived HKDF key + AES-GCM | `src/lib/services/quick-unlock.ts:37`, `src/lib/services/quick-unlock.ts:105` | Acceptable local cache |
| Recovery envelope | Argon2id + HKDF-SHA512 + AES-GCM | `src/lib/crypto/recovery-envelope.ts:135`, `src/lib/crypto/recovery-envelope.ts:144`, `src/lib/crypto/recovery-envelope.ts:179` | Acceptable; offline attack documented in `docs/SECURITY.md:84` |
| OPAQUE | `@structured-id/opaque` plus forced JS backend | `src/lib/services/opaque-client.ts:24`, `src/lib/services/opaque-client.ts:168` | Indeterminate third-party maturity; no independent audit evidence found |

## 6. Network Surface

| Destination | Category | Justification | Contains User Data |
|---|---|---|---|
| self `/api/opaque/*` | auth/sync backend | OPAQUE registration/login (`src/lib/services/sync-client.ts:241`) | Account/client id + OPAQUE messages; no plaintext password |
| self `/api/blobs/*` | sync backend | ciphertext sync (`src/lib/services/sync-client.ts:321`) | Ciphertext + account/session metadata |
| self `/api/documents/<blobId>` | document blob backend | ciphertext upload/fetch/delete (`src/lib/services/sync-client.ts:384`) | Ciphertext + blob id + account/session metadata |
| self `/_app/immutable/bundle-manifest.json` and chunk paths | integrity verifier | same-origin manifest/chunk fetch (`src/lib/utils/env.ts:199`, `src/lib/utils/env.ts:242`) | no user content |
| self `/argon2id/*.wasm` | WASM runtime | same-origin Argon2id WASM fetch (`src/lib/crypto/argon2.ts:126`) | no user content |
| `https://search.sigstore.dev` | transparency-log link | URL string and UI link in verifier (`src/lib/utils/env.ts:173`) | only if user clicks external Rekor link |
| `https://github.com/vuvault/vuvault/releases` | external release link | onboarding verification button (`src/routes/onboarding/_steps/StepVerify.svelte:147`) | only if user clicks external link |

No Sentry/PostHog/Mixpanel/Google Analytics/Firebase Analytics/Hotjar/LogRocket/Bugsnag/Datadog RUM dependencies were found in `package-lock.json` by the forbidden-dependency sweep. `package-lock.json` does contain `@opentelemetry/api` transitively (`package-lock.json:2223`), but no application instrumentation call site was found in `src/`.

## 7. Build & Delivery

Reproducibility work is real: `SOURCE_DATE_EPOCH` is pinned in CI (`.github/workflows/ci.yml:83`), a two-pass digest is computed (`.github/workflows/ci.yml:91`, `.github/workflows/ci.yml:113`), and release builds publish Sigstore/Rekor artifacts (`.github/workflows/release.yml:141`, `.github/workflows/release.yml:173`). That supports supply-chain verification, but SubZero still fails because `_headers` permits `unsafe-inline` (`_headers:2`) and no published third-party security review exists (`docs/SECURITY.md:146`).

No service worker auto-update mechanism was found; search for `serviceWorker`, `self.skipWaiting()`, and `clients.claim()` returned no shipped registration file. Web delivery still permits silent origin updates by Cloudflare Pages unless the user independently verifies the displayed bundle hash.

## 8. Metadata & Side Channels

The server can observe account existence and login attempts: `/api/opaque/login/ke1` returns `unknown clientId` by design (`src/routes/api/opaque/login/ke1/+server.ts:52`). The server stores account ids, client ids, login timestamps, session expiry, session device ids, and sequence clocks (`migrations/0001_init.sql:37`, `migrations/0001_init.sql:81`, `migrations/0002_account_sequence_clock.sql:6`). R2 object keys reveal per-account blob counts, update sequence, document blob UUIDs, object sizes, and upload times (`src/routes/api/blobs/latest/+server.ts:31`, `src/routes/api/documents/[blobId]/+server.ts:46`). The docs already admit size/timing leakage and unpadded natural-length ciphertext (`docs/SECURITY.md:15`, `docs/PRIVACY-LEVEL.md:59`).

Cloudflare itself sees IP, user agent, path, request timing, and TLS metadata for every page/API request. That does not expose plaintext content, but it is not the empty/correlation-free network surface required for canonical Vu0.

## 9. Claim Reconciliation

| Claim | Evidence | Verdict |
|---|---|---|
| `VuVault — zero-knowledge password manager` | `src/app.html:26`, `src/routes/(landing)/_panels/Hero.svelte:18`, `package.json:5` | Partially supported for content, overstated for canonical Vu0 because account/session/blob metadata persists server-side |
| `company ... cannot read your data` | `src/routes/(landing)/+page.svelte:112`, ciphertext-only blob upload at `src/routes/api/blobs/upload/+server.ts:5` | Supported for content plaintext |
| `We never see it` | `src/routes/(landing)/_panels/Hero.svelte:34` | Supported for plaintext content; unsupported if read literally as all metadata, because D1/R2 metadata is visible |
| `Same-origin only · no third-party hosts` | `src/routes/(landing)/_panels/Hero.svelte:74` | Supported for automatic shipped resource loading; external click links still exist at `src/routes/onboarding/_steps/StepVerify.svelte:147` and `src/lib/utils/env.ts:173` |
| `No analytics tags shipped` | `src/routes/(landing)/_panels/Hero.svelte:79`; no forbidden telemetry dependencies found | Supported |
| `Crypto runs in your browser, not ours` | `src/routes/(landing)/_panels/Hero.svelte:84`; encryption call sites in `src/lib/services/vault-session.ts:373` and `src/lib/services/vault-session.ts:465` | Supported for content encryption |
| Older `Vu Level 1` is current/best-ish | `src/lib/data/privacy-level.ts:43`, `src/lib/data/privacy-level.ts:82`, `docs/PRIVACY-LEVEL.md:21` | Contradicts canonical prompt taxonomy where Vu1 is E2E + minimal metadata and Vu0 is zero-knowledge |
| `$25.60/year` canonical price | `src/lib/data/pricing.ts:10`, `src/routes/(landing)/_panels/Pricing.svelte:9` | Violates VU addendum if canonical price must be `$2.56`; internally deliberate but not compliant with this prompt |

## 10. Findings (Sorted by Severity, then by File)

### F-001 [CRITICAL] Canonical VU pricing check fails

- **Location:** `src/lib/data/pricing.ts:10`
- **Evidence:**
  ```ts
  export const PRICE = '$25.60/year';
  export const PRICE_NUM = '$25.60';
  ```
- **Why this matters:** The VU addendum in the canonical prompt states that the only acceptable VU price literal is `$2.56` / `2.56` / `256` cents. This repo deliberately uses `$25.60/year`, and CI even blocks `$2.56` in shipped source. Under this audit standard, that is a Critical VU-specific compliance failure, regardless of product intent.
- **Recommendation:** Decide whether this project follows the canonical VU addendum. If yes, migrate pricing constants, UI, tests, CI guards, and docs to `$2.56`. If no, explicitly remove/override VU ecosystem mode for this repo's privacy-audit standard.
- **Blocks claim:** VU ecosystem canonical compliance.
- **Closes at level:** Does not change privacy level; closes VU addendum Critical.

### F-002 [HIGH] Legacy privacy taxonomy conflicts with canonical SubZero/Vu0/Vu1/Vu2 scale

- **Location:** `src/lib/data/privacy-level.ts:33`
- **Evidence:**
  ```ts
  export const PRIVACY_LEVELS: readonly PrivacyLevel[] = [
    {
      id: 0,
      short: 'Vu Level 0',
      headline: 'Policy privacy',
  ```
- **Why this matters:** The canonical taxonomy is directional: SubZero is strongest, Vu0 is zero-knowledge, Vu5 is weakest. This code uses a legacy ladder where `Vu Level 0` means policy privacy and `Vu Level 1` is the shipped good state. That creates a high-risk semantic inversion in UI, docs, and future audits.
- **Recommendation:** Replace the legacy numeric ladder with canonical labels: SubZero, Vu0, Vu1, Vu2, Vu3, Vu4, Vu5. Map the current implementation to canonical Vu2 unless the metadata plane is redesigned.
- **Blocks claim:** `src/routes/privacy/+page.svelte:42` displays the legacy current level.
- **Closes at level:** Required for accurate canonical classification.

### F-003 [HIGH] Persistent account/session metadata caps the project at canonical Vu2

- **Location:** `migrations/0001_init.sql:37`
- **Evidence:**
  ```sql
  CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    client_public_key BLOB NOT NULL,
    masking_key BLOB NOT NULL,
    envelope_bytes BLOB NOT NULL,
    oprf_secret_key BLOB NOT NULL,
  ```
- **Why this matters:** The server stores stable account identifiers and OPAQUE records, and later session/device metadata. Content remains encrypted, but the server can correlate a user's sync activity, session creation, sequence clocks, and blob inventory. That is canonical Vu2 territory, not Vu0/Vu1.
- **Recommendation:** Either lower claims to canonical Vu2, or redesign sync around unlinkable identifiers, blinded routing, and metadata minimization with explicit limits.
- **Blocks claim:** Zero-knowledge/Vu0 claims when interpreted as no account correlation.
- **Closes at level:** Fixing this is required to clear Vu1/Vu0 metadata criteria.

### F-004 [HIGH] Deployed CSP permits `unsafe-inline` scripts

- **Location:** `_headers:2`
- **Evidence:**
  ```text
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'; ...
  ```
- **Why this matters:** SubZero requires a documented enforced CSP with no `unsafe-inline` and no `unsafe-eval`. The app's SvelteKit config is stricter, but Cloudflare `_headers` is the deployed HTTP policy and allows inline script execution.
- **Recommendation:** Remove `unsafe-inline` from the served CSP by using SvelteKit nonces/hashes consistently, or document the exact bootstrap hash set needed for production.
- **Blocks claim:** SubZero/provable zero-knowledge.
- **Closes at level:** Required for SubZero criterion #5.

### F-005 [HIGH] No published third-party security review

- **Location:** `docs/SECURITY.md:146`
- **Evidence:**
  ```md
  | TBD | TBD | Full Tier 1 stack | Public PDF on launch |
  ```
- **Why this matters:** SubZero requires a published third-party security review or formal verification covering the cryptographic boundary. The current documentation explicitly marks audit history as TBD.
- **Recommendation:** Commission and publish a third-party review of the client encryption, OPAQUE integration, D1/R2 sync metadata boundary, and build verification model.
- **Blocks claim:** SubZero.
- **Closes at level:** Required for SubZero criterion #7.

### F-006 [MEDIUM] Hex color literals remain in Svelte files

- **Location:** `src/lib/components/SplashScreen.svelte:73`
- **Evidence:**
  ```svelte
  background: #020610;
  color: #fff;
  color: #556688;
  ```
- **Why this matters:** The VU addendum bans hex literals in `src/**/*.svelte`; colors should come from CSS variables driven by `[data-theme]`. This is not a privacy leak, but it violates the canonical VU design/privacy standard.
- **Recommendation:** Move hard-coded colors into design tokens and reference CSS variables from Svelte components.
- **Blocks claim:** VU design-system compliance.
- **Closes at level:** Addendum hygiene only.

### F-007 [MEDIUM] Outbound release/transparency links lack explicit noreferrer evidence

- **Location:** `src/routes/onboarding/_steps/StepVerify.svelte:147`
- **Evidence:**
  ```svelte
  <Button href="https://github.com/vuvault/vuvault/releases">View public release</Button>
  ```
- **Why this matters:** Automatic third-party resources were not found, but user-clicked outbound links to GitHub/Rekor can still leak referrer/path metadata if the underlying `Button` link does not enforce `rel="noreferrer"`. The audit did not verify `Button.svelte` before report write.
- **Recommendation:** Ensure all external anchors centrally set `rel="noreferrer noopener"` and, where opened in a new tab, use `target="_blank"` only with those rel attributes.
- **Blocks claim:** Strict interpretation of “same-origin only”.
- **Closes at level:** Defense-in-depth for Vu0/Vu1 claims.

### F-008 [MEDIUM] Same-origin sync leaks natural ciphertext sizes and timing

- **Location:** `docs/SECURITY.md:15`
- **Evidence:**
  ```md
  current implementation does not pad. The vault-codec and the document sealer both encrypt under AES-256-GCM and write the resulting ciphertext at its natural length
  ```
- **Why this matters:** Natural-length ciphertext reveals approximate vault/document size and update cadence. The docs correctly admit this, so this is not a contradiction; it is the main practical metadata leak that keeps the system out of canonical Vu1/Vu0.
- **Recommendation:** Add bucketed padding, sync jitter, and field-level encrypted CRDT deltas if the product wants a higher canonical level.
- **Blocks claim:** Any claim of size-hiding or minimal metadata.
- **Closes at level:** Needed for stronger Vu1-style metadata minimization.

### F-009 [LOW] Emoji/symbol audit finds UI glyphs in source

- **Location:** `src/routes/onboarding/_steps/StepSecret.svelte:119`
- **Evidence:**
  ```svelte
  <div class="warn"><strong>⚠ Without this key</strong>, plus access to a paired device, your vault is permanently inaccessible.</div>
  ```
- **Why this matters:** The VU addendum says no emojis in shipped Svelte/TS/HTML. This warning glyph is not a privacy defect, but it violates the addendum.
- **Recommendation:** Replace emoji/symbol glyphs with inline SVG icons or text labels from the design system.
- **Blocks claim:** VU addendum compliance.
- **Closes at level:** Addendum hygiene only.

### F-010 [INDETERMINATE] OPAQUE dependency maturity is not independently verified

- **Location:** `src/lib/services/opaque-client.ts:10`
- **Evidence:**
  ```ts
  * REVIEW: new runtime dep `@structured-id/opaque@1.0.4` (pre-approved
  * for M2 per the plan). Pin is exact; CI guards against silent
  * upgrades.
  ```
- **Why this matters:** The code pins and wraps OPAQUE, but the audit did not find an external audit report for `@structured-id/opaque` or for the local JS backend forced in this facade. OPAQUE sits on the authentication/key-derivation boundary, so this cannot be hand-waved.
- **Recommendation:** Obtain an implementation review of `@structured-id/opaque` usage and the forced JS backend, or migrate to an independently audited OPAQUE implementation.
- **Blocks claim:** Audit-complete zero-knowledge/SubZero claims.
- **Closes at level:** Required to reduce Indeterminate crypto boundary risk.

## 11. Trust Gap Analysis

The code supports the strongest user-facing content claim: the audited paths encrypt vault items and document bytes client-side before D1/R2 egress. The gap is metadata and taxonomy. Marketing says “zero-knowledge,” but canonical Vu0 additionally requires no correlatable server accounts, no runtime behavior control, and a stricter delivery boundary. This repo earns Vu2 because the server cannot read content but does know stable account/session/blob metadata.

## 12. Remediation Plan (Prioritized)

1. Resolve F-001 by either adopting canonical `$2.56` pricing or explicitly opting this repo out of the VU pricing addendum.
2. Resolve F-002 by migrating the legacy privacy ladder to canonical SubZero/Vu0/Vu1/Vu2/Vu3/Vu4/Vu5 labels.
3. Resolve F-003 and F-008 by lowering claims to canonical Vu2 or redesigning sync for metadata minimization.
4. Resolve F-004 by removing `unsafe-inline` from the deployed CSP.
5. Resolve F-005 and F-010 by commissioning/publishing independent review of the cryptographic and OPAQUE boundary.
6. Resolve F-006 and F-009 by moving colors/glyphs into the VU design system.
7. Resolve F-007 by centrally enforcing noreferrer/noopener on external links.

## 13. Verification Checklist (for re-audit after remediation)

☐ F-001: Pricing literals and CI guards match the chosen canonical pricing policy.

☐ F-002: `/privacy`, `privacy-level.ts`, docs, and tests use canonical taxonomy labels.

☐ F-003: Either claims are lowered to canonical Vu2, or server-visible account/session metadata is redesigned and re-audited.

☐ F-004: Production HTTP CSP has no `unsafe-inline`, no `unsafe-eval`, and no wildcard sources.

☐ F-005: A public third-party security review exists and covers the cryptographic boundary.

☐ F-006: `src/**/*.svelte` contains no raw hex color literals outside unavoidable data/content literals.

☐ F-007: All external anchors include `rel="noreferrer noopener"` or equivalent centralized enforcement.

☐ F-008: Ciphertext padding and timing mitigation are implemented or claims explicitly exclude them.

☐ F-009: Emoji/symbol code points are removed from shipped Svelte/TS/HTML UI source.

☐ F-010: OPAQUE dependency/local backend has independent review or is replaced.

## 14. Indeterminate Items (Need More Access / Info)

- Public repository/license status was not verified from remote hosting during this audit. `package.json:4` marks the package private, which is enough to withhold SubZero credit until public OSI licensing is proven.
- The audit did not packet-capture a production session. Network conclusions are static-code conclusions from source/config and should be confirmed with browser DevTools or a proxy against the deployed origin.
- The audit did not inspect Cloudflare dashboard settings, Pages project headers outside `_headers`, WAF rules, or access logs.
- The audit did not verify `Button.svelte` external-link rel handling before writing this report; F-007 remains Indeterminate/Medium pending component review.

## 15. Appendix: Legacy Taxonomy Translation

| Legacy Label | New Canonical Label |
|---|---|
| `Vu Level 4` frontier crypto | Not a privacy level; map only after criteria are proven |
| `Vu Level 3` recovery/TEE/agentic autofill | Not canonical Vu3 unless server can decrypt; rename as roadmap tier |
| `Vu Level 2` sync/sharing/breach checks | Candidate canonical Vu1/Vu2 depending metadata |
| `Vu Level 1` shipped architectural privacy | Canonical Vu2 for current implementation |
| `Vu Level 0` policy privacy | Canonical Vu3 or worse, depending server plaintext access |

## 16. 2026-05-22 Phase 2 footer — V1-C2 closure (informational)

This audit was authored before the session-mint redesign landed.
Since 2026-05-22 the codebase has shipped the **V1-C2** closure
described in [`docs/VU-LEVEL-MIGRATION-MAP.md`](./docs/VU-LEVEL-MIGRATION-MAP.md):

- `migrations/0004_metadata_minimization.sql` drops
  `sessions.device_id`, `accounts.last_login_at`, and the
  `device_pairings` table; installs `metadata_minimization_guard`
  trigger; corresponding CI rule lives in
  `scripts/audit-bindings.mjs` Rule 4.
- `src/lib/server/api/auth-token.ts` removes `Session.deviceId` and
  adds `rotateToken()` atomic mint-and-retire.
- `src/routes/api/v2/sessions/self/+server.ts` (new) returns only
  `{expiresAt, sequenceClock}` and emits a `Next-Token` response
  header on every call.
- KE3, blob upload, and document put no longer write any device-
  correlating field to D1 or R2 customMetadata.

The release probe (`scripts/release-probe-vu1.mjs`) now reports
`v1_c2 = pass` against any deploy carrying the migration. **The
repo's CURRENT_LEVEL is still 2** because V1-C1 and V1-C3 (both
gated by Phase 4 §L07b) remain open. See
[`docs/verifications/2026-05-22-vu1-phase2.md`](./docs/verifications/2026-05-22-vu1-phase2.md)
for the audited evidence trail.

This footer is informational and does not retroactively change
the audit's original findings. The next refresh of this audit
should incorporate the V1-C2 closure into the body and remove
this footer.

## 17. 2026-05-25 Vu0 full-crypto closure footer (informational)

Since the §16 footer above was written, the codebase has shipped
the **V0-C1**, **V0-C2**, and **V0-C3** closures described in
[`docs/VU-LEVEL-MIGRATION-MAP.md`](./docs/VU-LEVEL-MIGRATION-MAP.md):

- **V0-C1 unlinkable routing.** AKD epoch publication via
  `migrations/0006_akd_epochs.sql` + `src/lib/server/api/akd-server.ts`.
  Per-epoch VOPRF secret keys via `migrations/0007_oprf_keys.sql`
  + `src/lib/server/api/oprf-server.ts`. RFC 9497 VOPRF over
  Ristretto255 in `src/lib/crypto/voprf.ts`. Capability index in
  `migrations/0008_capability_index.sql`. `X-Vu0-Capability`
  header accepted on /api/v2/blobs/[uuid], /api/v2/inv/[addr],
  /api/v2/sessions/self via `src/lib/server/api/capability-auth.ts`.
- **V0-C2 bucketed blob sizes.** `src/lib/crypto/padding.ts`
  wired into `sealBlob`/`openBlob` at vault format version 3.
  Document blobs use a 1-byte v1 marker for legacy compat.
  Verified by `tests/integration/v0c2-padding.spec.ts`.
- **V0-C3 no account-existence oracle.**
  `/api/opaque/login/ke1` performs dummy OPRF work on the
  unknown-clientId path; generic error message replaces the
  legacy "unknown clientId" string.

**Residual gap (Tier-3+ closure required):** the OPAQUE handshake
itself still requires a stable per-account identifier so the
server can load the envelope. We replaced the user-chosen
`clientId` with `accountSeed`-derived handles, but the handle is
stable per account during the handshake. Full per-handshake
unlinkability requires a ZK-proof layer over the lookup. The
honest Vu0 framing: **"after OPAQUE login, the server cannot
link a session's subsequent requests to the account that logged
in."**

See
[`docs/verifications/2026-05-26-vu0-uplift.md`](./docs/verifications/2026-05-26-vu0-uplift.md)
for the full Vu0 verification trail. This footer is informational
and does not retroactively change the audit's original findings.
