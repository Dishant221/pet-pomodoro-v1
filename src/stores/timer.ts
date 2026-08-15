import { atom } from 'nanostores';
import { TIMER_KEY, isBrowser, readJSON, writeJSON } from './persist';
import { $profile, type Settings, type TimerMode } from './profile';

export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerState {
  mode: TimerMode;
  status: TimerStatus;
  /** Absolute wall-clock ms when the current run ends. Null unless running. */
  endsAt: number | null;
  /** Milliseconds left. Authoritative only while idle/paused. */
  remainingMs: number;
  /** Focus sessions finished in the current long-break cycle. */
  cycle: number;
  /** Total focus sessions completed, ever — drives the session dots. */
  focusDone: number;
}

export interface CompletionEvent {
  mode: TimerMode;
  ms: number;
  /** Next mode the timer moved to. */
  next: TimerMode;
}

export function minutesFor(mode: TimerMode, s: Settings): number {
  return mode === 'focus' ? s.focusMin : mode === 'short' ? s.shortMin : s.longMin;
}

export function durationFor(mode: TimerMode, s: Settings): number {
  return minutesFor(mode, s) * 60_000;
}

function initialState(): TimerState {
  const s = $profile.get().settings;
  return {
    mode: 'focus',
    status: 'idle',
    endsAt: null,
    remainingMs: durationFor('focus', s),
    cycle: 0,
    focusDone: 0,
  };
}

function restore(): TimerState {
  const base = initialState();
  if (!isBrowser) return base;
  const saved = readJSON<Partial<TimerState> | null>(TIMER_KEY, null);
  if (!saved || typeof saved !== 'object') return base;
  const merged: TimerState = {
    mode: (saved.mode as TimerMode) ?? base.mode,
    status: (saved.status as TimerStatus) ?? 'idle',
    endsAt: typeof saved.endsAt === 'number' ? saved.endsAt : null,
    remainingMs: typeof saved.remainingMs === 'number' ? saved.remainingMs : base.remainingMs,
    cycle: typeof saved.cycle === 'number' ? saved.cycle : 0,
    focusDone: typeof saved.focusDone === 'number' ? saved.focusDone : 0,
  };
  if (merged.status === 'running' && merged.endsAt == null) {
    merged.status = 'idle';
    merged.remainingMs = durationFor(merged.mode, $profile.get().settings);
  }
  return merged;
}

export const $timer = atom<TimerState>(restore());

/** Live countdown in ms, recomputed from the absolute end timestamp. */
export const $remaining = atom<number>(computeRemaining($timer.get()));

export function computeRemaining(t: TimerState): number {
  if (t.status === 'running' && t.endsAt != null) return Math.max(0, t.endsAt - Date.now());
  return Math.max(0, t.remainingMs);
}

function commit(next: TimerState): void {
  $timer.set(next);
  writeJSON(TIMER_KEY, next);
  $remaining.set(computeRemaining(next));
}

// --- completion listeners --------------------------------------------------

type Listener = (e: CompletionEvent) => void;
const listeners = new Set<Listener>();

export function onComplete(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

type AbandonListener = (mode: TimerMode, plannedMs: number) => void;
const abandonListeners = new Set<AbandonListener>();

export function onAbandon(fn: AbandonListener): () => void {
  abandonListeners.add(fn);
  return () => abandonListeners.delete(fn);
}

// --- transitions -----------------------------------------------------------

function nextModeAfter(mode: TimerMode, cycle: number, s: Settings): { mode: TimerMode; cycle: number } {
  if (mode !== 'focus') return { mode: 'focus', cycle };
  const c = cycle + 1;
  if (c >= s.longEvery) return { mode: 'long', cycle: 0 };
  return { mode: 'short', cycle: c };
}

export function start(): void {
  const t = $timer.get();
  if (t.status === 'running') return;
  const ms = t.remainingMs > 0 ? t.remainingMs : durationFor(t.mode, $profile.get().settings);
  commit({ ...t, status: 'running', endsAt: Date.now() + ms, remainingMs: ms });
}

export function pause(): void {
  const t = $timer.get();
  if (t.status !== 'running') return;
  commit({ ...t, status: 'paused', remainingMs: computeRemaining(t), endsAt: null });
}

export function toggle(): void {
  $timer.get().status === 'running' ? pause() : start();
}

/** Resets the current interval back to its full duration without advancing. */
export function reset(): void {
  const t = $timer.get();
  commit({
    ...t,
    status: 'idle',
    endsAt: null,
    remainingMs: durationFor(t.mode, $profile.get().settings),
  });
}

/** Give up on the current interval. Records an incomplete session. */
export function abandon(): void {
  const t = $timer.get();
  const s = $profile.get().settings;
  const planned = durationFor(t.mode, s);
  abandonListeners.forEach((fn) => fn(t.mode, planned));
  commit({ ...t, status: 'idle', endsAt: null, remainingMs: planned, cycle: t.mode === 'focus' ? 0 : t.cycle });
}

/** Jump straight to a mode (used by the mode chips and by skip). */
export function switchMode(mode: TimerMode): void {
  const t = $timer.get();
  const s = $profile.get().settings;
  commit({ ...t, mode, status: 'idle', endsAt: null, remainingMs: durationFor(mode, s) });
}

function complete(): void {
  const t = $timer.get();
  const s = $profile.get().settings;
  const finishedMode = t.mode;
  const plannedMs = durationFor(finishedMode, s);
  const { mode: nextMode, cycle } = nextModeAfter(finishedMode, t.cycle, s);

  const nextState: TimerState = {
    mode: nextMode,
    status: s.autoStartBreaks && nextMode !== 'focus' ? 'running' : 'idle',
    endsAt: s.autoStartBreaks && nextMode !== 'focus' ? Date.now() + durationFor(nextMode, s) : null,
    remainingMs: durationFor(nextMode, s),
    cycle,
    focusDone: finishedMode === 'focus' ? t.focusDone + 1 : t.focusDone,
  };
  commit(nextState);
  listeners.forEach((fn) => fn({ mode: finishedMode, ms: plannedMs, next: nextMode }));
}

/** Re-reads durations after the settings change, if the clock isn't running. */
export function syncDurations(): void {
  const t = $timer.get();
  if (t.status === 'running') return;
  commit({ ...t, remainingMs: durationFor(t.mode, $profile.get().settings) });
}

// --- the tick --------------------------------------------------------------

let ticking = false;

/**
 * Drives the countdown. Recomputes from the absolute end timestamp on every
 * tick, on tab focus, and on visibility change — so a refresh, a backgrounded
 * tab, or a laptop sleep can never drift the clock. If the deadline passed
 * while we were away, completion fires on the next tick.
 */
export function startTicking(): () => void {
  if (!isBrowser || ticking) return () => {};
  ticking = true;

  const tick = () => {
    const t = $timer.get();
    if (t.status !== 'running' || t.endsAt == null) return;
    const left = Math.max(0, t.endsAt - Date.now());
    $remaining.set(left);
    if (left <= 0) complete();
  };

  const id = setInterval(tick, 250);
  const onVisible = () => tick();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  tick(); // catch up immediately on load

  ticking = false;
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const MODE_LABEL: Record<TimerMode, string> = {
  focus: 'Focus',
  short: 'Short Break',
  long: 'Long Break',
};
