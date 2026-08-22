/**
 * Event ingest — POST /api/events, fed by src/game/events.ts.
 *
 * The two-store rule (MODERATION.md's infra map): Workers Analytics Engine
 * is the time-series FIREHOSE (unlimited-cardinality, 3-month retention,
 * 100k free points/day) and D1 holds the DURABLE truth — per-user daily
 * rollups for the admin dashboard, and one permanent `gift_clicks` row per
 * external gift click, because affiliate payouts validate 30–90 days after
 * the click (AFFILIATES.md) and revenue attribution cannot live in a store
 * that forgets after three months.
 *
 * The endpoint accepts sendBeacon bodies (which arrive as text/plain), takes
 * at most 20 events per call against a whitelist, and never tells the
 * client more than "ok": analytics must not be a reason a game stutters.
 *
 * Write volume, sized against limits: a session completion is at most one D1
 * rollup upsert per 25 minutes per player; gift clicks are human-scale.
 * Letter opens and any future high-volume events go to AE only.
 */
import { Hono } from 'hono';
import { cfOf, clientKey, overLimit, sessionUser, type Bindings } from './index';

export const analytics = new Hono<{ Bindings: Bindings }>();

const EVENT_TYPES = new Set(['session_complete', 'letter_open', 'gift_click']);
const EVENTS_PER_MIN = 60;
const MAX_BATCH = 20;

interface RawEvent {
  type?: unknown;
  minutes?: unknown;
  giftId?: unknown;
  network?: unknown;
  campaignId?: unknown;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

/** Atomic daily-rollup upsert — same single-statement shape as bumpLimit. */
function bumpDaily(
  c: { env: Bindings },
  userId: string,
  day: string,
  col: 'sessions' | 'focus_minutes' | 'letter_opens' | 'gift_clicks',
  by: number,
) {
  return c.env.DB.prepare(
    `INSERT INTO user_stats_daily (user_id, day, ${col}) VALUES (?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET ${col} = ${col} + excluded.${col}`,
  )
    .bind(userId, day, by)
    .run()
    .catch(() => undefined); // analytics never breaks gameplay
}

analytics.post('/events', async (c) => {
  const who = clientKey(c);
  const minute = Math.floor(Date.now() / 60_000);
  if (await overLimit(`ev/${who}/${minute}`, EVENTS_PER_MIN, 120)) {
    return c.json({ ok: true }); // silently drop: never worth a client retry
  }

  // sendBeacon sends text/plain; parse the raw text rather than trusting
  // the content-type header.
  let events: RawEvent[];
  try {
    const parsed = JSON.parse(await c.req.text()) as unknown;
    events = Array.isArray(parsed) ? (parsed.slice(0, MAX_BATCH) as RawEvent[]) : [];
  } catch {
    return c.json({ error: 'malformed json' }, 400);
  }

  const user = await sessionUser(c);
  const day = new Date().toISOString().slice(0, 10);
  const country = cfOf(c.req.raw)?.country ?? null;
  const now = Date.now();
  const work: Promise<unknown>[] = [];

  for (const ev of events) {
    const type = typeof ev.type === 'string' ? ev.type : '';
    if (!EVENT_TYPES.has(type)) continue; // unknown types are dropped, not errors

    const giftId = str(ev.giftId, 64);
    const network = str(ev.network, 32);
    const campaignId = str(ev.campaignId, 64);
    const minutes = Math.min(180, Math.max(0, Math.round(Number(ev.minutes)) || 0));

    // Firehose: index = who (user id, else hashed-ish address is overkill —
    // 'anon' groups the logged-out), blobs = what, doubles = how much.
    try {
      c.env.EVENTS?.writeDataPoint({
        indexes: [user?.id ?? 'anon'],
        blobs: [type, giftId ?? '', network ?? '', campaignId ?? '', typeof country === 'string' ? country : ''],
        doubles: [1, minutes],
      });
    } catch {
      /* AE hiccups are invisible by design */
    }

    // Durable side.
    if (type === 'gift_click' && giftId && network) {
      work.push(
        c.env.DB.prepare(
          `INSERT INTO gift_clicks (gift_id, network, campaign_id, user_id, country, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(giftId, network, campaignId, user?.id ?? null, country, now)
          .run()
          .catch(() => undefined),
      );
      if (user) work.push(bumpDaily(c, user.id, day, 'gift_clicks', 1));
    } else if (type === 'session_complete' && user) {
      work.push(bumpDaily(c, user.id, day, 'sessions', 1));
      if (minutes) work.push(bumpDaily(c, user.id, day, 'focus_minutes', minutes));
    } else if (type === 'letter_open' && user) {
      work.push(bumpDaily(c, user.id, day, 'letter_opens', 1));
    }
  }

  c.executionCtx.waitUntil(Promise.all(work));
  return c.json({ ok: true });
});
