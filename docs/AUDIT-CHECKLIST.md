# VuVault Audit Checklist

**Audience:** Third-party security auditors evaluating the Tier 1 stack (M4 launch gate).
**Companion:** [`docs/THREAT-MODEL.md`](./THREAT-MODEL.md), [`docs/SECURITY.md`](./SECURITY.md), [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md), [`sbom.json`](../sbom.json) (generated; run `npm run sbom`).

This document maps every security-relevant claim VuVault makes to:

1. The exact file(s) implementing the claim.
2. The command an auditor runs to verify the claim from a clean checkout.
3. The expected output / artifact.

Every command in this document is reproducible from `git checkout <release-tag> && npm ci`. Anything that is NOT reproducible is a bug — file it.

---

## 0. Repo bring-up

```bash
git clone https://github.com/hermerdeox/vuvault.git
cd vuvault
git checkout <release-tag>          # e.g. v0.1.11
npm ci --legacy-peer-deps
```

`--legacy-peer-deps` is required because of the `@sveltejs/adapter-cloudflare` ⟷ `wrangler` peer relationship. See `.github/workflows/ci.yml` for the canonical install line.

---

## 1. Cryptographic primitives

| Claim | Implementation | Verification command | Expected evidence |
| --- | --- | --- | --- |
| Hybrid X25519 + ML-KEM-1024 envelope (FIPS 203) | [`src/lib/crypto/envelope.ts`](../src/lib/crypto/envelope.ts), [`src/lib/services/vault-envelope.ts`](../src/lib/services/vault-envelope.ts) | `npm run test src/lib/crypto/envelope.test.ts src/lib/services/vault-envelope.test.ts` | 15+ assertions pass; round-trip, tamper, wrong-key, deterministic keypair derivation |
| ML-KEM-1024 byte-for-byte against pinned regression vectors | [`src/lib/crypto/ml-kem-1024.kat.test.ts`](../src/lib/crypto/ml-kem-1024.kat.test.ts) | `npm run test:fips` | 5+ deterministic seed-based vectors; verifies `kat.nobleVersion` matches `@noble/post-quantum@0.4.1` |
| ML-KEM-1024 against NIST ACVP keyGen (tcId 51–55) | [`src/lib/crypto/ml-kem-1024.acvp.kat.test.ts`](../src/lib/crypto/ml-kem-1024.acvp.kat.test.ts), [`src/lib/crypto/kat/ml-kem-1024-acvp.json`](../src/lib/crypto/kat/ml-kem-1024-acvp.json) | `npm run test:fips` | 5 NIST vectors; ek + dk byte-identical |
| Argon2id RFC 9106 §5.3 KAT | [`src/lib/crypto/argon2id-rfc9106.kat.test.ts`](../src/lib/crypto/argon2id-rfc9106.kat.test.ts), [`src/lib/crypto/kat/argon2id-rfc9106.json`](../src/lib/crypto/kat/argon2id-rfc9106.json) | `npm run test:fips` | Canonical RFC 9106 §5.3 vector matches |
| Argon2id production parameters (256 MiB / 4 / p=1, 32-byte tag) | [`src/lib/crypto/argon2.ts`](../src/lib/crypto/argon2.ts) | `npm run test src/lib/crypto/argon2.test.ts` | 8 assertions including `VAULT_HIGH_PARAMS` pin |
| OPAQUE (RFC 9807) client + server engine | [`src/lib/services/opaque-client.ts`](../src/lib/services/opaque-client.ts), [`src/lib/server/api/server-opaque.ts`](../src/lib/server/api/server-opaque.ts) | `npm run test src/lib/services/opaque-client.test.ts tests/integration/worker.spec.ts` | Register-then-login round trip; wrong-password rejection; export-key parity |
| HKDF-SHA512 vault-key derivation | [`src/lib/crypto/derive.ts`](../src/lib/crypto/derive.ts) | `npm run test src/lib/crypto/derive.test.ts` | 10+ vector assertions with v1/v2 dispatch |
| Local Recovery Envelope (Argon2id + Secret Key) | [`src/lib/crypto/recovery-envelope.ts`](../src/lib/crypto/recovery-envelope.ts) | `npm run test src/lib/crypto/recovery-envelope.test.ts` | Round-trip + wrong-password / wrong-context rejection |

---

## 2. Server-side stack

| Claim | Implementation | Verification command | Expected evidence |
| --- | --- | --- | --- |
| D1 schema captures only RFC 9807 envelope fields, no password equivalent | [`migrations/0001_init.sql`](../migrations/0001_init.sql) | `cat migrations/0001_init.sql` | `accounts` table has `envelope_bytes` + `oprf_secret_key`; no `password_hash`, `master_key`, etc. |
| Server identity loaded from D1, all-zero rejected | [`src/lib/server/api/d1-storage.ts`](../src/lib/server/api/d1-storage.ts) `loadServerIdentity` | `npm run test tests/integration/worker.spec.ts` | "rejects an all-zero D1 OPAQUE server identity seed" test passes |
| Per-env OPAQUE serverIdentity (no preview↔production replay) | [`wrangler.toml`](../wrangler.toml) `[vars]` + `[env.production.vars]` | `node scripts/audit-bindings.mjs` + `grep -F OPAQUE_SERVER_ID wrangler.toml` | Two distinct values; preview = `preview.vuvault.app`, production = `vuvault.app` |
| Bearer token revoked server-side on lock | [`src/routes/api/opaque/logout/+server.ts`](../src/routes/api/opaque/logout/+server.ts), wired in [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts) `lockSession()` | `grep -F opaqueLogout src/lib/services/vault-session.ts` | Fire-and-forget call before zeroize |
| Monotonic sequence clock enforced server-side | [`src/lib/server/api/auth-token.ts`](../src/lib/server/api/auth-token.ts) `advanceSequenceClock`, [`src/routes/api/blobs/upload/+server.ts`](../src/routes/api/blobs/upload/+server.ts) | `npm run test tests/integration/api-routes.spec.ts` | "enforces monotonic sequence clocks" + "rejects stale uploads against the durable account sequence clock" pass |
| D1-backed sliding-window rate limit | [`src/lib/server/api/rate-limit-d1.ts`](../src/lib/server/api/rate-limit-d1.ts) | `npm run test src/lib/server/api/rate-limit-d1.test.ts` | 11 tests covering quota, fail-open, fail-closed, mode resolution |
| Production rate-limit fails closed on D1 outage | Same | `npm run test tests/integration/api-routes.spec.ts -t "fails closed"` | 503 with `fail-closed` mode; 200/400 with `fail-open` |
| Opportunistic D1 row cleanup (pending state, sessions, rate limits) | [`src/lib/server/api/cleanup.ts`](../src/lib/server/api/cleanup.ts) | `npm run test src/lib/server/api/cleanup.test.ts` | 3 tests; deterministic sweepNow + partial-failure tolerance |
| Opportunistic R2 garbage collection (superseded vault blobs + dormant document blobs) | [`src/lib/server/api/r2-gc.ts`](../src/lib/server/api/r2-gc.ts) | `npm run test src/lib/server/api/r2-gc.test.ts` | 5 tests covering vault-blob age-out, doc-blob age-out, prefix isolation, R2-failure tolerance |
| API route ↔ Env interface ↔ wrangler.toml parity | [`scripts/audit-bindings.mjs`](../scripts/audit-bindings.mjs) | `node scripts/audit-bindings.mjs` | `audit-bindings: OK (2 Env bindings × 2 envs verified, 7 vars tracked)` |

---

## 3. Bundle integrity & supply chain

| Claim | Implementation | Verification command | Expected evidence |
| --- | --- | --- | --- |
| SHA-384 per-chunk manifest emitted at build | [`scripts/build-manifest.mjs`](../scripts/build-manifest.mjs) | `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD) npm run build` | `.bundle-digest` written; manifest under `.svelte-kit/cloudflare/_app/immutable/bundle-manifest.json` |
| Reproducible build (two-pass digest convergence) | [`scripts/verify-reproducible.mjs`](../scripts/verify-reproducible.mjs) | `SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD) node scripts/verify-reproducible.mjs` | Two builds produce byte-identical `.bundle-digest` |
| Bundle integrity verified at every unlock | [`src/lib/utils/env.ts`](../src/lib/utils/env.ts) `verifyBundleIntegrity()` | `npm run test src/lib/utils/env.test.ts src/lib/utils/env.tamper.test.ts` | 10 assertions including adversarial tamper probes |
| Sigstore + Rekor keyless signing on release | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | `gh release view <tag>` | Release artifacts include `.sig`, `.pem`, and `.rekor.json` |
| Crypto dep version pins (exact, no ^/~/>=) | [`scripts/verify-pins.mjs`](../scripts/verify-pins.mjs) | `node scripts/verify-pins.mjs` | `verify-pins: OK (3 npm pins + 2 cosign pins verified)` |
| Production runtime preflight (no demo auth, no e2e auth, valid bundle hash) | [`scripts/verify-production-runtime.mjs`](../scripts/verify-production-runtime.mjs) | See `.github/workflows/release.yml` `Verify production runtime configuration` step | Exits 0 only with `PUBLIC_ENABLE_DEMO_AUTH=false`, `PUBLIC_M3_E2E_AUTH=false`, HTTPS sync origin, valid `.m3-e2e-passed` |
| CycloneDX SBOM | [`scripts/build-sbom.mjs`](../scripts/build-sbom.mjs) | `npm run sbom` | `sbom.json` written; deterministic SHA-384 printed |

---

## 4. Client-side hardening

| Claim | Implementation | Verification command | Expected evidence |
| --- | --- | --- | --- |
| Strict CSP (no third-party origins, `wasm-unsafe-eval` for WASM only, `frame-src 'none'`, `object-src 'none'`) | [`svelte.config.js`](../svelte.config.js) | `grep -F csp svelte.config.js`; live deploy `curl -I https://<origin>` | CSP header present; no `unsafe-eval`, no `unsafe-inline` for scripts |
| HSTS + nosniff + no-referrer + COOP same-origin + CORP same-origin | [`src/lib/server/security-headers.ts`](../src/lib/server/security-headers.ts), `static/_headers` | `curl -I https://<origin>` | All headers present in production response |
| Zero third-party URLs in shipped JS | CI "Third-party URL guard" | `.github/workflows/ci.yml` (the explicit grep step) | Step passes; no `https://` literals outside docs/static |
| AES-GCM AAD binds formatVersion + auth-mode + deviceSalt + credId digest | [`src/lib/services/vault-session.ts`](../src/lib/services/vault-session.ts), [`src/lib/services/vault-envelope.ts`](../src/lib/services/vault-envelope.ts) | `npm run test src/lib/services/vault-session.test.ts` | 20+ assertions including cross-account/cross-format tamper rejection |
| Plaintext never leaves IndexedDB unencrypted | [`tests/e2e/full-workflow.spec.ts`](../tests/e2e/full-workflow.spec.ts) "zero-knowledge IDB inspection" | `npm run test:e2e -- tests/e2e/full-workflow.spec.ts` (requires dev server) | E2E asserts none of the 7 typed plaintext secrets appear anywhere in encrypted IDB rows |
| Auto-lock (5min idle / 30s hidden / pagehide) | [`src/lib/services/auto-lock.ts`](../src/lib/services/auto-lock.ts) | `npm run test src/lib/services/auto-lock.test.ts` | Idle, visibility-change, pagehide branches |
| Clipboard auto-clear (60s, on lock) | [`src/lib/services/secure-clipboard.ts`](../src/lib/services/secure-clipboard.ts) | `npm run test src/lib/services/secure-clipboard.test.ts` | Clear timer + lock-triggered clear assertions |
| Mobile WCAG 2.5.5 touch-target floor (44×44) | [`tests/e2e/mobile-responsive.spec.ts`](../tests/e2e/mobile-responsive.spec.ts) | `npm run test:e2e -- tests/e2e/mobile-responsive.spec.ts` (requires dev server) | "primary vault chrome hits at least 44×44 CSS px" passes |

---

## 5. Live-deploy verification

These commands target a running production deploy. Replace `https://<origin>` with the production URL (per release notes, `https://vuvault.app`).

```bash
# 5.1 Security headers
curl -I https://<origin> | grep -E "(strict-transport|content-security|cross-origin|referrer-policy|x-content-type)"

# 5.2 Capabilities endpoint (public, no auth)
curl -s https://<origin>/api/capabilities | jq .

# 5.3 Rate-limit burst probe (12 requests in quick succession should yield at least one 429/503)
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST \
    -H 'content-type: application/json' \
    -d '{"clientId":"audit-probe","request":"AA=="}' \
    https://<origin>/api/opaque/register/request
done

# 5.4 Bundle digest matches Rekor
curl -s https://<origin>/_app/immutable/bundle-manifest.json | jq -r '.aggregateDigest'
# Compare against `gh release view <tag>` `.bundle-digest` artifact
# and against the entry on https://search.sigstore.dev/?hash=<digest>

# 5.5 Verify the SvelteKit Worker accepts only same-origin Authorization
curl -i -X POST https://<origin>/api/blobs/upload    # expect 401 unauthorized
```

---

## 6. Audit firm hand-off checklist

When engaging a third-party crypto audit (Cure53, NCC, Trail of Bits, etc.), the firm receives:

- [x] Release tag (immutable Git ref)
- [x] Release commit SHA
- [x] [`sbom.json`](../sbom.json) (run `npm run sbom`)
- [x] [`.bundle-digest`](../.bundle-digest)
- [x] Rekor entry URL
- [x] [`docs/THREAT-MODEL.md`](./THREAT-MODEL.md)
- [x] [`docs/SECURITY.md`](./SECURITY.md)
- [x] [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- [x] [`docs/PRIVACY-LEVEL.md`](./PRIVACY-LEVEL.md)
- [x] This document
- [x] Read-only access to the GitHub repository
- [x] Read-only access to CI build logs for the release
- [ ] Read-only access to production Cloudflare dashboard (D1 / R2 / Pages logs) — granted on engagement
- [ ] Bug-bounty terms (see [`docs/SECURITY.md`](./SECURITY.md) §"Reporting a vulnerability")

---

## 7. Known scope exclusions

The auditor is NOT expected to test:

- Endpoint malware resistance — out of scope per `SECURITY.md` B1.
- Side-channel resistance of the browser-vendor WebCrypto implementation — `SECURITY.md` B3.
- Nation-state TPM + firmware + browser update channel compromise — `SECURITY.md` B5.
- Tier 2+ features (MLS, CRDT, WebRTC, AKD, PIR, FROST) — none are shipped; see [`docs/TIER2-ARCHITECTURE.md`](./TIER2-ARCHITECTURE.md) for forward-looking specifications only.

If the auditor wants to expand scope into any of the above, that is a separate engagement.

---

## 8. Maintenance

This document is updated by the engineering team on every release that changes a primitive, schema, route, or control. The `last reviewed` line below is the canonical pointer; if it's older than the release tag the auditor is examining, the auditor should ask for a refresh.

- **Last reviewed:** 2026-05-19 (post-v0.1.11 milestone audit)
- **Next review:** Before the Tier 1 third-party audit kickoff
