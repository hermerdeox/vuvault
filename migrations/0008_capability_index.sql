-- Migration 0008 — capability_index lookup table (Vu0 §L09cap).
--
-- After a client mints a fresh capability via POST /api/v0/capability/issue,
-- the server records the (epoch_id, capability_hex) → account_id
-- mapping HERE. Subsequent V2 route requests use the capability as
-- the auth credential; the server looks up the account_id row to
-- resolve the session.
--
-- IMPORTANT V0-C1 NUANCE:
--   - The `account_id` column WOULD link the capability back to an
--     account IF an external observer also had the capability_hex.
--     But the capability_hex is ONLY exchanged over the network
--     during the issue step (which is authenticated and rate-limited)
--     and over subsequent authenticated requests. A passive R2 / D1
--     observer (without Cloudflare API access) cannot recover this
--     mapping.
--   - An AUTHORIZED AUDITOR with D1 access CAN link
--     (capability_hex → account_id). This is documented in
--     docs/TIER2-ARCHITECTURE.md §L09cap as an acceptable Vu0
--     trade-off: the server inherently needs to route the request
--     to the right account, so some D1-level linkage is unavoidable
--     short of full PIR (Tier 3+).
--   - What the table DOES enforce: external observers (Cloudflare
--     edge logs, R2 metadata, public APIs) cannot link two
--     different-epoch capabilities to the same account.
--
-- Lifecycle:
--   - Insert: on POST /api/v0/capability/issue success.
--   - Read:   on every V2 route with X-Vu0-Capability header.
--   - Delete: when the epoch is fully aged out (the OPRF secret is
--             pruned alongside per Phase D's GC policy).

CREATE TABLE capability_index (
  epoch_id        INTEGER NOT NULL REFERENCES akd_epochs(epoch_id) ON DELETE CASCADE,
  capability_hex  TEXT    NOT NULL,            -- 64 hex = 32 bytes of capability handle
  account_id      TEXT    NOT NULL,            -- internal-only; never echoed on the wire
  issued_at       INTEGER NOT NULL,
  PRIMARY KEY (epoch_id, capability_hex)
);

CREATE INDEX capability_index_account_idx ON capability_index (account_id);
CREATE INDEX capability_index_issued_idx  ON capability_index (issued_at);

-- Down-migration:
--   DROP INDEX IF EXISTS capability_index_issued_idx;
--   DROP INDEX IF EXISTS capability_index_account_idx;
--   DROP TABLE IF EXISTS capability_index;
