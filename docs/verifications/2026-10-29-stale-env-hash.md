# Stale `/_app/env.js` at the edge — incident note and fix

**Date:** 2026-10-29 (found while verifying the v0.4.1 deploy)
**Severity:** production unlock / onboarding / restore refused on affected
edges — the in-page bundle-integrity gate fails closed.

## What was observed

After the v0.4.1 deploy, a real browser against `https://vuvault.app`
loaded `/_app/env.js` carrying `PUBLIC_BUNDLE_HASH = 41257c…` — the
**v0.3.1** digest from a week earlier — while the `no-store` manifest
hashed to the signed v0.4.1 digest `75bf03…`. `cf-cache-status: HIT`,
`cache-control: max-age=14400`. A cache-busted fetch of the same URL
returned `75bf03…`, so the origin was correct and only the edge copy was
stale. The verifier compares the recomputed digest with the module value
and would therefore report `mismatch` and refuse to decrypt.

The hazard was known: f0d9561 and 7d103c8 traced it and concluded the
fix had to be a zone Cache Rule set out of band. That rule is not in
effect, and every release re-opens the window.

## Fix

1. **Client self-heals** (`src/lib/utils/env.ts`): `verifyBundleIntegrity`
   now reads the hash with a cache-busted `no-store` fetch of
   `/_app/env.js` (`ensureFreshBundleHash`, once per page load) and
   compares against that; the baked module value is the fallback when
   the read fails. Results carry `staleEnv` so the UI can say so. The
   Emergency Kit and `.vukey` exports print the resolved hash.
   Trust argument: manifest and env both come from the origin, so an
   attacker who can only poison the edge cache cannot make a tampered
   bundle verify; one who controls the origin already defeats an
   in-bundle verifier (documented honest framing). Tests:
   `src/lib/utils/env.stale-env.test.ts`.
2. **Release workflow**: a "Purge the edge cache for /_app/env.js" step
   purges the URL when `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_CACHE_PURGE_TOKEN`
   are set, fails if the origin does not carry the release hash, and
   warns if the plain edge response is still stale.
3. **Runbook**: `docs/M3-DEPLOYMENT.md` documents the zone Cache Rule
   (`/_app/env.js` → Bypass cache) and the purge token.

## Operator actions still required

- Add the zone Cache Rule and purge `/_app/env.js` once by hand.
- Optionally add the two repository secrets so releases purge
  automatically.
