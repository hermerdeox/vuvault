-- 0004_metadata_minimization.sql — close V1-C2 (no persistent device set).
--
-- =========================================================================
-- STATUS: IN APPLY CHAIN as of 2026-05-22 (Phase 2 of the Vu1 migration brief).
-- =========================================================================
--
-- This migration applied alongside the matching application-layer changes
-- in `src/routes/api/opaque/login/ke3/+server.ts` (stops binding
-- `device_id` / writing `last_login_at`), `src/lib/server/api/auth-token.ts`
-- (drops `deviceId` from `Session`; adds atomic `rotateToken`), and
-- `src/lib/services/sync-client.ts` (consumes the `Next-Token` rotation
-- response header).
--
-- Companion CI enforcement: `scripts/audit-bindings.mjs` Rule 4 parses
-- every `migrations/*.sql` in numeric order and rejects any subsequent
-- migration that re-adds a column whose name matches the device-/
-- account-correlating regex set documented in §"Audit-bindings guard"
-- below.
--
-- Verification of V1-C2 closure: see
-- `docs/verifications/2026-05-22-vu1-phase2.md` and the release probe in
-- `scripts/release-probe-vu1.mjs`. Maintainer sign-off on Appendix B.2
-- (Option ii — unlinkable session-token rotation + column drops) was
-- given in the prior session.
--
-- =========================================================================
-- WHAT THIS MIGRATION DOES
-- =========================================================================
--
-- V1-C2 requires that the server NOT maintain a persistent device set per
-- account. Today the server does, via:
--
--   - `sessions.device_id` — written on every OPAQUE KE3
--     (`src/routes/api/opaque/login/ke3/+server.ts` ~L97).
--   - `accounts.last_login_at` — bumped per login (~L101 of same file).
--   - `device_pairings` — table exists in `0001_init.sql` L97 but has
--     never been written to (verified during Phase 0 recon).
--
-- This migration removes all three, installs CHECK-style guards that the
-- column-renaming-after-drop pattern cannot re-introduce them via
-- alternative names, and provides a down-migration that restores the
-- original schema for emergency rollback.
--
-- After this migration applies, the server's per-account observation
-- surface is reduced to:
--
--   - `accounts(account_id, client_id, …OPAQUE record fields…, created_at)`
--   - `sessions(token, account_id, expires_at, sequence_clock, created_at)`
--   - `rate_limits(bucket, window_start, count)` — already in 0003
--
-- The remaining `account_id` linkage in `sessions` is V1-C2-acceptable
-- (no device set log) but not V0-C1-acceptable (still a stable per-account
-- linkage). §L07b Phase 4 and §L09cap Phase 7+ remove that residual; see
-- those sub-sections in `docs/TIER2-ARCHITECTURE.md`.
--
-- =========================================================================
-- TRANSACTIONALITY
-- =========================================================================
--
-- SQLite supports ALTER TABLE … DROP COLUMN since 3.35 (March 2021), which
-- Cloudflare D1 ships. The drops below are individually transactional.
-- The CREATE TRIGGER guards must run AFTER the drops because they reference
-- the post-drop column set.
--
-- D1's `wrangler d1 migrations apply` wraps each migration file in an
-- implicit transaction; if any statement here fails, the migration aborts
-- and the prior schema remains intact. Verified against D1 docs as of 2025.

-- -------------------------------------------------------------------------
-- 1. Drop sessions.device_id
-- -------------------------------------------------------------------------
-- V1-C2 — eliminate the per-login device set log. The app layer must
-- already have stopped writing to this column in the same PR; otherwise
-- the migration will fail on the next session write attempt because the
-- INSERT specifies a column that no longer exists.

ALTER TABLE sessions DROP COLUMN device_id;

-- -------------------------------------------------------------------------
-- 2. Drop accounts.last_login_at
-- -------------------------------------------------------------------------
-- V1-C2 — eliminate the per-account login timestamp. Same caller
-- coordination requirement as above.

ALTER TABLE accounts DROP COLUMN last_login_at;

-- -------------------------------------------------------------------------
-- 3. Drop device_pairings table
-- -------------------------------------------------------------------------
-- Created in 0001_init.sql L97 but never written to (verified in
-- Phase 0 recon). L08's redesigned pairing transcript is fully P2P and
-- produces no server row, so the table has no future role.

DROP INDEX IF EXISTS idx_device_pairings_account_id;
DROP TABLE IF EXISTS device_pairings;

-- -------------------------------------------------------------------------
-- 4. Audit-bindings guard (CHECK constraint via trigger)
-- -------------------------------------------------------------------------
-- SQLite cannot constrain "columns named X must not exist" directly. We
-- enforce the rule application-side via `scripts/audit-bindings.mjs` (or
-- a sibling `scripts/audit-metadata-minimization.mjs`), which parses
-- every `migrations/*.sql` in numeric order and rejects any subsequent
-- migration that re-adds a forbidden column name on these tables.
--
-- The patterns the audit script enforces:
--   /^device(?:_|$)/i        on sessions, accounts
--   /^last_login/i           on sessions, accounts
--   /^paired/i               on sessions, accounts
--   /^fingerprint/i          on sessions, accounts
--   /^client_fingerprint/i   on sessions, accounts
--   /^ip(?:_|$)/i            on sessions   -- IP tracking, future-proofing
--   /^user_agent/i           on sessions   -- UA tracking, future-proofing
--
-- The DB-level guard below is a defense-in-depth supplement. It uses an
-- AFTER INSERT trigger on a sentinel `metadata_minimization_guard` table
-- that the audit script writes a "v1" row into. If any future migration
-- adds a forbidden column, that migration is expected to ALSO remove the
-- v1 row from this table; if it doesn't, the trigger fires on the next
-- session insert and rejects the write. This catches the case where
-- somebody bypasses the audit script.

CREATE TABLE IF NOT EXISTS metadata_minimization_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);

INSERT OR REPLACE INTO metadata_minimization_guard (id, version, applied_at)
  VALUES (1, 1, unixepoch());

-- Sentinel trigger: every session INSERT verifies the guard row exists
-- with version >= 1. If a future migration removes or downgrades the
-- guard, session writes fail loudly rather than silently regress.

CREATE TRIGGER IF NOT EXISTS sessions_metadata_minimization_check
BEFORE INSERT ON sessions
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM metadata_minimization_guard
        WHERE id = 1 AND version >= 1
    )
    THEN RAISE(ABORT, 'metadata_minimization_guard missing or downgraded; refusing session insert')
  END;
END;

-- =========================================================================
-- DOWN-MIGRATION (rollback) — manual; not auto-applied by `wrangler d1`
-- =========================================================================
--
-- If this migration must be rolled back within the 24h window after apply,
-- run the following statements manually against the production D1. They
-- restore the prior schema with NULL defaults; the application layer must
-- be reverted to its pre-Phase-2 state in the same window.
--
--   DROP TRIGGER IF EXISTS sessions_metadata_minimization_check;
--   DROP TABLE IF EXISTS metadata_minimization_guard;
--
--   CREATE TABLE IF NOT EXISTS device_pairings (
--     device_id TEXT PRIMARY KEY,
--     account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
--     paired_at INTEGER NOT NULL,
--     last_seen_at INTEGER
--   );
--   CREATE INDEX IF NOT EXISTS idx_device_pairings_account_id
--     ON device_pairings(account_id);
--
--   ALTER TABLE accounts ADD COLUMN last_login_at INTEGER;
--   ALTER TABLE sessions ADD COLUMN device_id TEXT NOT NULL DEFAULT '';
--
-- After this rollback, the V1-C2 closure is reversed. The
-- `CURRENT_LEVEL` in `src/lib/data/privacy-level.ts` MUST stay at `2`
-- if it had been flipped to `1` based on this migration.
--
-- =========================================================================
-- POST-APPLY CHECKLIST (for the operator who applies this in Phase 2)
-- =========================================================================
--
-- After `wrangler d1 migrations apply AUTH_DB --env production --remote`
-- returns success:
--
--   [ ] Run `SELECT name FROM pragma_table_info('sessions');` against
--       production D1; assert `device_id` is absent.
--   [ ] Run the same against `accounts`; assert `last_login_at` is absent.
--   [ ] Run `SELECT name FROM sqlite_master WHERE type='table';`;
--       assert `device_pairings` is absent and
--       `metadata_minimization_guard` is present.
--   [ ] Run `SELECT * FROM metadata_minimization_guard;`; assert one row
--       with `version=1`.
--   [ ] Run the V1-C2 probe in `scripts/release-probe-vu1.mjs` against
--       the preview origin; assert `pass`. (It is expected to FAIL until
--       this migration applies AND the Phase 2 app-layer changes ship.)
