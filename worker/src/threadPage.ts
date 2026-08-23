/**
 * Worker-rendered forum thread pages — /forum/thread/:id[/:slug].
 *
 * Why this exists: the site is statically built, and static output cannot
 * emit a page per *dynamic* thread id — which would leave every shared
 * thread link with the same generic social card. Sharing threads is the
 * point of the forum, so this route makes the Worker render them: it fetches
 * the Astro-built SHELL at /forum/thread/ from the asset store (real hashed
 * CSS, header, theme tokens — zero duplicated markup) and rewrites it with
 * HTMLRewriter:
 *
 *   - <title>, meta description, og:title / og:description / og:url and the
 *     canonical link become the thread's own (real share cards),
 *   - an inert <script type="application/json" id="pp-thread-data"> carries
 *     the thread JSON so the island hydrates without a second fetch
 *     (type=application/json is data, not an executable script — the strict
 *     CSP is untouched),
 *   - the thread itself is server-rendered as escaped HTML into
 *     #pp-thread-ssr, which is what scrapers and search engines read.
 *
 * EVERY interpolation goes through esc() — thread text is user-written and
 * sanitized on the way in, but this page treats it as hostile anyway.
 *
 * `run_worker_first = ["/forum/thread/*"]` (wrangler.toml) routes these URLs
 * here; 60 s edge cache keeps approve-to-visible lag acceptable while saving
 * D1 reads on a shared link going around.
 */
import { Hono } from 'hono';
import type { Bindings } from './index';

/** Narrow HTMLRewriter surface (workers runtime global) — enough for this
 * file, without dragging @cloudflare/workers-types globals into the
 * browser-side type program. */
declare const HTMLRewriter: new () => {
  on(
    selector: string,
    handlers: {
      element(el: {
        setInnerContent(content: string, opts?: { html?: boolean }): void;
        setAttribute(name: string, value: string): void;
        append(content: string, opts?: { html?: boolean }): void;
      }): void;
    },
  ): InstanceType<typeof HTMLRewriter>;
  transform(res: Response): Response;
};

declare const caches: { default?: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } };

export const threadPage = new Hono<{ Bindings: Bindings }>();

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON destined for an inline data block: '<' is escaped so a literal
 * "</script>" inside user text can never close the element early. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * One wildcard route with manual id parsing, deliberately: URL shapes in the
 * wild include /forum/thread/12, /forum/thread/12/, and
 * /forum/thread/12/pretty-slug/ — a parameter pattern treats the trailing
 * slash as an empty segment and 404s, which is exactly the bug this replaced.
 */
threadPage.get('/forum/thread/*', async (c) => {
  const match = new URL(c.req.url).pathname.match(/^\/forum\/thread\/(\d+)(?:\/|$)/);
  // No id at all (someone trimmed the URL): the forum index is the answer,
  // permanently — a 302 here makes crawlers keep re-checking the bare URL.
  if (!match) return c.redirect('/forum/', 301);
  const id = Number(match[1]);
  if (!Number.isInteger(id) || !c.env.ASSETS) return c.notFound();

  // Shared links hit this page in bursts; one rendered copy per minute per
  // URL is plenty fresh for human-approved content.
  const cacheKey = new Request(new URL(`/forum/thread/${id}/`, c.req.url).href);
  const cached = await caches.default?.match(cacheKey);
  if (cached) return cached;

  const thread = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.body, p.created_at, COALESCE(u.name, 'Member') AS author
     FROM posts p LEFT JOIN "user" u ON u.id = p.user_id
     WHERE p.id = ? AND p.kind = 'thread' AND p.status = 'approved'`,
  )
    .bind(id)
    .first<{ id: number; title: string; body: string; created_at: number; author: string }>();
  if (!thread) return c.notFound();

  const replies = (
    await c.env.DB.prepare(
      `SELECT p.id, p.body, p.created_at, COALESCE(u.name, 'Member') AS author
       FROM posts p LEFT JOIN "user" u ON u.id = p.user_id
       WHERE p.thread_id = ? AND p.kind = 'reply' AND p.status = 'approved'
       ORDER BY p.created_at ASC LIMIT 200`,
    )
      .bind(id)
      .all<{ id: number; body: string; created_at: number; author: string }>()
  ).results ?? [];

  const shell = await c.env.ASSETS.fetch(new URL('/forum/thread/', c.req.url).href);
  if (!shell.ok) return c.notFound();

  const canonical = new URL(`/forum/thread/${thread.id}/`, c.req.url).href;
  const title = `${thread.title} — PetPomo Forum`;
  const description = thread.body.slice(0, 155).replace(/\s+/g, ' ').trim();

  const ssr = `
    <article class="pp-card" style="padding:1.25rem; display:grid; gap:0.75rem;">
      <h1 style="font-size:1.35rem; font-weight:800; letter-spacing:-0.01em;">${esc(thread.title)}</h1>
      <p style="font-size:0.75rem; color:var(--ink-soft);">${esc(thread.author)} · ${new Date(thread.created_at).toISOString().slice(0, 10)}</p>
      <p style="white-space:pre-wrap; font-size:0.925rem;">${esc(thread.body)}</p>
    </article>
    ${replies
      .map(
        (r) => `
      <article class="pp-card" style="padding:1rem; display:grid; gap:0.5rem; margin-top:0.75rem;">
        <p style="font-size:0.75rem; color:var(--ink-soft);">${esc(r.author)} · ${new Date(r.created_at).toISOString().slice(0, 10)}</p>
        <p style="white-space:pre-wrap; font-size:0.9rem;">${esc(r.body)}</p>
      </article>`,
      )
      .join('')}`;

  const data = jsonForScript({ thread, replies });

  const rewritten = new HTMLRewriter()
    .on('title', { element: (el) => el.setInnerContent(esc(title)) })
    .on('link[rel="canonical"]', { element: (el) => el.setAttribute('href', canonical) })
    .on('meta[name="description"]', { element: (el) => el.setAttribute('content', esc(description)) })
    .on('meta[property="og:title"]', { element: (el) => el.setAttribute('content', esc(title)) })
    .on('meta[property="og:description"]', { element: (el) => el.setAttribute('content', esc(description)) })
    .on('meta[property="og:url"]', { element: (el) => el.setAttribute('content', canonical) })
    .on('meta[name="twitter:title"]', { element: (el) => el.setAttribute('content', esc(title)) })
    .on('#pp-thread-ssr', { element: (el) => el.setInnerContent(ssr, { html: true }) })
    .on('#pp-thread-data', { element: (el) => el.setInnerContent(data) })
    .transform(new Response(shell.body, shell));

  const response = new Response(rewritten.body, rewritten);
  response.headers.set('cache-control', 'public, max-age=60');
  if (caches.default) c.executionCtx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
});
