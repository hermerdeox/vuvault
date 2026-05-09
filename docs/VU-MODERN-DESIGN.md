# VU-MODERN Design Reference

> **Authoritative.** Do not modify during implementation passes. The token names and values here are the contract that components rely on.

VU-MODERN is one of two parity-equal themes in the VuVault design system. The other is VU-BRUTALIST. Both share token *names*; they differ only in token *values*. Theme switching is achieved by setting the `[data-theme]` attribute on `documentElement` — there is no JavaScript style branching anywhere.

---

## Mood

Dark glass · cyan accent · long shadows · soft gradients · backdrop blur. The visual language of late-night terminal work, premium hardware, and high-end espionage cinema.

Think: 2024-era SpaceX mission control + Bridgerton's "after-hours library" set + a Bang & Olufsen turntable.

---

## Palette

### Surfaces (deepest to lightest)

```
--bg              #000000               True black canvas
--bg-elev         #0a0a0a               Elevated panels
--paper           #050505               Document/PDF backgrounds
--surface         rgba(255,255,255,0.04)   Subtle hover surface
--surface-hover   rgba(255,255,255,0.07)   Active surface
--surface-strong  rgba(245,245,240,0.08)   Brand-warm surface accent
```

### Lines & strokes

```
--border          rgba(255,255,255,0.08)  Default 1px line
--border-mid      rgba(255,255,255,0.14)  Hover state
--border-strong   rgba(255,255,255,0.22)  Active/focused
--line            rgba(0,212,255,0.18)    Accent-tinted dividers
--line-strong     rgba(0,212,255,0.45)    Emphasis dividers
--line-dim        rgba(0,212,255,0.08)    Whisper dividers
--grid-color      rgba(0,212,255,0.045)   Background grid texture
```

### Text

```
--text            #ffffff   Primary
--text-2          #a8a8a8   Secondary
--text-3          #666666   Tertiary / hints
--text-4          #404040   Disabled / placeholder
```

### Brand & accent

```
--brand           #f5f5f0   Off-white V-mark fill
--accent          #00d4ff   Cyan — exactly seven uses per page maximum
--accent-dim      rgba(0,212,255,0.16)   Hover background
--accent-faint    rgba(0,212,255,0.06)   Subtle wash
```

### Semantic

```
--success         #22c55e
--success-dim     rgba(34,197,94,0.14)
--warn            #ffa500
--warn-dim        rgba(255,165,0,0.14)
--danger          #ef4444
--danger-dim      rgba(239,68,68,0.14)
```

### Shadows

```
--shadow-glow   0 0 60px rgba(0,212,255,0.2)         Reserved: max ONE per screen
--shadow-card   0 24px 60px rgba(0,0,0,0.6)
--shadow-modal  0 30px 80px rgba(0,0,0,0.7)
```

---

## Typography

```
--font-sans       'Instrument Sans', system-ui sans-serif
--font-serif      'Instrument Serif', Georgia, serif (italic only — never roman)
--font-mono       'JetBrains Mono', SF Mono, Menlo, monospace
```

### Type scale

- Display (hero):  `clamp(48px, 7vw, 88px)` · weight 700 · letter-spacing -0.04em · line-height 0.95
- Section title:   `clamp(36px, 5vw, 56px)` · weight 700 · letter-spacing -0.035em · line-height 1
- Card title:      18px–22px · weight 600 · letter-spacing -0.02em
- Body:            15px · weight 400 · letter-spacing -0.005em · line-height 1.5
- Lede:            17px · color `var(--text-2)` · line-height 1.55
- Mono caption:    11px · `var(--font-mono)` · letter-spacing 0
- Eyebrow:         11px · weight 600 · uppercase · letter-spacing 0.04em

### Italic serif idiom

Italic serif (`Instrument Serif`) appears only as a punctuation note — emphatic, fragile, lyrical. Always inline within a sans heading. Never as a standalone block.

✅ Yes: `Untouchable. <em>By construction.</em>`
❌ No: A whole paragraph of italic serif body text.

---

## Shape

```
--radius-xs   4px
--radius-sm   6px
--radius     10px      (default)
--radius-lg  14px      (cards)
--radius-xl  20px      (modals, primary surfaces)
```

---

## Motion

```
--transition       220ms cubic-bezier(0.2, 0.8, 0.2, 1)
--transition-slow  600ms cubic-bezier(0.2, 0.8, 0.2, 1)
```

Never use linear easing. Always honor `prefers-reduced-motion: reduce` (handled in `globals.css`).

---

## Layout invariants

- `--header-h: 64px` — top bar height
- `--footer-h: 56px` — audit footer height (always present in authenticated routes)
- Body sets `overflow: hidden` — **the Cardinal Rule: no page-level scroll, ever**
- `100dvh` everywhere (iOS Safari dynamic viewport)
- Safe-area insets tokenized as `--safe-{top,bottom,left,right}`

---

## Anti-patterns (do not do)

- ❌ Hex color literals in `.svelte` files. Always reference a CSS variable or use `color-mix()` to derive.
- ❌ Tailwind classes that translate VU tokens. The tokens are the source of truth; Tailwind utilities are secondary.
- ❌ Emojis. Anywhere. Use flat SVG icons from `src/lib/icons/`.
- ❌ More than one `--shadow-glow` per screen. The accent is precious; spend it once.
- ❌ Rounded corners > `--radius-xl`. We are not making toy app icons.
- ❌ Drop shadows that imply depth without earning it. If a card doesn't elevate above paper, it doesn't need a shadow.
- ❌ Text content that scrolls past the viewport. Use the swipe pager pattern instead.
- ❌ Heading + body in the same color. Always step the hierarchy.

---

## Required components in every screen

- Persistent header (64px) with brand mark and theme toggle on auth'd routes
- Persistent footer (56px) with audit feed (`AuditFooter.svelte`)
- One — and only one — primary action per viewport
