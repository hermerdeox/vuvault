-- seed_server_identity.sql — emergency OPAQUE server identity rotation helper.
--
-- Normal first-deploy seeding is automated by:
--
--   node scripts/seed-opaque-identity.mjs --env=production --rotate=false
--
-- This SQL file is intentionally a manual fallback for emergency
-- rotation only. Re-running it rotates the OPAQUE server identity.
-- Every existing registration_record becomes unreadable on rotation;
-- users cannot log in until they re-register.
--
-- Run only with an explicit replacement seed:
--
--   wrangler d1 execute AUTH_DB \
--     --env=production \
--     --remote \
--     --file=migrations/seed_server_identity.sql
--
-- The 32 bytes below MUST be replaced with a valid OPAQUE server
-- secret scalar. Prefer the checked-in script:
--
--   ALLOW_OPAQUE_ROTATION=true \
--     node scripts/seed-opaque-identity.mjs --env=production --rotate=true
--
-- If using this SQL manually, paste the script-generated hex into the
-- `WHERE 1=1` branch below and quote it as `X'...'` (SQLite hex blob
-- syntax). The fallback below is a no-op (`WHERE 1=0`) so that blind
-- execution of this file cannot write a placeholder seed. The runtime
-- additionally refuses to load an all-zero seed via
-- `loadServerIdentity()` in `src/lib/server/api/d1-storage.ts`.

INSERT OR REPLACE INTO server_identity (id, oprf_seed, created_at)
SELECT
	1,
	X'00',
	unixepoch()
WHERE 1=0;
-- Replace `WHERE 1=0` with `WHERE 1=1` and the placeholder `X'00'`
-- with a script-generated 32-byte hex blob to actually rotate.
