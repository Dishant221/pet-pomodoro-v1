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
import type { D1Database, IncomingRequestCfProperties } from '@cloudflare/workers-types';

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

/**
 * Per-IP write limits.
 *
 * The per-code interval above stops a runaway client. It does nothing about
 * the interesting attack, which is a script inventing a fresh code for every
 * request: each one is a new D1 row of up to 256 KB, on our account, and the
 * per-code limiter never fires because no code is ever reused. Creating rows
 * is therefore limited far more tightly than updating them — a real player
 * creates one code, ever, and then only writes to it.
 *
 * This is best-effort and deliberately so. The counters live in the edge
 * cache, which is per-colo and not atomic, so a determined attacker spread
 * across regions gets a higher effective limit than the numbers suggest. It
 * raises the cost of casual abuse by orders of magnitude; the control for a
 * serious attempt is a Cloudflare rate-limiting rule in front of the Worker,
 * which is documented in DEPLOY.md.
 *
 * The numbers are deliberately loose. These are per-IP, and an office, a
 * campus or a carrier-grade NAT puts many real players behind one address —
 * locking those people out of their own saves to inconvenience an attacker
 * who can rent a hundred addresses would be a bad trade. Mobile carriers are
 * the case that sets the floor: CGNAT routinely puts hundreds of subscribers
 * behind one IPv4 address, so a limit tuned for one household is a limit that
 * refuses first-time players on a phone network for no reason they can see.
 *
 * Sixty new codes an hour is still three orders of magnitude short of what a
 * harvester wants, and the failure it prevents — a player left holding a code
 * that will not upload, with no way to tell why — is worse than the abuse it
 * would have caught. The limiter cannot be the real defence at any of these
 * numbers anyway; that is the WAF rule's job.
 */
const WRITES_PER_MINUTE = 30;
const NEW_CODES_PER_HOUR = 60;

const app = new Hono<{ Bindings: Bindings }>();

/**
 * CORS: an explicit allowlist, or nothing at all.
 *
 * This previously reflected whatever `Origin` it was sent, which is the same
 * as having no policy. It did not expose saves — the sync code is the
 * credential and no cookies are involved — but it did let any website on the
 * internet drive this API from its visitors' browsers, spending our D1 writes
 * from their IP addresses. There is no reason for a third-party origin to call
 * this: the game is served from the same origin as the API.
 *
 * So an unset ALLOWED_ORIGINS now means no CORS headers, which browsers read
 * as same-origin only. Splitting the API onto its own Worker is the case that
 * needs the allowlist, and that is exactly when it should be set deliberately.
 */
app.use('/api/*', async (c, next) => {
  const configured = c.env.ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!configured?.length) return next();
  return cors({
    origin: configured,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['content-type'],
    maxAge: 86400,
  })(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true }));

/**
 * Count one event against a bucket, and say whether it is over the limit.
 *
 * Read-then-write with no atomicity: two requests landing in the same
 * millisecond can both read the same count and both be allowed. That is
 * acceptable for abuse mitigation — being off by one on a limit of twelve
 * changes nothing — and the alternative is a Durable Object per IP, which is
 * a lot of machinery and cost to defend a free save file.
 */
async function overLimit(bucket: string, limit: number, ttlSeconds: number): Promise<boolean> {
  if (!edgeCache) return false;
  const key = new Request(`https://petpomo.internal/rl/${bucket}`);
  try {
    const hit = await edgeCache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= limit) return true;
    await edgeCache.put(
      key,
      new Response(String(count + 1), {
        headers: { 'cache-control': `max-age=${ttlSeconds}`, 'content-type': 'text/plain' },
      }),
    );
    return false;
  } catch {
    // A limiter that fails closed would take the feature down with it.
    return false;
  }
}

/** Caller identity for rate limiting only. Never stored, never logged. */
function clientKey(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

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

  // Checked before the body is read, so a flood costs us as little as possible.
  const who = clientKey(c);
  const minute = Math.floor(Date.now() / 60_000);
  if (await overLimit(`save/${who}/${minute}`, WRITES_PER_MINUTE, 120)) {
    return c.json({ error: 'too many writes, try again shortly' }, 429, { 'retry-after': '60' });
  }

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

  // Creating a row is the expensive, unbounded operation, so it is limited far
  // harder than updating one. A real player mints a single code and then only
  // ever updates it; a script harvesting free storage mints a new one per
  // request, which is exactly what this stops.
  if (!existing) {
    const hour = Math.floor(now / 3_600_000);
    if (await overLimit(`new/${who}/${hour}`, NEW_CODES_PER_HOUR, 3900)) {
      return c.json({ error: 'too many new sync codes from this address, try again later' }, 429, {
        'retry-after': '3600',
      });
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO saves (code, profile, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`,
  )
    .bind(code, serialized, now)
    .run();

  return c.json({ ok: true, updatedAt: now });
});

// --- weather ----------------------------------------------------------------

/**
 * GET /api/weather — what the sky is doing where the visitor is.
 *
 * The game world reacts to the player's real weather, which needs a location.
 * Cloudflare already knows roughly where the request came from and puts it on
 * `request.cf`, so nothing has to be asked of the user: no geolocation prompt,
 * no IP handling of our own, no consent banner for a permission we never take.
 *
 * Privacy is a design constraint here, not a footnote:
 *
 *   - Coordinates are rounded to one decimal (~11 km) before they are used for
 *     anything. That is precise enough to know it is raining on you and far too
 *     coarse to place you.
 *   - The rounded pair is the cache key, so a whole town shares one upstream
 *     call and no per-visitor record is ever created.
 *   - Nothing is written to D1 and nothing is logged. The response is derived
 *     and discarded.
 *
 * Failure is not an error state. If geolocation is missing, the upstream is
 * slow, or the fetch throws, the caller gets fair weather and `ok: false`. A
 * pomodoro timer must never fail to load because a weather API had a bad day.
 */

/**
 * Workers-only globals, declared narrowly.
 *
 * This file is compiled as part of the browser program (see the type-only D1
 * import above), so the Workers ambient globals are deliberately absent. Rather
 * than pull them all in — which would put `fetch`, `Response` and friends into
 * every client module's scope — the three runtime features this endpoint needs
 * are described here and nowhere else.
 */
interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
/** `caches.default` is a Workers extension; the DOM lib does not know it. */
const edgeCache = (caches as unknown as { default?: EdgeCache }).default;
/** `cf` on both Request and RequestInit is likewise Workers-only. */
type CfInit = RequestInit & { cf?: { cacheTtl?: number; cacheEverything?: boolean } };
const cfOf = (r: Request) => (r as unknown as { cf?: IncomingRequestCfProperties }).cf;

type Condition = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'storm';

interface WeatherPayload {
  ok: boolean;
  condition: Condition;
  /** Degrees Celsius, or null when unknown. */
  temperature: number | null;
  windKph: number | null;
  /** Upstream's own day/night flag — more reliable than guessing from a clock. */
  isDay: boolean | null;
  /** IANA zone, so the client can sanity-check its own clock. */
  timezone: string | null;
}

const FAIR: WeatherPayload = {
  ok: false,
  condition: 'clear',
  temperature: null,
  windKph: null,
  isDay: null,
  timezone: null,
};

/** How long a rounded location's weather is reused. Weather is not fast. */
const WEATHER_TTL_S = 900;
/** Upstream budget. Past this the game gets fair weather and moves on. */
const WEATHER_TIMEOUT_MS = 3000;

/** WMO code → the handful of conditions the game actually renders. */
function conditionFor(code: number): Condition {
  if (code === 0) return 'clear';
  if (code <= 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  return 'clear';
}

app.get('/api/weather', async (c) => {
  const cf = cfOf(c.req.raw);
  const lat = Number(cf?.latitude);
  const lon = Number(cf?.longitude);
  const timezone = typeof cf?.timezone === 'string' ? cf.timezone : null;

  // No usable geolocation — a VPN, a datacentre IP, or local dev.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return c.json({ ...FAIR, timezone }, 200, { 'cache-control': 'public, max-age=300' });
  }

  // Deliberately coarse. See the note above.
  const rlat = lat.toFixed(1);
  const rlon = lon.toFixed(1);

  const cacheKey = new Request(`https://petpomo.internal/weather/${rlat},${rlon}`);
  const hit = await edgeCache?.match(cacheKey);
  if (hit) return hit;

  let payload: WeatherPayload;
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${rlat}&longitude=${rlon}` +
      `&current=temperature_2m,is_day,weather_code,wind_speed_10m&wind_speed_unit=kmh&timezone=auto`;

    const init: CfInit = {
      signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
      // Let the edge share one upstream call across colos too.
      cf: { cacheTtl: WEATHER_TTL_S, cacheEverything: true },
    };
    const res = await fetch(url, init);
    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const data = (await res.json()) as {
      current?: { temperature_2m?: number; is_day?: number; weather_code?: number; wind_speed_10m?: number };
      timezone?: string;
    };
    const cur = data.current;
    if (!cur || typeof cur.weather_code !== 'number') throw new Error('no current block');

    payload = {
      ok: true,
      condition: conditionFor(cur.weather_code),
      temperature: typeof cur.temperature_2m === 'number' ? Math.round(cur.temperature_2m) : null,
      windKph: typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null,
      isDay: typeof cur.is_day === 'number' ? cur.is_day === 1 : null,
      timezone: data.timezone ?? timezone,
    };
  } catch {
    // Deliberately silent. There is nothing an operator could act on, and the
    // game is unaffected.
    return c.json({ ...FAIR, timezone }, 200, { 'cache-control': 'public, max-age=60' });
  }

  const response = c.json(payload, 200, { 'cache-control': `public, max-age=${WEATHER_TTL_S}` });
  // Cache a clone; the original is still being streamed to this caller.
  if (edgeCache) c.executionCtx.waitUntil(edgeCache.put(cacheKey, response.clone()));
  return response;
});

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404));

export default app;
