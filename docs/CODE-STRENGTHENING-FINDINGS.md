# Code Strengthening Findings

> Captured during the Phase 6 sweep of the Roadmap Audit + Perf + Mobile-First
> Overhaul plan. Each entry records the audit category, the in-tree evidence,
> whether it was fixed in this pass, and the rationale for any deliberate
> deferrals.

## Methodology

Source paths swept in this pass:

- `src/**/*.svelte` (Svelte 5 anti-patterns)
- `src/lib/services/**/*.ts` and `src/lib/server/api/**/*.ts` (silent catches,
  unsafe casts, secret-buffer zeroize hygiene)
- `src/lib/utils/**/*.ts` (storage, env, sanitize)
- `tests/integration/**/*.spec.ts` (coverage map)

Tooling baseline at end of Phase 5:

| Gate | Result |
| --- | --- |
| `npm run check` | 0 errors, 93 warnings (pre-existing CSS-unused / vendor `text-security`) |
| `npm run lint` | 0 errors |
| `npm run test` | 193 tests passing |
| `npm run test:fips` | 15 KAT tests passing (ML-KEM-1024 noble + ACVP + Argon2id RFC 9106) |
| `node scripts/verify-pins.mjs` | 3 npm exact pins (opaque, argon2id, noble-post-quantum) + 2 cosign pins verified |
| `node scripts/audit-bindings.mjs` | OK |

## Findings

### F1. Svelte 5 anti-patterns (rune state writes from `$effect`)

**Status:** fixed earlier this session.

Two regressions emerged when the M3 Item Editor and Modal first shipped: the
editor's open-state effect wrote `selectedKind` and `showGenerator` in a way
Svelte 5 traced as a self-update, hitting
`effect_update_depth_exceeded`. Both were fixed by replacing the effect with
a keyed-remount pattern in [src/routes/vault/+page.svelte](../src/routes/vault/+page.svelte)
that constructs a fresh `ItemEditor` instance via `{#key editorNonce}`, and
by reading the initial open-state props through `untrack()` in
[src/routes/vault/ItemEditor.svelte](../src/routes/vault/ItemEditor.svelte).
The Modal's `dialogEl` reference was likewise converted to `$state` so the
focus-effect can read/write it cleanly.

No additional Svelte 5 anti-patterns surfaced in the fresh sweep (10
`$effect` call-sites across the codebase, all reading external state and
producing local side effects; none read-and-write the same `$state`).

### F2. Silent `catch {}` blocks

**Status:** none found in `src/`.

Grep across `src/**/*.ts` for `catch {` followed by an empty body returned 0
hits. The only `catch {}` patterns are deliberate "soft fail" branches in
the OPAQUE login error decoder (which then returns a structured `SyncResult`)
and in the bundle-integrity verifier (which downgrades a fetch failure to a
typed `mismatch` state for the unlock screen to render).

### F3. Type-safety casts (`as unknown as ...`, `as any`)

**Status:** four occurrences, all intentional and documented.

- `src/lib/crypto/webauthn-prf.ts:59` —
  `PublicKeyCredential as unknown as { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> }`
  bridges the experimental `PublicKeyCredential` static surface that
  `lib.dom.d.ts` does not yet narrow. Required.
- `src/lib/types/vault-item.ts:148` —
  `item as unknown as Record<string, unknown>` enables the discriminated
  union to be iterated for zeroize. Required.
- `src/lib/crypto/argon2.ts:99` —
  `(process as unknown as { versions?: { node?: string } }).versions`
  detects Node for the test path. Required.
- `src/lib/services/vault-session.test.ts:572` — `99 as unknown as 1` is a
  deliberate type defeat in a test fixture for the
  unsupported-format-version branch. Required.

No `as any` casts anywhere.

### F4. `d1-storage.ts` row-shape decoder hardening

**Status:** fixed earlier in Phase 2.

The `bytes()` helper at
[src/lib/server/api/d1-storage.ts](../src/lib/server/api/d1-storage.ts) now
accepts every BLOB column shape Wrangler's local D1, production D1, and the
in-memory mock have emitted: `Uint8Array`, `ArrayBuffer`, plain `number[]`,
Node `Buffer` (with `{ type: 'Buffer', data: number[] }`), and the
numeric-keyed object that local Wrangler returns for BLOB cells. The
all-zero guard in `loadServerIdentity` also moved above the
`serverPublicKey` early-return branch in Phase 2 so a future caller that
supplies a public key cannot bypass the secret-key zero check.

### F5. Test-coverage gaps

**Status:** partially addressed.

| Target | Coverage before | Coverage after |
| --- | --- | --- |
| `src/lib/services/sync-client.ts` | none | new [src/lib/services/sync-client.test.ts](../src/lib/services/sync-client.test.ts) — 7 tests covering local-only short-circuit, success decode, server error decode, network error decode, bearer-token application, no-session header omission, `isSyncWired` mirroring |
| `src/lib/services/vault-envelope.ts` | already covered (`vault-envelope.test.ts`, 9 tests) | unchanged |
| `src/routes/api/**` handlers | `tests/integration/api-routes.spec.ts` (5 tests) | unchanged — Phase 2 added burst-probe coverage at the live deploy layer |
| `src/lib/crypto/webauthn-prf.ts` shim path | none | unchanged (deferred — exercised end-to-end via `tests/e2e/sync.spec.ts` under `PUBLIC_M3_E2E_AUTH=true`) |

### F6. Zeroize hygiene

**Status:** centralized and audited.

`vault-session.ts` keeps a single private `zeroize(buf)` helper and calls it
at every key-rotation site:

- `provisionVault` — both happy and failure paths zeroize the freshly
  derived `vaultKey`, `aesKey`, and `prf` (lines 504-508, 526-528).
- `openVault` — failure path zeroizes `newVaultKey`, `newAesKey`, and
  `prfOutput` (lines 627-628, 636).
- `saveItems` and the v1→v2 upgrade path do not derive new keys (they reuse
  the unlocked `vaultKey` and rotate `aesKey` only); the previous `aesKey`
  is replaced by `activeAesKey` at the end of the function.
- `rotateAuth` zeroizes both the old `vaultKey` and the old `aesKey`
  before swapping in the new pair (lines 990-991).
- `syncNow` zeroizes `remoteAesKey` in the catch branch and zeroizes the
  previous `aesKey` if a different one was promoted (lines 280-282, 290).
- `lockSession` zeroizes everything and clears module-local state.

OPAQUE export keys are caller-owned (the module documents this in
`opaque-client.ts:75-85`). Every caller currently zeroizes them:

- [src/routes/unlock/+page.svelte](../src/routes/unlock/+page.svelte) lines
  229, 235 — `opaqueExportKey?.fill(0)` in both the happy and failure paths.
- [src/routes/onboarding/_steps/StepProvision.svelte](../src/routes/onboarding/_steps/StepProvision.svelte)
  lines 252, 271 — same in both register and login flows.

`argon2.ts` does not need zeroize because every output is a fresh `Uint8Array`
that the caller owns; same applies to `derive.ts`.

### F7. Inline `<script>` nonce / CSP coverage

**Status:** out of scope for this pass, deferred.

The only inline script is the FOUC-prevention block in
[src/app.html](../src/app.html), which SvelteKit hash-pins for prerendered
pages and nonce-injects for SSR pages. Vite's dev server still serves the
script without a nonce in some routes, which the existing
[tests/e2e/mobile-responsive.spec.ts](../tests/e2e/mobile-responsive.spec.ts)
already handles by stripping the CSP header for E2E. No new findings.

## Deferred opportunities (carried forward)

- **Strip unused NIST OPAQUE suites** — `@structured-id/opaque` statically
  imports `p256/p384/p521` from `@noble/curves/nist.js`. The library
  destructures the named imports at module init, so a naive Rollup `replace`
  to `undefined` breaks the suite registry. A safe upstream fix is a
  `/*#__PURE__*/` annotation in `@structured-id/opaque`'s exports; this is
  worth a tracked upstream issue rather than a fragile patch.
- **Service-worker for offline-first** — VuVault is local-first by design
  but does not yet ship a service worker for asset caching. Tier 2 PWA
  story.
- **`<details>`-style overflow on `StepSecret`** — the audit suggested
  collapsing the "Regenerate" / "Download Emergency Kit" actions into a
  `<details>` summary on xs. The current pass raised the action-button tap
  heights and added safe-area padding; the `<details>` collapse is a UX
  decision deferred to a designer review.

## Closing assessment

The Phase 6 sweep surfaced fewer real issues than the original audit feared.
The crypto path is unusually clean (zero silent catches, four required
type bridges, every zeroize centralized), and the previously brittle
Svelte 5 effect-loop sites were already fixed during the M3 production
readiness work. The biggest concrete win from this phase is the new
`sync-client.test.ts` contract, which closes the only meaningful unit-test
gap in the M3 path.
