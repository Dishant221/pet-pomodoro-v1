/**
 * PetPomo sync Worker — persistence only.
 *
 * This server runs no game logic, holds no accounts and makes no decisions. It
 * stores an opaque blob under a client-generated secret and hands it back. All
 * gameplay stays in the browser, so the app is fully functional with this Worker
 * absent, offline, or deleted.
 *
 * Threat model: the sync code IS the credential. It is 24 chars from
 * crypto.getRandomValues, never emailed, never logged, and only ever travels
 * over TLS. There is nothing to enumerate — an attacker with a wrong code gets
 * a 404 and learns nothing.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
// Type-only import: pulls in D1Database without dragging the Workers global
// typings (fetch, Response, ...) into the browser-side program.
import type { D1Database } from '@cloudflare/workers-types';

type Bindings = {
  DB: D1Database;
  /** Comma-separated origin allowlist. Unset means "same-origin only". */
  ALLOWED_ORIGINS?: string;
};

/** Codes are generated client-side by newSyncCode(); keep this in step with it. */
const CODE_RE = /^[a-z0-9]{16,64}$/;
/** A profile with 1000 sessions is ~120 KB of JSON; 256 KB is generous. */
const MAX_BODY = 256 * 1024;
/** Minimum gap between writes for one code. Blunt, but enough to stop a loop. */
const MIN_WRITE_INTERVAL_MS = 1000;

const app = new Hono<{ Bindings: Bindings }>();

app.use('/api/*', async (c, next) => {
  const configured = c.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  return cors({
    origin: configured && configured.length ? configured : (o) => o,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['content-type'],
    maxAge: 86400,
  })(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true }));

/**
 * GET /api/load?code=...
 * 404 when the code has never been used — the client treats that as "nothing
 * saved yet", not an error.
 */
app.get('/api/load', async (c) => {
  const code = c.req.query('code') ?? '';
  if (!CODE_RE.test(code)) return c.json({ error: 'invalid code' }, 400);

  const row = await c.env.DB.prepare('SELECT profile, updated_at FROM saves WHERE code = ?')
    .bind(code)
    .first<{ profile: string; updated_at: number }>();

  if (!row) return c.json({ error: 'not found' }, 404);

  let profile: unknown;
  try {
    profile = JSON.parse(row.profile);
  } catch {
    return c.json({ error: 'stored save is corrupt' }, 500);
  }
  return c.json({ profile, updatedAt: row.updated_at });
});

/**
 * POST /api/save  { code, profile }
 * Last write wins. The client is the source of truth; we never merge, because
 * merging two divergent save files would silently invent a third one.
 */
app.post('/api/save', async (c) => {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MAX_BODY) return c.json({ error: 'save too large' }, 413);

  let body: { code?: unknown; profile?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }

  const code = typeof body.code === 'string' ? body.code : '';
  if (!CODE_RE.test(code)) return c.json({ error: 'invalid code' }, 400);
  if (!body.profile || typeof body.profile !== 'object') return c.json({ error: 'missing profile' }, 400);

  const serialized = JSON.stringify(body.profile);
  if (serialized.length > MAX_BODY) return c.json({ error: 'save too large' }, 413);

  const now = Date.now();
  const existing = await c.env.DB.prepare('SELECT updated_at FROM saves WHERE code = ?')
    .bind(code)
    .first<{ updated_at: number }>();

  if (existing && now - existing.updated_at < MIN_WRITE_INTERVAL_MS) {
    return c.json({ error: 'too many writes' }, 429);
  }

  await c.env.DB.prepare(
    `INSERT INTO saves (code, profile, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`,
  )
    .bind(code, serialized, now)
    .run();

  return c.json({ ok: true, updatedAt: now });
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

export default app;
