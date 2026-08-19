import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile, updateSettings, clamp, PET_MAX_W, PET_MIN_W } from '../stores/profile';
import { speciesOf } from '../game/economy';
import { paletteFor } from '../three/palette';
import { webglAvailable } from '../three/webgl';
import { blockedBy, groundAt, measureTerrain, typingRect, type Ledge } from '../game/terrain';
import { moodFor, MOODS } from '../game/mood';
import * as audio from '../game/audio';
import { ask, listenOnce, speechAvailable, type ListenHandle } from '../game/speech';
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
/** Walking, in px per second. A cat crossing a screen should take a while. */
const SPEED = 34;
/** Keep this far clear of the window edges. */
const EDGE = 8;

type Mode = 'walk' | 'pause' | 'sit' | 'react';

/**
 * Behaviours the pet may be asked to perform in reply to being spoken to.
 *
 * Kept in step with the whitelist in `worker/src/index.ts`, and checked on this
 * side too. The server's list is the one that stops a model inventing an
 * action; this one is what stops a *response* — from a proxy, a cache, or a
 * future version of that endpoint — reaching the animation system unchecked.
 */
const ALLOWED_REPLIES = new Set<string>([
  'idle',
  'sit',
  'sleep',
  'stretch',
  'play',
  'jump',
  'celebrate',
  'groom',
  'beg',
  'walk',
]);

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
      } else {
        step(now, dt, w, h, vw, vh, engine);
      }

      // Feet on the floor, or on whatever it climbed onto.
      const y = vh - h - liftRef.current;
      host.style.transform = `translate3d(${Math.round(xRef.current)}px, ${Math.round(y)}px, 0)`;
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

      if (now > untilRef.current) {
        const roll = Math.random();
        if (roll < 0.55) {
          untilRef.current = now + 2500 + Math.random() * 4000;
        } else if (roll < 0.9) {
          modeRef.current = 'sit';
          untilRef.current = now + 2000 + Math.random() * 3500;
        } else {
          modeRef.current = 'pause';
          untilRef.current = now + 1200;
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
  // Off until asked for, every time. There is deliberately no stored "always
  // listening" setting: see the note at the top of game/speech.ts for why.
  const [listening, setListening] = useState(false);
  const [bubble, setBubble] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const listenRef = useRef<ListenHandle | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (line: string) => {
    setBubble(line);
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 6000);
  };

  /** Send what was said, then play back whatever the animal decided to do. */
  const heard = async (text: string) => {
    show('…');
    const r = await ask(text);
    show(r.say);
    // The behaviour is checked again here rather than trusted: this is the last
    // point before an arbitrary string reaches the animation system.
    const action = ALLOWED_REPLIES.has(r.behaviour) ? (r.behaviour as Action) : 'idle';
    const engine = engineRef.current;
    if (engine) {
      engine.setAction(action, true);
      modeRef.current = 'react';
    }
    // It answers in its own voice, never in words. Tone picks the variant, so
    // an excited reply is a different noise from a sad one.
    if (!settings.muted) {
      const variant = r.tone === 'excited' ? 2 : r.tone === 'sad' ? 1 : 0;
      void audio.unlock().then(() => audio.playVoice(variant, { force: true }));
    }
  };

  const toggleListen = (e: Event) => {
    e.stopPropagation();
    if (listening) {
      listenRef.current?.cancel();
      return;
    }
    if (!speechAvailable()) {
      // No recogniser here — Firefox and Safari. Offer the keyboard instead of
      // a control that would do nothing.
      setTyped('');
      return;
    }
    setListening(true);
    show('listening…');
    listenRef.current = listenOnce({
      onResult: (text) => void heard(text),
      onEnd: (reason) => {
        setListening(false);
        listenRef.current = null;
        if (reason === 'denied') show('needs microphone permission');
      },
    });
  };

  // A recogniser must never outlive the component that opened it.
  useEffect(
    () => () => {
      listenRef.current?.cancel();
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    },
    [],
  );

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

      {/* What the animal just did, in words, for anyone who cannot hear the
          meow — and because a reaction you can read is a reaction you can be
          sure landed. `polite`, so it never interrupts. */}
      {/* `aria-live` without `role="status"`, deliberately. The role adds
          nothing here — it only implies the same polite live region — and it
          would put a second `[role="status"]` on any page the pet is on, which
          is the selector the stage and the settings panel already use for their
          own announcements. */}
      {bubble && (
        <p class="pp-companion-bubble" aria-live="polite">
          {bubble}
        </p>
      )}

      {/* Talking to it. A button, pressed each time — never a stored setting,
          and never a microphone left open. */}
      <button
        type="button"
        class="pp-companion-mic"
        data-on={listening ? 'true' : 'false'}
        aria-pressed={listening}
        title={listening ? 'Listening — click to stop' : 'Say something to your pet'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={toggleListen}
      >
        <span aria-hidden="true">{listening ? '◉' : '🎤'}</span>
        <span class="sr-only">{listening ? 'Listening. Click to stop.' : 'Say something to your pet'}</span>
      </button>

      {/* Firefox and Safari cannot transcribe, so they get the keyboard. The
          same endpoint, the same reaction — just typed. */}
      {typed !== null && (
        <form
          class="pp-companion-say"
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            const t = typed.trim();
            setTyped(null);
            if (t) void heard(t);
          }}
        >
          <input
            type="text"
            value={typed}
            autoFocus
            maxLength={200}
            placeholder="Say something…"
            aria-label="Say something to your pet"
            onInput={(e) => setTyped((e.currentTarget as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setTyped(null);
              e.stopPropagation();
            }}
          />
        </form>
      )}
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
