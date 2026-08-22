import { useMemo, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile, type SessionRecord } from '../stores/profile';

type Range = 'today' | 'week' | 'all';

const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'all', label: 'All' },
];

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

function inRange(rec: SessionRecord, range: Range, now: number): boolean {
  if (range === 'all') return true;
  const today = startOfDay(new Date(now));
  if (range === 'today') return rec.at >= today;
  return rec.at >= today - 6 * 86_400_000;
}

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

export default function StatsPanel() {
  const profile = useStore($profile);
  const [range, setRange] = useState<Range>('today');
  // Recomputed per render; sessions only change on completion so this is cheap.
  const now = Date.now();

  const stats = useMemo(() => {
    const scoped = profile.sessions.filter((s) => inRange(s, range, now));
    const focus = scoped.filter((s) => s.mode === 'focus');
    const completed = focus.filter((s) => s.completed);
    const abandoned = focus.filter((s) => !s.completed);
    const focusMs = completed.reduce((sum, s) => sum + s.ms, 0);
    const breaks = scoped.filter((s) => s.mode !== 'focus' && s.completed).length;
    const rate = focus.length ? Math.round((completed.length / focus.length) * 100) : 0;
    return { focusMs, completed: completed.length, abandoned: abandoned.length, breaks, rate };
  }, [profile.sessions, range, now]);

  // Seven-day bars always show the last 7 days regardless of the range toggle —
  // it's the shape of the habit, not a filtered subset.
  const days = useMemo(() => {
    const today = startOfDay(new Date(now));
    return Array.from({ length: 7 }, (_, i) => {
      const dayStart = today - (6 - i) * 86_400_000;
      const dayEnd = dayStart + 86_400_000;
      const ms = profile.sessions
        .filter((s) => s.mode === 'focus' && s.completed && s.at >= dayStart && s.at < dayEnd)
        .reduce((sum, s) => sum + s.ms, 0);
      return { label: new Date(dayStart).toLocaleDateString(undefined, { weekday: 'short' }), ms, dayStart };
    });
  }, [profile.sessions, now]);

  const streak = useMemo(() => computeStreak(profile.sessions, now), [profile.sessions, now]);
  const hasAny = profile.sessions.some((s) => s.mode === 'focus' && s.completed);

  return (
    <section>
      <header class="mb-5">
        <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">Stats</h1>
        <p class="text-sm" style="color: var(--ink-soft)">
          Only completed focus sessions count toward your totals.
        </p>
      </header>

      <div class="mb-5 flex gap-1.5" role="tablist" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={range === r.id}
            onClick={() => setRange(r.id)}
            class="pp-btn pp-focus-ring px-4 py-1.5 text-sm"
            style={range === r.id ? 'background: var(--accent); color: var(--accent-ink); border-color: transparent;' : ''}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Focus time" value={formatDuration(stats.focusMs)} glyph="⏱️" />
        <Card label="Sessions" value={String(stats.completed)} glyph="✅" />
        <Card label="Completion" value={`${stats.rate}%`} glyph="🎯" hint={`${stats.abandoned} abandoned`} />
        <Card label="Day streak" value={String(streak)} glyph="🔥" />
      </div>

      <div class="pp-card p-4 sm:p-5">
        <h2 class="mb-4 text-sm font-bold uppercase tracking-wide" style="color: var(--ink-soft)">
          Last 7 days
        </h2>
        {hasAny ? <Bars days={days} /> : <Empty />}
      </div>

      <div class="mt-4 grid grid-cols-2 gap-3">
        <Card label="Breaks taken" value={String(stats.breaks)} glyph="☕" />
        <Card label="Coins earned" value={String(profile.coins)} glyph="🪙" hint="current balance" />
      </div>
    </section>
  );
}

function Bars({ days }: { days: { label: string; ms: number; dayStart: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.ms));
  const W = 700;
  const H = 220;
  // Top padding is what keeps the tallest bar's value label inside the
  // viewBox — without it the number over a full-height bar is clipped.
  const PAD_T = 22;
  const PAD_B = 28;
  const plotH = H - PAD_T - PAD_B;
  const baseline = H - PAD_B;
  const slot = W / days.length;
  const barW = Math.min(56, slot * 0.55);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="h-auto w-full" role="img" aria-label="Focus minutes for each of the last seven days">
      {/* Gridlines sit on the same value scale as the bars: t of max. */}
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1="0"
          x2={W}
          y1={baseline - plotH * t}
          y2={baseline - plotH * t}
          stroke="var(--ring-track)"
          stroke-width="1"
        />
      ))}
      {/* The axis the bars stand on. */}
      <line x1="0" x2={W} y1={baseline} y2={baseline} stroke="var(--ring-track)" stroke-width="1.5" />
      {days.map((d, i) => {
        const h = d.ms === 0 ? 0 : Math.max(4, (plotH * d.ms) / max);
        const x = i * slot + (slot - barW) / 2;
        const y = baseline - h;
        return (
          <g key={d.dayStart}>
            <title>{`${d.label}: ${Math.round(d.ms / 60000)} minutes`}</title>
            <rect x={x} y={y} width={barW} height={h} rx="6" fill="var(--accent)" />
            {d.ms > 0 && (
              <text x={x + barW / 2} y={y - 6} text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink-soft)">
                {Math.round(d.ms / 60000)}
              </text>
            )}
            <text x={x + barW / 2} y={H - 8} text-anchor="middle" font-size="13" font-weight="600" fill="var(--ink-soft)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Card({ label, value, glyph, hint }: { label: string; value: string; glyph: string; hint?: string }) {
  return (
    <div class="pp-card p-4">
      <div class="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style="color: var(--ink-soft)">
        <span aria-hidden="true">{glyph}</span>
        {label}
      </div>
      <div class="pp-tabular text-2xl font-extrabold">{value}</div>
      {hint && (
        <div class="mt-0.5 text-xs" style="color: var(--ink-soft)">
          {hint}
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div class="py-10 text-center">
      <div class="mb-2 text-4xl" aria-hidden="true">
        🌱
      </div>
      <p class="text-sm font-semibold">No focus sessions yet.</p>
      <p class="text-sm" style="color: var(--ink-soft)">
        Finish one on the <a href="/" class="underline">Focus</a> page and it'll show up here.
      </p>
    </div>
  );
}

/** Consecutive days (ending today or yesterday) with at least one focus session. */
function computeStreak(sessions: SessionRecord[], now: number): number {
  const days = new Set(
    sessions.filter((s) => s.mode === 'focus' && s.completed).map((s) => startOfDay(new Date(s.at))),
  );
  if (days.size === 0) return 0;
  const today = startOfDay(new Date(now));
  let cursor = days.has(today) ? today : today - 86_400_000;
  if (!days.has(cursor)) return 0;
  let count = 0;
  while (days.has(cursor)) {
    count += 1;
    cursor -= 86_400_000;
  }
  return count;
}
