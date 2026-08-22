-- Account-linked saves. One row per user, same opaque-blob model as `saves`
-- (worker/migrations/0001_baseline.sql): the server stores what the client
-- sends and hands it back; hydrate() on the client remains the trust boundary.
-- The legacy code-keyed `saves` table stays for logged-out sync — a login
-- ADOPTS the local save into this table, it never deletes the legacy row.
CREATE TABLE IF NOT EXISTS user_saves (
  user_id    TEXT PRIMARY KEY REFERENCES "user" (id) ON DELETE CASCADE,
  profile    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
