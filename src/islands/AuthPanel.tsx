import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $session, refreshSession } from '../stores/session';
import { signIn, signInGoogle, signUp } from '../game/account';
import { TURNSTILE_SITE_KEY, mountTurnstile } from '../game/turnstile';

/**
 * Sign in / create account, on /login.
 *
 * Two build-time switches decide what renders, mirroring how the server
 * degrades: PUBLIC_GOOGLE_LOGIN shows the Google button only when the OAuth
 * client actually exists server-side, and PUBLIC_TURNSTILE_SITE_KEY mounts
 * the Turnstile widget only when the server verifies its tokens. With
 * neither set (local dev), plain email+password works end to end.
 *
 * The Google button follows Google's branding rules: official multi-colour
 * "G" on its own tile, "Continue with Google" wording, never recoloured.
 */

const GOOGLE_ENABLED = (import.meta.env.PUBLIC_GOOGLE_LOGIN as string | undefined) === '1';

type Mode = 'signin' | 'signup';

/** The official multi-colour G, inline so the CSP needs no image origin. */
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function AuthPanel() {
  const session = useStore($session);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const captchaToken = useRef('');
  const captchaHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshSession();
  }, []);

  // Already signed in: /login is not a page to linger on.
  useEffect(() => {
    if (session.status === 'in') window.location.replace('/profile/');
  }, [session.status]);

  // Turnstile via the shared loader (src/game/turnstile.ts): no site key at
  // build time, no widget — mirrors the server skipping verification.
  useEffect(() => {
    if (captchaHost.current) {
      mountTurnstile(captchaHost.current, (token) => {
        captchaToken.current = token;
      });
    }
  }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus(mode === 'signin' ? 'Signing in…' : 'Creating your account…');
    const result =
      mode === 'signin'
        ? await signIn(email.trim(), password, captchaToken.current || undefined)
        : await signUp(email.trim(), password, name.trim() || email.split('@')[0], captchaToken.current || undefined);
    if (result.ok) {
      setStatus('Welcome back! Taking you to your profile…');
      window.location.href = '/profile/';
    } else {
      setStatus(`${mode === 'signin' ? 'Sign-in' : 'Sign-up'} failed: ${result.error}`);
      setBusy(false);
    }
  };

  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === id}
      class="pp-focus-ring flex-1 rounded-lg px-3 py-2 text-sm font-bold transition-colors"
      style={mode === id ? 'background: var(--accent); color: var(--accent-ink);' : 'color: var(--ink-soft);'}
      onClick={() => {
        setMode(id);
        setStatus('');
      }}
    >
      {label}
    </button>
  );

  const field =
    'pp-focus-ring w-full rounded-lg px-3 py-2 text-sm';
  const fieldStyle = 'background: var(--bg); color: var(--ink); border: 1px solid var(--border);';

  return (
    <div class="pp-card mx-auto w-full max-w-sm p-5 sm:p-6">
      <h1 class="mb-1 text-center text-xl font-extrabold tracking-tight">Your PetPomo account</h1>
      <p class="mb-4 text-center text-xs" style="color: var(--ink-soft)">
        Optional — the game plays fine without one. An account keeps your pet, coins and streaks
        with you on any device.
      </p>

      <div class="mb-4 flex gap-1.5 rounded-xl p-1" role="tablist" aria-label="Sign in or create account" style="background: var(--bg); border: 1px solid var(--border);">
        {tab('signin', 'Sign in')}
        {tab('signup', 'Create account')}
      </div>

      <form onSubmit={submit} class="grid gap-3">
        {mode === 'signup' && (
          <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
            Name
            <input
              class={field}
              style={fieldStyle}
              type="text"
              autocomplete="name"
              maxLength={60}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
        <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
          Email
          <input
            class={field}
            style={fieldStyle}
            type="email"
            required
            autocomplete="email"
            maxLength={254}
            value={email}
            onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
          Password
          <input
            class={field}
            style={fieldStyle}
            type="password"
            required
            minLength={8}
            maxLength={128}
            autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
          />
        </label>

        {TURNSTILE_SITE_KEY && <div ref={captchaHost} class="min-h-[65px]" />}

        <button type="submit" class="pp-btn pp-btn-primary w-full" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {GOOGLE_ENABLED && (
        <>
          <div class="my-4 flex items-center gap-3 text-xs" style="color: var(--ink-soft)" aria-hidden="true">
            <span class="h-px flex-1" style="background: var(--border)" />
            or
            <span class="h-px flex-1" style="background: var(--border)" />
          </div>
          <button
            type="button"
            class="pp-focus-ring flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold"
            style="background: #ffffff; color: #1f1f1f; border: 1px solid #dadce0;"
            onClick={async () => {
              setStatus('Sending you to Google…');
              const r = await signInGoogle();
              if (!r.ok) setStatus(`Google sign-in failed: ${r.error}`);
            }}
          >
            <GoogleG />
            Continue with Google
          </button>
        </>
      )}

      <p role="status" aria-live="polite" class="mt-3 min-h-5 text-center text-xs" style="color: var(--ink-soft)">
        {status}
      </p>

      {/* No forgot-password link by owner's request (2026-08-22) — reset
          emails aren't switched on yet anyway; support goes via /contact. */}
    </div>
  );
}
