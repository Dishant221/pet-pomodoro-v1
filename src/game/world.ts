/**
 * The living world: what time it is where the player is, and what the sky is
 * doing there.
 *
 * This is the single source of truth for both. The renderer, the pet's
 * behaviour and the ambient audio all read from here rather than each calling
 * `new Date()` and drifting apart — a pet that naps at dusk while the sky is
 * still painting noon is worse than no day cycle at all.
 *
 * Everything degrades. Weather is a progressive enhancement layered on a world
 * that already works: no network, a blocked request, an ad blocker eating
 * `/api/weather`, or a first visit with a cold cache all land on fair weather
 * and a correct clock. Nothing here can prevent the game from starting.
 */
import { atom } from 'nanostores';
import { isBrowser, readJSON, writeJSON } from '../stores/persist';

// --- time of day -------------------------------------------------------------

export type PhaseId = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night';

export const PHASE_ORDER: PhaseId[] = ['dawn', 'morning', 'noon', 'afternoon', 'dusk', 'night'];

export const PHASE_LABEL: Record<PhaseId, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  noon: 'Midday',
  afternoon: 'Afternoon',
  dusk: 'Dusk',
  night: 'Night',
};

/**
 * Fraction through the local day: 0 at midnight, 0.5 at noon.
 *
 * Local to the *browser*, which is already in the player's own timezone. No
 * timezone maths, no server clock, nothing to get wrong — and it stays correct
 * when they travel.
 */
export function dayFraction(at: Date = new Date()): number {
  return (at.getHours() * 3600 + at.getMinutes() * 60 + at.getSeconds()) / 86400;
}

/** Which named phase a day fraction falls in. */
export function phaseForFraction(f: number): PhaseId {
  const h = ((f % 1) + 1) % 1 * 24;
  if (h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 15) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'dusk';
  return 'night';
}

export function phaseForHour(hour: number): PhaseId {
  return phaseForFraction((((hour % 24) + 24) % 24) / 24);
}

/**
 * Nominal sunrise and sunset, in local hours.
 *
 * A real solar-position calculation needs latitude, which would mean either a
 * geolocation prompt or shipping an ephemeris library — a lot of machinery to
 * decide what colour to paint the sky. These are a fair global average and are
 * wrong by at most an hour or so away from the equator, which is invisible in
 * a stylised world.
 */
const SUNRISE_H = 5.5;
const SUNSET_H = 20;

/**
 * Sun height: 0 on the horizon, 1 overhead, as a smooth arc.
 *
 * Lighting reads this rather than the discrete phase, so dawn arrives as a
 * sunrise instead of a jump cut.
 */
export function sunElevation(f: number): number {
  const h = (((f % 1) + 1) % 1) * 24;
  const x = (h - SUNRISE_H) / (SUNSET_H - SUNRISE_H);
  // Negative before sunrise and after sunset, which clamps to night.
  return Math.max(0, Math.sin(Math.PI * x));
}

/**
 * Sun's horizontal position: -1 in the east at sunrise, 0 at noon, +1 in the
 * west at sunset.
 *
 * This has to agree with where the painter draws the sun disc. A cast shadow
 * falling the opposite way to a visible sun is the single most obvious way to
 * break the composite — the eye catches it instantly.
 */
export function sunAzimuth(f: number): number {
  const h = (((f % 1) + 1) % 1) * 24;
  const x = (h - SUNRISE_H) / (SUNSET_H - SUNRISE_H);
  return Math.max(-1, Math.min(1, -Math.cos(Math.PI * Math.max(0, Math.min(1, x)))));
}

// --- weather -----------------------------------------------------------------

export type Condition = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'storm';

export interface Weather {
  /** False means this is the fallback, not a real reading. */
  ok: boolean;
  condition: Condition;
  temperature: number | null;
  windKph: number | null;
  isDay: boolean | null;
  timezone: string | null;
}

export const FAIR_WEATHER: Weather = {
  ok: false,
  condition: 'clear',
  temperature: null,
  windKph: null,
  isDay: null,
  timezone: null,
};

const WEATHER_KEY = 'petpomo.weather.v1';
/**
 * Set once a deployment answers 404, so we stop asking.
 *
 * The API is a Pages Function and genuinely optional — the game ships as
 * static files that work with no server at all. Without this, a static or
 * self-hosted deployment would log a failed request on every single page load
 * forever, which is both noisy in the console and pointless traffic.
 */
const NO_API_KEY = 'petpomo.weather.absent.v1';
/** Refetch interval. Weather does not change fast and neither should our load. */
const WEATHER_MAX_AGE_MS = 30 * 60 * 1000;
/** Client-side budget. The world renders regardless. */
const FETCH_TIMEOUT_MS = 4000;

const API_BASE = (import.meta.env.PUBLIC_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

interface CachedWeather {
  at: number;
  weather: Weather;
}

const CONDITIONS: Condition[] = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'snow', 'storm'];

/**
 * Never trust the wire, even our own.
 *
 * This response drives lighting and particle systems; a malformed or hostile
 * body should produce fair weather, not a crash inside the render loop.
 */
function parseWeather(raw: unknown): Weather {
  if (!raw || typeof raw !== 'object') return FAIR_WEATHER;
  const r = raw as Record<string, unknown>;
  const condition = CONDITIONS.includes(r.condition as Condition) ? (r.condition as Condition) : 'clear';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ok: r.ok === true,
    condition,
    temperature: num(r.temperature),
    windKph: num(r.windKph),
    isDay: typeof r.isDay === 'boolean' ? r.isDay : null,
    timezone: typeof r.timezone === 'string' ? r.timezone : null,
  };
}

function cachedWeather(): CachedWeather | null {
  const c = readJSON<CachedWeather | null>(WEATHER_KEY, null);
  if (!c || typeof c.at !== 'number' || !c.weather) return null;
  return { at: c.at, weather: parseWeather(c.weather) };
}

export async function fetchWeather(): Promise<Weather> {
  if (!isBrowser) return FAIR_WEATHER;
  if (readJSON<boolean>(NO_API_KEY, false)) return FAIR_WEATHER;
  try {
    const res = await fetch(`${API_BASE}/api/weather`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) {
      // This build is deployed without the Function. Stop asking.
      writeJSON(NO_API_KEY, true);
      return FAIR_WEATHER;
    }
    if (!res.ok) return FAIR_WEATHER;
    const weather = parseWeather(await res.json());
    // Only a real reading is worth remembering; caching the fallback would
    // keep us on fair weather for half an hour after one blip.
    if (weather.ok) writeJSON(WEATHER_KEY, { at: Date.now(), weather } satisfies CachedWeather);
    return weather;
  } catch {
    return FAIR_WEATHER;
  }
}

// --- the store ---------------------------------------------------------------

export interface WorldState {
  /** 0..1 through the local day. */
  fraction: number;
  phase: PhaseId;
  weather: Weather;
}

function initialState(): WorldState {
  const f = dayFraction();
  return {
    fraction: f,
    phase: phaseForFraction(f),
    // A cached reading, however stale, beats fair weather on first paint —
    // it is almost certainly still right.
    weather: cachedWeather()?.weather ?? FAIR_WEATHER,
  };
}

export const $world = atom<WorldState>(initialState());

/**
 * Start tracking real time and weather. Returns a stop function.
 *
 * The clock ticks once a minute rather than once a frame: the renderer
 * interpolates between whatever it was given, and waking the main thread 60
 * times a second to ask what time it is would be absurd.
 */
export function startWorld(): () => void {
  if (!isBrowser) return () => {};

  let stopped = false;

  const tickClock = () => {
    if (stopped) return;
    const f = dayFraction();
    const prev = $world.get();
    const phase = phaseForFraction(f);
    if (prev.fraction !== f || prev.phase !== phase) {
      $world.set({ ...prev, fraction: f, phase });
    }
  };

  const refreshWeather = async (force = false) => {
    if (stopped) return;
    const cached = cachedWeather();
    if (!force && cached && Date.now() - cached.at < WEATHER_MAX_AGE_MS) {
      $world.set({ ...$world.get(), weather: cached.weather });
      return;
    }
    const weather = await fetchWeather();
    if (stopped) return;
    // Never downgrade a good reading to the fallback on a transient failure.
    if (weather.ok || !$world.get().weather.ok) {
      $world.set({ ...$world.get(), weather });
    }
  };

  tickClock();

  /**
   * Weather waits for the browser to be idle.
   *
   * It is decoration on a world that is already correct, so it must never
   * compete with first paint or with the game's own boot work. Firing it
   * during load also kept the page from reaching network-idle, which delayed
   * everything downstream of it.
   */
  let idleHandle: number | undefined;
  const whenIdle = (fn: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    idleHandle = ric ? ric(fn, { timeout: 4000 }) : (setTimeout(fn, 1200) as unknown as number);
  };
  whenIdle(() => void refreshWeather());

  const clockTimer = setInterval(tickClock, 60_000);
  const weatherTimer = setInterval(() => void refreshWeather(), WEATHER_MAX_AGE_MS);

  // A laptop that slept through the afternoon comes back to the wrong sky
  // otherwise — the interval did not fire while it was suspended.
  const onWake = () => {
    if (document.hidden) return;
    tickClock();
    void refreshWeather();
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('online', onWake);

  return () => {
    stopped = true;
    if (idleHandle !== undefined) {
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cic) cic(idleHandle);
      else clearTimeout(idleHandle);
    }
    clearInterval(clockTimer);
    clearInterval(weatherTimer);
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('online', onWake);
  };
}
