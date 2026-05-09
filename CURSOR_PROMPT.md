# Cursor Handoff Prompt — VuVault SvelteKit Implementation

> **Read this entire document before opening Composer mode.** The single largest source of regression is "AI tool drift" — pattern-matching to generic SvelteKit conventions instead of the specific patterns this codebase is built around. The verification checklists in this document exist to catch that drift.

---

## Your role

You are continuing implementation of **VuVault**, a zero-knowledge password manager and document vault. The architectural scaffold is complete (see `README.md`). Your job is to take what's there and finish it out — converting prototypes into production Svelte components, wiring real crypto into the stubs, and shipping the Tier 1 launch surface.

The four canonical visual sources of truth are in `docs/prototypes/`:

| Prototype | Conversion target |
| --- | --- |
| `desktop.html` (102 KB) | `src/routes/vault/` (already partially scaffolded) |
| `landing.html` (141 KB · 11 panels) | `src/routes/+page.svelte` + `src/routes/(landing)/_panels/*` |
| `blueprint.html` (86 KB) | `src/routes/blueprint/+page.svelte` (already scaffolded; visual parity with prototype) |
| `onboarding.html` (89 KB · 7 steps) | `src/routes/onboarding/` (already scaffolded; visual parity with prototype) |

These HTML files are the spec. If something in this prompt and the prototype disagree, the prototype wins. Period.

---

## Hard invariants — never violate these

These are non-negotiable. A pull request that breaks any of them does not land.

### 1. Pricing is `$25.60/year`. Never `$2.56`. Never anything rounded.

The number `25.60` appears as `256 bits × $0.10 = honest math` in narrative copy. Both the dollar amount and the bit-math line must remain intact. Search the codebase for `2.56` before submitting and prove zero matches.

### 2. The Cardinal Rule: no page-level scrolling.

`html, body { overflow: hidden; }` is set in `src/lib/styles/globals.css`. Every screen fits in `100dvh`. If content overflows, you build a swipe-pager, a pinned header/footer with internal scroll, or you cut content. You **do not** unset `overflow: hidden`.

### 3. Two themes. `[data-theme]` only.

Theme switching is achieved by setting `document.documentElement.setAttribute('data-theme', '<modern|brutalist>')`. There is **no** JavaScript style branching in components. CSS does the work via `[data-theme=modern] { --foo: ... }` and `[data-theme=brutalist] { --foo: ... }` blocks in `tokens-modern.css` and `tokens-brutalist.css`. If you find yourself writing `if (theme.current === 'modern') ...` to set a color, you've made a mistake.

### 4. No hex literals in `.svelte` files.

All colors come from CSS custom properties: `var(--bg)`, `var(--accent)`, etc. To derive a color, use `color-mix(in srgb, var(--accent) 30%, transparent)`. Never `#00d4ff` or `rgba(0, 212, 255, 0.3)` directly inside a Svelte component's `<style>` block. The exception: the SVG mocks inside the prototype HTML files use hex; when you port those into Svelte components, replace the hex literals with token references where the colors map to design tokens, and keep the originals only for SVG elements that represent realistic content (e.g., a Visa card gradient that's specifically branded).

### 5. No emojis. Anywhere. Use flat SVG icons.

The 24-icon library is in `src/lib/icons/`. If you need an icon that isn't in the library, add it as a new component matching the existing pattern (`stroke="currentColor"`, configurable size and stroke width, optional title for a11y). Do not import an icon library — match what's already there.

### 6. No new runtime dependencies without explicit approval.

The dependency list in `package.json` is intentional and minimal. `@noble/*` for crypto, `dexie` for IndexedDB, `yjs` for future CRDT, that's it. If you need to add a runtime dep, leave a `// REVIEW:` comment explaining why and pause.

### 7. No telemetry. No analytics. No "anonymized usage data."

Don't add it. Don't suggest it. The product's competitive advantage is genuine architectural privacy. Eroding that is a fatal product mistake regardless of how the metric is framed.

### 8. Svelte 5 runes mode only.

`$state`, `$derived`, `$props`, `$effect`. No legacy `let`/`reactive`. No `<svelte:options runes={true}>` (it's set in `svelte.config.js`'s `compilerOptions`).

### 9. No page-level scrolling, no per-route theme overrides, no JS-set colors.

If a route needs to feel different visually, it does so by composing token references differently — never by overriding tokens or setting colors via JavaScript.

### 10. Bundle hash is real and visible.

`PUBLIC_BUNDLE_HASH` in `wrangler.toml` is a placeholder for now (`9f4c7d2e8b16a4f122e0d5c83a7e91b4`). When you wire up the production build pipeline, this becomes the actual SHA-384 of the published bundle, computed in CI and recorded to a Sigstore Rekor entry. Until then, leave the placeholder visible — the audit logic should treat it as a real fingerprint.

---

## What's already built (don't rebuild it)

```
src/
├── app.html                                 ✅ FOUC-prevention inline script
├── app.css                                  ✅ Imports the three style modules
├── app.d.ts                                 ✅ Cloudflare Platform types
│
├── lib/styles/
│   ├── tokens-modern.css                    ✅ Full VU-MODERN token set
│   ├── tokens-brutalist.css                 ✅ Full VU-BRUTALIST parity set
│   └── globals.css                          ✅ Cardinal Rule enforced
│
├── lib/crypto/
│   ├── secret-key.ts                        ✅ 256-bit gen + Base32-Crockford
│   ├── webauthn-prf.ts                      ✅ registerPasskey + evaluatePRF
│   ├── envelope.ts                          ✅ Hybrid X25519 + ML-KEM-1024 (FIPS 203, KAT-locked)
│   ├── derive.ts                            ✅ HKDF-SHA512 vault key
│   ├── totp.ts                              ✅ RFC 6238
│   └── passgen.ts                           ✅ Rejection-sampling CSPRNG
│
├── lib/stores/
│   ├── theme.svelte.ts                      ✅ [data-theme] runtime API
│   ├── audit.svelte.ts                      ✅ Append-only feed (50 cap)
│   ├── vault.svelte.ts                      ✅ Item types + lock() zeroize
│   └── onboarding.svelte.ts                 ✅ 7-step state machine
│
├── lib/components/
│   ├── Button.svelte                        ✅ 4 variants × 3 sizes
│   ├── BrandMark.svelte                     ✅ V-mark + wordmark + pill
│   ├── Eyebrow.svelte                       ✅ With accent variant
│   ├── Stepper.svelte                       ✅ Numbered horizontal
│   ├── ThemeToggle.svelte                   ✅ Modern·Brutalist
│   ├── AuditFooter.svelte                   ✅ 3-column persistent footer
│   ├── Card.svelte                          ✅ default/elevated/accent
│   ├── Pager.svelte                         ✅ Side-rail dots
│   └── TechDrawer.svelte                    ✅ Collapsible "tech detail" panel
│
├── lib/icons/                               ✅ 24 components + barrel
└── lib/utils/
    ├── storage.ts                           ✅ Dexie schema v2 (v1 vaults transparently upgraded)
    └── env.ts                               ✅ PUBLIC_BUNDLE_HASH

routes/
├── +layout.{ts,svelte}                      ✅ Imports app.css
├── +page.svelte                             ⚠️ Placeholder — full landing pending
├── onboarding/
│   ├── +page.{ts,svelte}                    ✅ State-machine page
│   └── _steps/{Welcome,Identity,Secret,Touch,Verify,Pricing,Provision}.svelte
│                                            ✅ All seven step screens
├── vault/
│   ├── +page.{ts,svelte}                    ✅ 3-pane layout with demo data
│   ├── VaultSidebar.svelte                  ✅ Categories + Health
│   ├── VaultList.svelte                     ✅ Search + items
│   └── VaultDetail.svelte                   ✅ Reveal/copy/auto-hide + TOTP
└── blueprint/
    └── +page.svelte                         ✅ 18 layers × 4 tiers
```

---

## What's pending — the build queue

### P0 — Required for first internal demo

#### P0.1 Convert the 11-panel landing page

**Source**: `docs/prototypes/landing.html` (140 KB, 11 viewport-locked panels)
**Target**: Replace the current `src/routes/+page.svelte` placeholder with a route group `(landing)` containing:

```
src/routes/(landing)/
├── +page.svelte                            ← Pager logic, T-key audience toggle, IntersectionObserver
└── _panels/
    ├── Hero.svelte
    ├── Problem.svelte
    ├── Promise.svelte
    ├── Vault.svelte                        ← Tilted desktop preview SVG
    ├── Mobile.svelte                       ← Tilted iPhone preview SVG
    ├── Documents.svelte                    ← Tilted iPad with PDF preview SVG
    ├── Stack.svelte
    ├── Compare.svelte
    ├── Pricing.svelte
    ├── Trust.svelte
    └── Final.svelte
```

Each panel takes 100dvh. Pager dots are fixed right-rail. The audience toggle is bound to the `T` key; it switches `data-show="user"` → `data-show="tech"` mode and morphs all dual-audience copy. Add `src/lib/stores/audience.svelte.ts` for this.

Keyboard nav: `J`/`ArrowDown`/`PageDown` advance, `K`/`ArrowUp`/`PageUp` retreat. Use `Element.scrollIntoView({ behavior: 'smooth', block: 'start' })`.

The pricing panel and final CTAs must show **`$25.60/year`** with the bit-math line. The dual-audience copy lives in the prototype — port it verbatim.

#### P0.2 Wire the vault to real persistence

**Source**: `docs/prototypes/desktop.html` (the vault interior is already shaped) plus the existing `vault.svelte.ts` store.

Right now `src/routes/vault/+page.svelte` calls `vault.add(...)` with demo data on mount. Replace this with:

1. On vault route load: read `account` and `vault` rows from Dexie via `src/lib/utils/storage.ts`.
2. If no account exists → redirect to `/onboarding`.
3. If account exists → `evaluatePRF()` against the stored `credentialId`, derive the vault key via `deriveVaultKey()`, decrypt the vault blob via `envelope.open()`, hydrate `vault.items`.
4. On any item mutation: re-encrypt the vault blob and write it back to Dexie.
5. Implement a real lock UX: `vault.lock()` runs, and the user is redirected to a re-unlock screen (not back to landing). The re-unlock screen is a new route `src/routes/unlock/+page.svelte`.

#### P0.3 Item add/edit modal

The current `addItem` in the vault top bar is a stub that calls `vault.add` with placeholder data. Build a modal:

- File: `src/routes/vault/ItemEditor.svelte`
- Trigger: the `+ Add` button in the top bar opens it; clicking on an existing item's "Edit" action opens it pre-filled
- Form fields adapt based on `kind` (login vs card vs document vs note vs identity vs ssh vs crypto-seed)
- Use the existing `Button.svelte`, `Card.svelte`, and form-field patterns from `_steps/StepIdentity.svelte`
- Generator integration: for password fields, a "Generate" button opens `src/routes/vault/GeneratorPanel.svelte` (also new) which uses `passgen.ts` and shows a live entropy meter

#### P0.4 ⌘K command palette

- File: `src/routes/vault/CommandK.svelte`
- Triggered by `Cmd/Ctrl+K` from anywhere in the vault
- Search across items by title/url/username
- Quick actions: "Copy username", "Copy password", "Copy TOTP", "Reveal item", "Lock vault"
- Style: centered modal, glass surface, kbd-style item rows

### P1 — Required for public release

#### P1.1 L03 ML-KEM-1024 component — *shipped in M2*

`src/lib/crypto/envelope.ts` ships the full hybrid X25519 + ML-KEM-1024 KEM via `@noble/post-quantum`. CI runs `npm run test:fips` against curated FIPS 203 KAT vectors at `src/lib/crypto/kat/ml-kem-1024.json` so a silent change to keygen/encapsulate output bytes fails the pipeline loudly. See `src/lib/services/vault-envelope.ts` for the per-vault wrap/unwrap that builds on top of `envelope.ts`, and `src/lib/services/vault-session.ts` for the v1→v2 transparent migration.

#### P1.2 OPAQUE client (RFC 9807)

Implement client-side OPAQUE registration and login, talking to a Cloudflare Worker that holds the OPAQUE record in D1. The Worker code goes in a new `functions/` directory (Cloudflare Pages Functions). Reference: a vetted JS library; otherwise compose from `@noble/curves` + `@noble/hashes`.

#### P1.3 Bundle integrity check at unlock

Compute the SHA-384 of the running bundle via `crypto.subtle.digest()` over `import.meta.url` chunks (or via a build-time embedded manifest). Compare against `PUBLIC_BUNDLE_HASH`. If they differ, refuse to unlock and show a forensic warning screen. Reference Sigstore Rekor at `https://search.sigstore.dev/?hash=...`.

#### P1.4 Health categories — Weak / Reused

The `VaultSidebar.svelte` "Health" section currently shows zero counts. Compute these:

- **Weak**: items where `entropyBits(item.password) < 60` per a zxcvbn-style estimator (or import `zxcvbn-ts` if approved)
- **Reused**: items where the SHA-384 hash of the password matches another item's

Display in the sidebar with red dots for items above threshold counts.

### P2 — Quality and operational readiness

#### P2.1 Test suite

- `vitest` unit tests for every crypto module (test vectors required for AES-GCM, HKDF, X25519, ML-KEM, TOTP)
- `playwright` e2e for the onboarding happy path
- Visual regression tests against the four prototype HTMLs as ground truth (compare side-by-side at 1440×900 and 390×844)

#### P2.2 CI/CD

- GitHub Action: lint + check + test on PR
- GitHub Action: reproducible build verification on tag — produces SHA-384 manifest, signs with Sigstore, publishes to Rekor
- Wrangler deploy on merge to main → preview environment; tag → production

#### P2.3 Accessibility

- All interactive elements keyboard-navigable
- Focus rings using `:focus-visible` (already set up in `globals.css`)
- ARIA labels on icon-only buttons (already done in scaffolded components — match the pattern)
- Run axe-core in CI

---

## Anti-patterns — do not do

These represent ways AI tools commonly drift from this codebase's conventions. Pre-empting them is the single highest-leverage thing this prompt does.

| ❌ Anti-pattern | ✅ Correct |
| --- | --- |
| `<style>div { color: #00d4ff; }</style>` in a Svelte file | `color: var(--accent);` |
| `class="text-blue-400 bg-gray-800"` (Tailwind translation) | Use the token system; Tailwind utilities are secondary |
| `if (theme === 'modern') { color = '#fff' } else { color = '#000' }` | Set CSS var; let `[data-theme]` resolve it |
| Adding `<svelte:options runes={true} />` | Already global via `svelte.config.js` |
| `let count = 0; $: doubled = count * 2;` (Svelte 4 reactivity) | `let count = $state(0); let doubled = $derived(count * 2);` |
| Importing from `lucide-react`, `lucide`, `heroicons`, etc. | Use `$lib/icons` |
| Using emojis in copy (👋, 🔒, ⚡) | Use flat SVG icons |
| `body { overflow: auto; }` to "fix" content overflow | Build a pager or pin internal scroll regions |
| Adding a new color hex anywhere | Add a token to `tokens-modern.css` AND `tokens-brutalist.css` first, then reference it |
| Using `console.log` in production paths | Use `audit.push('info', '...')` for user-visible operations |
| Renaming `$2.56` to a different price by mistake | The price is `$25.60/year`. Period. |
| Adding `localStorage.setItem('analytics_id', ...)` | NO. Telemetry is a hard-no. |
| Wrapping the body in a scroll container in onboarding | Onboarding screens are 100dvh-1px each; if content overflows, restructure into a sub-step |
| Importing a fresh CSS-in-JS library | The token system is the styling pattern |
| Replacing `Instrument Sans` with `Inter` | Typography is part of the design system. Don't substitute. |

---

## Verification checklist — run all of these before submitting

### Behavior

- [ ] `npm run dev` starts without errors at `localhost:5173`
- [ ] `npm run build` succeeds
- [ ] `npm run check` reports zero TypeScript errors
- [ ] `npm run lint` passes
- [ ] Landing page (`/`) renders all 11 panels, pager-dot navigation works, T-key toggles audience, J/K keyboard advances
- [ ] Onboarding (`/onboarding`) walks through all 7 steps, real WebAuthn registration succeeds (or simulation fallback if unsupported), Secret Key downloads as `.vukey` and as Emergency Kit `.txt`
- [ ] Vault (`/vault`) shows 3-pane layout, sidebar selection filters list, list selection populates detail, password reveal auto-hides after 30 seconds
- [ ] Blueprint (`/blueprint`) renders 18 layers across 4 tiers with risk meters

### Privacy

- [ ] `grep -r "fetch\|XMLHttpRequest\|navigator.sendBeacon" src/` returns only Cloudflare Worker calls (or zero, until OPAQUE wiring lands)
- [ ] `grep -r "analytics\|telemetry\|tracking\|gtag" src/` returns zero matches
- [ ] No third-party script tags in `app.html`
- [ ] CSP headers in `svelte.config.js` are tight (default-src 'self'; no unsafe-eval; no unsafe-inline except style)
- [ ] Bundle inspection: no IPs, no domains other than `vault.vu`, no embedded API keys

### Theme parity

- [ ] Every screen renders correctly in both `[data-theme=modern]` and `[data-theme=brutalist]`
- [ ] Theme toggle switches without page reload, no FOUC, no JS errors
- [ ] Visual diff vs prototype: ≤ 5 px deviation at 1440×900 viewport
- [ ] No `#hex` literals introduced in any `.svelte` file (`grep -rn "#[0-9a-fA-F]\{3,6\}" src/**/*.svelte` should be empty or only show SVG content)

### Responsive

- [ ] Landing renders on mobile (390×844) — vault, mobile, and documents preview panels stack vertically below 1100px
- [ ] Onboarding renders on mobile — stepper collapses to compact mode, step content fits 100dvh
- [ ] Vault on mobile (≤720px): single-pane mode with bottom-tab navigation between sidebar/list/detail
- [ ] No horizontal scrollbar at any viewport ≥ 320px

### Accessibility

- [ ] Tab order is logical on every screen
- [ ] All interactive elements have visible focus rings (verified manually)
- [ ] All icon-only buttons have `aria-label`
- [ ] Color contrast ≥ WCAG AA in both themes (run a contrast checker)
- [ ] `prefers-reduced-motion` honored — entropy meter, scanning ring, page transitions all degrade gracefully

### Code quality

- [ ] No `any` types in TypeScript files
- [ ] No `// @ts-ignore` or `// @ts-nocheck` comments
- [ ] All Svelte files use `<script lang="ts">`
- [ ] No legacy Svelte 4 reactivity syntax
- [ ] Stores follow the `class FooState { ... } export const foo = new FooState();` pattern
- [ ] Crypto modules have NIST or RFC test vectors in companion `*.test.ts` files

### Build / deploy

- [ ] `wrangler.toml` has correct `compatibility_date` (≥ `2026-04-01`)
- [ ] `npm run deploy` succeeds against a Cloudflare Pages preview
- [ ] Bundle size of the main entry chunk is < 200 KB gzipped
- [ ] Crypto chunk loads on-demand (lazy import in onboarding/vault routes)

---

## How to read the prototypes

The HTML prototypes in `docs/prototypes/` are self-contained — each one has its own `<style>` block with all CSS, all SVG mocks inline, all interaction handlers in a `<script>` block at the bottom. They were built to be ground-truth visual references, not modular code.

When converting:

1. **Don't try to preserve the JS interaction code verbatim.** It uses vanilla DOM APIs and is structured for prototype iteration speed, not maintenance. The Svelte version uses runes and the established stores.

2. **Do preserve every visual detail.** Pixel-level fidelity is the goal: the same shadows, the same radii, the same letter-spacing, the same animation timings.

3. **CSS variable substitution.** Where the prototype writes `color: #00d4ff`, your component writes `color: var(--accent)`. Where the prototype writes `background: rgba(255,255,255,0.04)`, your component writes `background: var(--surface)`. Use this table: see `docs/VU-MODERN-DESIGN.md` for the full mapping.

4. **SVG content.** When a prototype includes a complex SVG (the credit card mockup, the iPhone screen, the iPad with PDF), copy the SVG verbatim into the Svelte component as-is. SVGs that represent realistic content can keep their hex values — they're depicting things that have specific real-world colors.

5. **Embedded fonts.** The prototypes use Google Fonts via `<link>` in `<head>`. The scaffold already handles this in `app.html` — don't re-link.

---

## Definition of done

This codebase is "Tier 1 ready" when:

- All P0 items in the build queue are checked off
- All P1 items are at minimum prototyped end-to-end
- The verification checklist passes in full
- Third-party crypto audit signed off
- Bundle hash matches a published Sigstore Rekor entry
- Three external testers can complete the full onboarding → vault → add item → lock → unlock cycle without assistance

When you reach that bar, tag `v0.1.0`, run `npm run deploy`, and the world gets to verify what we shipped.

---

## When in doubt

The hierarchy of authority, in order:

1. **The prototype HTML in `docs/prototypes/`** — visual ground truth
2. **The hard invariants** in this document — never violated
3. **`docs/VU-MODERN-DESIGN.md` and `docs/VU-BRUTALIST-DESIGN.md`** — token reference
4. **The existing scaffolded code** — pattern reference for new code
5. **`docs/ARCHITECTURE.md` and `docs/SECURITY.md`** — technical justification
6. **Common SvelteKit conventions** — only if none of the above apply

If you're about to do something that contradicts (1)–(4), pause and re-read this prompt. If you've done it three times and it still seems right, leave a `// REVIEW:` comment with your reasoning and let a human break the tie.

— end of handoff —
