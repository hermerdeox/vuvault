# Performance Baseline

> Captured at the end of the Roadmap Audit + Perf + Mobile-First Overhaul pass.
> All sizes uncompressed (Cloudflare Pages serves brotli/gzip; over-the-wire is
> typically ~30-35% of these figures). Run `npm run build` and re-capture to
> refresh.

## Route node boot scripts (`_app/immutable/nodes/`)

These are the per-route JavaScript entry files. Smaller = the route boots
faster because Svelte less has to parse before first paint.

| Node | Route | Size |
| --- | --- | ---: |
| `7.*.js` | `/vault` shell | **83 bytes** (was 83 KB before lazy-load) |
| `0.*.js` | root layout | 642 bytes |
| `1.*.js` | layout placeholder | 516 bytes |
| `5.*.js` | `/recover` | 8.9 KB |
| `3.*.js` | `/blueprint` | 9.0 KB |
| `6.*.js` | `/unlock` | 12.5 KB |
| `4.*.js` | `/onboarding` | 41.3 KB |
| `2.*.js` | `/` landing | **54.6 KB** (was 94 KB before SVG extraction) |

## Top chunks (`_app/immutable/chunks/`)

| Chunk | Approx contents | Size |
| --- | --- | ---: |
| `vendor-noble-pq.*` | `@noble/post-quantum` (ML-KEM-1024) — pinned chunk | ~96 KB |
| `vendor-noble-core.*` | `@noble/curves` + `@noble/hashes` — pinned chunk | ~82 KB |
| `vendor-noble-ciphers.*` | `@noble/ciphers` (AES-256-GCM) — pinned chunk | ~44 KB |
| `vendor-opaque.*` | `@structured-id/opaque` JS shim — pinned chunk | ~33 KB |
| `vendor-dexie.*` | `dexie` — pinned chunk | ~29 KB |
| Other (Svelte runtime, router, icons, helpers) | mixed | ~5-26 KB each |

Pinning these vendor chunks via `vite.config.ts` `manualChunks` keeps
returning visitors from re-downloading the crypto stack when only a Svelte
component changes.

## Static assets

### Fonts (`/fonts/*.woff2`)

| Family | Subset | Size |
| --- | --- | ---: |
| Instrument Sans | latin | 29.9 KB |
| Instrument Sans | latin-ext | 11.1 KB |
| Instrument Serif | latin | 15.0 KB |
| Instrument Serif | latin (italic) | 15.7 KB |
| Instrument Serif | latin-ext | 7.8 KB |
| Instrument Serif | latin-ext (italic) | 8.4 KB |
| JetBrains Mono | latin | 31.3 KB |
| **Total** | | **119.3 KB** |

(Five JetBrains Mono non-Latin subsets — Cyrillic, Cyrillic-ext, Greek,
Vietnamese, Latin-ext — were removed during the overhaul. ~35 KB reclaimed.)

The two Latin font URLs preloaded from `src/app.html`:

- `/fonts/instrument-sans-31fe1ea2.woff2`
- `/fonts/instrument-serif-51cc973f.woff2`

### Landing device-mock SVGs (`/landing/*.svg`)

| File | Size |
| --- | ---: |
| `documents-mock.svg` | 18.2 KB |
| `vault-mock.svg` | 13.5 KB |
| `mobile-mock.svg` | 8.2 KB |
| **Total** | **39.9 KB** |

Each loads with `<img loading="lazy" decoding="async">` from the matching
panel component, off the critical path until the user scrolls into view.

## Per-route initial JS download (cold cache)

Computed as the route node script + the chunks it pulls in directly. Each
route also shares the SvelteKit runtime, root layout, and Svelte runtime
chunks (~30 KB combined) so subtract those for a delta-on-second-route view.

| Route | Direct payload (uncompressed) | Notes |
| --- | ---: | --- |
| `/` landing | ~150 KB | No Dexie, no Noble crypto. Three device-mock SVGs are `<img>` lazy. |
| `/blueprint` | ~80 KB | Pure presentation. |
| `/unlock` | ~135 KB | **Was ~285 KB.** Noble curves + ML-KEM-1024 + OPAQUE + Argon2id WASM (~155 KB JS + 143 KB WASM) deferred to the click handler. |
| `/onboarding` | ~190 KB | Same lazy-load story as `/unlock` for the heavy crypto step. |
| `/recover` | ~280 KB | Imports vault-session synchronously to drive the wipe-and-restart flow. |
| `/vault` | ~245 KB | Vault overlays (ItemEditor, CommandK, MasterPasswordSettings, QuickGenerator) lazy-load on first open. Lite cold-cache cost is now ~83 bytes for the node entry. |

## Targets we enforce (release-gate level)

1. **Reproducible builds** — two-pass `npm run build` produces a byte-identical
   `.bundle-digest` for any commit. CI fails the merge if not.
2. **Per-chunk SHA-384 manifest** — every chunk hash is signed in
   `_app/immutable/bundle-manifest.json`. The unlock screen verifies them in
   parallel before opening the vault.
3. **Production sourcemap** — set to `'hidden'`. Sourcemap files exist on
   disk for `npm run deploy` users who want to inspect them, but the browser
   never downloads them (no trailing `//# sourceMappingURL=...`).
4. **Manual chunk pins** — `vendor-noble-pq`, `vendor-noble-core`,
   `vendor-noble-ciphers`, `vendor-opaque`, `vendor-dexie` each occupy their
   own chunk. Stable cache hashes across Svelte-only releases.
5. **Touch-target floor** — every primary interactive element (`.ico-btn`,
   `.add-btn`, `.lock-btn`, `.overflow-trigger`, `.head-btn`, `.row`,
   `.chip`, `.action`, `.toggle`, Modal `.close`, `Button.sm`) hits 44×44
   CSS px on `[data-vp~='mobile']` / `[data-vp~='tablet']`. WCAG 2.5.5.
6. **Safe-area insets** — every fixed chrome bar (`landing/TopBar`,
   `onboarding/.header`, `unlock/.topbar`, `blueprint/.topbar`,
   `recover/.topbar`) honors `env(safe-area-inset-top/left/right)`. The
   AuditFooter, Final-panel foot, and QuickGenerator popover all honor
   `env(safe-area-inset-bottom)`.
7. **Backdrop-filter caps on mobile** — `.topbar`, `.footer`, `.vu-bar`,
   `.mobile-tabs`, `.palette`, `.status-pill` clip to 8 px. Card surfaces
   (`.stat-card`, `.promise-card`, `.stack-step`, `.price-card`,
   `.trust-card`, `.mobile-feature`, `.compare-wrap`) drop the backdrop
   filter entirely. (Defined globally in
   [src/lib/styles/globals.css](../src/lib/styles/globals.css).)
8. **Lighthouse / TTI targets** — no automated gate yet (Tier 2 follow-up).
   Manual baseline as of this pass:
   - Landing on Moto G4 (slow 4G): LCP ≈ 1.4 s.
   - `/unlock` on Moto G4 (slow 4G): TTI ≈ 1.1 s (was ≈ 2.3 s pre-overhaul).
   - `/vault` on Moto G4 (slow 4G): TTI ≈ 1.6 s (was ≈ 2.5 s pre-overhaul).

## Bundle aggregate

Latest build (`May 11, 2026`):

```
build-manifest: hashed 125 files
aggregate SHA-384 = 68ed1a459119daa77fd0e1dd7d2dde2e57ba8c35114f7008a401e7f4a896d2eedfcb4bdb674b86de6d5e60dc23318e8f
```

The release workflow signs this aggregate with cosign (Sigstore Fulcio) and
publishes a Rekor entry. Users compare the unlock-screen short hash against
the Rekor URL out-of-band.
