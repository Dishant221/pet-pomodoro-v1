import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $session, refreshSession } from '../stores/session';
import { signOut, watchAndSync } from '../game/account';

/**
 * The profile control in the nav bar — second from the right, just left of
 * the fullscreen toggle. Signed out it is a plain link to /login; signed in
 * it is the user's initial opening a small menu (Profile, Admin when the
 * role allows, Sign out).
 *
 * Rides on every page via Layout.astro, so it must stay tiny and must never
 * log: refreshSession() treats every failure as logged-out (see session.ts).
 */
export default function ProfileMenu() {
  const session = useStore($session);
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshSession();
    // Signed-in play auto-syncs the profile to the account row.
    watchAndSync();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Unknown renders like signed-out: a stable target beats a popping-in one,
  // and /login redirects the already-signed-in to their profile anyway.
  if (session.status !== 'in') {
    return (
      <a
        href="/login/"
        title="Sign in"
        class="pp-focus-ring ml-1 rounded-lg px-2 py-1.5 text-sm font-semibold sm:ml-2"
        style="color: var(--ink-soft)"
      >
        <span aria-hidden="true" class="sm:hidden">👤</span>
        <span class="hidden sm:inline">Sign in</span>
      </a>
    );
  }

  const user = session.user;
  const initial = (user.name || user.email || '?').trim().charAt(0).toUpperCase();

  const item =
    'pp-focus-ring block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors';

  return (
    <div ref={host} class="relative ml-1 sm:ml-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Signed in as ${user.name || user.email}`}
        onClick={() => setOpen(!open)}
        class="pp-focus-ring grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold"
        style="background: var(--accent); color: var(--accent-ink);"
      >
        {initial}
        <span class="sr-only">Account menu</span>
      </button>

      {open && (
        <div
          role="menu"
          class="absolute right-0 top-10 z-40 w-48 rounded-xl p-1.5"
          style="background: var(--bg-elev); border: 1px solid var(--border); box-shadow: var(--shadow-card);"
        >
          <p class="truncate px-3 pb-1 pt-2 text-xs" style="color: var(--ink-soft)" title={user.email}>
            {user.email}
          </p>
          <a role="menuitem" href="/profile/" class={item} style="color: var(--ink)">
            Profile
          </a>
          {user.role === 'admin' && (
            <a role="menuitem" href="/admin/" class={item} style="color: var(--ink)">
              Admin
            </a>
          )}
          <button
            role="menuitem"
            type="button"
            class={item}
            style="color: var(--ink)"
            onClick={async () => {
              setOpen(false);
              await signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
