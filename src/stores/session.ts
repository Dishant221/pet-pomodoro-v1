/**
 * Who is signed in, as a nanostore every island can read.
 *
 * `refreshSession()` MUST swallow every failure silently and report
 * logged-out instead: `astro preview` serves no /api at all, and the
 * acceptance suite fails the whole run on a single console error. A broken
 * network, a 404 HTML page, or a malformed body are all just "out".
 */
import { atom } from 'nanostores';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role?: string | null;
  emailVerified?: boolean;
}

export type SessionState =
  | { status: 'unknown' }
  | { status: 'out' }
  | { status: 'in'; user: SessionUser };

export const $session = atom<SessionState>({ status: 'unknown' });

let inflight: Promise<void> | null = null;

/** Asks the server who we are. Safe to call repeatedly; concurrent calls share
 * one request. */
export function refreshSession(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch('/api/auth/get-session', { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) {
        $session.set({ status: 'out' });
        return;
      }
      const body = (await res.json()) as { user?: SessionUser } | null;
      if (body?.user?.id) {
        $session.set({ status: 'in', user: body.user });
      } else {
        $session.set({ status: 'out' });
      }
    } catch {
      // No /api (astro preview), offline, or a proxy page — all logged-out.
      $session.set({ status: 'out' });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
