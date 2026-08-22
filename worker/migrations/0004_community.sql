-- Community + admin + analytics-rollup schema (backlog #39's later phases).
-- The moderation rules these tables implement are documented in MODERATION.md
-- at the repo root; the endpoint contracts live in worker/src/community.ts
-- and worker/src/admin.ts.

-- ---------------------------------------------------------------------------
-- posts — every piece of user-written content on the site, in ONE table:
-- blog/homepage comments now, forum threads and replies in the next phase.
-- One table means one moderation queue and one set of admin endpoints.
--
--   kind      'comment' | 'thread' | 'reply'
--   target    comments: a blog slug or 'home'; threads: 'forum'; replies: ''
--   thread_id replies only — the id of the thread they answer
--   user_id   better-auth user.id; NULL = a guest (comments only, name kept
--             in guest_name). Not a foreign key on purpose: deleting a user
--             must not silently delete already-approved public content.
--   status    'pending' -> 'approved' | 'rejected' | 'deleted'. NOTHING is
--             ever published without an explicit admin approval (owner's
--             decision, 2026-08-22) — there is no auto-approve path.
--   ai_verdict Llama Guard's pre-screen, stored to help the admin triage:
--             'safe' | 'unsafe:<categories>' | 'skipped' (AI unbound) |
--             'error' (call failed). Advisory only; never publishes anything.
--   ip_hash   same truncated-SHA-256 scheme as the rate table — never a raw
--             address. Gives the admin a "same source?" signal on spam.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('comment','thread','reply')),
  target      TEXT    NOT NULL DEFAULT '',
  thread_id   INTEGER,
  user_id     TEXT,
  guest_name  TEXT,
  title       TEXT,
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','rejected','deleted')),
  ai_verdict  TEXT    NOT NULL DEFAULT 'skipped',
  ip_hash     TEXT,
  created_at  INTEGER NOT NULL,
  reviewed_at INTEGER
);
-- Public reads: approved items for one target, newest first.
CREATE INDEX IF NOT EXISTS idx_posts_target  ON posts (target, status, created_at DESC);
-- Replies of a thread, oldest first (conversation order).
CREATE INDEX IF NOT EXISTS idx_posts_thread  ON posts (thread_id, status, created_at);
-- The admin queue. Partial index: stays tiny however large posts grows.
CREATE INDEX IF NOT EXISTS idx_posts_pending ON posts (created_at) WHERE status = 'pending';
-- Per-author history ("your pending comments", admin user detail).
CREATE INDEX IF NOT EXISTS idx_posts_user    ON posts (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- contact_messages — the /contact form, stored ALWAYS so the admin tab works
-- before (and independently of) email sending. `emailed` records whether the
-- notification actually went out (0 until the sending domain is onboarded).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL,
  subject    TEXT    NOT NULL,
  message    TEXT    NOT NULL,
  emailed    INTEGER NOT NULL DEFAULT 0,
  read_at    INTEGER,
  ip_hash    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_messages (created_at DESC);

-- ---------------------------------------------------------------------------
-- gift_clicks — one row per external-gift click, PERMANENT. This is the
-- revenue audit trail (AFFILIATES.md): Workers Analytics Engine only keeps
-- 3 months, and affiliate payouts validate 30–90 days after the click, so
-- revenue attribution needs a durable record. Volume is inherently human-
-- scale (clicks on letters), so one D1 row per click is fine; letter *opens*
-- are higher-volume and go to Analytics Engine only. Wired in the analytics
-- phase; created now so the schema ships once.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gift_clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gift_id     TEXT    NOT NULL,
  network     TEXT    NOT NULL,
  campaign_id TEXT,
  user_id     TEXT,
  country     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gclicks_gift ON gift_clicks (gift_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gclicks_user ON gift_clicks (user_id, created_at);

-- ---------------------------------------------------------------------------
-- user_stats_daily — per-user daily rollups (sessions, focus minutes, gift
-- activity), upserted at ingest with the same atomic single-statement shape
-- as the rate table. D1 holds the durable per-user truth the admin dashboard
-- reads; Analytics Engine holds the time-series firehose. Wired in the
-- analytics phase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_stats_daily (
  user_id       TEXT    NOT NULL,
  day           TEXT    NOT NULL,
  sessions      INTEGER NOT NULL DEFAULT 0,
  focus_minutes INTEGER NOT NULL DEFAULT 0,
  letter_opens  INTEGER NOT NULL DEFAULT 0,
  gift_clicks   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_ustats_day ON user_stats_daily (day);

-- Tiny key/value for cron bookkeeping (last moderation-digest timestamp etc.).
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
