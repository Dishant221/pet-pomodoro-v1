import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile, updateSettings, clamp, PET_MAX_W, PET_MIN_W } from '../stores/profile';
import { speciesOf } from '../game/economy';
import { paletteFor } from '../three/palette';
import { webglAvailable } from '../three/webgl';
import { blockedBy, groundAt, measureTerrain, typingRect, type Ledge } from '../game/terrain';
import { moodFor, MOODS } from '../game/mood';
import * as audio from '../game/audio';
import { $talk, ALLOWED_REPLIES } from '../game/talk';
/**
 * Type-only, for the same reason `Stage3D` imports its engine this way: three.js
 * and the rig on top of it are more than the rest of the app put together, and a
 * static import would put all of it in front of first paint on *every* page —
 * including the blog, where someone arrived to read an article.
 */
import type { Companion as CompanionEngine } from '../three/companion';
import type { Action } from '../three/animations';

/**
 * The pet, out of its stage and loose on the page.
 *
 * This island owns *where* the animal is and *what it should be doing*; the
 * renderer underneath owns how it looks doing it. Everything visual — the rig,
 * the species, the palette, all fifteen actions, the mood bias — is the same
 * code the painted stage runs, so there is exactly one cat in this project.
 *
 * It never re-renders on animation. Preact sees the size, the mode and the
 * error states; the walk writes a transform straight onto the host element at
 * 60Hz, because pushing a position through a component tree every frame is how
 * a companion animal becomes a performance problem.
 */

/** How far up from the bottom of the window counts as furniture. */
const BAND = 92;
/** The tallest thing it will climb onto rather than turn away from. */
const HOP_MAX = 46;
/**
 * Walking, in px per second.
 *
 * Slower than it was. At 34 the animal crossed a laptop window in well under a
 * minute and read as restless rather than alive — and anything attached to it
 * was a target moving faster than a pointer wants to chase.
 */
const SPEED = 20;
/** Keep this far clear of the window edges. */
const EDGE = 8;

type Mode = 'walk' | 'pause' | 'sit' | 'react';

export default function Companion() {
  const profile = useStore($profile);
  const settings = profile.settings;

  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CompanionEngine | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [live, setLive] = useState(false);

  /** Live size while the handle is held, committed on release — as the clock does. */
  const [liveW, setLiveW] = useState<number | null>(null);
  const width = liveW ?? settings.petW;
  /** The box is a little taller than wide: ears at the top, tail out the back. */
  const height = Math.round(width * 0.82);

  const enabled = settings.petMode === 'screen';
  const reduced = settings.reducedMotion;

  // --- everything the walk loop needs, in refs -------------------------------
  //
  // Refs rather than state throughout: these change every frame and none of
  // them should cause Preact to do anything at all.
  const xRef = useRef(0);
  const dirRef = useRef<1 | -1>(1);
  const liftRef = useRef(0);
  const modeRef = useRef<Mode>('walk');
  const untilRef = useRef(0);
  const ledgesRef = useRef<Ledge[]>([]);
  const dirtyRef = useRef(true);
  const measuredRef = useRef(0);
  const draggingRef = useRef(false);
  const sizeRef = useRef({ w: width, h: height });
  sizeRef.current = { w: width, h: height };
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const stayRef = useRef(settings.petStay);
  stayRef.current = settings.petStay;
  const petXRef = useRef(settings.petX);
  petXRef.current = settings.petX;

  const moodId = moodFor(profile.vitals);

  // --- boot the renderer -----------------------------------------------------
  useEffect(() => {
    if (!enabled) return;
    const ok = webglAvailable();
    setSupported(ok);
    if (!ok) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Everything the async boot might create, so cleanup can undo it whichever
    // side of the `await` an unmount lands on — flipping the setting off while
    // a 200 KB chunk is in flight is not hypothetical.
    let cancelled = false;
    let engine: CompanionEngine | null = null;
    let onVisibility: (() => void) | null = null;

    void (async () => {
      const { Companion: Engine } = await import('../three/companion');
      if (cancelled) return;

      try {
        engine = new Engine({
          canvas,
          species: speciesOf($profile.get().equipped.pet),
          palette: paletteFor($profile.get().equipped.pet),
          reduced: $profile.get().settings.reducedMotion,
        });
      } catch {
        // Context creation can still fail on a blocklisted driver.
        setSupported(false);
        return;
      }

      engineRef.current = engine;
      engine.setMood($profile.get().vitals.happiness / 100);
      engine.start();

      onVisibility = () => {
        if (document.hidden) engine?.stop();
        else engine?.start();
      };
      document.addEventListener('visibilitychange', onVisibility);
      setLive(true);
    })();

    return () => {
      cancelled = true;
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      engineRef.current = null;
      engine?.dispose();
      setLive(false);
    };
  }, [enabled]);

  // Push prop changes in through setters rather than rebuilding the engine.
  useEffect(() => {
    engineRef.current?.setPet(speciesOf(profile.equipped.pet), paletteFor(profile.equipped.pet));
  }, [profile.equipped.pet]);

  useEffect(() => {
    engineRef.current?.setMood(profile.vitals.happiness / 100);
  }, [profile.vitals.happiness]);

  useEffect(() => {
    engineRef.current?.setReduced(reduced);
  }, [reduced]);

  useEffect(() => {
    engineRef.current?.resize();
  }, [width, height]);

  // --- the walk --------------------------------------------------------------
  useEffect(() => {
    if (!enabled || !live) return;

    // Start where the player last parked it.
    const room = Math.max(0, window.innerWidth - sizeRef.current.w);
    xRef.current = clamp(settings.petX, 0, 1) * room;

    let raf = 0;
    let last = performance.now();

    const soil = () => {
      dirtyRef.current = true;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const host = hostRef.current;
      const engine = engineRef.current;
      if (!host || !engine) return;

      const { w, h } = sizeRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      /**
       * Re-measure here, in the read phase, on a bounded schedule.
       *
       * Not a debounced MutationObserver: the stage rewrites style attributes
       * every frame, so a debounce would be reset forever and the measurement
       * would never run at all. A dirty flag drained on a throttle cannot
       * starve, and the periodic sweep catches layout that fires no mutation —
       * a CSS transition sliding a panel changes no attribute.
       */
      if ((dirtyRef.current && now - measuredRef.current > 250) || now - measuredRef.current > 1000) {
        ledgesRef.current = measureTerrain({ band: BAND, exclude: host });
        dirtyRef.current = false;
        measuredRef.current = now;
      }

      if (draggingRef.current) {
        // Held. The pointer handler owns the position; just look alive.
        engine.setSpeed(0);
        engine.setAction('petted');
      } else if (reducedRef.current) {
        // Awake but not pacing.
        engine.setSpeed(0);
        engine.setAction('sit');
      } else if (stayRef.current) {
        rest(now, dt, w, vw, engine);
      } else {
        step(now, dt, w, h, vw, vh, engine);
      }

      // Feet on the floor, or on whatever it climbed onto.
      const y = vh - h - liftRef.current;
      host.style.transform = `translate3d(${Math.round(xRef.current)}px, ${Math.round(y)}px, 0)`;
    };

    /**
     * Parked, but not switched off.
     *
     * The pet stays where the player put it and cycles slowly through the calm
     * actions — sitting, grooming, the occasional stretch or nap. It still turns
     * to face a reaction and still answers when spoken to; it simply does not
     * travel. This is the default, because a companion that paces continuously
     * in the corner of a focus timer is working against the thing it is sitting
     * next to.
     *
     * `x` is eased toward the parked fraction rather than assigned, so a window
     * resize slides it back into place instead of teleporting it.
     */
    const rest = (now: number, dt: number, w: number, vw: number, engine: CompanionEngine) => {
      const room = Math.max(0, vw - w);
      const target = clamp(petXRef.current, 0, 1) * room;
      xRef.current += (target - xRef.current) * Math.min(1, dt * 3);
      liftRef.current = groundAt(ledgesRef.current, xRef.current, xRef.current + w, HOP_MAX);

      engine.setSpeed(0);
      if (modeRef.current === 'react') {
        if (!engine.busy()) {
          modeRef.current = 'sit';
          untilRef.current = now + 4000;
        }
        return;
      }

      if (now <= untilRef.current) return;

      // Long dwells on purpose: the point is that glancing over twice a minute
      // shows you roughly the same animal in roughly the same place.
      const roll = Math.random();
      if (roll < 0.5) {
        engine.setAction('sit');
        untilRef.current = now + 8000 + Math.random() * 7000;
      } else if (roll < 0.75) {
        engine.setAction('idle');
        untilRef.current = now + 6000 + Math.random() * 6000;
      } else if (roll < 0.9) {
        engine.setAction('groom', true);
        modeRef.current = 'react';
      } else {
        engine.setAction('sleep');
        untilRef.current = now + 12_000 + Math.random() * 10_000;
      }
    };

    const step = (
      now: number,
      dt: number,
      w: number,
      _h: number,
      vw: number,
      _vh: number,
      engine: CompanionEngine,
    ) => {
      const ledges = ledgesRef.current;
      const mode = modeRef.current;

      if (mode === 'react') {
        if (!engine.busy()) {
          modeRef.current = 'walk';
          untilRef.current = now + 2500;
        }
        return;
      }

      if (mode === 'sit' || mode === 'pause') {
        engine.setSpeed(0);
        engine.setAction(mode === 'sit' ? 'sit' : 'idle');
        if (now > untilRef.current) {
          modeRef.current = 'walk';
          untilRef.current = now + 3000 + Math.random() * 4000;
        }
        return;
      }

      // --- walking
      const nx = xRef.current + dirRef.current * SPEED * dt;
      const typing = typingRect(BAND);

      if (nx < EDGE || nx + w > vw - EDGE) {
        dirRef.current = (-dirRef.current) as 1 | -1;
        engine.setFacing(dirRef.current);
        modeRef.current = 'pause';
        untilRef.current = now + 700;
        return;
      }

      if (blockedBy(ledges, nx, nx + w, HOP_MAX)) {
        // A wall. Turn — unless there is a wall the other way too, in which
        // case turning around only makes it jitter in the gap, so it settles.
        const back = xRef.current - dirRef.current * SPEED * dt;
        if (blockedBy(ledges, back, back + w, HOP_MAX)) {
          modeRef.current = 'sit';
          untilRef.current = now + 4000;
        } else {
          dirRef.current = (-dirRef.current) as 1 | -1;
          engine.setFacing(dirRef.current);
          modeRef.current = 'pause';
          untilRef.current = now + 900;
        }
        return;
      }

      if (typing && nx < typing.right + 40 && nx + w > typing.left - 40) {
        // Walk away from whatever is being typed into.
        const away: 1 | -1 = nx + w / 2 < (typing.left + typing.right) / 2 ? -1 : 1;
        dirRef.current = away;
        engine.setFacing(away);
      }

      xRef.current = nx;
      liftRef.current = groundAt(ledges, nx, nx + w, HOP_MAX);
      engine.setSpeed(SPEED / 40);
      engine.setAction('walk');

      // Weighted toward stopping. Even with wandering switched on, a cat that
      // is walking most of the time is a distraction rather than a companion.
      if (now > untilRef.current) {
        const roll = Math.random();
        if (roll < 0.3) {
          untilRef.current = now + 2500 + Math.random() * 4000;
        } else if (roll < 0.85) {
          modeRef.current = 'sit';
          untilRef.current = now + 5000 + Math.random() * 6000;
        } else {
          modeRef.current = 'pause';
          untilRef.current = now + 2000;
        }
      }
    };

    window.addEventListener('scroll', soil, { passive: true });
    window.addEventListener('resize', soil);
    document.addEventListener('focusin', soil);
    document.addEventListener('focusout', soil);
    // `style` is deliberately out of the filter — see the note in the loop.
    const mo = new MutationObserver(soil);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', soil);
      window.removeEventListener('resize', soil);
      document.removeEventListener('focusin', soil);
      document.removeEventListener('focusout', soil);
      mo.disconnect();
    };
    // `settings.petX` is read once to seed the position; re-running the loop
    // every time it is written would restart the walk mid-stride.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, live]);

  // --- interaction -----------------------------------------------------------

  /** Say something, in the animal's own voice, subject to the mute setting. */
  const speak = () => {
    if (settings.muted) return;
    void audio.unlock().then(() => audio.playVoice());
  };

  const react = (action: Action) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setAction(action, true);
    modeRef.current = 'react';
    speak();
  };

  // --- being spoken to -------------------------------------------------------
  //
  // The conversation itself lives in `game/talk.ts`, driven by the fixed control
  // in `TalkBar`. This island's only job is to perform the reaction: the pet used
  // to carry the microphone itself, which meant the control walked away from the
  // pointer and did not exist at all when the pet lived in its stage.
  const talk = useStore($talk);

  useEffect(() => {
    // `seq` starts at 0 and is bumped per reaction, so this cannot fire on mount
    // and a repeated behaviour still plays twice.
    if (talk.seq === 0 || !talk.behaviour) return;
    const engine = engineRef.current;
    if (!engine) return;
    // Checked once more before an arbitrary string reaches the animation system.
    const action = ALLOWED_REPLIES.has(talk.behaviour) ? (talk.behaviour as Action) : 'idle';
    engine.setAction(action, true);
    modeRef.current = 'react';
    // Only the sequence number matters; reacting to `behaviour` would miss a
    // repeat of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk.seq]);

  const grab = useRef<{ dx: number; moved: number } | null>(null);

  const onPointerDown = (e: PointerEvent) => {
    const host = hostRef.current;
    if (!host) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    grab.current = { dx: e.clientX - xRef.current, moved: 0 };
  };

  const onPointerMove = (e: PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    g.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    // A few pixels of wobble is a click, not a drag. Only past that does the
    // animal get picked up — otherwise petting it would shove it sideways.
    if (g.moved < 6) return;
    draggingRef.current = true;
    const room = Math.max(0, window.innerWidth - sizeRef.current.w);
    xRef.current = clamp(e.clientX - g.dx, 0, room);
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = grab.current;
    if (!g) return;
    grab.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);

    if (draggingRef.current) {
      draggingRef.current = false;
      const room = Math.max(0, window.innerWidth - sizeRef.current.w);
      updateSettings({ petX: room > 0 ? clamp(xRef.current / room, 0, 1) : 0 });
      modeRef.current = 'walk';
      untilRef.current = performance.now() + 1200;
    } else {
      react('petted');
    }
  };

  /** Arrow keys move it, for the same reason the clock's do: a drag handle only
      a mouse can reach is not a handle. Shift resizes. */
  const onKeyDown = (e: KeyboardEvent) => {
    const room = Math.max(0, window.innerWidth - sizeRef.current.w);
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -16 : 16;
      updateSettings({ petW: clamp(Math.round(width + d), PET_MIN_W, PET_MAX_W) });
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const d = (e.key === 'ArrowLeft' ? -0.05 : 0.05) * room;
      xRef.current = clamp(xRef.current + d, 0, room);
      updateSettings({ petX: room > 0 ? clamp(xRef.current / room, 0, 1) : 0 });
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      react('petted');
    }
  };

  // --- resize handle ---------------------------------------------------------
  const resizing = useRef<{ startX: number; startW: number } | null>(null);

  const onResizeDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    resizing.current = { startX: e.clientX, startW: width };
    setLiveW(width);
  };

  const onResizeMove = (e: PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    setLiveW(clamp(Math.round(r.startW + (e.clientX - r.startX)), PET_MIN_W, PET_MAX_W));
  };

  const onResizeUp = (e: PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    if (liveW != null) updateSettings({ petW: liveW });
    setLiveW(null);
  };

  const onResizeKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    updateSettings({ petW: clamp(Math.round(width + d), PET_MIN_W, PET_MAX_W) });
  };

  // --- render ----------------------------------------------------------------
  //
  // Nothing at all when the pet lives in its stage, and nothing when the
  // browser cannot draw it. A companion that is present but broken is worse
  // than one that is absent: it takes up the corner and does nothing.
  if (!enabled || supported === false) return null;

  const label = `${MOODS[moodId].label} ${profile.equipped.pet}. Drag to move, arrow keys to walk it, shift and arrow keys to resize, enter to pet it.`;

  return (
    <div
      ref={hostRef}
      class="pp-companion"
      data-live={live ? 'true' : 'pending'}
      data-mood={moodId}
      style={`width: ${width}px; height: ${height}px;`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="button"
      aria-label={label}
    >
      <canvas ref={canvasRef} class="pp-companion-canvas" aria-hidden="true" />

      {/* The reply is shown by `TalkBar`, not here. A bubble parented to this
          element was clipped away by `contain: paint` and never actually
          appeared on screen, which is why talking to the pet looked like it did
          nothing at all. */}
      <span
        class="pp-companion-grip"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        onKeyDown={onResizeKey}
        tabIndex={0}
        role="slider"
        aria-label="Pet size"
        aria-valuemin={PET_MIN_W}
        aria-valuemax={PET_MAX_W}
        aria-valuenow={width}
        aria-orientation="horizontal"
      />
    </div>
  );
}
