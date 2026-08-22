/**
 * Accounts, hand-rolled against better-auth's plain HTTP endpoints.
 *
 * Deliberately NOT the better-auth client SDK: these islands ride
 * Layout.astro onto every page, inside a 200 KB first-load budget that
 * three.js already dominates. Seven fetch calls in the style of
 * src/game/sync.ts cost ~2 KB; the SDK costs an order of magnitude more.
 *
 * Account-linked saves reuse the sync model wholesale: the server stores an
 * opaque blob, hydrate() stays the trust boundary, last write wins. The only
 * difference from code-based sync is the key — a session cookie instead of a
 * bearer code.
 */
import { $profile, flushNow, hydrate, setProfile, type Profile } from '../stores/profile';
import { SAVED_AT_KEY, isBrowser } from '../stores/persist';
import { $session, refreshSession } from '../stores/session';

export type AuthResult = { ok: true } | { ok: false; error: string };

async function reason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    // better-auth answers refusals as { message }, our own API as { error }.
    const text = typeof body?.error === 'string' ? body.error : body?.message;
    if (typeof text === 'string' && text.length <= 200) return text;
  } catch {
    /* not JSON, or not ours */
  }
  return `server said ${res.status}`;
}

function describe(e: unknown): string {
  if (e instanceof DOMException && e.name === 'AbortError') return 'request timed out';
  if (e instanceof TypeError) return 'API not reachable';
  return e instanceof Error ? e.message : 'unknown error';
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(path, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function post(path: string, body: unknown, captchaToken?: string): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The better-auth captcha plugin reads this header. Harmless when the
      // plugin (and so the check) is off.
      ...(captchaToken ? { 'x-captcha-response': captchaToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

export async function signUp(
  email: string,
  password: string,
  name: string,
  captchaToken?: string,
): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/sign-up/email', { email, password, name }, captchaToken);
    if (!res.ok) return { ok: false, error: await reason(res) };
    await refreshSession();
    await adoptOrSyncSave();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function signIn(email: string, password: string, captchaToken?: string): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/sign-in/email', { email, password }, captchaToken);
    if (!res.ok) return { ok: false, error: await reason(res) };
    await refreshSession();
    await adoptOrSyncSave();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/** Starts the Google OAuth redirect. Only called when the build says the
 * provider exists (PUBLIC_GOOGLE_LOGIN). */
export async function signInGoogle(): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/sign-in/social', {
      provider: 'google',
      callbackURL: '/profile/',
    });
    if (!res.ok) return { ok: false, error: await reason(res) };
    const body = (await res.json()) as { url?: string };
    if (!body?.url) return { ok: false, error: 'malformed response' };
    window.location.href = body.url;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export async function signOut(): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/sign-out', {});
    if (!res.ok) return { ok: false, error: await reason(res) };
    $session.set({ status: 'out' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

// --- account-linked save -----------------------------------------------------

function localSavedAt(): number {
  if (!isBrowser) return 0;
  try {
    return Number(localStorage.getItem(SAVED_AT_KEY)) || 0;
  } catch {
    return 0;
  }
}

function stampSavedAt(ms: number): void {
  if (!isBrowser) return;
  try {
    localStorage.setItem(SAVED_AT_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

/** Uploads the local profile to the account row. */
export async function accountPush(): Promise<AuthResult> {
  try {
    const res = await request('/api/me/save', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: $profile.get() }),
    });
    if (!res.ok) return { ok: false, error: await reason(res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

/**
 * Run once after login. Decides which side of the account save wins:
 *
 *  - no server row            → this device's save becomes the account save
 *  - server newer than local  → server wins, through hydrate() like any pull
 *  - local newer than server  → local wins, pushed up
 *
 * The legacy code-based save is never touched: an account ADOPTS the local
 * profile, it does not migrate rows.
 */
export async function adoptOrSyncSave(): Promise<void> {
  if ($session.get().status !== 'in') return;
  try {
    const res = await request('/api/me/save');
    if (res.status === 404) {
      await accountPush();
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as { profile?: Partial<Profile>; updatedAt?: number };
    if (!body?.profile) return;
    const serverAt = typeof body.updatedAt === 'number' ? body.updatedAt : 0;
    if (serverAt >= localSavedAt()) {
      setProfile(hydrate(body.profile));
      // The login flow navigates away right after adoption; the debounced
      // save write would lose that race and the pulled profile with it.
      flushNow();
      stampSavedAt(serverAt);
    } else {
      await accountPush();
    }
  } catch {
    /* offline login is still a login */
  }
}

// --- auto-sync while signed in ------------------------------------------------

let watching = false;

/**
 * While a session exists, every profile change is pushed to the account row
 * after a quiet 5 s — the account save follows play without anyone pressing
 * an Upload button. Server-side caps (1 write/s per user, 30/min per IP)
 * stay comfortably clear of a 5 s debounce.
 */
export function watchAndSync(): void {
  if (!isBrowser || watching) return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  $profile.subscribe(() => {
    if ($session.get().status !== 'in') return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void accountPush();
    }, 5000);
  });
}
