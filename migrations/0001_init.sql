-- 0001_init.sql — initial D1 schema for the M3 sync Worker.
--
-- Five tables. Surrogate keys are RFC 9807 OPAQUE protocol fields or
-- server-allocated UUIDs. The schema is deliberately minimal:
-- zero-knowledge invariant (server stores only what it needs to run
-- the protocol; never any plaintext or password equivalent) plus
-- the account-existence / total-blob-volume oracles that
-- SECURITY.md explicitly documents as out-of-scope of the ZK claim.
--
-- All BLOB columns are raw bytes (never hex). All TEXT columns are
-- UTF-8. Timestamps are UNIX seconds (INTEGER) — D1's strftime is
-- locale-sensitive so we never use it.

PRAGMA foreign_keys = ON;

-- The single server identity row. `oprf_seed` is a 32-byte secret
-- generated once at first deploy via the seed-server-identity
-- one-shot SQL. Rotating it invalidates every existing OPAQUE
-- registration record, so it's append-only by convention.
CREATE TABLE IF NOT EXISTS server_identity (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	oprf_seed BLOB NOT NULL,
	created_at INTEGER NOT NULL
);

-- One row per OPAQUE-registered account. `client_id` is the
-- user-presented identifier (deterministic from the device, NOT the
-- password). `account_id` is server-allocated (a UUID) so client and
-- account namespaces stay separate.
--
-- The four BLOB columns (`client_public_key`, `masking_key`,
-- `envelope_bytes`, `oprf_secret_key`) are the parsed RFC 9807
-- registration record fields. `registration_record` is the redundant
-- concatenation kept for forensic/debug parity with the wire format.
CREATE TABLE IF NOT EXISTS accounts (
	account_id TEXT PRIMARY KEY,
	client_id TEXT NOT NULL UNIQUE,
	client_public_key BLOB NOT NULL,
	masking_key BLOB NOT NULL,
	envelope_bytes BLOB NOT NULL,
	oprf_secret_key BLOB NOT NULL,
	registration_record BLOB NOT NULL,
	created_at INTEGER NOT NULL,
	last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_accounts_client_id ON accounts(client_id);

-- In-flight registration state: server-issued OPRF secret kept until
-- the client posts the matching record. Rows older than ~30s are
-- considered expired (enforced by the storage adapter via
-- created_at filter; backstop GC by the cleanup trigger).
CREATE TABLE IF NOT EXISTS pending_registrations (
	request_id TEXT PRIMARY KEY,
	client_id TEXT NOT NULL,
	oprf_secret_key BLOB NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_regs_created_at ON pending_registrations(created_at);

-- In-flight login state: server AKE state retained between KE2 and
-- KE3. Same 30s TTL as pending_registrations.
CREATE TABLE IF NOT EXISTS pending_logins (
	request_id TEXT PRIMARY KEY,
	client_id TEXT NOT NULL,
	ake_state TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_logins_created_at ON pending_logins(created_at);

-- Bearer tokens minted on successful KE3. Used to authorize blob
-- uploads / fetches. Tokens are short-lived (1 hour by default;
-- enforced server-side, never trusted from the client). Each token
-- carries the monotonic SequenceClock the next blob upload must
-- exceed; this is the CRDT merge primitive the client uses to
-- order writes.
CREATE TABLE IF NOT EXISTS sessions (
	token TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
	device_id TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	sequence_clock INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account_id ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Optional metadata: which devices a user has paired. Populated by
-- the future Tier-2 ECDH pairing flow (L08 in the blueprint). Not
-- consulted on the OPAQUE login path. Server learns the device set,
-- which SECURITY.md ZK-scope #5 calls out as Tier-2-pending.
CREATE TABLE IF NOT EXISTS device_pairings (
	device_id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
	paired_at INTEGER NOT NULL,
	last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_pairings_account_id ON device_pairings(account_id);
