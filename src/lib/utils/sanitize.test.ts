import { describe, expect, it } from 'vitest';
import { safeHref, safeHostOf } from './sanitize';

describe('safeHref', () => {
	it('returns the URL for plain https', () => {
		expect(safeHref('https://github.com')).toBe('https://github.com/');
	});

	it('returns the URL for plain http', () => {
		expect(safeHref('http://example.org/path')).toBe('http://example.org/path');
	});

	it('upgrades scheme-less hosts to https', () => {
		expect(safeHref('example.com')).toBe('https://example.com/');
		expect(safeHref('github.com/me')).toBe('https://github.com/me');
	});

	it('rejects javascript: URLs', () => {
		expect(safeHref('javascript:alert(1)')).toBeNull();
		expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull();
		expect(safeHref('  javascript:alert(1)  ')).toBeNull();
	});

	it('rejects javascript: with embedded whitespace/control chars', () => {
		expect(safeHref('java\tscript:alert(1)')).toBeNull();
		expect(safeHref('java\nscript:alert(1)')).toBeNull();
		expect(safeHref('java\u0009script:alert(1)')).toBeNull();
	});

	it('rejects data:, vbscript:, file:, blob:', () => {
		expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
		expect(safeHref('vbscript:msgbox(1)')).toBeNull();
		expect(safeHref('file:///etc/passwd')).toBeNull();
		expect(safeHref('blob:https://evil.example/abc')).toBeNull();
	});

	it('rejects empty / null / non-parseable input', () => {
		expect(safeHref('')).toBeNull();
		expect(safeHref('   ')).toBeNull();
		expect(safeHref(null)).toBeNull();
		expect(safeHref(undefined)).toBeNull();
	});
});

describe('safeHostOf', () => {
	it('returns the host for safe URLs', () => {
		expect(safeHostOf('https://github.com/me')).toBe('github.com');
	});

	it('returns the original string for unsafe URLs (so search keeps working)', () => {
		expect(safeHostOf('javascript:alert(1)')).toBe('javascript:alert(1)');
	});
});
