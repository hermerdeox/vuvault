# Self-hosted fonts

These WOFF2 files are served from VuVault's own origin to enforce VU Level 0
privacy: zero third-party requests on every public route.

## Provenance

Files were fetched once from the Google Fonts CSS feed
(`https://fonts.googleapis.com/css2?family=...`) which redirects to
`fonts.gstatic.com`. The deterministic local filenames are
`<family>-<sha256[0..7]>.woff2`, where the hash is taken over the original
upstream filename.

Each file is the unmodified upstream WOFF2 binary. The build script that
regenerates this directory + `src/lib/styles/fonts.css` is checked into
`scripts/refresh-fonts.mjs` (see that file for re-run instructions).

## Families included

| Family            | Weights / styles            | Source         |
| ----------------- | --------------------------- | -------------- |
| Instrument Sans   | 400, 500, 600, 700          | Instrument NYC |
| Instrument Serif  | 400 normal, 400 italic      | Instrument NYC |
| JetBrains Mono    | 400, 500, 600, 700          | JetBrains s.r.o. |

Each family ships latin + latin-ext unicode ranges. The browser only loads the
range it actually renders, so total transferred bytes per page is small
(~12-30 KB per family).

## License

All three families are licensed under SIL OFL-1.1
(<https://scripts.sil.org/OFL>). OFL-1.1 explicitly permits self-hosting,
embedding in web pages, and redistribution as part of a software bundle, as
long as the licence is preserved.

- Instrument Sans / Instrument Serif:
  <https://github.com/Instrument/instrument-sans>
  Copyright 2022 The Instrument Sans Project Authors.

- JetBrains Mono:
  <https://github.com/JetBrains/JetBrainsMono>
  Copyright 2020 The JetBrains Mono Project Authors.

The full OFL-1.1 text is available at the upstream repositories above; this
project does not modify or redistribute the source font files (only the
already-compiled WOFF2 subsets that Google Fonts produces from those
upstream sources).

## Why hosted, not @fontsource/* npm packages

A new runtime/build dependency would require approval per `CURSOR_PROMPT.md`'s
"no new runtime deps without approval" rule. Plain `.woff2` files have no
build-time impact and are trivially auditable.
