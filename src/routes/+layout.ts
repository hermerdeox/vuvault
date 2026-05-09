// Marketing pages (landing, blueprint) can prerender for fast TTFB.
// Vault and onboarding are client-only because they require WebCrypto,
// IndexedDB, and WebAuthn — all of which are unavailable on the server.
export const prerender = 'auto';
export const ssr = true;
export const trailingSlash = 'never';
