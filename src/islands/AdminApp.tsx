import { useEffect, useState } from 'preact/hooks';

/**
 * The admin dashboard, mounted client:only on /admin.
 *
 * Security model: this static page and island are PUBLIC and contain no
 * data. Everything comes from /api/admin/* at runtime, and every one of
 * those endpoints re-checks the session's role server-side (worker/src/
 * admin.ts). The island's opening probe distinguishes the three states —
 * signed out (401), signed in but not the admin (403), admin (200) — and
 * says so instead of rendering an empty shell.
 *
 * Three tabs, matching the API:
 *   Queue    — pending posts, AI-flagged first; approve / reject / delete / ban
 *   Users    — every account with its community footprint and ban control
 *   Contact  — messages from /contact, mark-read
 *
 * All user-written text renders as TEXT NODES only — the same rule as the
 * public comments island. Styling comes entirely from the .pp-* primitives
 * and theme tokens, so all four themes work unchanged.
 */

type Gate = 'checking' | 'signed-out' | 'not-admin' | 'admin';
type Tab = 'queue' | 'users' | 'contact';

interface QueueItem {
  id: number;
  kind: string;
  target: string;
  title: string | null;
  body: string;
  ai_verdict: string;
  ip_hash: string | null;
  created_at: number;
  user_id: string | null;
  author: string;
  author_email: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string | null;
  banned: number | null;
  ban_reason: string | null;
  created_at: string;
  approved_posts: number;
  pending_posts: number;
  sessions: number;
  focus_minutes: number;
  gift_clicks: number;
}

interface ContactRow {
  id: number;
  name: string;
  email: string;
  subject: string;
  message: string;
  emailed: number;
  read_at: number | null;
  created_at: number;
}

interface Stats {
  pending: number;
  users: number;
  approvedPosts: number;
  unreadContact: number;
  giftClicks: number;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin${path}`, init);
  if (!res.ok) throw Object.assign(new Error(`admin api ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

const post = (path: string, body: unknown) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>('checking');
  const [tab, setTab] = useState<Tab>('queue');
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        await api('/ping');
        setGate('admin');
        setStats(await api<Stats>('/stats'));
      } catch (e) {
        const status = (e as { status?: number }).status;
        setGate(status === 401 ? 'signed-out' : status === 403 ? 'not-admin' : 'signed-out');
      }
    })();
  }, []);

  if (gate === 'checking') {
    return <p class="text-sm" style="color: var(--ink-soft)">Checking permissions…</p>;
  }
  if (gate !== 'admin') {
    return (
      <div class="pp-card mx-auto max-w-md p-6 text-center">
        <h1 class="text-xl font-extrabold tracking-tight">Admin</h1>
        <p class="mt-2 text-sm" style="color: var(--ink-soft)">
          {gate === 'signed-out'
            ? 'Sign in with the owner account to open the dashboard.'
            : 'This account is signed in, but it is not the admin.'}
        </p>
        {gate === 'signed-out' && (
          <a href="/login/" class="pp-btn pp-btn-primary mt-4 inline-block">Sign in</a>
        )}
      </div>
    );
  }

  const tabBtn = (id: Tab, label: string, badge?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      class="pp-focus-ring rounded-lg px-3 py-2 text-sm font-bold transition-colors"
      style={tab === id ? 'background: var(--accent); color: var(--accent-ink);' : 'color: var(--ink-soft);'}
      onClick={() => setTab(id)}
    >
      {label}
      {badge ? ` (${badge})` : ''}
    </button>
  );

  return (
    <div class="grid gap-5">
      <header class="flex flex-wrap items-baseline gap-3">
        <h1 class="text-2xl font-extrabold tracking-tight">Admin</h1>
        {stats && (
          <p class="text-xs" style="color: var(--ink-soft)">
            {stats.users} users · {stats.approvedPosts} approved posts · {stats.giftClicks} gift clicks
          </p>
        )}
      </header>

      <div class="flex gap-1.5" role="tablist" aria-label="Admin sections">
        {tabBtn('queue', 'Queue', stats?.pending)}
        {tabBtn('users', 'Users')}
        {tabBtn('contact', 'Contact', stats?.unreadContact)}
      </div>

      {tab === 'queue' && <QueueTab onChange={() => api<Stats>('/stats').then(setStats).catch(() => {})} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'contact' && <ContactTab onChange={() => api<Stats>('/stats').then(setStats).catch(() => {})} />}
    </div>
  );
}

/** Pending posts, AI-flagged first. Actions remove the row optimistically —
 * the server confirmed before the state updates, so "optimistic" here only
 * means "no full refetch". */
function QueueTab({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [status, setStatus] = useState('');

  const load = () =>
    api<{ items: QueueItem[] }>('/queue')
      .then((d) => setItems(d.items))
      .catch(() => setStatus('Could not load the queue.'));
  useEffect(() => {
    void load();
  }, []);

  const act = async (id: number, action: 'approve' | 'reject' | 'delete') => {
    try {
      await post('/moderate', { id, action });
      setItems((list) => (list ? list.filter((i) => i.id !== id) : list));
      onChange();
    } catch {
      setStatus('Action failed — reload and try again.');
    }
  };

  const ban = async (item: QueueItem) => {
    if (!item.user_id) return;
    try {
      await post('/ban', { userId: item.user_id, reason: 'banned from the moderation queue' });
      setItems((list) => (list ? list.filter((i) => i.user_id !== item.user_id) : list));
      onChange();
    } catch {
      setStatus('Ban failed — reload and try again.');
    }
  };

  if (items === null) return <p class="text-sm" style="color: var(--ink-soft)">Loading queue…</p>;
  if (items.length === 0)
    return <p class="pp-card p-5 text-sm" style="color: var(--ink-soft)">Queue's empty. Nothing waiting. 🐾</p>;

  return (
    <ul class="grid gap-3">
      {status && <p class="text-xs" style="color: var(--ink-soft)">{status}</p>}
      {items.map((i) => (
        <li key={i.id} class="pp-card grid gap-2 p-4">
          <p class="flex flex-wrap items-baseline gap-2 text-xs" style="color: var(--ink-soft)">
            <strong style="color: var(--ink)">{i.author}</strong>
            {i.author_email && <span>{i.author_email}</span>}
            <span>on {i.target}</span>
            <time>{when(i.created_at)}</time>
            {i.ai_verdict.startsWith('unsafe') && (
              <span class="pp-tag-chip" style="color: var(--accent-ink); background: var(--accent);">
                AI flag: {i.ai_verdict}
              </span>
            )}
            {i.ip_hash && <span title="Source hash — spot same-source floods">{i.ip_hash.slice(4, 12)}</span>}
          </p>
          <p class="whitespace-pre-wrap text-sm">{i.body}</p>
          <p class="flex flex-wrap gap-2">
            <button type="button" class="pp-btn pp-btn-primary" onClick={() => act(i.id, 'approve')}>Approve</button>
            <button type="button" class="pp-btn" onClick={() => act(i.id, 'reject')}>Reject</button>
            <button type="button" class="pp-btn" onClick={() => act(i.id, 'delete')}>Delete</button>
            {i.user_id && (
              <button type="button" class="pp-btn" onClick={() => ban(i)}>Ban author</button>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

function UsersTab() {
  const [items, setItems] = useState<UserRow[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const load = () =>
    api<{ items: UserRow[] }>('/users')
      .then((d) => setItems(d.items))
      .catch(() => setStatus('Could not load users.'));
  useEffect(() => {
    void load();
  }, []);

  const toggleBan = async (u: UserRow) => {
    try {
      await post(u.banned ? '/unban' : '/ban', { userId: u.id });
      await load();
    } catch {
      setStatus('Ban change failed.');
    }
  };

  if (items === null) return <p class="text-sm" style="color: var(--ink-soft)">Loading users…</p>;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? items.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(needle))
    : items;

  return (
    <div class="grid gap-3">
      <input
        class="pp-focus-ring w-full max-w-xs rounded-lg px-3 py-2 text-sm"
        style="background: var(--bg); color: var(--ink); border: 1px solid var(--border);"
        type="search"
        placeholder="Search name or email…"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {status && <p class="text-xs" style="color: var(--ink-soft)">{status}</p>}
      <div class="overflow-x-auto">
        <table class="w-full text-sm" style="border-collapse: collapse;">
          <thead>
            <tr class="text-left text-xs" style="color: var(--ink-soft)">
              <th class="px-2 py-2">User</th>
              <th class="px-2 py-2">Sessions</th>
              <th class="px-2 py-2">Focus min</th>
              <th class="px-2 py-2">Posts</th>
              <th class="px-2 py-2">Gift clicks</th>
              <th class="px-2 py-2">Status</th>
              <th class="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} style="border-top: 1px solid var(--border);">
                <td class="px-2 py-2">
                  <strong>{u.name}</strong>
                  <br />
                  <span class="text-xs" style="color: var(--ink-soft)">{u.email}</span>
                </td>
                <td class="px-2 py-2 text-center">{u.sessions}</td>
                <td class="px-2 py-2 text-center">{u.focus_minutes}</td>
                <td class="px-2 py-2 text-center">
                  {u.approved_posts}
                  {u.pending_posts ? ` (+${u.pending_posts} pending)` : ''}
                </td>
                <td class="px-2 py-2 text-center">{u.gift_clicks}</td>
                <td class="px-2 py-2 text-xs">
                  {u.role === 'admin' ? 'admin' : u.banned ? `banned${u.ban_reason ? ` — ${u.ban_reason}` : ''}` : 'active'}
                </td>
                <td class="px-2 py-2">
                  {u.role !== 'admin' && (
                    <button type="button" class="pp-btn" onClick={() => toggleBan(u)}>
                      {u.banned ? 'Unban' : 'Ban'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContactTab({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<ContactRow[] | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api<{ items: ContactRow[] }>('/contact')
      .then((d) => setItems(d.items))
      .catch(() => setStatus('Could not load messages.'));
  }, []);

  const markRead = async (id: number) => {
    try {
      await post(`/contact/${id}/read`, {});
      setItems((list) => (list ? list.map((m) => (m.id === id ? { ...m, read_at: Date.now() } : m)) : list));
      onChange();
    } catch {
      setStatus('Could not mark as read.');
    }
  };

  if (items === null) return <p class="text-sm" style="color: var(--ink-soft)">Loading messages…</p>;
  if (items.length === 0)
    return <p class="pp-card p-5 text-sm" style="color: var(--ink-soft)">No contact messages yet.</p>;

  return (
    <ul class="grid gap-3">
      {status && <p class="text-xs" style="color: var(--ink-soft)">{status}</p>}
      {items.map((m) => (
        <li key={m.id} class="pp-card grid gap-2 p-4" style={m.read_at ? 'opacity: 0.65;' : ''}>
          <p class="flex flex-wrap items-baseline gap-2 text-xs" style="color: var(--ink-soft)">
            <strong style="color: var(--ink)">{m.subject}</strong>
            <span>{m.name}</span>
            <span>{m.email}</span>
            <time>{when(m.created_at)}</time>
            {!m.emailed && <span title="Stored only — email sending not configured yet">📥 not emailed</span>}
          </p>
          <p class="whitespace-pre-wrap text-sm">{m.message}</p>
          <p class="flex gap-2">
            {/* Admin-initiated reply via their own mail client — safe, and it
                works before any sending infrastructure exists. */}
            <a class="pp-btn" href={`mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}>
              Reply
            </a>
            {!m.read_at && (
              <button type="button" class="pp-btn" onClick={() => markRead(m.id)}>Mark read</button>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
