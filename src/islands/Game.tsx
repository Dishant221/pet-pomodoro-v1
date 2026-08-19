import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import Stage from './Stage';
import Stage3D, { type StageApi } from './Stage3D';
import {
  $profile,
  addCoins,
  applyAppearance,
  clamp,
  flushNow,
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
import { PET_BY_ID, REWARDS, SNACK_BY_ID, coinsForFocus, speciesOf } from '../game/economy';
import { startWorld } from '../game/world';
import { $view } from '../game/view';
import WallClock from './WallClock';
import type { Condition, PhaseId } from '../game/world';
import { PHASES } from '../world/palette';
import { SEASONS, type SeasonId } from '../world/season';
import { MOODS, moodFor, voiceRateFor } from '../game/mood';
import * as audio from '../game/audio';
import { CLOCK_MAX_W, CLOCK_MIN_W } from '../stores/profile';
import type { TimerMode } from '../stores/profile';
import type { PropSpec } from '../three/props';

const LAST_SEEN_KEY = 'petpomo.lastSeen.v1';

/** The docked edges and the floating card, as one thing CSS can switch on. */
type HudLayout = 'top' | 'left' | 'float';

/**
 * Glyphs and words for the world readout.
 *
 * Kept here rather than in the world modules on purpose: these are how the
 * state is *presented*, and `world.ts` should not care that dusk is drawn as a
 * sunset emoji. The labels are separate from the ids for the same reason —
 * `overcast` is a value, "Overcast" is copy.
 */
const PHASE_GLYPH: Record<PhaseId, string> = {
  dawn: '🌅',
  morning: '🌤️',
  noon: '☀️',
  afternoon: '🌇',
  dusk: '🌆',
  night: '🌙',
};

const CONDITION_GLYPH: Record<Condition, string> = {
  clear: '☀️',
  cloudy: '⛅',
  overcast: '☁️',
  fog: '🌫️',
  rain: '🌧️',
  snow: '❄️',
  storm: '⛈️',
};

const CONDITION_LABEL: Record<Condition, string> = {
  clear: 'Clear',
  cloudy: 'Cloudy',
  overcast: 'Overcast',
  fog: 'Fog',
  rain: 'Rain',
  snow: 'Snow',
  storm: 'Storm',
};

const SEASON_GLYPH: Record<SeasonId, string> = {
  spring: '🌱',
  summer: '🌿',
  autumn: '🍂',
  winter: '🌨️',
};

export default function Game() {
  const profile = useStore($profile);
  const timer = useStore($timer);
  const remaining = useStore($remaining);
  const petState = useStore($petState);
  const world = useStore($view);

  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const reduced = prefersReducedMotion(profile);

  /** Which overlays the player has kept. See `Settings.showWorld` and friends. */
  const { showWorld, showPet, showTimer, showClock } = profile.settings;

  /**
   * The equipped character's name, which every message about the pet uses.
   *
   * Hardcoding "Mochi" was fine while there was one animal. It stops being fine
   * the moment a player equips a dog and is told their cat is sad.
   */
  const petName = PET_BY_ID[profile.equipped.pet]?.name ?? 'Mochi';

  /**
   * How the animal feels, derived rather than stored — see game/mood.ts.
   *
   * Recomputed on every render, which sounds wasteful and is not: it reads five
   * numbers already in hand, and the alternative is a cached mood that can
   * disagree with the vitals it came from.
   */
  const mood = MOODS[moodFor(profile.vitals)];

  /** Did the player interact with the pet during the current break? */
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
    /**
     * Write the normalised profile back over whatever was on disk.
     *
     * `hydrate` is a trust boundary, and until now it only cleaned the copy in
     * memory: a save that arrived with an unknown id, a string where a number
     * belongs, or a `__proto__` in an array kept sitting in localStorage and
     * got re-parsed on every single load. The app behaved correctly each time,
     * which is exactly why it went unnoticed.
     *
     * One synchronous write on boot replaces it with the sanitised form, so the
     * bad data is dealt with once rather than survived forever. It also makes
     * that behaviour observable, which is how the gap surfaced — the test that
     * reads the stored save had been passing on an incidental write from an
     * unrelated vitals tick.
     */
    flushNow();
    const stopTick = startTicking();
    // Real local time and real weather, feeding the stage's lighting.
    const stopWorld = startWorld();

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
      stopWorld();
      clearInterval(heartbeat);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      audio.dispose();
    };
  }, []);

  // Re-apply theme/skin whenever the profile changes (shop equips, settings),
  // and hand the mixer the voice of whichever animal is now equipped — a dog
  // that meows would undo the whole point of having species.
  useEffect(() => {
    applyAppearance(profile);
    audio.setVoice(speciesOf(profile.equipped.pet));
  }, [profile.equipped.theme, profile.equipped.pet, profile.settings.reducedMotion]);

  // How often the animal speaks follows its mood and the hour. A cat that meows
  // at the same rate at 3am as at noon is a sound effect on a timer.
  useEffect(() => {
    audio.setVoiceRate(voiceRateFor(mood.id, world.phase));
  }, [mood.id, world.phase]);

  // Mixer follows the sliders live.
  useEffect(() => {
    audio.setVolumes({
      master: profile.settings.volMaster,
      sfx: profile.settings.volSfx,
      ambient: profile.settings.volAmbient,
    });
    audio.setMuted(profile.settings.muted);
    if (!profile.settings.muted) audio.unlock();
  }, [profile.settings.volMaster, profile.settings.volSfx, profile.settings.volAmbient, profile.settings.muted]);

  /**
   * The weather bed follows the sky.
   *
   * Also re-run on unmute, because audio cannot start before a gesture: on a
   * first visit the condition is known long before there is an AudioContext to
   * play it through, so the effect that reacts to the weather would have
   * nothing to do and never fire again.
   */
  useEffect(() => {
    if (profile.settings.muted) {
      audio.stopAmbience();
      return;
    }
    // Chained off unlock rather than called beside it. Audio cannot exist
    // before a gesture, and `setAmbience` bails silently when there is no
    // running context — so calling it in the same tick as `unlock()` would
    // always be a no-op on the one visit that matters, the first.
    let cancelled = false;
    void audio.unlock().then(() => {
      if (!cancelled) audio.setAmbience(world.weather.condition);
    });
    return () => {
      cancelled = true;
    };
  }, [world.weather.condition, profile.settings.muted]);

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
        notify('Focus complete', `Time for a break. ${petName} is waking up.`);
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
        flash(`Session abandoned. ${petName} is sad.`);
      } else {
        settle();
      }
    });

    return () => {
      off();
      offAbandon();
    };
  }, [flash, petName]);

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
    audio.playVoice(1);
    interactedThisBreak.current = true;
    flash(`${snack.name} — ${petName} is delighted`);
  }, [snack, flash, petName]);

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
    audio.playVoice(0);
    interactedThisBreak.current = true;
  }, []);

  const handleMeow = useCallback(() => {
    audio.playVoice();
  }, []);

  const handleGift = useCallback(
    (prop: PropSpec) => {
      audio.playCoin();
      flash(
        prop.kind === 'toy'
          ? `${prop.glyph} ${petName} brought you a ${prop.label.toLowerCase()} — click it to play!`
          : `${prop.glyph} ${petName} brought you a ${prop.label.toLowerCase()}`,
      );
    },
    [flash, petName],
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

  /**
   * With the timer card hidden, the space bar starts and pauses instead.
   *
   * Hiding the countdown is allowed to make the stage bare; it is not allowed
   * to make the app unusable, and without the card there is no control left to
   * start a session with. Only bound while the card is gone — a global space
   * handler that is always on would fight every button on the page.
   */
  useEffect(() => {
    if (showTimer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      // Space already means something inside a control or a text field, and
      // stealing it there is how a shortcut becomes a bug.
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]')) return;
      if (confirmAbandon) return;
      e.preventDefault();
      audio.unlock();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showTimer, confirmAbandon]);

  const handleAbandon = () => {
    setConfirmAbandon(false);
    abandon();
  };

  const toggleMute = () => {
    const next = !profile.settings.muted;
    updateSettings({ muted: next });
    if (!next) audio.unlock();
  };

  // --- clock placement ------------------------------------------------------
  //
  // Two modes, three arrangements. Docked reserves its own strip of the layout
  // along the top or the left edge, so it can never cover the cat. Floating
  // lifts it out of the flow into a card the player drags wherever they want.
  //
  // The three share one markup tree and differ only in CSS. Writing them as
  // three trees would mean every future control had to be added three times,
  // and the two that were forgotten would be the ones nobody notices.
  const layout: HudLayout = profile.settings.clockMode === 'float' ? 'float' : profile.settings.clockDock;
  const floating = layout === 'float';

  const fieldRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /** Where inside the card the pointer grabbed it, so it doesn't jump on grab. */
  const grabOffset = useRef({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  // While dragging, the live position is the source of truth for rendering.
  // The store is written once on release: a re-render is triggered by the timer
  // every second regardless, and reading a stale store mid-drag would snap the
  // card back to where it started on the next tick.
  const clockX = drag ? drag.x : profile.settings.clockX;
  const clockY = drag ? drag.y : profile.settings.clockY;

  /**
   * Live width while the resize handle is held, committed on release — the same
   * arrangement as the drag, and for the same reason: the timer re-renders every
   * second, and reading a stale store mid-gesture would snap the card back.
   */
  const [liveW, setLiveW] = useState<number | null>(null);
  const cardW = liveW ?? (profile.settings.clockW || 0);

  /**
   * Fraction of the travel, expressed so CSS does the measuring.
   *
   * `left: 40%` alone would place the card's left edge 40% across and let the
   * rest of it hang off the right of a narrow window. Pairing it with an equal
   * negative `translate` makes the pair interpolate between flush-left at 0 and
   * flush-right at 1, whatever the card and the window happen to measure — the
   * same reason the stored value is a fraction and not a pixel count.
   */
  const floatStyle =
    `left: ${clockX * 100}%; top: ${clockY * 100}%; transform: translate(${-clockX * 100}%, ${-clockY * 100}%)` +
    // The stylesheet caps an auto-width card at 44rem. An explicitly resized one
    // has to be allowed past that or the handle stops moving before the maximum,
    // but the 94% guard stays so it can never be wider than the stage.
    (cardW ? `; width: ${cardW}px; max-width: min(94%, ${cardW}px)` : '');

  /** Pointer position → fraction of the room the card has to move in. */
  const toFraction = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const field = fieldRef.current?.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    if (!field || !card) return null;
    const roomX = Math.max(0, field.width - card.width);
    const roomY = Math.max(0, field.height - card.height);
    const left = clientX - field.left - grabOffset.current.x;
    const top = clientY - field.top - grabOffset.current.y;
    return {
      x: roomX > 0 ? clamp(left / roomX, 0, 1) : 0,
      y: roomY > 0 ? clamp(top / roomY, 0, 1) : 0,
    };
  };

  const onGripDown = (e: PointerEvent) => {
    const card = cardRef.current?.getBoundingClientRect();
    if (!card) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    grabOffset.current = { x: e.clientX - card.left, y: e.clientY - card.top };
    setDrag({ x: clockX, y: clockY });
  };

  const onGripMove = (e: PointerEvent) => {
    if (!drag) return;
    e.preventDefault();
    const next = toFraction(e.clientX, e.clientY);
    if (next) setDrag(next);
  };

  const onGripUp = (e: PointerEvent) => {
    if (!drag) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    updateSettings({ clockX: drag.x, clockY: drag.y });
    setDrag(null);
  };

  // --- resize ---------------------------------------------------------------
  //
  // A window you can move but not size is half a window. The handle drags the
  // right edge; the height follows from the contents, which is what you want
  // here — nobody wants to choose how tall a clock is, they want to choose how
  // much room its row of controls gets before it wraps.
  const resizing = useRef<{ startX: number; startW: number } | null>(null);

  const onResizeDown = (e: PointerEvent) => {
    const card = cardRef.current?.getBoundingClientRect();
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    resizing.current = { startX: e.clientX, startW: card.width };
    setLiveW(Math.round(card.width));
  };

  const onResizeMove = (e: PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    e.preventDefault();
    setLiveW(clamp(Math.round(r.startW + (e.clientX - r.startX)), CLOCK_MIN_W, CLOCK_MAX_W));
  };

  const onResizeUp = (e: PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    if (liveW != null) updateSettings({ clockW: liveW });
    setLiveW(null);
  };

  /** Arrow keys resize it too, for the same reason they move it. */
  const onResizeKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16;
    const d = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (!d) return;
    e.preventDefault();
    const from = cardW || cardRef.current?.getBoundingClientRect().width || CLOCK_MIN_W;
    updateSettings({ clockW: clamp(Math.round(from + d), CLOCK_MIN_W, CLOCK_MAX_W) });
  };

  /** Arrow keys move it too — a drag handle only a mouse can reach isn't one. */
  const onGripKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.2 : 0.05;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    updateSettings({ clockX: clamp(clockX + dx, 0, 1), clockY: clamp(clockY + dy, 0, 1) });
  };

  // --- derived --------------------------------------------------------------
  /**
   * The animal is either in the painting or loose on the page, never both.
   *
   * The stage keeps everything else — the world, the weather, the props, the
   * errands — and simply stops drawing the cat, because two of the same animal
   * on one screen reads as a bug however it is explained.
   */
  const petLivesOnStage = profile.settings.petMode !== 'screen';

  const total = durationFor(timer.mode, profile.settings);
  const progress = total > 0 ? 1 - remaining / total : 0;

  const breakHint = `Break time — stroke ${petName}, or drag a snack onto the floor.`;
  const hint = running
    ? timer.mode === 'focus'
      ? `${petName} is curled up asleep. Go do the work.`
      : breakHint
    : timer.mode === 'focus'
      ? showTimer
        ? `Press start. ${petName} will nap while you focus.`
        : // The card that says "start" is hidden, so the hint has to carry the
          // shortcut — otherwise the only way to find it is to read the source.
          `Press space to start. ${petName} will nap while you focus.`
      : breakHint;

  /**
   * Everything about the animal, pinned to the top right of the stage.
   *
   * Kept apart from the timer on purpose. The timer is a tool you set and then
   * ignore; the pet's condition is a readout you glance at. Mixing them meant
   * the card you drag around the screen to get it out of the way was also the
   * only place to see whether the animal was hungry — so moving one moved the
   * other. This panel does not move, and the clock is free to.
   */
  /**
   * The world readout: time of day, weather, season.
   *
   * All three already drove the painting, the lighting and the sound, and none
   * of them appeared anywhere a person could read. That is a strange way to
   * build a feature — the work was being done and then hidden, and the only way
   * to know it was working was to leave the tab open for six hours. It was
   * announced to screen readers via the canvas label and to nobody else.
   *
   * Top left, opposite the pet panel, in the same bare style: this is weather,
   * not chrome, and it should sit on the painting rather than in a box.
   */
  const worldRead = (
    <div class="pp-world" role="group" aria-label="Time of day, weather and season">
      <span
        class="pp-chip"
        title={
          profile.settings.phaseMode !== 'auto'
            ? `${PHASES[world.phase].label} — set by you in Settings`
            : `${PHASES[world.phase].label} — the world follows your device's clock`
        }
      >
        <span aria-hidden="true">{PHASE_GLYPH[world.phase]}</span>
        <span class="text-xs font-bold">{PHASES[world.phase].label}</span>
      </span>
      <span
        class="pp-chip"
        title={
          profile.settings.weatherMode !== 'auto'
            ? `${CONDITION_LABEL[world.weather.condition]} — set by you in Settings`
            : world.weather.ok
              ? `${CONDITION_LABEL[world.weather.condition]} where you are`
              : 'Live weather unavailable — showing fair weather'
        }
      >
        <span aria-hidden="true">{CONDITION_GLYPH[world.weather.condition]}</span>
        <span class="text-xs font-bold">
          {CONDITION_LABEL[world.weather.condition]}
          {world.weather.temperature != null ? ` ${world.weather.temperature}°` : ''}
        </span>
      </span>
      <span
        class="pp-chip"
        title={
          profile.settings.seasonMode !== 'auto'
            ? `${SEASONS[world.season].label} — set by you in Settings`
            : `${SEASONS[world.season].label} where you are`
        }
      >
        <span aria-hidden="true">{SEASON_GLYPH[world.season]}</span>
        <span class="text-xs font-bold">{SEASONS[world.season].label}</span>
      </span>
    </div>
  );

  const metrics = (
    <div class="pp-metrics" role="group" aria-label={`${petName}: condition and care`}>
      <div class="pp-metrics-row">
        {/* `data-coins` rather than the tooltip: the title is user-facing copy
            and rewording it should not break anything that reads this. */}
        <span class="pp-chip pp-tabular" data-coins={profile.coins} title="Coins earned by focusing">
          <span aria-hidden="true">🪙</span>
          <span class="font-bold">{profile.coins}</span>
        </span>

        {/* Mood leads, then the three numbers it is read from. The mood is what
            a player acts on — "grumpy" tells you to feed it, where a happiness
            bar at 54 tells you nothing. */}
        <span class="pp-chip pp-mood" title={`${mood.label} — ${mood.blurb}`} style={`--mood: ${mood.tone}`}>
          <span aria-hidden="true">{mood.glyph}</span>
          <span class="text-xs font-bold">{mood.label}</span>
          <span class="sr-only">
            {petName} is {mood.label.toLowerCase()}. {mood.blurb}
          </span>
        </span>
      </div>

      {/* The three bars share one pill. Without the panel behind them they
          would be thin marks laid straight on the painting, and a 2px track
          over grass is not a readout. */}
      <div class="pp-chip pp-metrics-bars">
        <Meter label="Fullness" value={100 - profile.vitals.hunger} tone="var(--accent)" glyph="🍽️" />
        <Meter label="Happiness" value={profile.vitals.happiness} tone="#F5788F" glyph="💗" />
        <Meter label="Condition" value={profile.vitals.health} tone={mood.tone} glyph="❤️‍🩹" />
      </div>

      <div class="pp-metrics-row">
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
          title={snackEnabled ? `Drag ${snack.name} onto the floor to feed ${petName}` : 'Feeding waits for the break'}
        >
          <span aria-hidden="true" class="text-base leading-none">
            {snack.glyph}
          </span>
          <span class="text-xs font-semibold">Drag to feed</span>
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
  );

  const hud = (
    <div
      ref={cardRef}
      class="pp-hud relative z-20 shrink-0"
      data-layout={layout}
      data-moving={drag ? 'true' : 'false'}
      style={floating ? floatStyle : undefined}
    >
      {floating && (
        <button
          type="button"
          class="pp-grip pp-focus-ring"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onKeyDown={onGripKey}
          aria-label="Move the clock. Drag it, or nudge it with the arrow keys."
          title="Drag to move the clock"
        >
          <span aria-hidden="true">⠿</span>
        </button>
      )}
      {floating && (
        <button
          type="button"
          class="pp-resize pp-focus-ring"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onKeyDown={onResizeKey}
          aria-label="Resize the clock. Drag, or use the left and right arrow keys."
          title="Drag to resize"
        >
          <span aria-hidden="true">◢</span>
        </button>
      )}
      <div class="pp-hud-inner">
        <div class="pp-hud-clock flex items-baseline gap-2">
          <span
            class="pp-clock pp-tabular"
            data-font={profile.settings.clockFont}
            data-size={profile.settings.clockSize}
            aria-live={running ? 'off' : 'polite'}
          >
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

        {/* Session dots stay: they are the timer's own progress, not the
            animal's. Everything about the pet lives in the panel instead — see
            `metrics` below. */}
        <SessionDots done={timer.cycle} of={profile.settings.longEvery} />
      </div>

      <div class="pp-progress" role="presentation">
        <span style={`transform: scaleX(${Math.min(1, Math.max(0, progress))})`} />
      </div>
    </div>
  );

  return (
    <div
      /* Fills whatever the page gives it. The old `calc(100dvh - 3.25rem)`
         guessed at the chrome's height, got it wrong by one footer, and pushed
         the pet off the bottom of a scrolling page. */
      class={`flex h-full w-full ${layout === 'left' ? 'flex-col sm:flex-row' : 'flex-col'}`}
    >
      {/* Docked: the bar owns a strip of the layout, so the stage is whatever
          is left and the two can never overlap. Floating: it goes inside the
          stage below, absolutely positioned over the world. */}
      {!floating && showTimer && hud}

      {/* --- the world ------------------------------------------------------ */}
      <div class="relative min-h-0 flex-1" ref={fieldRef}>
        <Stage3D
          scene={profile.equipped.scene}
          pet={profile.equipped.pet}
          petState={petState}
          reduced={reduced}
          mood={profile.vitals.happiness / 100}
          petVisible={petLivesOnStage}
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

        {/* The top-left corner is a column, not two absolutely-placed things.
            Either of them can be switched off, and a stack that positions its
            own members would leave a hole where the missing one used to be. */}
        {(showWorld || showClock) && (
          <div class="pp-corner">
            {showWorld && worldRead}
            {showClock && <WallClock zones={profile.settings.clockZones} reduced={reduced} />}
          </div>
        )}
        {showPet && metrics}

        {floating && showTimer && hud}

        {/* Toasts move out from under the floating clock, which starts at the
            top of the stage — two things fading in and out over each other in
            the same place is worse than either one alone. */}
        <div
          class={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-2 p-3 ${
            floating ? 'bottom-0' : 'top-0'
          }`}
        >
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
              {petName} will be sad… It won't count toward your stats either.
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
      <span class="pp-track block h-1.5 w-10 overflow-hidden rounded-full sm:w-14" style="background: var(--ring-track)">
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
