/**
 * Workers Static Assets entry point — the composition root.
 *
 * Module layout (dependencies point strictly downward; no cycles):
 *
 *   entry.ts      ← this file: mounts everything, owns scheduled()
 *   ├─ index.ts   core app: sync saves, weather, geo, /api/ask, /api/auth,
 *   │             /api/me — and the EXPORTED shared guards (rate limiters,
 *   │             clientKey/rateKey, turnstileOk, sessionUser)
 *   ├─ community.ts  public comments + contact form   (imports guards)
 *   ├─ admin.ts      the role-gated admin API         (imports guards)
 *   ├─ auth.ts / mail.ts / sanitize.ts / moderate.ts  leaf modules
 *   └─ blogSlugs.ts  GENERATED comment-target allowlist (scripts/make-slugs.mjs)
 *
 * The /api catch-all 404 is registered HERE, after every mount — Hono matches
 * in registration order, so a catch-all inside index.ts would shadow the
 * routers mounted after it.
 *
 * With `run_worker_first = ["/api/*"]` in wrangler.toml, only API traffic
 * ever reaches this code; every other URL is served from the asset store
 * (where public/_headers and public/_redirects apply).
 */
import app from './index';
import { community } from './community';
import { admin } from './admin';
import { analytics } from './analytics';
import { threadPage } from './threadPage';
import { sendMail } from './mail';
import type { D1Database } from '@cloudflare/workers-types';

app.route('/api', community);
app.route('/api', analytics);
app.route('/api/admin', admin);
// Worker-rendered forum thread pages (run_worker_first routes them here).
app.route('/', threadPage);
app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

/**
 * The cron (17:03 UTC daily, wrangler.toml [triggers]) sends the owner a
 * moderation digest: "N items awaiting review" — a DIGEST, never one email
 * per item, so a spam flood can never become an inbox flood. Fail-soft like
 * all email: without the SEND_EMAIL binding it counts and stays quiet, and
 * the queue is always visible in the dashboard regardless. `meta` remembers
 * the last run so restarts never double-send.
 */
async function moderationDigest(env: { DB: D1Database } & Parameters<typeof sendMail>[0]): Promise<void> {
  try {
    const db = env.DB;
    const last = await db.prepare(`SELECT v FROM meta WHERE k = 'digest_at'`).first<{ v: string }>();
    const since = Number(last?.v) || 0;
    const fresh = await db
      .prepare(`SELECT COUNT(*) AS n FROM posts WHERE status = 'pending' AND created_at > ?`)
      .bind(since)
      .first<{ n: number }>();
    const now = Date.now();
    await db
      .prepare(`INSERT INTO meta (k, v) VALUES ('digest_at', ?1) ON CONFLICT(k) DO UPDATE SET v = ?1`)
      .bind(String(now))
      .run();
    if (!fresh?.n) return;
    await sendMail(
      env,
      env.ADMIN_EMAIL ?? '',
      `PetPomo: ${fresh.n} item${fresh.n === 1 ? '' : 's'} awaiting review`,
      `${fresh.n} new community post${fresh.n === 1 ? '' : 's'} since the last digest are waiting in the moderation queue.\n\nReview: /admin on the site.`,
    );
  } catch {
    /* the next digest covers it */
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: unknown, env: unknown): Promise<void> {
    await moderationDigest(env as { DB: D1Database } & Parameters<typeof sendMail>[0]);
  },
};
