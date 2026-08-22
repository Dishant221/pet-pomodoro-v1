/**
 * localStorage is the source of truth. Everything here is SSR-safe: Astro
 * pre-renders the Preact islands at build time, so no module-level browser API
 * access is allowed.
 */
export const SAVE_KEY = 'petpomo.save.v1';
/** When this device last CHANGED the profile (ms). The last-write-wins clock
 * for account sync: compared against the server row's updated_at on login. */
export const SAVED_AT_KEY = 'petpomo.savedAt.v1';
export const TIMER_KEY = 'petpomo.timer.v1';

export const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

export function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  if (!isBrowser) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private-mode: gameplay continues in memory */
  }
}

export function removeKey(key: string): void {
  if (!isBrowser) return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Coalesces bursty writes so dragging/petting doesn't thrash localStorage. */
export function debounceWrite(key: string, delay = 250) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let pending: unknown;
  return (value: unknown) => {
    pending = value;
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => {
      writeJSON(key, pending);
      handle = undefined;
    }, delay);
  };
}
