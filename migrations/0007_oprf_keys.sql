-- Migration 0007 — per-epoch VOPRF secret keys for §L09cap V0-C1.
--
-- Each AKD epoch (see migration 0006) gets its own Ristretto255
-- VOPRF secret key. The key is the seed the server uses to
-- blind-evaluate every client's capability mint request during that
-- epoch. Rotating keys per epoch is what makes the capabilities
-- across epochs UNLINKABLE.
--
-- Storage shape:
--   - oprf_secret_keys(epoch_id, oprf_secret_hex, oprf_pubkey_hex, created_at)
--   - One row per epoch. Older rows can be pruned after the epoch's
--     capability_index window expires (Phase D §"GC policy").
--
-- V0-C1 invariant: this table MUST NOT carry an account_id /
-- user_id / device_id / similar correlating column. The
-- audit-bindings Rule 4 already enforces this for sessions and
-- accounts; here we add a DB-level guard trigger as defense in
-- depth (mirroring the one on akd_leaves).

CREATE TABLE oprf_secret_keys (
  epoch_id        INTEGER PRIMARY KEY REFERENCES akd_epochs(epoch_id) ON DELETE CASCADE,
  oprf_secret_hex TEXT    NOT NULL,    -- 64 hex = 32-byte Ristretto255 scalar (server-only)
  oprf_pubkey_hex TEXT    NOT NULL,    -- 64 hex = 32-byte Ristretto255 point (published via /api/v0/capability/...)
  created_at      INTEGER NOT NULL
);

CREATE INDEX oprf_secret_keys_created_idx ON oprf_secret_keys (created_at DESC);

CREATE TRIGGER oprf_keys_no_account_drift
BEFORE INSERT ON oprf_secret_keys
WHEN (SELECT count(*) FROM pragma_table_info('oprf_secret_keys')
       WHERE name IN ('account_id', 'user_id', 'device_id', 'fingerprint',
                      'last_login_at', 'paired_at', 'ip', 'user_agent',
                      'client_id')) > 0
BEGIN
  SELECT RAISE(ABORT,
    'V0-C1 violation: oprf_secret_keys must not carry account-correlating columns');
END;

-- Down-migration:
--   DROP TRIGGER IF EXISTS oprf_keys_no_account_drift;
--   DROP INDEX IF EXISTS oprf_secret_keys_created_idx;
--   DROP TABLE IF EXISTS oprf_secret_keys;
