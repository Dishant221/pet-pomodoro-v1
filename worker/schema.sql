-- PetPomo sync store.
--
-- There are no accounts. `code` is a client-generated 24-char secret that acts
-- as both the row key and the bearer credential: whoever holds it can read and
-- write that save, and nothing else. Nothing here is queryable by user identity
-- because the server never learns one.
CREATE TABLE IF NOT EXISTS saves (
  code       TEXT PRIMARY KEY,
  profile    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Supports the housekeeping sweep for abandoned saves.
CREATE INDEX IF NOT EXISTS idx_saves_updated_at ON saves (updated_at);

-- Rate-limit counters for /api/ask.
--
-- This table exists because the two limiters you would normally reach for are
-- both unavailable to this project: Pages rejects a `[[ratelimits]]` binding
-- outright, and a WAF rate-limiting rule needs a zone, which a site served from
-- *.pages.dev does not have. The edge-cache counter used elsewhere in the
-- Worker is per-colo and read-then-write, so a daily cap enforced with it is
-- really "that cap, once per colo" — not good enough for the one endpoint where
-- every call past the limit is billed inference.
--
-- `bucket` is never an address. It is a truncated SHA-256 of the connecting IP
-- with the scope and time window mixed in, so the table cannot be read as a list
-- of visitors. Rows are counters, they are deleted once their window has passed,
-- and no save, code or profile is reachable from one. See `rateKey`.
CREATE TABLE IF NOT EXISTS rate (
  bucket   TEXT PRIMARY KEY,
  n        INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- Supports the opportunistic sweep of windows that have already expired.
CREATE INDEX IF NOT EXISTS idx_rate_reset_at ON rate (reset_at);
