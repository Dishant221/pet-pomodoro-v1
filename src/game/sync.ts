/**
 * Optional cloud sync. The server is persistence only — it never runs game
 * logic and never sees an account. A sync code is a random 24-char secret that
 * doubles as the row key; whoever has it can read and write that save.
 *
 * Everything here degrades to a no-op when the Worker isn't deployed: the game
 * is fully playable on localStorage alone.
 */
import { $profile, hydrate, type Profile } from '../stores/profile';
import { SAVE_KEY, isBrowser, writeJSON } from '../stores/persist';

const CODE_KEY = 'petpomo.syncCode.v1';

/** Same-origin by default; override with PUBLIC_API_BASE at build time. */
const API_BASE = (import.meta.env.PUBLIC_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export type SyncResult = { ok: true } | { ok: false; error: string };

export function getSyncCode(): string {
  if (!isBrowser) return '';
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setSyncCode(code: string): void {
  if (!isBrowser) return;
  try {
    const clean = code.trim();
    if (clean) localStorage.setItem(CODE_KEY, clean);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    /* ignore */
  }
}

export function newSyncCode(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
  setSyncCode(code);
  return code;
}

/**
 * The reason a request failed, in words the player can act on.
 *
 * The API answers a refusal with `{ error }` written for a human — "too many
 * new sync codes from this address, try again later" tells someone what to do
 * next, where "server said 429" tells them only that something broke. Rate
 * limiting made that difference matter: a 429 is now a state a real player can
 * reach, on a shared office or campus address, without having done anything
 * wrong.
 *
 * The body is still untrusted, so it is used only after it proves to be a
 * short string, and the status is kept as the fallback for a response that
 * isn't ours to read — a proxy's error page, say.
 */
async function reason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === 'string' && body.error.length <= 200) return body.error;
  } catch {
    /* not JSON, or not ours */
  }
  return `server said ${res.status}`;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Uploads the local save. Last write wins. */
export async function push(): Promise<SyncResult> {
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'No sync code set.' };
  try {
    const res = await request('/api/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, profile: $profile.get() }),
    });
    if (!res.ok) return { ok: false, error: await reason(res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/** Replaces the local save with the cloud copy. */
export async function pull(): Promise<SyncResult> {
  const code = getSyncCode();
  if (!code) return { ok: false, error: 'No sync code set.' };
  try {
    const res = await request(`/api/load?code=${encodeURIComponent(code)}`);
    if (res.status === 404) return { ok: false, error: 'nothing saved for that code yet' };
    if (!res.ok) return { ok: false, error: await reason(res) };
    const body = (await res.json()) as { profile?: Partial<Profile> };
    if (!body?.profile) return { ok: false, error: 'malformed response' };
    const next = hydrate(body.profile);
    $profile.set(next);
    writeJSON(SAVE_KEY, next);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

function describe(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'request timed out';
  if (e instanceof TypeError) return 'API not reachable (is the Worker deployed?)';
  return e instanceof Error ? e.message : 'unknown error';
}
