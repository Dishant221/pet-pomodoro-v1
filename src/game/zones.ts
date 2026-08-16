/**
 * Timezones, for the wall clock in the corner.
 *
 * Everything here goes through `Intl`, which means the browser's own IANA
 * database does the work: no zone table shipped in the bundle, no offset
 * arithmetic, and — the part that actually matters — daylight saving is right
 * on the days it changes. Hand-rolled `UTC+5:30` tables are correct until the
 * last Sunday in March and then quietly wrong for six months.
 *
 * Kept apart from `world.ts` on purpose. That module is about *this* player's
 * sky; this one is about what time it is somewhere else, and the two share
 * nothing but the word "clock".
 */

/** Extra dials beside the player's own. Four faces is already a wide widget. */
export const MAX_ZONES = 3;

/**
 * Offered when the browser will not enumerate its own zone list.
 *
 * `Intl.supportedValuesOf` has been everywhere since 2022, so this is a
 * genuine long tail rather than the common path — but a settings page that
 * renders an empty picker is a bug report, and thirty cities spread across the
 * offsets is a usable product.
 */
const FALLBACK_ZONES = [
  'UTC',
  'Pacific/Auckland',
  'Australia/Sydney',
  'Australia/Perth',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dubai',
  'Europe/Moscow',
  'Africa/Nairobi',
  'Europe/Istanbul',
  'Europe/Athens',
  'Africa/Johannesburg',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/London',
  'Africa/Lagos',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Mexico_City',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

/** Every zone this browser knows, or a usable subset if it will not say. */
export function allZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = supported?.('timeZone');
    if (Array.isArray(list) && list.length > 0) return list;
  } catch {
    /* fall through to the short list */
  }
  return FALLBACK_ZONES;
}

/**
 * Whether this browser accepts the zone.
 *
 * A save is not always something this player wrote, and a zone id is a string
 * from a file — `Intl` throws a RangeError on a bad one, and an exception
 * thrown while painting the corner of the screen would take the whole island
 * down. Asking it up front turns that into a filter.
 */
export function isValidZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone this device is in, per the browser. */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * One formatter per zone, built once.
 *
 * `Intl.DateTimeFormat` is expensive to construct and cheap to reuse, and this
 * one is called for every dial on every tick — four times a second with three
 * extra zones on screen.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // `h23` rather than the locale's default, because midnight is 00 in one
      // convention and 24 in another and only one of them points a clock hand
      // straight up.
      hourCycle: 'h23',
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

export interface ZoneTime {
  h: number;
  m: number;
  s: number;
}

/** Wall-clock time in a zone, as three numbers a clock face can be drawn from. */
export function timeInZone(tz: string, at: Date): ZoneTime {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(tz).formatToParts(at);
  } catch {
    parts = formatterFor(localZone()).formatToParts(at);
  }
  const read = (type: string) => {
    const p = parts.find((x) => x.type === type);
    const n = p ? Number(p.value) : 0;
    return Number.isFinite(n) ? n : 0;
  };
  return { h: read('hour') % 24, m: read('minute'), s: read('second') };
}

/** `14:32` in that zone — what the dial's tooltip and screen-reader name say. */
export function digitalInZone(tz: string, at: Date): string {
  const { h, m } = timeInZone(tz, at);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Cities the IANA database still files under the name they had decades ago.
 *
 * Browsers resolve `Asia/Kolkata` to `Asia/Calcutta` and hand that id straight
 * back, so a player in India picks their own city and gets a dial labelled
 * with the colonial name. The zones are genuinely the same; only the label is
 * wrong, and only these few.
 */
const RENAMED: Record<string, string> = {
  Calcutta: 'Kolkata',
  Saigon: 'Ho Chi Minh City',
  Rangoon: 'Yangon',
  Katmandu: 'Kathmandu',
  Asmera: 'Asmara',
  Ujung_Pandang: 'Makassar',
};

/** `Asia/Kolkata` → `Kolkata`. The id's last segment is always the place. */
function cityOf(tz: string): string {
  const last = tz.split('/').pop() ?? tz;
  return (RENAMED[last] ?? last).replace(/_/g, ' ');
}

/**
 * A short label to sit under a dial.
 *
 * Abbreviations where the browser has a real one — `UTC`, `EST`, `AEDT` — and
 * the city otherwise. Zones without an English abbreviation return things like
 * `GMT+5:30`, which is both wider than the dial and less use than "Kolkata",
 * so those fall back to the place name.
 *
 * Note this is time-dependent by design: a zone on daylight saving labels
 * itself `EDT` in July and `EST` in January, which is exactly right.
 *
 * The player's own locale, not a fixed one: `Asia/Kolkata` is `IST` to a
 * browser set to India and `GMT+5:30` to one set to Britain, and the person
 * reading the dial is the one whose abbreviation should win. The numeric
 * formatting above deliberately does the opposite and pins `en-GB`, because
 * that output is parsed rather than read.
 */
export function zoneLabel(tz: string, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (/^[A-Z]{2,5}$/.test(name)) return name;
  } catch {
    /* fall through to the city */
  }
  return cityOf(tz);
}

/**
 * The offset from the player, in hours, as `+5.5` / `-4` / `0`.
 *
 * Shown in the settings picker rather than on the dial: choosing a zone is
 * when you want to know how far away it is, and a clock face already tells
 * you once it is on screen.
 */
export function offsetFromLocal(tz: string, at: Date = new Date()): number {
  const here = timeInZone(localZone(), at);
  const there = timeInZone(tz, at);
  const diff = there.h * 60 + there.m - (here.h * 60 + here.m);
  // Zones sit within ±14h of UTC and so within ±26h of each other, but the two
  // readings above are clock times with the date thrown away — 23:00 Monday
  // against 04:00 Tuesday reads as -19h when it is really +5h. Folding onto
  // (-12, +12] recovers the intended one.
  const wrapped = ((diff + 720) % 1440 + 1440) % 1440 - 720;
  return Math.round((wrapped / 60) * 100) / 100;
}

/** `+3h 30m`, `−4h`, `same time` — the offset as a person would say it. */
export function offsetLabel(tz: string, at: Date = new Date()): string {
  const h = offsetFromLocal(tz, at);
  if (h === 0) return 'same time';
  // A true minus sign, not a hyphen: these sit next to a time in the same line
  // and `-5` beside `08:09` reads as a range at a glance.
  const sign = h > 0 ? '+' : '−';
  const abs = Math.abs(h);
  const whole = Math.floor(abs);
  const mins = Math.round((abs - whole) * 60);
  const parts = [whole ? `${whole}h` : '', mins ? `${mins}m` : ''].filter(Boolean);
  return `${sign}${parts.join(' ')}`;
}
