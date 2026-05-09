-- seed_server_identity.sql — one-shot OPAQUE server identity seed.
--
-- Run ONCE at first deploy:
--
--   wrangler d1 execute AUTH_DB \
--     --env=production \
--     --remote \
--     --file=functions/api/_shared/migrations/seed_server_identity.sql
--
-- Re-running this rotates the OPAQUE server identity. Every existing
-- registration_record becomes unreadable on rotation; users cannot
-- log in until they re-register. This is intentional — there is no
-- "soft" rotation path because the server cannot decrypt records
-- with the wrong oprfSeed.
--
-- The 32 bytes below MUST be replaced with the output of:
--
--   node -e "console.log(crypto.randomBytes(32).toString('hex'))"
--
-- and quoted as `X'...'` (SQLite hex blob syntax). The placeholder
-- below is invalid by design — the deploy will refuse to load it.

INSERT OR REPLACE INTO server_identity (id, oprf_seed, created_at)
VALUES (
	1,
	X'0000000000000000000000000000000000000000000000000000000000000000',
	unixepoch()
);
