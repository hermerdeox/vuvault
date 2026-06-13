# VuVault Brand Assets

Generated: 2026-06-13T22:52:18.182Z

## Structure

```
modern/
├── svg/          Master SVGs (source of truth)
├── png/          Rasterized icons (16–1024px)
├── ico/          Multi-resolution favicon.ico
└── marketing/    OG images, Twitter cards, hero banner

manifest-snippets/
├── manifest.json       PWA web app manifest
└── head-snippet.html   Copy-paste <head> tags
```

## Integration

1. Copy `modern/png/` contents → `static/icons/`
2. Copy `modern/ico/favicon.ico` → `static/favicon.ico`
3. Copy `modern/svg/favicon.svg` → `static/favicon.svg`
4. Copy `modern/marketing/og-image.png` → `static/og-image.png`
5. Copy `modern/marketing/twitter-card.png` → `static/twitter-card.png`
6. Copy `manifest-snippets/manifest.json` → `static/manifest.json`
7. Add the `head-snippet.html` tags to your `app.html` `<head>`.

## Design Decisions

- **Glyph:** Circular brushed-steel safe dial (combination lock) with a
  cyan-lit keyhole at center and a cyan index marker at 12 o'clock.
  Chosen over the prior rounded-square vault door, which read as an
  opaque white square inside the rounded-square tile at small sizes.
- **Steel:** Cool brushed-steel gradient (#eef3f9 → #8b97a8 → #3a4452) —
  metallic, never pure-white, so it does not flatten into a sticker.
- **Keyhole / accent:** Cyan canonical (#00d4ff) — the unified VU brand
  element and the icon's focal point, visible down to 16px.
- **Background:** Deep navy radial (#12243f → #03070f) with a top cyan
  dome wash.
