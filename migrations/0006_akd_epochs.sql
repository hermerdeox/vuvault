-- Migration 0006 — AKD (Auditable Key Directory) epoch publication.
--
-- Closes the groundwork for V0-C1 (unlinkable routing identifiers).
-- Each AKD epoch is a Merkle commitment over the current set of
-- account leaves; the root is signed with an Ed25519 key the server
-- publishes via /api/akd/epochs/latest. Clients verify epoch
-- membership against the published root; capability handles (issued
-- against the OPRF key tied to each epoch — see migration 0007)
-- derive their unlinkability anchor from this commitment.
--
-- Phase 2+ of the Vu0 path will rotate epochs hourly via Cron Worker;
-- this migration ships the schema only. Epoch lifecycle code lives
-- in src/lib/server/api/akd-server.ts.
--
-- Per docs/TIER2-ARCHITECTURE.md §L09:
--   - Ed25519 signing keypair lives in env (AKD_SIGNING_KEY_HEX).
--   - Per-epoch Ed25519-VRF keypair is derived from the signing key
--     + epoch_id and is published in `vrf_pubkey_hex`.
--   - Each leaf's position is VRF(sk_e, accountHandle), so an
--     external observer with the published root + vrf_pubkey can
--     verify the leaf placement was honest without learning which
--     account it represents.

CREATE TABLE akd_epochs (
  epoch_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  root_hex        TEXT    NOT NULL,           -- 96 hex = SHA-384(root) of the sparse Merkle tree
  vrf_pubkey_hex  TEXT    NOT NULL,           -- 64 hex = Ed25519 pubkey for this epoch's VRF
  signed_at       INTEGER NOT NULL,           -- unix seconds at epoch mint
  signature_hex   TEXT    NOT NULL,           -- 128 hex = Ed25519(akd_signing_key, root || vrf_pubkey || signed_at)
  leaf_count      INTEGER NOT NULL DEFAULT 0  -- denormalized for /epochs/latest summary
);

CREATE INDEX akd_epochs_signed_at_idx ON akd_epochs (signed_at DESC);

CREATE TABLE akd_leaves (
  epoch_id      INTEGER NOT NULL REFERENCES akd_epochs(epoch_id) ON DELETE CASCADE,
  leaf_pos_hex  TEXT    NOT NULL,             -- 96 hex = SHA-384(VRF output) — Merkle tree key
  leaf_hash_hex TEXT    NOT NULL,             -- 96 hex = SHA-384(account_handle || epoch_id || account_state_root)
  account_handle TEXT   NOT NULL,             -- opaque per-account identifier (HKDF of opaque_export_key); see §L09cap
  PRIMARY KEY (epoch_id, leaf_pos_hex)
);

CREATE INDEX akd_leaves_epoch_idx ON akd_leaves (epoch_id);
CREATE INDEX akd_leaves_handle_idx ON akd_leaves (account_handle);

-- Sentinel guard: AKD tables must NEVER carry an account_id /
-- device_id / user_id / similar correlating column. The
-- audit-bindings.mjs Rule 4 already enforces this for sessions and
-- accounts; here we install a DB-level trigger as defense in depth.
-- The trigger fires before INSERT on akd_leaves and fails if the
-- table schema has grown a forbidden column.
CREATE TRIGGER akd_leaves_no_account_drift
BEFORE INSERT ON akd_leaves
WHEN (SELECT count(*) FROM pragma_table_info('akd_leaves')
       WHERE name IN ('account_id', 'user_id', 'device_id', 'fingerprint',
                      'last_login_at', 'paired_at', 'ip', 'user_agent',
                      'client_id')) > 0
BEGIN
  SELECT RAISE(ABORT,
    'V0-C1 violation: akd_leaves must not carry account-correlating columns');
END;

-- Down-migration:
--   DROP TRIGGER IF EXISTS akd_leaves_no_account_drift;
--   DROP INDEX IF EXISTS akd_leaves_handle_idx;
--   DROP INDEX IF EXISTS akd_leaves_epoch_idx;
--   DROP TABLE IF EXISTS akd_leaves;
--   DROP INDEX IF EXISTS akd_epochs_signed_at_idx;
--   DROP TABLE IF EXISTS akd_epochs;
