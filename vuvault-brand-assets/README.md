# VuVault Brand Assets

Generated: 2026-05-11T17:58:12.473Z

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

- **Glyph:** Geometric vault door with keyhole + rotary handle
- **Accent:** Off-white / steel gray (#f5f5f0 → #808080 → #505050)
- **Halo:** Cyan canonical (#00d4ff) — unified VU brand element
- **Background:** Deep navy radial (#0c1828 → #02060d)
- **Dial ring, comet, dome highlight:** Present (brand-mandated)
