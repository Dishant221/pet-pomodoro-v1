import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import Stage from './Stage';
import Stage3D, { type StageApi } from './Stage3D';
import {
  $profile,
  addCoins,
  applyAppearance,
  prefersReducedMotion,
  recordSession,
  updateSettings,
} from '../stores/profile';
import {
  $remaining,
  $timer,
  MODE_LABEL,
  abandon,
  durationFor,
  formatClock,
  onAbandon as onTimerAbandon,
  onComplete,
  reset,
  startTicking,
  switchMode,
  toggle,
} from '../stores/timer';
import {
  $petState,
  onAbandon as petAbandon,
  onBreakComplete,
  onBreakEnd,
  onBreakStart,
  onFed,
  onFocusComplete,
  onFocusStart,
  onPetted,
  onPlay,
  settle,
  tickVitals,
} from '../stores/pet';
import { REWARDS, SNACK_BY_ID, coinsForFocus } from '../game/economy';
import * as audio from '../game/audio';
import type { TimerMode } from '../stores/profile';
import type { PropSpec } from '../three/props';

const LAST_SEEN_KEY = 'petpomo.lastSeen.v1';

export default function Game() {
  const profile = useStore($profile);
  const timer = useStore($timer);
  const remaining = useStore($remaining);
  const petState = useStore($petState);

  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const reduced = prefersReducedMotion(profile);

  /** Did the player interact with the cat during the current break? */
  const interactedThisBreak = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stage = useRef<StageApi | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // --- boot -----------------------------------------------------------------
  useEffect(() => {
    applyAppearance($profile.get());
    const stopTick = startTicking();

    // Catch up on hunger/happiness drift while the tab was closed.
    try {
      const last = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
      if (last > 0) tickVitals(Date.now() - last);
    } catch {
      /* storage blocked */
    }
    const heartbeat = setInterval(() => {
      try {
        localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      settle();
    }, 15_000);

    settle();
    return () => {
      stopTick();
      clearInterval(heartbeat);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      audio.dispose();
    };
  }, []);

  // Re-apply theme/skin whenever the profile changes (shop equips, settings).
  useEffect(() => {
    applyAppearance(profile);
  }, [profile.equipped.theme, profile.equipped.pet, profile.settings.reducedMotion]);

  // Mixer follows the sliders live.
  useEffect(() => {
    audio.setVolumes({
      master: profile.settings.volMaster,
      sfx: profile.settings.volSfx,
    });
    audio.setMuted(profile.settings.muted);
    if (!profile.settings.muted) audio.unlock();
  }, [profile.settings.volMaster, profile.settings.volSfx, profile.settings.muted]);

  // --- timer completion -----------------------------------------------------
  useEffect(() => {
    const off = onComplete((e) => {
      audio.playBell();
      recordSession({ at: Date.now(), mode: e.mode, ms: e.ms, completed: true });

      if (e.mode === 'focus') {
        const earned = coinsForFocus(e.ms);
        addCoins(earned);
        onFocusComplete();
        audio.playCoin();
        flash(`Focus complete — +${earned} coins`);
        notify('Focus complete', 'Time for a break. Mochi is waking up.');
        interactedThisBreak.current = false;
        // The reward for finishing: the cat runs off and fetches you something.
        setTimeout(() => stage.current?.deliverGift(), 3400);
      } else {
        if (e.mode === 'long') addCoins(REWARDS.longBreakBonus);
        onBreakComplete(interactedThisBreak.current);
        flash(`${MODE_LABEL[e.mode]} over — back to it`);
        notify('Break over', 'Ready for another focus session?');
      }
    });

    const offAbandon = onTimerAbandon((mode, ms) => {
      recordSession({ at: Date.now(), mode, ms, completed: false });
      if (mode === 'focus') {
        petAbandon();
        audio.playWhimper();
        flash('Session abandoned. Mochi is sad.');
      } else {
        settle();
      }
    });

    return () => {
      off();
      offAbandon();
    };
  }, [flash]);

  // Pet reacts when a focus run begins.
  const prevStatus = useRef(timer.status);
  useEffect(() => {
    if (prevStatus.current !== 'running' && timer.status === 'running' && timer.mode === 'focus') {
      onFocusStart();
    }
    if (prevStatus.current === 'running' && timer.status !== 'running') {
      settle();
    }
    prevStatus.current = timer.status;
  }, [timer.status, timer.mode]);

  // Entering a break arms the "feed me" campaign; leaving one calls it off.
  useEffect(() => {
    if (timer.mode === 'focus') onBreakEnd();
    else onBreakStart();
    settle();
  }, [timer.mode]);

  // --- title-bar countdown --------------------------------------------------
  useEffect(() => {
    const base = 'PetPomo';
    document.title =
      timer.status === 'running' ? `${formatClock(remaining)} · ${MODE_LABEL[timer.mode]} — ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [remaining, timer.status, timer.mode]);

  // --- interactions ---------------------------------------------------------
  const snack = SNACK_BY_ID[profile.equipped.snack];
  const running = timer.status === 'running';
  const snackEnabled = timer.mode !== 'focus' || !running;

  const handleFeed = useCallback(() => {
    audio.unlock();
    onFed(snack.restores, snack.joy);
    addCoins(REWARDS.feeding);
    audio.playMunch();
    audio.playMeow(1);
    interactedThisBreak.current = true;
    flash(`${snack.name} — Mochi is delighted`);
  }, [snack, flash]);

  const handlePet = useCallback(() => {
    audio.unlock();
    onPetted();
    addCoins(REWARDS.petting);
    interactedThisBreak.current = true;
  }, []);

  const handlePoke = useCallback(() => {
    audio.unlock();
    onPlay();
    addCoins(REWARDS.play);
    audio.playMeow(0);
    interactedThisBreak.current = true;
  }, []);

  const handleMeow = useCallback(() => {
    audio.playMeow();
  }, []);

  const handleGift = useCallback(
    (prop: PropSpec) => {
      audio.playCoin();
      flash(
        prop.kind === 'toy'
          ? `${prop.glyph} Mochi brought you a ${prop.label.toLowerCase()} — click it to play!`
          : `${prop.glyph} Mochi brought you a ${prop.label.toLowerCase()}`,
      );
    },
    [flash],
  );

  const handlePurrStart = useCallback(() => {
    audio.unlock().then(() => audio.startPurr());
  }, []);

  const handlePurrEnd = useCallback(() => {
    audio.stopPurr();
  }, []);

  // --- snack drag -----------------------------------------------------------
  const draggingRef = useRef(false);

  const onSnackDown = (e: PointerEvent) => {
    if (!snackEnabled || !stage.current) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    audio.unlock();
    stage.current.beginDrag(profile.equipped.snack);
    stage.current.moveDrag(e.clientX, e.clientY);
  };

  const onSnackMove = (e: PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    stage.current?.moveDrag(e.clientX, e.clientY);
  };

  const onSnackUp = (e: PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    const landed = stage.current?.endDrag(true) ?? false;
    if (!landed) flash('Drop the snack on the floor, near your cat.');
  };

  const handlePrimary = () => {
    audio.unlock();
    toggle();
  };

  const handleAbandon = () => {
    setConfirmAbandon(false);
    abandon();
  };

  const toggleMute = () => {
    const next = !profile.settings.muted;
    updateSettings({ muted: next });
    if (!next) audio.unlock();
  };

  // --- derived --------------------------------------------------------------
  const total = durationFor(timer.mode, profile.settings);
  const progress = total > 0 ? 1 - remaining / total : 0;

  const hint = running
    ? timer.mode === 'focus'
      ? 'Mochi is curled up asleep. Go do the work.'
      : 'Break time — stroke the cat, or drag a snack onto the floor.'
    : timer.mode === 'focus'
      ? 'Press start. Mochi will nap while you focus.'
      : 'Break time — stroke the cat, or drag a snack onto the floor.';

  return (
    <div class="flex h-[calc(100dvh-3.25rem)] w-full flex-col">
      {/* --- command bar: every metric and control lives up here ------------ */}
      <div class="pp-hud relative z-20 shrink-0">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:gap-x-4 sm:px-5">
          <div class="flex items-baseline gap-2">
            <span class="pp-clock pp-tabular" aria-live={running ? 'off' : 'polite'}>
              {formatClock(remaining)}
            </span>
            <span class="pp-hud-label hidden sm:inline">{MODE_LABEL[timer.mode]}</span>
          </div>

          <div class="pp-seg" role="group" aria-label="Timer mode">
            {(['focus', 'short', 'long'] as TimerMode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => switchMode(m)}
                disabled={running}
                aria-pressed={timer.mode === m}
                class="pp-seg-btn pp-focus-ring"
                data-active={timer.mode === m ? 'true' : 'false'}
              >
                {m === 'focus' ? 'Focus' : m === 'short' ? 'Short' : 'Long'}
              </button>
            ))}
          </div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrimary}
              class="pp-btn pp-btn-primary pp-focus-ring px-4 py-1.5 text-sm"
            >
              {running ? 'Pause' : timer.remainingMs < total ? 'Resume' : 'Start'}
            </button>
            <button type="button" onClick={reset} class="pp-btn pp-focus-ring px-2.5 py-1.5 text-sm" title="Reset">
              <span aria-hidden="true">↺</span>
              <span class="sr-only">Reset timer</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmAbandon(true)}
              disabled={timer.status === 'idle'}
              class="pp-btn pp-focus-ring px-2.5 py-1.5 text-sm"
              title="Give up on this session"
            >
              <span aria-hidden="true">✕</span>
              <span class="sr-only">Abandon session</span>
            </button>
          </div>

          <SessionDots done={timer.cycle} of={profile.settings.longEvery} />

          <div class="ml-auto flex items-center gap-2 sm:gap-3">
            <span class="pp-chip pp-tabular" title="Coins">
              <span aria-hidden="true">🪙</span>
              <span class="font-bold">{profile.coins}</span>
            </span>

            <span class="flex items-center gap-2.5">
              <Meter label="Fullness" value={100 - profile.vitals.hunger} tone="var(--accent)" glyph="🍽️" />
              <Meter label="Happiness" value={profile.vitals.happiness} tone="#F5788F" glyph="💗" />
            </span>

            <button
              type="button"
              class="pp-chip pp-snack pp-focus-ring"
              data-dragging={dragging ? 'true' : 'false'}
              disabled={!snackEnabled}
              onPointerDown={onSnackDown}
              onPointerMove={onSnackMove}
              onPointerUp={onSnackUp}
              onPointerCancel={onSnackUp}
              onKeyDown={(e: KeyboardEvent) => {
                if (!snackEnabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleFeed();
                }
              }}
              title={snackEnabled ? `Drag ${snack.name} onto the floor to feed Mochi` : 'Feeding waits for the break'}
            >
              <span aria-hidden="true" class="text-base leading-none">
                {snack.glyph}
              </span>
              <span class="hidden text-xs font-semibold sm:inline">Drag to feed</span>
            </button>

            <button
              type="button"
              onClick={toggleMute}
              class="pp-chip pp-focus-ring"
              aria-pressed={!profile.settings.muted}
              title={profile.settings.muted ? 'Unmute' : 'Mute'}
            >
              <span aria-hidden="true">{profile.settings.muted ? '🔇' : '🔊'}</span>
              <span class="sr-only">{profile.settings.muted ? 'Unmute audio' : 'Mute audio'}</span>
            </button>
          </div>
        </div>

        <div class="pp-progress" role="presentation">
          <span style={`transform: scaleX(${Math.min(1, Math.max(0, progress))})`} />
        </div>
      </div>

      {/* --- the world ------------------------------------------------------ */}
      <div class="relative min-h-0 flex-1">
        <Stage3D
          scene={profile.equipped.scene}
          pet={profile.equipped.pet}
          petState={petState}
          reduced={reduced}
          mood={profile.vitals.happiness / 100}
          onPet={handlePet}
          onPoke={handlePoke}
          onFeed={handleFeed}
          onMeow={handleMeow}
          onPurrStart={handlePurrStart}
          onPurrEnd={handlePurrEnd}
          onGift={handleGift}
          onReady={(api) => {
            stage.current = api;
          }}
          /* No WebGL: fall back to the original hand-drawn SVG stage, which
             supports the same interactions minus the fetch-a-gift errand. */
          fallback={
            <Stage
              scene={profile.equipped.scene}
              petState={petState}
              reduced={reduced}
              snack={snack}
              snackEnabled={snackEnabled}
              onFeed={handleFeed}
              onPet={handlePet}
              onPlay={handlePoke}
              onPetStart={handlePurrStart}
              onPetEnd={handlePurrEnd}
            />
          }
        />

        <div class="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-2 p-3">
          {toast && (
            <div class="pp-toast" role="status" aria-live="polite">
              {toast}
            </div>
          )}
          <p class="pp-hint hidden sm:block">{hint}</p>
        </div>
      </div>

      {confirmAbandon && (
        <div class="absolute inset-0 z-40 grid place-items-center p-4" style="background: rgb(0 0 0 / 0.4)">
          <div class="pp-card w-full max-w-sm p-5" role="alertdialog" aria-modal="true" aria-labelledby="ab-title">
            <h2 id="ab-title" class="mb-1 text-lg font-extrabold">
              Give up this session?
            </h2>
            <p class="mb-4 text-sm" style="color: var(--ink-soft)">
              Mochi will be sad… It won't count toward your stats either.
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmAbandon(false)}
                class="pp-btn pp-focus-ring flex-1 px-3 py-2 text-sm"
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={handleAbandon}
                class="pp-btn pp-btn-primary pp-focus-ring flex-1 px-3 py-2 text-sm"
              >
                Abandon
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- small pieces ------------------------------------------------------------

function SessionDots({ done, of }: { done: number; of: number }) {
  return (
    <div
      class="hidden items-center gap-1.5 md:flex"
      title={`${done} of ${of} focus sessions until a long break`}
      aria-label={`${done} of ${of} focus sessions until a long break`}
    >
      {Array.from({ length: of }, (_, i) => (
        <span
          key={i}
          class="block h-2 w-2 rounded-full transition-colors"
          style={`background: ${i < done ? 'var(--accent)' : 'var(--ring-track)'}`}
        />
      ))}
    </div>
  );
}

function Meter({ label, value, tone, glyph }: { label: string; value: number; tone: string; glyph: string }) {
  const v = Math.round(Math.min(100, Math.max(0, value)));
  return (
    <span class="flex items-center gap-1.5" title={`${label}: ${v}%`}>
      <span aria-hidden="true" class="text-xs">
        {glyph}
      </span>
      <span class="block h-1.5 w-10 overflow-hidden rounded-full sm:w-14" style="background: var(--ring-track)">
        <span
          class="block h-full rounded-full transition-[width] duration-500"
          style={`width: ${v}%; background: ${tone}`}
        />
      </span>
      <span class="sr-only">
        {label} {v}%
      </span>
    </span>
  );
}

function notify(title: string, body: string): void {
  const p = $profile.get();
  if (!p.settings.notifications) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/favicon.svg', tag: 'petpomo' });
  } catch {
    /* some browsers require a service-worker registration; the bell still plays */
  }
}
