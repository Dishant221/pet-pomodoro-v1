import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $session, refreshSession } from '../stores/session';

/**
 * The forum index — thread list plus the new-thread form. Reading is public;
 * starting a thread needs an account (the forum is the signed-in community —
 * guests can comment on articles instead). New threads go to the moderation
 * queue like everything else (MODERATION.md), and the form says so instead
 * of pretending the thread is live.
 */

interface ThreadRow {
  id: number;
  title: string;
  excerpt: string;
  author: string;
  replies: number;
  created_at: number;
}

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function Forum() {
  const session = useStore($session);
  const [items, setItems] = useState<ThreadRow[] | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    void refreshSession();
    fetch('/api/threads')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: ThreadRow[] }) => setItems(d.items))
      .catch(() => setItems([]));
  }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('Sending…');
    try {
      const res = await fetch('/api/threads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setTitle('');
        setBody('');
        setStatus('');
        setSubmitted(true);
      } else {
        setStatus(data.error ?? `server said ${res.status}`);
      }
    } catch {
      setStatus('Could not reach the server — try again in a moment.');
    }
    setBusy(false);
  };

  const field = 'pp-focus-ring w-full rounded-lg px-3 py-2 text-sm';
  const fieldStyle = 'background: var(--bg); color: var(--ink); border: 1px solid var(--border);';

  return (
    <div class="grid gap-6">
      <section aria-label="Start a thread" class="pp-card grid gap-3 p-5">
        <h2 class="text-lg font-extrabold tracking-tight">Start a thread</h2>
        {session.status !== 'in' ? (
          <p class="text-sm" style="color: var(--ink-soft)">
            The forum is for signed-in members —{' '}
            <a class="underline underline-offset-2" href="/login/">sign in or create a free account</a>{' '}
            to share how you focus.
          </p>
        ) : submitted ? (
          <p class="text-sm" style="color: var(--ink-soft)">
            🐾 Thanks — your thread is awaiting approval. Everything here is read by a human before
            it appears, so check back soon.
          </p>
        ) : (
          <form onSubmit={submit} class="grid gap-2.5">
            <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
              Title
              <input class={field} style={fieldStyle} type="text" required maxLength={120}
                value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
            </label>
            <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
              Your experience
              <textarea class={field} style={fieldStyle} rows={4} required maxLength={4000}
                placeholder="Plain text only — links aren't allowed."
                value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
            </label>
            <div class="flex items-center gap-3">
              <button type="submit" class="pp-btn pp-btn-primary" disabled={busy}>Send for review</button>
              <p role="status" aria-live="polite" class="min-h-4 text-xs" style="color: var(--ink-soft)">{status}</p>
            </div>
          </form>
        )}
      </section>

      <section aria-label="Threads" class="grid gap-3">
        {items === null ? (
          <p class="text-sm" style="color: var(--ink-soft)">Loading threads…</p>
        ) : items.length === 0 ? (
          <p class="pp-card p-5 text-sm" style="color: var(--ink-soft)">
            No threads yet — start the first conversation above.
          </p>
        ) : (
          items.map((t) => (
            <a
              key={t.id}
              href={`/forum/thread/${t.id}/`}
              class="pp-focus-ring pp-card pp-lift grid gap-1 p-4 no-underline"
              style="color: var(--ink)"
            >
              <h3 class="text-base font-extrabold tracking-tight">{t.title}</h3>
              <p class="text-sm" style="color: var(--ink-soft)">{t.excerpt}{t.excerpt.length >= 200 ? '…' : ''}</p>
              <p class="text-xs" style="color: var(--ink-soft)">
                {t.author} · {timeAgo(t.created_at)} · {t.replies} {t.replies === 1 ? 'reply' : 'replies'}
              </p>
            </a>
          ))
        )}
      </section>
    </div>
  );
}
