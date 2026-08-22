/**
 * The admin API — everything the dashboard island (src/islands/admin/) talks
 * to. Mounted by worker/src/entry.ts under /api/admin, BEHIND the router-wide
 * role gate below: the static /admin page is public and empty by design, and
 * this module is the only place admin data ever leaves the database.
 *
 * Moderation model (MODERATION.md): every post is born 'pending'; approve /
 * reject / delete are the only transitions, all human-initiated, all
 * timestamped. Bans are direct column updates on better-auth's user table —
 * better-auth reads `banned` at sign-in, and community.ts re-reads it per
 * submission so a ban bites existing sessions immediately.
 *
 * Dependency direction: imports shared guards from ./index; imported only by
 * entry.ts — no cycles.
 */
import { Hono } from 'hono';
import { sessionUser, type Bindings } from './index';

export const admin = new Hono<{ Bindings: Bindings }>();

/** Router-wide gate: a valid session AND role='admin', or nothing. 401 vs
 * 403 is deliberate — the dashboard island uses the difference to say
 * "sign in" versus "this account isn't the admin". */
admin.use('*', async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: 'sign in required' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  return next();
});

/** GET /api/admin/ping — the testable foundation (tests/auth.mjs). */
admin.get('/ping', (c) => c.json({ ok: true }));

/**
 * GET /api/admin/queue — pending posts, oldest first (fairness: first come,
 * first reviewed), except AI-flagged items float to the top so the likely
 * problems are seen first. The verdict is triage advice, never a decision.
 */
admin.get('/queue', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.kind, p.target, p.title, p.body, p.ai_verdict, p.ip_hash, p.created_at,
            p.user_id, COALESCE(u.name, p.guest_name, 'Anonymous') AS author, u.email AS author_email
     FROM posts p LEFT JOIN "user" u ON u.id = p.user_id
     WHERE p.status = 'pending'
     ORDER BY (p.ai_verdict LIKE 'unsafe%') DESC, p.created_at ASC
     LIMIT 100`,
  ).all();
  return c.json({ items: rows.results ?? [] });
});

/**
 * POST /api/admin/moderate { id, action: 'approve' | 'reject' | 'delete' }
 * `delete` also works on already-approved content — it is the take-down
 * action. Rows are never physically removed: status + reviewed_at ARE the
 * moderation audit trail.
 */
admin.post('/moderate', async (c) => {
  let body: { id?: unknown; action?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }
  const id = Number(body.id);
  const action = body.action;
  const status =
    action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'delete' ? 'deleted' : null;
  if (!Number.isInteger(id) || !status) return c.json({ error: 'bad request' }, 400);

  const res = await c.env.DB.prepare('UPDATE posts SET status = ?, reviewed_at = ? WHERE id = ?')
    .bind(status, Date.now(), id)
    .run();
  if (!res.meta.changes) return c.json({ error: 'no such post' }, 404);
  return c.json({ ok: true, id, status });
});

/**
 * POST /api/admin/ban { userId, reason? } and /api/admin/unban { userId }.
 * A ban also bulk-rejects the user's pending posts — the queue should not
 * keep offering work the decision already answered.
 */
admin.post('/ban', async (c) => {
  let body: { userId?: unknown; reason?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!userId) return c.json({ error: 'bad request' }, 400);
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;

  const res = await c.env.DB.prepare('UPDATE "user" SET banned = 1, banReason = ? WHERE id = ?')
    .bind(reason, userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'no such user' }, 404);
  await c.env.DB.prepare(
    `UPDATE posts SET status = 'rejected', reviewed_at = ? WHERE user_id = ? AND status = 'pending'`,
  )
    .bind(Date.now(), userId)
    .run();
  return c.json({ ok: true });
});

admin.post('/unban', async (c) => {
  let body: { userId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }
  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (!userId) return c.json({ error: 'bad request' }, 400);
  const res = await c.env.DB.prepare('UPDATE "user" SET banned = 0, banReason = NULL WHERE id = ?')
    .bind(userId)
    .run();
  if (!res.meta.changes) return c.json({ error: 'no such user' }, 404);
  return c.json({ ok: true });
});

/**
 * GET /api/admin/users — every account with its community footprint and (once
 * the analytics phase wires rollups) its play stats. LEFT JOINs so a user
 * with no activity still appears.
 */
admin.get('/users', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.banned, u."banReason" AS ban_reason, u."createdAt" AS created_at,
            (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.status = 'approved') AS approved_posts,
            (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id AND p.status = 'pending')  AS pending_posts,
            (SELECT COALESCE(SUM(s.sessions), 0)      FROM user_stats_daily s WHERE s.user_id = u.id) AS sessions,
            (SELECT COALESCE(SUM(s.focus_minutes), 0) FROM user_stats_daily s WHERE s.user_id = u.id) AS focus_minutes,
            (SELECT COUNT(*) FROM gift_clicks g WHERE g.user_id = u.id) AS gift_clicks
     FROM "user" u ORDER BY u."createdAt" DESC LIMIT 200`,
  ).all();
  return c.json({ items: rows.results ?? [] });
});

/**
 * GET /api/admin/stats — the dashboard's headline numbers, all from D1.
 * (Time-series charts arrive with the Analytics Engine phase.)
 */
admin.get('/stats', async (c) => {
  const one = <T>(sql: string) => c.env.DB.prepare(sql).first<T>();
  const [pending, users, approved, contacts, clicks] = await Promise.all([
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM posts WHERE status = 'pending'`),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM "user"`),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM posts WHERE status = 'approved'`),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM contact_messages WHERE read_at IS NULL`),
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM gift_clicks`),
  ]);
  return c.json({
    pending: pending?.n ?? 0,
    users: users?.n ?? 0,
    approvedPosts: approved?.n ?? 0,
    unreadContact: contacts?.n ?? 0,
    giftClicks: clicks?.n ?? 0,
  });
});

/** GET /api/admin/contact — newest first; POST /:id/read marks one handled. */
admin.get('/contact', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, email, subject, message, emailed, read_at, created_at
     FROM contact_messages ORDER BY created_at DESC LIMIT 100`,
  ).all();
  return c.json({ items: rows.results ?? [] });
});

admin.post('/contact/:id/read', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad request' }, 400);
  const res = await c.env.DB.prepare('UPDATE contact_messages SET read_at = ? WHERE id = ?')
    .bind(Date.now(), id)
    .run();
  if (!res.meta.changes) return c.json({ error: 'no such message' }, 404);
  return c.json({ ok: true });
});
