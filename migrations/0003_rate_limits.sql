-- 0003_rate_limits.sql - D1-backed sliding-window rate-limit counters.
--
-- Bucket shape: "<limit-name>:<key>", where key is usually "ip:<addr>"
-- or "account:<accountId>". window_start is a unix timestamp floored to
-- the configured window size, so each bucket has one row per active window.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON rate_limits(window_start);
