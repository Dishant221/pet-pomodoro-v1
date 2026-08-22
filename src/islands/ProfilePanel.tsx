import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $session, refreshSession } from '../stores/session';
import { accountPush, adoptOrSyncSave, signOut } from '../game/account';

/**
 * The account card on /profile — who you are, sync state, sign out. The
 * history/stats/streaks below it are the same StatsPanel the /stats page
 * mounts (composed in profile.astro), reading the same local profile: one
 * derivation, two pages.
 */
export default function ProfilePanel() {
  const session = useStore($session);
  const [status, setStatus] = useState('');

  useEffect(() => {
    void refreshSession();
  }, []);

  if (session.status === 'unknown') {
    return <div class="pp-card p-5 text-sm" style="color: var(--ink-soft)">Checking who you are…</div>;
  }

  if (session.status === 'out') {
    return (
      <div class="pp-card grid gap-3 p-5 text-center">
        <p class="text-sm" style="color: var(--ink-soft)">
          You're not signed in. Your pet still lives happily in this browser — an account just
          lets it follow you to other devices.
        </p>
        <a href="/login/" class="pp-btn pp-btn-primary mx-auto">Sign in or create an account</a>
      </div>
    );
  }

  const user = session.user;

  return (
    <div class="pp-card grid gap-4 p-5">
      <div class="flex items-center gap-4">
        <span
          aria-hidden="true"
          class="grid h-14 w-14 place-items-center rounded-full text-xl font-extrabold"
          style="background: var(--accent); color: var(--accent-ink);"
        >
          {(user.name || user.email).trim().charAt(0).toUpperCase()}
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-xl font-extrabold tracking-tight">{user.name || 'Friend of Mochi'}</h1>
          <p class="truncate text-sm" style="color: var(--ink-soft)">
            {user.email}
            {user.emailVerified ? ' · verified' : ''}
            {user.role === 'admin' ? ' · admin' : ''}
          </p>
        </div>
      </div>

      <p class="text-xs" style="color: var(--ink-soft)">
        Your save syncs to your account automatically while you play. Signing in on another
        device brings your pet, coins, purchases and history with you.
      </p>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="pp-btn"
          onClick={async () => {
            setStatus('Syncing…');
            const r = await accountPush();
            setStatus(r.ok ? 'Saved to your account.' : `Sync failed: ${r.error}`);
          }}
        >
          Sync now
        </button>
        <button
          type="button"
          class="pp-btn"
          onClick={async () => {
            setStatus('Checking the cloud copy…');
            await adoptOrSyncSave();
            setStatus('Up to date.');
          }}
        >
          Pull latest
        </button>
        <button
          type="button"
          class="pp-btn"
          onClick={async () => {
            const r = await signOut();
            if (r.ok) window.location.href = '/';
            else setStatus(`Sign-out failed: ${r.error}`);
          }}
        >
          Sign out
        </button>
      </div>

      <p role="status" aria-live="polite" class="min-h-4 text-xs" style="color: var(--ink-soft)">
        {status}
      </p>
    </div>
  );
}
