#!/usr/bin/env node
/**
 * VuVault brand asset generator.
 * Rasterises the master SVG into every required icon / marketing size.
 *
 * Dependencies: sharp, @resvg/resvg-js  (installed ad-hoc below)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Lazy-require — the caller installs these before running.
const { Resvg } = await import('@resvg/resvg-js');
const sharp = (await import('sharp')).default;

// ─── Config ───────────────────────────────────────────────────
const APP_NAME = 'VuVault';
const SLUG = 'vuvault';
const ACCENT = '#f5f5f0';
const DESCRIPTION = 'Zero-knowledge password manager. Mathematical privacy, not policy. Quantum-safe by construction.';

const ROOT = join(__dirname, '..', '..', 'static');
const OUT = join(__dirname, '..', '..', `${SLUG}-brand-assets`);
const MASTER_SVG = join(__dirname, 'icon-master.svg');

const ICON_SIZES = [1024, 512, 256, 192, 180, 167, 152, 144, 128, 120, 96, 72, 64, 48, 32, 16];
const ICO_SIZES = [16, 32, 48, 64];

// ─── Helpers ──────────────────────────────────────────────────
function ensureDir(d) { mkdirSync(d, { recursive: true }); }

function rasterizeSvg(svgBuffer, width, height) {
  const svgStr = typeof svgBuffer === 'string' ? svgBuffer : svgBuffer.toString('utf-8');
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
    logLevel: 'off',
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

async function resizePng(pngBuffer, width, height) {
  return sharp(pngBuffer)
    .resize(width, height || width, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── Monochrome variant (white glyph on transparent) ──────────
// A clean white safe-dial silhouette the OS can tint (manifest
// `purpose: monochrome`). Mirrors the master's dial geometry.
function buildMonochromeSvg() {
  const teeth = Array.from({ length: 24 }, (_, i) =>
    `<g transform="rotate(${i * 15})"><rect x="-7" y="-368" width="14" height="34" rx="5"/></g>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512,512)" fill="#ffffff">
    <g>${teeth}</g>
    <circle r="305" fill="none" stroke="#ffffff" stroke-width="78"/>
    <path d="M 0 -300 l 16 30 l -32 0 Z"/>
    <circle cx="0" cy="-22" r="50"/>
    <path d="M -20 8 L -34 118 Q -34 138 0 138 Q 34 138 34 118 L 20 8 Z"/>
  </g>
</svg>`;
}

// ─── Maskable variant (80% safe zone, dark bg fill) ───────────
async function buildMaskablePng(masterPng1024) {
  const iconResized = await sharp(masterPng1024)
    .resize(820, 820, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const canvas = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: { r: 5, g: 10, b: 20, alpha: 255 } }
  })
    .composite([{ input: iconResized, gravity: 'centre' }])
    .png()
    .toBuffer();

  return sharp(canvas)
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── OG Image (1200×630) ─────────────────────────────────────
async function buildOgImage(masterPng1024) {
  const iconResized = await sharp(masterPng1024)
    .resize(400, 400, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  // Dark background with the icon on the left and text area implied
  const textSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#020610"/>
    <text x="560" y="270" font-family="system-ui, sans-serif" font-weight="900" font-size="72" fill="#ffffff">VuVault</text>
    <text x="560" y="340" font-family="system-ui, sans-serif" font-weight="400" font-size="28" fill="#88aacc">Zero-knowledge password manager</text>
    <text x="560" y="385" font-family="system-ui, sans-serif" font-weight="400" font-size="22" fill="#556688">Mathematical privacy, not policy. Quantum-safe.</text>
    <line x1="560" y1="420" x2="760" y2="420" stroke="#00d4ff" stroke-width="2" stroke-opacity="0.4"/>
  </svg>`);

  const bgPng = await sharp(textSvg).png().toBuffer();

  return sharp(bgPng)
    .composite([{ input: iconResized, left: 100, top: 115 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── Twitter Card (1200×675) ─────────────────────────────────
async function buildTwitterCard(ogImage) {
  // Slightly taller crop from the OG base
  return sharp(ogImage)
    .resize(1200, 675, { fit: 'cover', position: 'centre' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── Hero Banner (1920×1080) ──────────────────────────────────
async function buildHeroBanner(masterPng1024) {
  const iconResized = await sharp(masterPng1024)
    .resize(480, 480, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  const bgSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
    <defs>
      <radialGradient id="hbg" cx="50%" cy="40%" r="70%">
        <stop offset="0%" stop-color="#0c1828"/>
        <stop offset="100%" stop-color="#02060d"/>
      </radialGradient>
    </defs>
    <rect width="1920" height="1080" fill="url(#hbg)"/>
    <text x="960" y="780" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="900" font-size="96" fill="#ffffff">VuVault</text>
    <text x="960" y="860" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="400" font-size="36" fill="#88aacc">Zero-knowledge password manager</text>
  </svg>`);

  const bgPng = await sharp(bgSvg).png().toBuffer();

  return sharp(bgPng)
    .composite([{ input: iconResized, left: 720, top: 180 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ─── Favicon.ico builder ──────────────────────────────────────
function buildIco(pngBuffers) {
  // ICO format: header + directory entries + image data
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = count * dirEntrySize;

  let dataOffset = headerSize + dirSize;
  const entries = [];

  for (const { size, buffer } of pngBuffers) {
    entries.push({ size, buffer, offset: dataOffset });
    dataOffset += buffer.length;
  }

  const totalSize = dataOffset;
  const ico = Buffer.alloc(totalSize);

  // Header
  ico.writeUInt16LE(0, 0);      // reserved
  ico.writeUInt16LE(1, 2);      // type: ICO
  ico.writeUInt16LE(count, 4);  // count

  // Directory entries
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const off = headerSize + i * dirEntrySize;
    ico.writeUInt8(e.size >= 256 ? 0 : e.size, off);      // width
    ico.writeUInt8(e.size >= 256 ? 0 : e.size, off + 1);  // height
    ico.writeUInt8(0, off + 2);                            // palette
    ico.writeUInt8(0, off + 3);                            // reserved
    ico.writeUInt16LE(1, off + 4);                         // color planes
    ico.writeUInt16LE(32, off + 6);                        // bits per pixel
    ico.writeUInt32LE(e.buffer.length, off + 8);           // data size
    ico.writeUInt32LE(e.offset, off + 12);                 // data offset
  }

  // Image data
  for (const e of entries) {
    e.buffer.copy(ico, e.offset);
  }

  return ico;
}

// ─── Wordmark SVG ─────────────────────────────────────────────
function buildWordmarkSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120" width="480" height="120">
  <defs>
    <linearGradient id="wSteel" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#e6ecf3"/>
      <stop offset="55%" stop-color="#9aa6b6"/>
      <stop offset="100%" stop-color="#4a5562"/>
    </linearGradient>
  </defs>
  <rect width="480" height="120" fill="transparent"/>
  <!-- Mini safe-dial icon (84×84) -->
  <g transform="translate(18,18)">
    <rect width="84" height="84" rx="20" fill="#071427"/>
    <g transform="translate(42,42)">
      <circle r="26" fill="none" stroke="url(#wSteel)" stroke-width="7.5"/>
      <circle r="21" fill="#121c2b"/>
      <circle cy="-5" r="6" fill="#22cfff"/>
      <path d="M -2.7 -1 L -4.4 11.5 Q -4.4 14.5 0 14.5 Q 4.4 14.5 4.4 11.5 L 2.7 -1 Z" fill="#22cfff"/>
    </g>
  </g>
  <text x="124" y="76" font-family="'Inter', system-ui, sans-serif" font-weight="900" font-size="48" letter-spacing="-1" fill="#ffffff">VuVault</text>
</svg>`;
}

// ─── Updated favicon.svg for /static ──────────────────────────
// Simplified safe-dial: a steel ring + cyan keyhole, legible at 16px.
function buildFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="fsteel" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="#e6ecf3"/>
      <stop offset="55%" stop-color="#9aa6b6"/>
      <stop offset="100%" stop-color="#4a5562"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="#071427"/>
  <g transform="translate(16,16)">
    <circle r="10" fill="none" stroke="url(#fsteel)" stroke-width="3"/>
    <circle r="8" fill="#121c2b"/>
    <circle cy="-2" r="2.4" fill="#22cfff"/>
    <path d="M -1.1 -0.4 L -1.8 4.6 Q -1.8 5.8 0 5.8 Q 1.8 5.8 1.8 4.6 L 1.1 -0.4 Z" fill="#22cfff"/>
  </g>
</svg>`;
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('🎨 VuVault Brand Asset Generator');
  console.log('================================\n');

  const masterSvg = readFileSync(MASTER_SVG);
  const masterSvgStr = masterSvg.toString('utf-8');

  // Create output directories
  const dirs = [
    'modern/svg', 'modern/png', 'modern/ico', 'modern/marketing',
    'manifest-snippets',
  ];
  for (const d of dirs) ensureDir(join(OUT, d));

  // ── 1. Save SVG sources ──
  console.log('📐 Writing SVG sources...');
  writeFileSync(join(OUT, 'modern/svg/icon-master.svg'), masterSvg);
  writeFileSync(join(OUT, 'modern/svg/icon-monochrome.svg'), buildMonochromeSvg(masterSvgStr));
  writeFileSync(join(OUT, 'modern/svg/wordmark.svg'), buildWordmarkSvg(masterSvgStr));

  // ── 2. Rasterize master at 1024 ──
  console.log('🖼️  Rasterizing master 1024×1024...');
  const master1024 = rasterizeSvg(masterSvg, 1024, 1024);
  writeFileSync(join(OUT, 'modern/png/icon-1024.png'), master1024);

  // ── 3. Resize to all icon sizes ──
  console.log('📏 Generating icon size matrix...');
  const icoBuffers = [];
  for (const size of ICON_SIZES) {
    if (size === 1024) continue;
    const buf = await resizePng(master1024, size, size);
    writeFileSync(join(OUT, `modern/png/icon-${size}.png`), buf);
    if (ICO_SIZES.includes(size)) {
      icoBuffers.push({ size, buffer: buf });
    }
    process.stdout.write(`  ✓ ${size}×${size}\n`);
  }

  // ── 4. Favicon.ico ──
  console.log('🔖 Building favicon.ico...');
  icoBuffers.sort((a, b) => a.size - b.size);
  const ico = buildIco(icoBuffers);
  writeFileSync(join(OUT, 'modern/ico/favicon.ico'), ico);

  // ── 5. Maskable ──
  console.log('📱 Building maskable icon...');
  const maskable = await buildMaskablePng(master1024);
  writeFileSync(join(OUT, 'modern/png/icon-maskable-512.png'), maskable);

  // ── 6. Monochrome PNG ──
  console.log('⚪ Building monochrome icon...');
  const monoSvg = Buffer.from(buildMonochromeSvg(masterSvgStr));
  const mono1024 = rasterizeSvg(monoSvg, 1024, 1024);
  const mono512 = await resizePng(mono1024, 512, 512);
  writeFileSync(join(OUT, 'modern/png/icon-monochrome-512.png'), mono512);

  // ── 7. Marketing assets ──
  console.log('📣 Building marketing assets...');
  const ogImage = await buildOgImage(master1024);
  writeFileSync(join(OUT, 'modern/marketing/og-image.png'), ogImage);

  const twitterCard = await buildTwitterCard(ogImage);
  writeFileSync(join(OUT, 'modern/marketing/twitter-card.png'), twitterCard);

  const heroBanner = await buildHeroBanner(master1024);
  writeFileSync(join(OUT, 'modern/marketing/hero-banner-1920x1080.png'), heroBanner);

  // ── 8. Manifest snippets ──
  console.log('📋 Writing manifest snippets...');

  const manifest = {
    name: APP_NAME,
    short_name: APP_NAME,
    description: DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#000000',
    background_color: '#000000',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
    ],
  };
  writeFileSync(join(OUT, 'manifest-snippets/manifest.json'), JSON.stringify(manifest, null, 2));

  const headSnippet = `<!-- Favicons -->
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="16x16"  href="/icons/icon-16.png">
<link rel="icon" type="image/png" sizes="32x32"  href="/icons/icon-32.png">

<!-- iOS -->
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${APP_NAME}">

<!-- PWA -->
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#000000">

<!-- Open Graph -->
<meta property="og:title" content="${APP_NAME} — Zero-knowledge password manager">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:type" content="website">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${APP_NAME} — Zero-knowledge password manager">
<meta name="twitter:description" content="${DESCRIPTION}">
<meta name="twitter:image" content="/twitter-card.png">`;

  writeFileSync(join(OUT, 'manifest-snippets/head-snippet.html'), headSnippet);

  // ── 9. Updated favicon.svg ──
  console.log('✨ Writing updated favicon.svg...');
  writeFileSync(join(OUT, 'modern/svg/favicon.svg'), buildFaviconSvg());

  // ── 10. BRAND_VERSION ──
  const version = {
    app: APP_NAME,
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    decisions: {
      glyph: 'safe-dial (circular brushed-steel combination dial + cyan-lit keyhole)',
      accent: ACCENT,
      variants: ['modern'],
    },
  };
  writeFileSync(join(OUT, 'BRAND_VERSION.json'), JSON.stringify(version, null, 2));

  // ── 11. README ──
  const readme = `# ${APP_NAME} Brand Assets

Generated: ${new Date().toISOString()}

## Structure

\`\`\`
modern/
├── svg/          Master SVGs (source of truth)
├── png/          Rasterized icons (16–1024px)
├── ico/          Multi-resolution favicon.ico
└── marketing/    OG images, Twitter cards, hero banner

manifest-snippets/
├── manifest.json       PWA web app manifest
└── head-snippet.html   Copy-paste <head> tags
\`\`\`

## Integration

1. Copy \`modern/png/\` contents → \`static/icons/\`
2. Copy \`modern/ico/favicon.ico\` → \`static/favicon.ico\`
3. Copy \`modern/svg/favicon.svg\` → \`static/favicon.svg\`
4. Copy \`modern/marketing/og-image.png\` → \`static/og-image.png\`
5. Copy \`modern/marketing/twitter-card.png\` → \`static/twitter-card.png\`
6. Copy \`manifest-snippets/manifest.json\` → \`static/manifest.json\`
7. Add the \`head-snippet.html\` tags to your \`app.html\` \`<head>\`.

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
`;
  writeFileSync(join(OUT, 'README.md'), readme);

  console.log('\n✅ Done! Assets written to:', OUT);
  console.log(`   Total PNG sizes: ${ICON_SIZES.length} + maskable + monochrome`);
  console.log('   Marketing: og-image, twitter-card, hero-banner');
  console.log('   Snippets: manifest.json, head-snippet.html');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
