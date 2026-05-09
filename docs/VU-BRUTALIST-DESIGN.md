# VU-BRUTALIST Design Reference

> **Authoritative.** Do not modify during implementation passes.

VU-BRUTALIST is the parity-equal counterpart to VU-MODERN. Same token names. Different values. Switched via `[data-theme="brutalist"]` on `documentElement`.

VU-BRUTALIST is **not** "light mode." It is a deliberately different aesthetic philosophy — Swiss design as filtered through 1970s technical manuals and brutalist architecture.

---

## Mood

Stark white paper · ink black · drop shadows that don't blur · hard 90° corners except where shape demands soft · monospace as primary readable type · ledger-paper grid texture.

Think: a NASA technical drawing + a hand-set Helvetica poster + a Möbius strip on display in the lobby of the New Museum.

---

## Palette

### Surfaces (deepest to lightest)

```
--bg              #f5f5f0               Cream paper
--bg-elev         #ffffff               Pure white panels
--paper           #ffffff               Document/PDF backgrounds
--surface         rgba(0,0,0,0.04)      Subtle hover surface
--surface-hover   rgba(0,0,0,0.07)      Active surface
--surface-strong  rgba(10,10,10,0.08)
```

### Lines & strokes

```
--border          rgba(10,10,10,0.14)
--border-mid      rgba(10,10,10,0.22)
--border-strong   rgba(10,10,10,0.45)
--line            rgba(10,10,10,0.45)   Default lines are STRONG in brutalist
--line-strong     rgba(10,10,10,0.9)
--line-dim        rgba(10,10,10,0.18)
--grid-color      rgba(10,10,10,0.06)
```

### Text

```
--text            #0a0a0a   Primary — ink black
--text-2          #404040   Secondary
--text-3          #707070   Tertiary
--text-4          #a8a8a8   Disabled / placeholder
```

### Brand & accent

```
--brand           #0a0a0a   Black V-mark
--accent          #0a0a0a   In brutalist, ACCENT IS BLACK — not cyan
--accent-dim      rgba(10,10,10,0.08)
--accent-faint    rgba(10,10,10,0.04)
```

This is the most important inversion: in VU-MODERN the accent is cyan; in VU-BRUTALIST it is black. The token name stays the same; the role stays the same (the most-emphatic call); the value flips.

### Semantic (less saturated for paper)

```
--success         #166534
--success-dim     rgba(22,101,52,0.12)
--warn            #b45309
--warn-dim        rgba(180,83,9,0.12)
--danger          #991b1b
--danger-dim      rgba(153,27,27,0.12)
```

### Shadows — sharp, not blurred

```
--shadow-glow    4px 4px 0 #0a0a0a    Reserved: max ONE per screen
--shadow-card    6px 6px 0 #0a0a0a
--shadow-modal   8px 8px 0 #0a0a0a
```

In brutalist, shadows are **not blurred**. They are hard offsets in pure ink black — like a printed page registered slightly off the underlying card. This is the single most identity-defining visual choice in this theme.

---

## Typography

Same families as VU-MODERN. Same scale.

The difference is *weight distribution*: in brutalist, the default body weight is 500 (medium) rather than 400 (regular), because paper textures push thin type into illegibility.

The italic serif idiom is identical between themes.

---

## Shape

In brutalist, default radius is 0 for cards and large surfaces. We override the global `--radius` to 0 only for hero panels, never globally. Buttons and inputs keep `--radius` at 10px for tactility.

This is a per-component override, not a token override. Component CSS like:

```css
.hero-card {
  border-radius: 0;
}
```

is acceptable. Globally redefining `--radius: 0` on `[data-theme=brutalist]` would break the parity-equal contract.

---

## Motion

Same as VU-MODERN. Brutalist is not "lower motion" — it just looks more graphic at rest.

---

## Layout invariants

Identical to VU-MODERN. The header height, footer height, dvh viewport, and Cardinal Rule (no page scroll) are theme-agnostic.

---

## Anti-patterns

All VU-MODERN anti-patterns apply, plus:

- ❌ Soft drop shadows. Brutalist shadows are HARD. If you reach for `box-shadow: 0 4px 20px rgba(0,0,0,0.1)`, you're writing a different theme.
- ❌ Cyan in brutalist. The accent is black. Cyan does not appear anywhere in the brutalist visual language.
- ❌ Glassmorphism. No `backdrop-filter: blur()` in brutalist mode unless the component conditionally suppresses it.
- ❌ Gradient text or gradient surfaces beyond a faint paper-grain texture.

---

## Where this theme shines

- Documents, deeds, contracts (echoes the actual print medium)
- Engineering blueprints (matches NASA-era technical aesthetic)
- Print-friendly / printer-output reports (brutalist *is* printer output)
- Print export from inside the vault — these screens render brutalist by default before sending to the printer
