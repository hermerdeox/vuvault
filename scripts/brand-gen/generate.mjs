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
function buildMonochromeSvg(masterSvg) {
  // Strip backgrounds, keep only the glyph shape, fill white
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(512,480)">
    <rect x="-175" y="-205" width="350" height="410" rx="32" fill="#ffffff"/>
    <rect x="-155" y="-185" width="310" height="370" rx="20" fill="none"
          stroke="#ffffff" stroke-width="2" stroke-opacity="0.5"/>
    <line x1="50" y1="10" x2="155" y2="10" stroke="#ffffff" stroke-width="14" stroke-linecap="round"/>
    <circle cx="155" cy="10" r="28" fill="none" stroke="#ffffff" stroke-width="10"/>
    <circle cx="-20" cy="-40" r="32" fill="#000000"/>
    <rect x="-30" y="-40" width="20" height="70" rx="4" fill="#000000"/>
    <rect x="-175" y="-120" width="20" height="8" rx="2" fill="#ffffff" opacity="0.6"/>
    <rect x="-175" y="-60" width="20" height="8" rx="2" fill="#ffffff" opacity="0.6"/>
    <rect x="-175" y="0" width="20" height="8" rx="2" fill="#ffffff" opacity="0.6"/>
    <rect x="-175" y="60" width="20" height="8" rx="2" fill="#ffffff" opacity="0.6"/>
    <rect x="-175" y="120" width="20" height="8" rx="2" fill="#ffffff" opacity="0.6"/>
    <rect x="148" y="-180" width="18" height="30" rx="4" fill="#ffffff" opacity="0.4"/>
    <rect x="148" y="150" width="18" height="30" rx="4" fill="#ffffff" opacity="0.4"/>
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
function buildWordmarkSvg(masterSvgContent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 120" width="480" height="120">
  <defs>
    <linearGradient id="wGlyph" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="50%" stop-color="#c8c8c0"/>
      <stop offset="100%" stop-color="#505050"/>
    </linearGradient>
  </defs>
  <rect width="480" height="120" fill="transparent"/>
  <!-- Mini icon placeholder (60×60) -->
  <g transform="translate(30,30) scale(0.0586)">
    <!-- Simplified squircle + glyph at small scale -->
    <rect width="1024" height="1024" rx="228" fill="#050a14"/>
    <g transform="translate(512,480)">
      <rect x="-175" y="-205" width="350" height="410" rx="32" fill="url(#wGlyph)"/>
      <circle cx="-20" cy="-40" r="32" fill="#0c1828"/>
      <rect x="-30" y="-40" width="20" height="70" rx="4" fill="#0c1828"/>
      <line x1="50" y1="10" x2="155" y2="10" stroke="url(#wGlyph)" stroke-width="14" stroke-linecap="round"/>
      <circle cx="155" cy="10" r="28" fill="none" stroke="url(#wGlyph)" stroke-width="10"/>
    </g>
  </g>
  <text x="115" y="76" font-family="'Inter', system-ui, sans-serif" font-weight="900" font-size="48" letter-spacing="-1" fill="#ffffff">VuVault</text>
</svg>`;
}

// ─── Updated favicon.svg for /static ──────────────────────────
function buildFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <defs>
    <linearGradient id="fg" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#808080"/>
    </linearGradient>
  </defs>
  <rect width="32" height="32" rx="7" fill="#050a14"/>
  <g transform="translate(16,15)">
    <rect x="-8" y="-9.5" width="16" height="19" rx="2.5" fill="url(#fg)"/>
    <circle cx="-1" cy="-2" r="2.5" fill="#050a14"/>
    <rect x="-2.2" y="-2" width="2.4" height="5" rx="0.5" fill="#050a14"/>
    <line x1="3" y1="0.5" x2="7" y2="0.5" stroke="url(#fg)" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="7" cy="0.5" r="2.2" fill="none" stroke="url(#fg)" stroke-width="1.2"/>
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
      glyph: 'vault-door (geometric safe with keyhole + handle)',
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

- **Glyph:** Geometric vault door with keyhole + rotary handle
- **Accent:** Off-white / steel gray (#f5f5f0 → #808080 → #505050)
- **Halo:** Cyan canonical (#00d4ff) — unified VU brand element
- **Background:** Deep navy radial (#0c1828 → #02060d)
- **Dial ring, comet, dome highlight:** Present (brand-mandated)
`;
  writeFileSync(join(OUT, 'README.md'), readme);

  console.log('\n✅ Done! Assets written to:', OUT);
  console.log(`   Total PNG sizes: ${ICON_SIZES.length} + maskable + monochrome`);
  console.log('   Marketing: og-image, twitter-card, hero-banner');
  console.log('   Snippets: manifest.json, head-snippet.html');
}

main().catch(err => { console.error('❌ Fatal:', err); process.exit(1); });
