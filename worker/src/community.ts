/**
 * Public community endpoints: comments (blog posts + the homepage) and the
 * contact form. Mounted by worker/src/entry.ts under /api. The admin half —
 * the queue these feed — lives in worker/src/admin.ts; the rules both halves
 * implement are documented in MODERATION.md.
 *
 * The submission pipeline, in order (each step documented at its site):
 *
 *   size gate → rate limit → session/ban check → Turnstile (guests, when
 *   configured) → sanitizer (worker/src/sanitize.ts, the security gate) →
 *   target allowlist → Llama Guard pre-screen (advisory) → INSERT as
 *   'pending'
 *
 * NOTHING auto-publishes. Every row waits for an explicit admin approval —
 * the owner's decision (2026-08-22), traded deliberately against liveliness.
 *
 * Dependency direction: this module imports shared guards from ./index and
 * is itself imported only by entry.ts — no cycles.
 */
import { Hono } from 'hono';
import {
  MAX_BODY,
  bumpLimit,
  clientKey,
  overLimit,
  rateKey,
  sessionUser,
  sweepRates,
  turnstileOk,
  type Bindings,
} from './index';
import { sanitizeGuestName, sanitizeUserText } from './sanitize';
import { guardVerdict } from './moderate';
import { COMMENT_TARGETS } from './blogSlugs';
import { sendMail } from './mail';

/** Where community text lands relative to the caps in MODERATION.md. */
const COMMENT_MAX = 1000;
const CONTACT_CAPS = { name: 100, email: 254, subject: 150, message: 1500 };

/** Comments per IP per 10 minutes. Atomic (D1), because a flooded moderation
 * queue costs the one human moderator real time — this limit protects a
 * person, not a database. */
const COMMENTS_PER_10MIN = 5;
/** Contact messages per IP per hour. Each one may become an email. */
const CONTACT_PER_HOUR = 3;

export const community = new Hono<{ Bindings: Bindings }>();

/**
 * POST /api/comments  { target, body, guestName?, turnstileToken? }
 *
 * Signed-in users comment under their account name; guests under a sanitized
 * display name (plus Turnstile once the widget is configured — same
 * degradation rule as everywhere: no secret, no check). Banned accounts are
 * refused here with a re-read of the user row, because sessions cache the
 * user snapshot and a fresh ban must bite immediately, not at next sign-in.
 */
community.post('/comments', async (c) => {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_BODY) return c.json({ error: 'comment too large' }, 413);

  const who = clientKey(c);
  const now = Date.now();

  let body: { target?: unknown; body?: unknown; guestName?: unknown; turnstileToken?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }

  const target = typeof body.target === 'string' ? body.target : '';
  if (!COMMENT_TARGETS.has(target)) return c.json({ error: 'unknown page' }, 400);

  const user = await sessionUser(c);
  let guestName: string | null = null;

  if (user) {
    // Fresh ban check — the session snapshot is stale by design.
    const row = await c.env.DB.prepare('SELECT banned FROM "user" WHERE id = ?')
      .bind(user.id)
      .first<{ banned: number | null }>();
    if (row?.banned) return c.json({ error: 'this account cannot comment' }, 403);
  } else {
    const name = sanitizeGuestName(body.guestName);
    if (!name.ok) return c.json({ error: name.reason }, 400);
    guestName = name.text;
    if (!(await turnstileOk(c.env.TURNSTILE_SECRET, body.turnstileToken, who))) {
      return c.json({ error: 'could not verify you are human — reload and try again' }, 403);
    }
  }

  const text = sanitizeUserText(body.body, COMMENT_MAX);
  if (!text.ok) return c.json({ error: text.reason }, 400);

  // Rate limit AFTER validation, deliberately: only submissions that would
  // actually land in the queue spend the budget. Someone fixing their
  // comment three times after "links aren't allowed" is a person editing,
  // not a flood — and a rejection costs no D1 write, no AI call, nothing
  // worth metering. What the limit protects is the moderator's queue.
  const bucket = await rateKey('comment', who, Math.floor(now / 600_000));
  if (await bumpLimit(c.env.DB, bucket, COMMENTS_PER_10MIN, 600, now)) {
    return c.json({ error: 'too many comments from this address — try again in a few minutes' }, 429, {
      'retry-after': '600',
    });
  }

  // Advisory AI pre-screen; the human approval is the only publish path.
  const verdict = await guardVerdict(c.env.AI, text.text);
  const ipHash = await rateKey('src', who, 0);

  const inserted = await c.env.DB.prepare(
    `INSERT INTO posts (kind, target, user_id, guest_name, body, status, ai_verdict, ip_hash, created_at)
     VALUES ('comment', ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING id`,
  )
    .bind(target, user?.id ?? null, guestName, text.text, verdict, ipHash, now)
    .first<{ id: number }>();

  c.executionCtx.waitUntil(Promise.resolve(sweepRates(c.env.DB, now)));
  return c.json({ ok: true, id: inserted?.id, status: 'pending' }, 201);
});

/**
 * GET /api/comments?target=X — approved comments for one page, newest first,
 * capped at 50. `pendingOwn` tells a signed-in author how many of their own
 * comments still wait for review, so the UI can say so instead of looking
 * like it swallowed them. (Guests get the same reassurance client-side, from
 * ids remembered in localStorage.)
 */
community.get('/comments', async (c) => {
  const target = c.req.query('target') ?? '';
  if (!COMMENT_TARGETS.has(target)) return c.json({ error: 'unknown page' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.body, p.created_at,
            COALESCE(u.name, p.guest_name, 'Anonymous') AS author,
            (p.user_id IS NOT NULL) AS is_member
     FROM posts p LEFT JOIN "user" u ON u.id = p.user_id
     WHERE p.kind = 'comment' AND p.target = ? AND p.status = 'approved'
     ORDER BY p.created_at DESC LIMIT 50`,
  )
    .bind(target)
    .all<{ id: number; body: string; created_at: number; author: string; is_member: number }>();

  let pendingOwn = 0;
  const user = await sessionUser(c);
  if (user) {
    const own = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND target = ? AND status = 'pending'`,
    )
      .bind(user.id, target)
      .first<{ n: number }>();
    pendingOwn = own?.n ?? 0;
  }

  return c.json(
    {
      items: (rows.results ?? []).map((r) => ({
        id: r.id,
        author: r.author,
        member: !!r.is_member,
        body: r.body,
        createdAt: r.created_at,
      })),
      pendingOwn,
    },
    200,
    // `private`: pendingOwn is per-viewer. A minute of browser cache is fine —
    // approval visibility lagging 60 s is nothing next to the human review
    // the content already waited for.
    { 'cache-control': 'private, max-age=60' },
  );
});

/**
 * POST /api/contact  { name, email, subject, message, turnstileToken?, website }
 *
 * Replaces the old mailto-composer flow with a real submission: the message
 * is STORED first (the admin tab must work before email sending exists),
 * then a notification email is attempted and its outcome recorded. The
 * honeypot (`website`, an off-screen field) answers success without storing
 * — same trick the old form used, and telling a bot it failed only teaches
 * it. Field caps mirror the old form's.
 */
community.post('/contact', async (c) => {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_BODY) return c.json({ error: 'message too large' }, 413);

  const who = clientKey(c);
  const now = Date.now();
  const bucket = await rateKey('contact', who, Math.floor(now / 3_600_000));
  if (await bumpLimit(c.env.DB, bucket, CONTACT_PER_HOUR, 3600, now)) {
    return c.json({ error: 'too many messages from this address — try again later' }, 429, {
      'retry-after': '3600',
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }

  // Honeypot: silently succeed, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return c.json({ ok: true, emailed: false });
  }

  if (!(await turnstileOk(c.env.TURNSTILE_SECRET, body.turnstileToken, who))) {
    return c.json({ error: 'could not verify you are human — reload and try again' }, 403);
  }

  const name = sanitizeUserText(body.name, CONTACT_CAPS.name);
  const subject = sanitizeUserText(body.subject, CONTACT_CAPS.subject);
  // The message may legitimately contain a link ("my site breaks on yours"),
  // so it skips the no-links rule: length + trim only, and it is only ever
  // read by the admin, rendered as a text node.
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, CONTACT_CAPS.message) : '';
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, CONTACT_CAPS.email) : '';
  if (!name.ok) return c.json({ error: `name: ${name.reason}` }, 400);
  if (!subject.ok) return c.json({ error: `subject: ${subject.reason}` }, 400);
  if (!message) return c.json({ error: 'write a message first' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'that email does not look right' }, 400);

  const ipHash = await rateKey('src', who, 0);
  const emailed = await sendMail(
    c.env,
    c.env.ADMIN_EMAIL ?? '',
    `PetPomo contact: ${subject.text}`,
    `${name.text} <${email}>\n\n${message}`,
  );

  await c.env.DB.prepare(
    `INSERT INTO contact_messages (name, email, subject, message, emailed, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(name.text, email, subject.text, message, emailed ? 1 : 0, ipHash, now)
    .run();

  return c.json({ ok: true, emailed });
});
