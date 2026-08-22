import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $session, refreshSession } from '../stores/session';

/**
 * The interactive half of a forum thread page. The Worker (threadPage.ts)
 * already rendered the thread as static HTML into #pp-thread-ssr and put the
 * same data in the #pp-thread-data JSON block — this island reads the block
 * (no second fetch), replaces the static rendering with the interactive one,
 * and adds what static HTML can't: the reply form, the share row, and the
 * awaiting-approval notice.
 *
 * Fallback: served without the Worker (local astro preview), there is no
 * data block — then it tries the API using the id in the URL, and failing
 * that says the thread could not be loaded. Text renders as text nodes only.
 */

interface Thread { id: number; title: string; body: string; created_at: number; author: string }
interface Reply { id: number; body: string; created_at: number; author: string }

const when = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function shareIntents(url: string, title: string) {
  const e = encodeURIComponent;
  return [
    { label: 'X', href: `https://twitter.com/intent/tweet?url=${e(url)}&text=${e(title)}` },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
    { label: 'WhatsApp', href: `https://wa.me/?text=${e(`${title} ${url}`)}` },
    { label: 'Reddit', href: `https://www.reddit.com/submit?url=${e(url)}&title=${e(title)}` },
  ];
}

export default function ThreadView() {
  const session = useStore($session);
  const [thread, setThread] = useState<Thread | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [missing, setMissing] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [pendingOwn, setPendingOwn] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void refreshSession();
    const block = document.getElementById('pp-thread-data');
    if (block?.textContent) {
      try {
        const data = JSON.parse(block.textContent) as { thread: Thread; replies: Reply[] };
        setThread(data.thread);
        setReplies(data.replies);
        document.getElementById('pp-thread-ssr')?.remove();
        return;
      } catch {
        /* fall through to the API */
      }
    }
    const id = Number(location.pathname.match(/\/forum\/thread\/(\d+)/)?.[1]);
    if (!Number.isInteger(id)) {
      setMissing(true);
      return;
    }
    fetch(`/api/threads/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { thread: Thread; replies: Reply[]; pendingOwn: number }) => {
        setThread(d.thread);
        setReplies(d.replies);
        setPendingOwn(d.pendingOwn);
        document.getElementById('pp-thread-ssr')?.remove();
      })
      .catch(() => setMissing(true));
  }, []);

  if (missing) {
    return (
      <p class="pp-card p-5 text-sm" style="color: var(--ink-soft)">
        This thread could not be loaded — it may still be awaiting approval.{' '}
        <a class="underline underline-offset-2" href="/forum/">Back to the forum</a>.
      </p>
    );
  }
  if (!thread) return null; // The SSR block is on screen until hydration.

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('Sending…');
    try {
      const res = await fetch(`/api/threads/${thread.id}/replies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setBody('');
        setStatus('');
        setPendingOwn((n) => n + 1);
      } else {
        setStatus(data.error ?? `server said ${res.status}`);
      }
    } catch {
      setStatus('Could not reach the server — try again in a moment.');
    }
    setBusy(false);
  };

  const url = `${location.origin}/forum/thread/${thread.id}/`;

  return (
    <div class="grid gap-4">
      <nav aria-label="Breadcrumb" class="text-xs" style="color: var(--ink-soft)">
        <a href="/forum/" class="pp-focus-ring rounded underline underline-offset-2">Forum</a>
        <span aria-hidden="true"> › </span>
        <span aria-current="page">{thread.title}</span>
      </nav>

      <article class="pp-card grid gap-3 p-5">
        <h1 class="text-xl font-extrabold tracking-tight sm:text-2xl">{thread.title}</h1>
        <p class="text-xs" style="color: var(--ink-soft)">{thread.author} · {when(thread.created_at)}</p>
        <p class="whitespace-pre-wrap text-sm">{thread.body}</p>

        {/* Share row — plain navigations, no third-party JS (same as ShareBar.astro). */}
        <div class="flex flex-wrap items-center gap-2 border-t pt-3" style="border-color: var(--border)">
          <span class="text-xs font-bold uppercase tracking-wide" style="color: var(--ink-soft)">Share</span>
          {shareIntents(url, thread.title).map((i) => (
            <a key={i.label} href={i.href} target="_blank" rel="noopener nofollow"
              class="pp-focus-ring pp-btn text-xs">{i.label}</a>
          ))}
          <button type="button" class="pp-focus-ring pp-btn text-xs"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch { /* address bar exists */ }
            }}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </article>

      {pendingOwn > 0 && (
        <p class="pp-card px-4 py-3 text-sm" style="color: var(--ink-soft)">
          🐾 {pendingOwn === 1 ? 'Your reply is' : `${pendingOwn} of your replies are`} awaiting approval.
        </p>
      )}

      <section aria-label="Replies" class="grid gap-3">
        {replies.map((r) => (
          <article key={r.id} class="pp-card grid gap-1.5 p-4">
            <p class="text-xs" style="color: var(--ink-soft)">{r.author} · {when(r.created_at)}</p>
            <p class="whitespace-pre-wrap text-sm">{r.body}</p>
          </article>
        ))}
      </section>

      {session.status === 'in' ? (
        <form onSubmit={submit} class="pp-card grid gap-2.5 p-4">
          <label class="grid gap-1 text-xs font-bold" style="color: var(--ink-soft)">
            Reply
            <textarea class="pp-focus-ring w-full rounded-lg px-3 py-2 text-sm" rows={3} required maxLength={2000}
              style="background: var(--bg); color: var(--ink); border: 1px solid var(--border);"
              placeholder="Plain text only — links aren't allowed."
              value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
          </label>
          <div class="flex items-center gap-3">
            <button type="submit" class="pp-btn pp-btn-primary" disabled={busy}>Send for review</button>
            <p role="status" aria-live="polite" class="min-h-4 text-xs" style="color: var(--ink-soft)">{status}</p>
          </div>
        </form>
      ) : (
        <p class="pp-card p-4 text-sm" style="color: var(--ink-soft)">
          <a class="underline underline-offset-2" href="/login/">Sign in</a> to reply.
        </p>
      )}
    </div>
  );
}
