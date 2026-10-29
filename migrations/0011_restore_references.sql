-- 0011_restore_references.sql — new-device restore records.
--
-- Tracks liveness of the sealed restore records a device writes to
-- `v2/restore/<addr>.bin` (see src/lib/crypto/restore-record.ts and
-- src/routes/api/v2/restore/[addr]/+server.ts) exactly the way
-- `inv_references` tracks inventories: by address only, never by
-- account. The reference GC (src/lib/server/api/r2-gc.ts) purges a
-- record not written or read for 60 days.
--
-- Addresses are fresh per (UTC day, slot) and derive from a root the
-- server cannot compute, so a row here is an unlinkable pseudonym that
-- never recurs — no per-account inventory is reintroduced (V1-C1,
-- V0-C1).

CREATE TABLE restore_references (
	addr         TEXT    PRIMARY KEY,         -- 26-char Crockford base32
	last_seen_at INTEGER NOT NULL,            -- unix seconds, server-side time
	bytes        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX restore_references_last_seen_idx
	ON restore_references (last_seen_at);

-- Sentinel: refuse inserts if a future migration bolts an
-- account-correlating column onto this table.
CREATE TRIGGER restore_refs_no_account_drift
BEFORE INSERT ON restore_references
WHEN (SELECT count(*) FROM pragma_table_info('restore_references')
       WHERE name IN ('account_id', 'user_id', 'device_id', 'fingerprint',
                      'last_login_at', 'paired_at', 'ip', 'user_agent',
                      'client_id', 'session_token')) > 0
BEGIN
	SELECT RAISE(ABORT,
		'V1-C1 violation: restore_references must not carry account-correlating columns');
END;
