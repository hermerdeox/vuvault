/**
 * URL sanitization for user-supplied vault content.
 *
 * Vault items can store URLs that the UI renders as `<a href>`. A
 * malicious import (Bitwarden CSV, KeePass XML, paste from clipboard)
 * could include a `javascript:`, `data:`, `vbscript:` or
 * `file:` URL that would execute arbitrary code or exfiltrate data
 * the moment the user clicks "Open". We refuse to render those as
 * links — the URL string is still preserved on the item so the user
 * can copy/inspect it manually, but the anchor never gets the
 * dangerous href.
 *
 * `safeHref(value)` returns:
 *   - the original string when the URL parses to an `http:` or
 *     `https:` scheme (or a scheme-less host that we coerce to https)
 *   - `null` for any other scheme or unparseable input — callers
 *     render the value as plain text in that case.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export function safeHref(value: string | undefined | null): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;

	// Reject obvious javascript: / data: / vbscript: / file: even
	// before URL.parse — `URL` can be permissive about whitespace
	// inside the scheme (`java\u0009script:` historically slipped past
	// some parsers). The control-character regex is intentional; the
	// goal is precisely to strip every C0 byte before scheme matching.
	// eslint-disable-next-line no-control-regex
	const lowered = trimmed.toLowerCase().replace(/[\u0000-\u001f\s]/g, '');
	for (const banned of ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']) {
		if (lowered.startsWith(banned)) return null;
	}

	let parsed: URL;
	try {
		// Add a default https:// for inputs that look like a bare host
		// ("example.com/path"). If the user already typed a scheme,
		// the URL ctor uses it verbatim.
		const candidate =
			/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
		parsed = new URL(candidate);
	} catch {
		return null;
	}

	if (!ALLOWED_SCHEMES.has(parsed.protocol)) return null;
	return parsed.toString();
}

/**
 * Cheap host extraction for the rank-and-display layer. Returns the
 * URL's host if parseable as a safe http(s) URL, otherwise the
 * original input (so search still finds it).
 */
export function safeHostOf(value: string | undefined | null): string {
	if (!value) return '';
	const safe = safeHref(value);
	if (!safe) return value;
	try {
		return new URL(safe).host;
	} catch {
		return value;
	}
}
