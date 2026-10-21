-- 0010_anon_tokens.sql — V0-C1 anonymous request tokens.
--
-- =========================================================================
-- WHAT THIS MIGRATION DOES
-- =========================================================================
--
-- 1. Creates `anon_tokens_spent`, the replay set for the single-use
--    VOPRF tokens that now authorize `/api/v2/blobs/*` and
--    `/api/v2/inv/*` (see `src/lib/server/api/anon-tokens.ts`). A row
--    holds SHA-256 of a redeemed token input and the key window it was
--    minted under — nothing that identifies a session, account, device,
--    or network origin. Rows for windows that can no longer redeem are
--    swept opportunistically.
--
-- 2. Drops `capability_index`. The §L09cap capability scheme it served
--    committed every capability to an `account_id` at issuance, so the
--    server could resolve any "unlinkable" capability straight back to
--    its account. The anonymous tokens replace it; nothing reads the
--    table any more, and keeping it would retain that linkage at rest.
--
-- `oprf_secret_keys` (0007) is left in place but unused: token keys are
-- derived per UTC day from the AKD master key and never persisted.
--
-- =========================================================================

CREATE TABLE anon_tokens_spent (
  token_hash  TEXT    PRIMARY KEY,         -- 64 hex = SHA-256(token input)
  key_id      INTEGER NOT NULL,            -- UTC-day key window
  spent_at    INTEGER NOT NULL             -- unix seconds, server-side time
);

CREATE INDEX anon_tokens_spent_key_idx ON anon_tokens_spent (key_id);

-- Sentinel: refuse inserts if a future migration bolts an
-- account-correlating column onto the replay set.
CREATE TRIGGER anon_tokens_no_account_drift
BEFORE INSERT ON anon_tokens_spent
WHEN (SELECT count(*) FROM pragma_table_info('anon_tokens_spent')
       WHERE name IN ('account_id', 'user_id', 'device_id', 'fingerprint',
                      'last_login_at', 'paired_at', 'ip', 'user_agent',
                      'client_id', 'session_token')) > 0
BEGIN
  SELECT RAISE(ABORT,
    'V0-C1 violation: anon_tokens_spent must not carry account-correlating columns');
END;

DROP INDEX IF EXISTS capability_index_account_idx;
DROP INDEX IF EXISTS capability_index_issued_idx;
DROP TABLE IF EXISTS capability_index;
