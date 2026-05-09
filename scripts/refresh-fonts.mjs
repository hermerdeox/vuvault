#!/usr/bin/env node
/**
 * Refresh self-hosted fonts under static/fonts/ and regenerate the
 * matching @font-face CSS at src/lib/styles/fonts.css.
 *
 * Run only when bumping a font family or adding a new weight. Fonts must stay
 * checked into git so production builds never need network access.
 *
 *   node scripts/refresh-fonts.mjs
 *
 * The script enumerates Google Fonts' CSS feed (which is the canonical source
 * for the SIL OFL-1.1 binaries) once, computes deterministic local filenames
 * from a SHA-256 digest of the upstream filename, and writes the static
 * @font-face CSS pointing at those local files. After running, the upstream
 * fonts.googleapis.com and fonts.gstatic.com are no longer touched at runtime.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const CSS_URL =
	'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;600;700&display=swap';

const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 ' +
	'(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HEADER = `/* ============================================================
   FONTS — self-hosted to enforce VU Level 0 (no third-party network)

   Families:
     - Instrument Sans (Instrument, SIL OFL-1.1)        weights 400/500/600/700
     - Instrument Serif (Instrument, SIL OFL-1.1)       regular + italic
     - JetBrains Mono (JetBrains, SIL OFL-1.1)          weights 400/500/600/700

   All WOFF2 binaries live under /fonts/ (served from static/fonts/)
   and the browser never resolves any third-party host for them.
   See static/fonts/README.md for license + provenance.
   ============================================================ */

`;

function localName(url) {
	const match = url.match(/\/s\/([a-z]+)\//);
	const family = match ? match[1] : 'unknown';
	const fname = url.split('/').pop();
	const hash = createHash('sha256').update(fname).digest('hex').slice(0, 8);
	const slug = family
		.replace(/sans/, '-sans')
		.replace(/serif/, '-serif')
		.replace(/mono/, '-mono');
	return `${slug}-${hash}.woff2`;
}

async function main() {
	const cssRes = await fetch(CSS_URL, { headers: { 'User-Agent': UA } });
	if (!cssRes.ok) throw new Error(`Failed to fetch fonts CSS: ${cssRes.status}`);
	const cssText = await cssRes.text();

	const urls = Array.from(
		new Set(cssText.match(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g) ?? [])
	);
	if (urls.length === 0) throw new Error('No WOFF2 URLs found in CSS feed');

	const fontsDir = resolve(ROOT, 'static/fonts');
	await mkdir(fontsDir, { recursive: true });

	let cssOut = cssText;
	for (const url of urls) {
		const local = localName(url);
		const path = resolve(fontsDir, local);
		const res = await fetch(url, { headers: { 'User-Agent': UA } });
		if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
		const buf = new Uint8Array(await res.arrayBuffer());
		await writeFile(path, buf);
		console.log(`  ${local}\t${buf.length} bytes`);
		cssOut = cssOut.split(url).join(`/fonts/${local}`);
	}

	const targetCss = resolve(ROOT, 'src/lib/styles/fonts.css');
	await writeFile(targetCss, HEADER + cssOut);
	console.log(`\nWrote ${targetCss}`);
	console.log(`Refreshed ${urls.length} font files under static/fonts/`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
