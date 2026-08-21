/**
 * Client-side blog search. The whole index ships with the page as a JSON data
 * block, so a query never leaves the browser — no endpoint, no logging, and
 * results appear on every keystroke.
 *
 * With a query active the paginated grid and pagination are hidden and a flat
 * result list takes their place; clearing the box restores the page exactly.
 * `?q=` in the URL pre-fills the box, which is what makes the sitewide
 * SearchAction schema on /blog/ honest.
 */

interface IndexedPost {
  t: string; // title
  d: string; // description
  u: string; // url
  g: string[]; // tags
  m: string; // published, YYYY-MM-DD
}

export function mountBlogSearch(): void {
  const input = document.getElementById('pp-search-input') as HTMLInputElement | null;
  const results = document.getElementById('pp-search-results');
  const grid = document.getElementById('pp-post-grid');
  const pagination = document.getElementById('pp-pagination');
  const dataEl = document.getElementById('pp-search-data');
  if (!input || !results || !grid || !dataEl) return;

  let posts: IndexedPost[] = [];
  try {
    posts = JSON.parse(dataEl.textContent ?? '[]');
  } catch {
    return;
  }

  const card = (p: IndexedPost) => {
    const a = document.createElement('a');
    a.href = p.u;
    a.className = 'pp-card pp-focus-ring block p-4 transition hover:opacity-90';
    const h = document.createElement('h3');
    h.className = 'pp-post-card-title';
    h.textContent = p.t;
    const d = document.createElement('p');
    d.className = 'pp-post-card-desc';
    d.textContent = p.d;
    const meta = document.createElement('p');
    meta.className = 'pp-post-card-meta';
    meta.textContent = `${p.m}${p.g.length ? ' · ' + p.g.join(' · ') : ''}`;
    a.append(h, d, meta);
    return a;
  };

  const run = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      results.hidden = true;
      results.replaceChildren();
      grid.hidden = false;
      if (pagination) pagination.hidden = false;
      return;
    }
    const words = q.split(/\s+/);
    const hits = posts.filter((p) => {
      const hay = `${p.t} ${p.d} ${p.g.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });

    results.replaceChildren();
    const count = document.createElement('p');
    count.className = 'text-sm';
    count.style.color = 'var(--ink-soft)';
    count.textContent = hits.length
      ? `${hits.length} article${hits.length === 1 ? '' : 's'} match “${input.value.trim()}”`
      : `Nothing matches “${input.value.trim()}” — the cat looked everywhere. 🙀`;
    results.append(count, ...hits.map(card));
    results.hidden = false;
    grid.hidden = true;
    if (pagination) pagination.hidden = true;
  };

  input.addEventListener('input', run);

  // Deep-linkable searches: /blog/?q=adhd lands with results already open.
  const preset = new URLSearchParams(location.search).get('q');
  if (preset) {
    input.value = preset;
    run();
  }
}
