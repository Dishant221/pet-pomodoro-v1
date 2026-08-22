import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $session, refreshSession } from '../stores/session';
import { TURNSTILE_SITE_KEY, mountTurnstile } from '../game/turnstile';
import { isBrowser } from '../stores/persist';

/**
 * The comments section — mounted at the bottom of every blog post and the
 * homepage with `client:visible`, so readers who never scroll down never pay
 * for it. One island serves both surfaces; `target` names the page (a blog
 * slug or 'home') and the Worker refuses targets that aren't real pages.
 *
 * The honest part of the UX: NOTHING here publishes instantly. Every comment
 * waits for the site owner's approval (MODERATION.md), so after a submit the
 * form flips to "awaiting approval" instead of pretending the comment is
 * live. For guests that notice survives reloads via a localStorage counter;
 * signed-in authors get the real count from the server (`pendingOwn`).
 *
 * Guests need a display name — and a Turnstile check once the widget is
 * configured (src/game/turnstile.ts; absent key = no widget, same as auth).
 * Signed-in users comment under their account name.
 *
 * Rendering rule (defence in depth behind the server's sanitizer): comment
 * text only ever renders as text nodes. No dangerouslySetInnerHTML for user
 * content, anywhere, ever.
 */

interface CommentItem {
  id: number;
  author: string;
  member: boolean;
  body: string;
  createdAt: number;
}

const pendingKey = (target: string) => `petpomo.pendingComments.${target}`;

function readLocalPending(target: string): number {
  if (!isBrowser) return 0;
  try {
    return Number(localStorage.getItem(pendingKey(target))) || 0;
  } catch {
    return 0;
  }
}

function bumpLocalPending(target: string): void {
  if (!isBrowser) return;
  try {
    localStorage.setItem(pendingKey(target), String(readLocalPending(target) + 1));
  } catch {
    /* ignore */
  }
}

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Comments({ target }: { target: string }) {
  const session = useStore($session);
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [pendingOwn, setPendingOwn] = useState(0);
  const [body, setBody] = useState('');
  const [guestName, setGuestName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const captchaToken = useRef('');
  const captchaHost = useRef<HTMLDivElement>(null);
  const localPending = useRef(0);

  useEffect(() => {
    void refreshSession();
    localPending.current = readLocalPending(target);
    void (async () => {
      try {
        const res = await fetch(`/api/comments?target=${encodeURIComponent(target)}`);
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { items: CommentItem[]; pendingOwn: number };
        setItems(data.items);
        setPendingOwn(data.pendingOwn || localPending.current);
      } catch {
        // No /api (astro preview) or offline: show nothing rather than an
        // error — comments are decoration on an article that already works.
        setItems([]);
      }
    })();
  }, [target]);

  // The guest form is the only place Turnstile appears; mount it lazily when
  // the host div exists (i.e. when signed out and a key is configured).
  const signedIn = session.status === 'in';
  useEffect(() => {
    if (!signedIn && captchaHost.current) {
      mountTurnstile(captchaHost.current, (token) => {
        captchaToken.current = token;
      });
    }
  }, [signedIn, items === null]);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('Sending…');
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target,
          body,
          ...(signedIn ? {} : { guestName, turnstileToken: captchaToken.current || undefined }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus(data.error ?? `server said ${res.status}`);
      } else {
        setBody('');
        bumpLocalPending(target);
        setPendingOwn((n) => n + 1);
        setStatus('');
      }
    } catch {
      setStatus('Could not reach the server — try again in a moment.');
    }
    setBusy(false);
  };

  const field = 'pp-focus-ring w-full rounded-lg px-3 py-2 text-sm';
  const fieldStyle = 'background: var(--bg); color: var(--ink); border: 1px solid var(--border);';

  return (
    <section aria-label="Comments" class="mx-auto grid max-w-2xl gap-4">
      <h2 class="text-lg font-extrabold tracking-tight">
        Comments{items?.length ? ` (${items.length})` : ''}
      </h2>

      {pendingOwn > 0 && (
        <p class="pp-card px-4 py-3 text-sm" style="color: var(--ink-soft)">
          🐾 {pendingOwn === 1 ? 'Your comment is' : `${pendingOwn} of your comments are`} awaiting
          approval — everything here is read by a human before it appears.
        </p>
      )}

      {items === null ? (
        <p class="text-sm" style="color: var(--ink-soft)">Loading comments…</p>
      ) : items.length === 0 ? (
        <p class="text-sm" style="color: var(--ink-soft)">No comments yet — be the first.</p>
      ) : (
        <ul class="grid gap-3">
          {items.map((c) => (
            <li key={c.id} class="pp-card px-4 py-3">
              <p class="mb-1 flex items-baseline gap-2 text-xs" style="color: var(--ink-soft)">
                <strong style="color: var(--ink)">{c.author}</strong>
                {c.member && <span title="Signed-in member">🐾</span>}
                <time>{timeAgo(c.createdAt)}</time>
              </p>
              {/* Text node only — never markup. */}
              <p class="whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} class="grid gap-2.5">
        {!signedIn && (
          <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
            Your name
            <input
              class={field}
              style={fieldStyle}
              type="text"
              required
              maxLength={40}
              value={guestName}
              onInput={(e) => setGuestName((e.target as HTMLInputElement).value)}
            />
          </label>
        )}
        <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
          {signedIn ? `Comment as ${session.status === 'in' ? session.user.name || session.user.email : ''}` : 'Comment'}
          <textarea
            class={field}
            style={fieldStyle}
            rows={3}
            required
            maxLength={1000}
            placeholder="Plain text only — links aren't allowed."
            value={body}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          />
        </label>

        {!signedIn && TURNSTILE_SITE_KEY && <div ref={captchaHost} class="min-h-[65px]" />}

        <div class="flex items-center gap-3">
          <button type="submit" class="pp-btn pp-btn-primary" disabled={busy}>
            Send for review
          </button>
          <p role="status" aria-live="polite" class="min-h-4 text-xs" style="color: var(--ink-soft)">
            {status}
          </p>
        </div>
        <p class="text-xs" style="color: var(--ink-faint, var(--ink-soft))">
          Comments appear after the site owner approves them.
        </p>
      </form>
    </section>
  );
}
