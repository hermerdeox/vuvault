#!/usr/bin/env node
/**
 * Generates a Lottie JSON animation for the VuVault splash screen.
 *
 * Animation sequence (1.2s = 36 frames at 30fps):
 *   0-6    (0.0-0.2s)  Background + bezel fades in
 *   4-12   (0.13-0.4s) Grid + dial ring draws on (stroke dash)
 *   8-16   (0.27-0.53s) Comet streak sweeps across
 *   12-20  (0.4-0.67s) Dome highlight fades in
 *   16-30  (0.53-1.0s) Vault glyph scales up + fades in with overshoot
 *   24-36  (0.8-1.2s)  Cyan halo pulses to full, glyph settles
 *
 * Lottie spec: bodymovin format, shapes-only (no images).
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', '..', 'vuvault-brand-assets');

const FPS = 30;
const TOTAL_FRAMES = 36; // 1.2s
const W = 512;
const H = 512;
const CX = 256;
const CY = 256;

function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }

function kf(startFrame, endFrame, startVal, endVal) {
  return {
    a: 1,
    k: [
      { t: startFrame, s: Array.isArray(startVal) ? startVal : [startVal], e: Array.isArray(endVal) ? endVal : [endVal], i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } },
      { t: endFrame, s: Array.isArray(endVal) ? endVal : [endVal] }
    ]
  };
}

function kfMulti(startFrame, endFrame, startVal, endVal) {
  const dim = startVal.length;
  return {
    a: 1,
    k: [
      { t: startFrame, s: startVal, e: endVal, i: { x: Array(dim).fill(0.42), y: Array(dim).fill(0) }, o: { x: Array(dim).fill(0.58), y: Array(dim).fill(1) } },
      { t: endFrame, s: endVal }
    ]
  };
}

function scaleOvershoot(startFrame, midFrame, endFrame, startVal, peakVal, endVal) {
  return {
    a: 1,
    k: [
      {
        t: startFrame,
        s: [startVal, startVal, 100],
        e: [peakVal, peakVal, 100],
        i: { x: [0.25, 0.25, 0.25], y: [0, 0, 0] },
        o: { x: [0.5, 0.5, 0.5], y: [1, 1, 1] }
      },
      {
        t: midFrame,
        s: [peakVal, peakVal, 100],
        e: [endVal, endVal, 100],
        i: { x: [0.42, 0.42, 0.42], y: [0, 0, 0] },
        o: { x: [0.58, 0.58, 0.58], y: [1, 1, 1] }
      },
      { t: endFrame, s: [endVal, endVal, 100] }
    ]
  };
}

// Squircle background path (scaled to 512)
const squirclePath = "M 256 0 C 358.75 0 411.75 0 446.65 20.6 C 470.4 34.3 477.7 41.6 491.4 65.35 C 512 100.25 512 153.25 512 256 C 512 358.75 512 411.75 491.4 446.65 C 477.7 470.4 470.4 477.7 446.65 491.4 C 411.75 512 358.75 512 256 512 C 153.25 512 100.25 512 65.35 491.4 C 41.6 477.7 34.3 470.4 20.6 446.65 C 0 411.75 0 358.75 0 256 C 0 153.25 0 100.25 20.6 65.35 C 34.3 41.6 41.6 34.3 65.35 20.6 C 100.25 0 153.25 0 256 0 Z";

function pathToLottie(d) {
  const parts = d.match(/[MCLZ][^MCLZ]*/g) || [];
  const vertices = [];
  const inTangents = [];
  const outTangents = [];

  let cx = 0, cy = 0;
  for (const part of parts) {
    const cmd = part[0];
    const nums = part.slice(1).trim().split(/[\s,]+/).map(Number);
    if (cmd === 'M') {
      cx = nums[0]; cy = nums[1];
      vertices.push([cx, cy]);
      inTangents.push([0, 0]);
      outTangents.push([0, 0]);
    } else if (cmd === 'C') {
      for (let i = 0; i < nums.length; i += 6) {
        const cp1x = nums[i], cp1y = nums[i+1];
        const cp2x = nums[i+2], cp2y = nums[i+3];
        const ex = nums[i+4], ey = nums[i+5];
        outTangents[outTangents.length - 1] = [cp1x - cx, cp1y - cy];
        vertices.push([ex, ey]);
        inTangents.push([cp2x - ex, cp2y - ey]);
        outTangents.push([0, 0]);
        cx = ex; cy = ey;
      }
    } else if (cmd === 'L') {
      for (let i = 0; i < nums.length; i += 2) {
        cx = nums[i]; cy = nums[i+1];
        vertices.push([cx, cy]);
        inTangents.push([0, 0]);
        outTangents.push([0, 0]);
      }
    }
  }

  // Close: last out-tangent and first in-tangent stay [0,0] for sharp close
  return { c: true, v: vertices, i: inTangents, o: outTangents };
}

// ─── Layer builders ───────────────────────────────────────────

function backgroundLayer() {
  const shape = pathToLottie(squirclePath);
  return {
    ty: 4, nm: "Background", sr: 1, ks: {
      o: kf(0, 6, 0, 100), r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] },
      a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }
    },
    ao: 0, ip: 0, op: TOTAL_FRAMES, st: 0, bm: 0,
    shapes: [{
      ty: "gr", it: [
        { ty: "sh", ks: { a: 0, k: shape } },
        { ty: "fl", c: { a: 0, k: [0.02, 0.04, 0.08, 1] }, o: { a: 0, k: 100 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
      ], nm: "bg"
    }]
  };
}

function dialLayer() {
  return {
    ty: 4, nm: "Dial Ring", sr: 1, ks: {
      o: kf(4, 14, 0, 100), r: kf(4, 14, -15, 0),
      p: { a: 0, k: [CX, CY, 0] }, a: { a: 0, k: [0, 0, 0] },
      s: kf(4, 14, [90, 90, 100], [100, 100, 100])
    },
    ao: 0, ip: 4, op: TOTAL_FRAMES, st: 4, bm: 0,
    shapes: [{
      ty: "gr", it: [
        { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [340, 340] } },
        { ty: "st", c: { a: 0, k: [0, 0.83, 1, 1] }, o: { a: 0, k: 22 }, w: { a: 0, k: 1.2 } },
        { ty: "tm", s: { a: 0, k: 0 }, e: kf(4, 12, 0, 100), o: { a: 0, k: 0 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
      ], nm: "ring"
    },
    // 12 tick marks as small rectangles
    ...Array.from({length: 12}, (_, i) => ({
      ty: "gr", it: [
        { ty: "rc", p: { a: 0, k: [0, -166] }, s: { a: 0, k: [2, 9] }, r: { a: 0, k: 1 } },
        { ty: "fl", c: { a: 0, k: [0, 0.83, 1, 1] }, o: { a: 0, k: 30 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: i * 30 }, o: kf(6 + Math.floor(i * 0.5), 10 + Math.floor(i * 0.5), 0, 100) }
      ], nm: `tick_${i}`
    }))]
  };
}

function cometLayer() {
  const cometShape = {
    c: false,
    v: [[50, 120], [170, 75], [375, 105]],
    i: [[0, 0], [-60, 15], [-60, 10]],
    o: [[60, -15], [60, -10], [0, 0]]
  };
  return {
    ty: 4, nm: "Comet", sr: 1, ks: {
      o: { a: 1, k: [
        { t: 8, s: [0], e: [55], i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } },
        { t: 14, s: [55], e: [55], i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } },
        { t: 20, s: [55], e: [35], i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } },
        { t: TOTAL_FRAMES, s: [35] }
      ]},
      r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] },
      a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] }
    },
    ao: 0, ip: 8, op: TOTAL_FRAMES, st: 8, bm: 0,
    shapes: [{
      ty: "gr", it: [
        { ty: "sh", ks: { a: 0, k: cometShape } },
        { ty: "st", c: { a: 0, k: [0.71, 0.9, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 1.5 } },
        { ty: "tm", s: kf(8, 14, 40, 0), e: kf(8, 16, 40, 100), o: { a: 0, k: 0 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
      ], nm: "comet"
    }]
  };
}

function domeLayer() {
  return {
    ty: 4, nm: "Dome Highlight", sr: 1, ks: {
      o: kf(12, 20, 0, 28), r: { a: 0, k: 0 },
      p: { a: 0, k: [CX, 80, 0] }, a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] }
    },
    ao: 0, ip: 12, op: TOTAL_FRAMES, st: 12, bm: 0,
    shapes: [{
      ty: "gr", it: [
        { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [400, 260] } },
        { ty: "fl", c: { a: 0, k: [0.47, 0.78, 1, 1] }, o: { a: 0, k: 100 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
      ], nm: "dome"
    }],
    ef: [{ ty: 29, nm: "Gaussian Blur", ix: 1, en: 1, ef: [
      { ty: 0, nm: "Blurriness", ix: 1, v: { a: 0, k: 80 } },
      { ty: 7, nm: "Blur Dimensions", ix: 2, v: { a: 0, k: 1 } },
      { ty: 7, nm: "Repeat Edge Pixels", ix: 3, v: { a: 0, k: 1 } }
    ]}]
  };
}

function glyphLayer() {
  // Vault door body as a rounded rect shape
  const vaultBody = {
    c: true,
    v: [[-71.5, -102.5], [71.5, -102.5], [71.5, 102.5], [-71.5, 102.5]],
    i: [[0, -8], [8, 0], [0, 8], [-8, 0]],
    o: [[-8, 0], [0, -8], [8, 0], [0, 8]]
  };

  return {
    ty: 4, nm: "Vault Glyph", sr: 1, ks: {
      o: kf(16, 26, 0, 100), r: { a: 0, k: 0 },
      p: { a: 0, k: [CX, CY - 16, 0] }, a: { a: 0, k: [0, 0, 0] },
      s: scaleOvershoot(16, 26, 30, 60, 105, 100)
    },
    ao: 0, ip: 16, op: TOTAL_FRAMES, st: 16, bm: 0,
    shapes: [
      // Vault door body
      {
        ty: "gr", it: [
          { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [175, 205] }, r: { a: 0, k: 16 } },
          {
            ty: "gf", t: 1,
            s: { a: 0, k: [0, -102] }, e: { a: 0, k: [0, 102] },
            g: { p: 3, k: { a: 0, k: [0, 1, 1, 1, 0.5, 0.78, 0.78, 0.75, 1, 0.31, 0.31, 0.31] } },
            o: { a: 0, k: 100 }
          },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "body"
      },
      // Inner frame
      {
        ty: "gr", it: [
          { ty: "rc", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [155, 185] }, r: { a: 0, k: 10 } },
          { ty: "st", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 25 }, w: { a: 0, k: 1 } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "frame"
      },
      // Keyhole circle
      {
        ty: "gr", it: [
          { ty: "el", p: { a: 0, k: [-10, -20] }, s: { a: 0, k: [32, 32] } },
          { ty: "fl", c: { a: 0, k: [0.047, 0.094, 0.157, 1] }, o: { a: 0, k: 90 } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "keyhole_circle"
      },
      // Keyhole slot
      {
        ty: "gr", it: [
          { ty: "rc", p: { a: 0, k: [-10, 15] }, s: { a: 0, k: [10, 35] }, r: { a: 0, k: 2 } },
          { ty: "fl", c: { a: 0, k: [0.047, 0.094, 0.157, 1] }, o: { a: 0, k: 90 } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "keyhole_slot"
      },
      // Keyhole glow ring
      {
        ty: "gr", it: [
          { ty: "el", p: { a: 0, k: [-10, -20] }, s: { a: 0, k: [22, 22] } },
          { ty: "st", c: { a: 0, k: [0, 0.83, 1, 1] }, o: kf(22, 30, 0, 50), w: { a: 0, k: 1 } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "keyhole_glow"
      },
      // Handle bar
      {
        ty: "gr", it: [
          { ty: "sh", ks: { a: 0, k: { c: false, v: [[25, 5], [77.5, 5]], i: [[0, 0], [0, 0]], o: [[0, 0], [0, 0]] } } },
          { ty: "st", c: { a: 0, k: [0.78, 0.78, 0.75, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 7 }, lc: 2 },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "handle_bar"
      },
      // Handle wheel
      {
        ty: "gr", it: [
          { ty: "el", p: { a: 0, k: [77.5, 5] }, s: { a: 0, k: [28, 28] } },
          { ty: "st", c: { a: 0, k: [0.78, 0.78, 0.75, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 5 } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: "handle_wheel"
      },
      // Bolt indicators (5 small rects on left)
      ...[-60, -30, 0, 30, 60].map((yOff, i) => ({
        ty: "gr", it: [
          { ty: "rc", p: { a: 0, k: [-87.5, yOff] }, s: { a: 0, k: [10, 4] }, r: { a: 0, k: 1 } },
          { ty: "fl", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 15 } },
          { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
        ], nm: `bolt_${i}`
      }))
    ]
  };
}

function haloLayer() {
  return {
    ty: 4, nm: "Cyan Halo", sr: 1, ks: {
      o: { a: 1, k: [
        { t: 24, s: [0], e: [45], i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } },
        { t: 30, s: [45], e: [35], i: { x: [0.42], y: [0] }, o: { x: [0.58], y: [1] } },
        { t: TOTAL_FRAMES, s: [35] }
      ]},
      r: { a: 0, k: 0 }, p: { a: 0, k: [CX, CY - 16, 0] },
      a: { a: 0, k: [0, 0, 0] }, s: kf(24, 32, [80, 80, 100], [100, 100, 100])
    },
    ao: 0, ip: 24, op: TOTAL_FRAMES, st: 24, bm: 0,
    shapes: [{
      ty: "gr", it: [
        { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [220, 260] } },
        { ty: "fl", c: { a: 0, k: [0, 0.83, 1, 1] }, o: { a: 0, k: 100 } },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }
      ], nm: "halo"
    }],
    ef: [{ ty: 29, nm: "Gaussian Blur", ix: 1, en: 1, ef: [
      { ty: 0, nm: "Blurriness", ix: 1, v: { a: 0, k: 40 } },
      { ty: 7, nm: "Blur Dimensions", ix: 2, v: { a: 0, k: 1 } },
      { ty: 7, nm: "Repeat Edge Pixels", ix: 3, v: { a: 0, k: 1 } }
    ]}]
  };
}

// ─── Assemble ─────────────────────────────────────────────────
const lottie = {
  v: "5.7.4",
  fr: FPS,
  ip: 0,
  op: TOTAL_FRAMES,
  w: W,
  h: H,
  nm: "VuVault Splash",
  ddd: 0,
  assets: [],
  layers: [
    // Render order: back to front (Lottie renders top layer first)
    glyphLayer(),
    haloLayer(),
    domeLayer(),
    cometLayer(),
    dialLayer(),
    backgroundLayer(),
  ]
};

const outPath = join(OUT, 'modern', 'lottie');
const { mkdirSync } = await import('node:fs');
mkdirSync(outPath, { recursive: true });

const filePath = join(outPath, 'vuvault-splash.json');
writeFileSync(filePath, JSON.stringify(lottie));
console.log(`✅ Lottie splash animation written to: ${filePath}`);
console.log(`   ${TOTAL_FRAMES} frames at ${FPS}fps = ${(TOTAL_FRAMES/FPS).toFixed(1)}s`);
console.log(`   Canvas: ${W}×${H}`);
console.log(`   Layers: ${lottie.layers.length}`);

// Also write a minified version
const minPath = join(outPath, 'vuvault-splash.min.json');
writeFileSync(minPath, JSON.stringify(lottie));
console.log(`   Minified: ${(Buffer.byteLength(JSON.stringify(lottie)) / 1024).toFixed(1)} KB`);

// Also copy to static for direct use
const staticPath = join(__dirname, '..', '..', 'static', 'lottie');
mkdirSync(staticPath, { recursive: true });
writeFileSync(join(staticPath, 'vuvault-splash.json'), JSON.stringify(lottie));
console.log(`   Copied to static/lottie/vuvault-splash.json`);
