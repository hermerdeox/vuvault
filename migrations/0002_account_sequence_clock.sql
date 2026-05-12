-- Durable account-level high-water mark for vault blob sequence clocks.
--
-- Sessions are short-lived bearer tokens and may be cleaned up after expiry.
-- Keep the monotonic upload guard on the account row so stale or concurrent
-- uploads cannot reset protection when old session rows disappear.
ALTER TABLE accounts ADD COLUMN sequence_clock INTEGER NOT NULL DEFAULT 0;
