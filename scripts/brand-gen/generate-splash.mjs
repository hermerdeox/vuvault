/**
 * iOS launch-screen (apple-touch-startup-image) generator.
 *
 * iOS does not use the web-app manifest's background_color for the
 * PWA launch frame — without explicit startup images an installed
 * app flashes a white system sheet on every cold start, the single
 * most jarring "not native" moment on iPhone. This script renders a
 * black frame with the centered vault mark for every current iPhone
 * and iPad logical resolution, matched in app.html via exact
 * device-width/device-height/pixel-ratio media queries.
 *
 * Pure @resvg/resvg-js (already a devDependency) — the icon raster
 * is embedded as a base64 <image> inside a generated SVG, so no
 * additional image tooling (sharp etc.) is required.
 *
 * Usage:  node scripts/brand-gen/generate-splash.mjs
 * Output: static/splash/splash-{w}x{h}@{s}x.png + link tags on stdout.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'static', 'splash');
const ICON = join(ROOT, 'static', 'icons', 'icon-512.png');

/** Portrait logical sizes (CSS pt) × device pixel ratio. */
const DEVICES = [
	{ w: 375, h: 667, s: 2 }, // iPhone SE (2nd/3rd gen)
	{ w: 375, h: 812, s: 3 }, // X / XS / 11 Pro / 12-13 mini
	{ w: 390, h: 844, s: 3 }, // 12 / 13 / 14
	{ w: 393, h: 852, s: 3 }, // 14 Pro / 15 / 16
	{ w: 402, h: 874, s: 3 }, // 16 Pro
	{ w: 414, h: 896, s: 2 }, // XR / 11
	{ w: 414, h: 896, s: 3 }, // XS Max / 11 Pro Max
	{ w: 428, h: 926, s: 3 }, // 12-14 Pro Max / 14 Plus
	{ w: 430, h: 932, s: 3 }, // 15 Plus / 15 Pro Max / 16 Plus
	{ w: 420, h: 912, s: 3 }, // iPhone Air
	{ w: 440, h: 956, s: 3 }, // 16 Pro Max / 17 Pro Max
	{ w: 744, h: 1133, s: 2 }, // iPad mini 6/7
	{ w: 768, h: 1024, s: 2 }, // iPad 9.7" (5th/6th gen), legacy minis
	{ w: 810, h: 1080, s: 2 }, // iPad 10.2" (7th-9th gen)
	{ w: 820, h: 1180, s: 2 }, // iPad 10th/11th gen, Air 4/5, Air 11" M2/M3
	{ w: 834, h: 1194, s: 2 }, // iPad Pro 11" (gen 1-4)
	{ w: 834, h: 1210, s: 2 }, // iPad Pro 11" M4
	{ w: 1024, h: 1366, s: 2 }, // iPad Pro 12.9", Air 13"
	{ w: 1032, h: 1376, s: 2 } // iPad Pro 13" M4
];
// Portrait-only by design: landscape launch frames are a marginal
// win (iPhones launch portrait; iPad landscape gets the default
// sheet briefly) and would double the asset set.

const BG = '#000000'; // matches modern --bg + manifest background_color

function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const iconB64 = readFileSync(ICON).toString('base64');
	const links = [];

	for (const { w, h, s } of DEVICES) {
		const W = w * s;
		const H = h * s;
		// Centered mark at 24% of the short edge — quiet, Apple-like.
		const size = Math.round(Math.min(W, H) * 0.24);
		const x = Math.round((W - size) / 2);
		const y = Math.round((H - size) / 2);

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/><image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${iconB64}"/></svg>`;

		const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
		const name = `splash-${w}x${h}@${s}x.png`;
		writeFileSync(join(OUT_DIR, name), png);

		links.push(
			`\t\t<link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${s}) and (orientation: portrait)" href="%sveltekit.assets%/splash/${name}" />`
		);
		console.log(`splash: ${name} (${W}x${H}, ${(png.length / 1024).toFixed(0)} KB)`);
	}

	console.log('\n— paste into src/app.html —\n');
	console.log(links.join('\n'));
}

main();
