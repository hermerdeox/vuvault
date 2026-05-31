-- Migration 0005 — blob_references for Phase 4 §L07b
--
-- Closes V1-C1 + V1-C3 by replacing the per-account R2 prefix layout
-- (vaults/{accountId}/…) with a single global prefix (v2/blobs/{uuid})
-- and tracking liveness in a per-blob (NOT per-account) D1 table.
--
-- The reference-counted sweep (see src/lib/server/api/r2-gc.ts) relies
-- on this table: every authenticated PUT or heartbeat updates the
-- blob's `last_seen_at`; the GC purges anything that hasn't been
-- seen within the sweep window (default 14 days).
--
-- V1-C1 / V1-C3 invariant: this table MUST NOT carry an account_id
-- column. Adding one would re-introduce the per-account inventory
-- this migration is specifically designed to prevent. The
-- `metadata_minimization_guard` trigger from 0004 protects accounts
-- and sessions; we install a sibling guard for blob_references.
--
-- The inv_references table tracks inventory addresses analogously,
-- so an inventory blob whose owner abandons their device is purged
-- after the sweep window.

CREATE TABLE blob_references (
	blob_id      TEXT    PRIMARY KEY,         -- canonical UUID v4 string
	last_seen_at INTEGER NOT NULL,            -- unix seconds, server-side time
	bytes        INTEGER NOT NULL DEFAULT 0   -- size hint for GC cost accounting
);

CREATE INDEX blob_references_last_seen_idx
	ON blob_references (last_seen_at);

CREATE TABLE inv_references (
	addr         TEXT    PRIMARY KEY,         -- 26-char Crockford base32
	last_seen_at INTEGER NOT NULL,
	bytes        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX inv_references_last_seen_idx
	ON inv_references (last_seen_at);

-- Sentinel triggers — defense-in-depth against future migrations
-- accidentally re-introducing per-account columns. If the upstream
-- gain in metadata minimization is to be preserved, a column with a
-- name matching the device/account/user-correlating regex MUST NOT
-- be ALTER-TABLE-ADDed onto either reference table.
--
-- (SQLite doesn't support a generic "reject ALTER TABLE … ADD COLUMN
-- matching pattern", so we rely on the audit-bindings.mjs Rule 4 to
-- catch it at CI time. The trigger here is a redundant safeguard
-- against direct production SQL that bypasses the migration pipeline.)
CREATE TRIGGER blob_refs_no_account_drift
BEFORE INSERT ON blob_references
WHEN (SELECT count(*) FROM pragma_table_info('blob_references')
       WHERE name IN ('account_id', 'user_id', 'device_id', 'fingerprint',
                      'last_login_at', 'paired_at', 'ip', 'user_agent')) > 0
BEGIN
	SELECT RAISE(ABORT,
		'V1-C1 violation: blob_references must not carry account-correlating columns');
END;

CREATE TRIGGER inv_refs_no_account_drift
BEFORE INSERT ON inv_references
WHEN (SELECT count(*) FROM pragma_table_info('inv_references')
       WHERE name IN ('account_id', 'user_id', 'device_id', 'fingerprint',
                      'last_login_at', 'paired_at', 'ip', 'user_agent')) > 0
BEGIN
	SELECT RAISE(ABORT,
		'V1-C1 violation: inv_references must not carry account-correlating columns');
END;

-- Down-migration (informational; SQLite has no DROP TRIGGER IF EXISTS
-- in older versions but D1 supports it):
--
--   DROP TRIGGER IF EXISTS inv_refs_no_account_drift;
--   DROP TRIGGER IF EXISTS blob_refs_no_account_drift;
--   DROP INDEX IF EXISTS inv_references_last_seen_idx;
--   DROP TABLE IF EXISTS inv_references;
--   DROP INDEX IF EXISTS blob_references_last_seen_idx;
--   DROP TABLE IF EXISTS blob_references;
