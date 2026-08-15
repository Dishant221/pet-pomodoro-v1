import { atom } from 'nanostores';
import { PET_STATES, type PetState } from '../game/manifest';
import { $profile, updateVitals } from './profile';
import { $timer } from './timer';

/**
 * The pet's visible state. One-shot poses (waking, eating, petted, playing,
 * celebrating) occupy the stage for a fixed duration and then "settle" back to
 * whatever the world says the resting state should be.
 */
export const $petState = atom<PetState>('idle');

/** Set while a one-shot pose is playing, so nothing interrupts it mid-beat. */
let holdUntil = 0;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let sadUntil = 0;

/** Wall-clock after which the cat starts lobbying for food during a break. */
let begFrom = Infinity;
/** Reset at the start of each break; only a meal clears it. */
let fedThisBreak = false;
let begTimer: ReturnType<typeof setTimeout> | undefined;

export const HUNGER_BEG_THRESHOLD = 70;
export const HUNGER_PER_FOCUS = 20;
export const SAD_HAPPINESS_THRESHOLD = 25;
export const ABANDON_SAD_MS = 60_000;
/** How far into a break the cat waits before it starts asking for food. */
export const BREAK_BEG_DELAY_MS = 15_000;

/**
 * Call when the timer enters a break. The cat gets a grace period, then starts
 * sitting up and asking for food — and keeps asking until it is fed.
 */
export function onBreakStart(): void {
  begFrom = Date.now() + BREAK_BEG_DELAY_MS;
  fedThisBreak = false;
  // The ambient heartbeat only settles every 15s, which is too coarse to catch
  // the moment begging becomes due — so nudge it directly.
  if (begTimer) clearTimeout(begTimer);
  begTimer = setTimeout(settle, BREAK_BEG_DELAY_MS + 50);
}

/** Call when the timer leaves a break, so begging does not leak into focus. */
export function onBreakEnd(): void {
  begFrom = Infinity;
  if (begTimer) clearTimeout(begTimer);
  begTimer = undefined;
}

/** What the pet should be doing when no one-shot animation is claiming it. */
export function restingState(now = Date.now()): PetState {
  const t = $timer.get();
  const { vitals } = $profile.get();

  if (t.status === 'running' && t.mode === 'focus') return 'sleeping';
  if (now < sadUntil) return 'sad';
  if (vitals.happiness <= SAD_HAPPINESS_THRESHOLD || vitals.ignoredBreaks >= 2) return 'sad';
  // A break is the cat's window to be demanding about dinner.
  if (t.mode !== 'focus' && !fedThisBreak && now >= begFrom) return 'begging';
  if (vitals.hunger >= HUNGER_BEG_THRESHOLD) return 'begging';
  return 'idle';
}

/** Recompute and apply the resting state, unless a one-shot is still holding. */
export function settle(): void {
  if (Date.now() < holdUntil) return;
  const next = restingState();
  if ($petState.get() !== next) $petState.set(next);
}

/**
 * Play a pose. One-shot poses hold the stage for their manifest duration, then
 * either chain to `then` or settle. Later calls during a hold are ignored
 * unless `force` is set, so a click can't cut a celebration in half.
 */
export function playState(state: PetState, opts: { then?: PetState; force?: boolean } = {}): void {
  const now = Date.now();
  if (!opts.force && now < holdUntil) return;

  const spec = PET_STATES[state];
  $petState.set(state);
  if (settleTimer) clearTimeout(settleTimer);

  if (spec.oneShot) {
    const dur = spec.duration ?? 2000;
    holdUntil = now + dur;
    settleTimer = setTimeout(() => {
      holdUntil = 0;
      if (opts.then) {
        playState(opts.then, { force: true });
      } else {
        settle();
      }
    }, dur);
  } else {
    holdUntil = 0;
  }
}

/** True while a one-shot pose owns the stage. */
export function isHolding(): boolean {
  return Date.now() < holdUntil;
}

// --- world events ----------------------------------------------------------

export function onFocusStart(): void {
  playState('sleeping', { force: true });
}

/** Focus bell: stretch awake, then celebrate, then fall through to resting. */
export function onFocusComplete(): void {
  const { vitals } = $profile.get();
  updateVitals({ hunger: vitals.hunger + HUNGER_PER_FOCUS });
  playState('waking', { then: 'celebrating', force: true });
}

export function onBreakComplete(fedOrPetted: boolean): void {
  const { vitals } = $profile.get();
  if (fedOrPetted) {
    updateVitals({ ignoredBreaks: 0 });
  } else {
    updateVitals({
      ignoredBreaks: vitals.ignoredBreaks + 1,
      happiness: vitals.happiness - 8,
    });
  }
  settle();
}

export function onAbandon(): void {
  const { vitals } = $profile.get();
  updateVitals({ happiness: vitals.happiness - 15 });
  sadUntil = Date.now() + ABANDON_SAD_MS;
  playState('sad', { force: true });
}

export function onFed(restores: number, joy: number): void {
  const { vitals } = $profile.get();
  updateVitals({
    hunger: vitals.hunger - restores,
    happiness: vitals.happiness + joy,
    ignoredBreaks: 0,
    lastInteractAt: Date.now(),
  });
  sadUntil = 0;
  // Only a meal settles the begging — petting is nice, but it is not dinner.
  fedThisBreak = true;
  playState('eating', { force: true });
}

export function onPetted(): void {
  const { vitals } = $profile.get();
  updateVitals({
    happiness: vitals.happiness + 8,
    ignoredBreaks: 0,
    lastInteractAt: Date.now(),
  });
  sadUntil = 0;
  playState('petted', { force: true });
}

export function onPlay(): void {
  const { vitals } = $profile.get();
  updateVitals({
    happiness: vitals.happiness + 12,
    ignoredBreaks: 0,
    lastInteractAt: Date.now(),
  });
  sadUntil = 0;
  playState('playing', { force: true });
}

/** Slow drift: gets hungrier and a little sadder as real time passes. */
export function tickVitals(elapsedMs: number): void {
  const { vitals } = $profile.get();
  const hours = elapsedMs / 3_600_000;
  if (hours <= 0) return;
  updateVitals({
    hunger: vitals.hunger + hours * 6,
    happiness: vitals.happiness - hours * 3,
  });
}

export function resetPetRuntime(): void {
  holdUntil = 0;
  sadUntil = 0;
  begFrom = Infinity;
  fedThisBreak = false;
  if (settleTimer) clearTimeout(settleTimer);
  if (begTimer) clearTimeout(begTimer);
  $petState.set('idle');
}
