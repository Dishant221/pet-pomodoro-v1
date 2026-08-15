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
