import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { PET_STATES, SCENES, type PetState, type SceneId } from '../game/manifest';
import type { PetSkinId, SnackId } from '../game/economy';
import { Engine, webglAvailable } from '../three/engine';
import { paletteFor } from '../three/palette';
import type { PropSpec } from '../three/props';
import { $world } from '../game/world';
import { useStore } from '@nanostores/preact';
import PaintedBackdrop from './PaintedBackdrop';

/**
 * Preact shell around the WebGL engine.
 *
 * The engine is imperative and owns its own render loop, so this component
 * creates it exactly once and pushes prop changes in through setters. It never
 * re-renders on animation — Preact only sees the loading and error states.
 */

export interface StageApi {
  /** Send the cat off to fetch a present and bring it to the player. */
  deliverGift(): void;
  beginDrag(snack: SnackId): void;
  moveDrag(clientX: number, clientY: number): void;
  endDrag(commit: boolean): boolean;
  /** Client coordinates of the cat, or null when it is off screen. */
  catScreenPos(): { x: number; y: number } | null;
}

/** The stage host element carries its API, so tests can aim at a moving cat. */
export interface StageHost extends HTMLDivElement {
  __stage?: StageApi;
}

export interface Stage3DProps {
  scene: SceneId;
  pet: PetSkinId;
  petState: PetState;
  reduced: boolean;
  /** 0..1, derived from happiness — biases ears, tail and idle behaviour. */
  mood: number;
  onPet: () => void;
  onPoke: () => void;
  onFeed: () => void;
  onMeow: () => void;
  onPurrStart: () => void;
  onPurrEnd: () => void;
  onGift: (prop: PropSpec) => void;
  /** Receives the imperative handle, or null on unmount. */
  onReady: (api: StageApi | null) => void;
  /** Rendered instead of the canvas when WebGL is unavailable. */
  fallback?: ComponentChildren;
}

export default function Stage3D(props: Stage3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  // The player's real time of day and real weather. Changes about once a
  // minute, so subscribing here costs nothing.
  const world = useStore($world);

  // Callbacks live in a ref so the engine can be built once and still call the
  // latest handler — rebuilding the engine on every render would be ruinous.
  const cbRef = useRef(props);
  cbRef.current = props;

  /**
   * How far the backdrop must slide to stay under the cat's feet.
   *
   * Handed to the backdrop as a stable function it can poll every frame,
   * rather than as a prop: the camera pans continuously and pushing that
   * through Preact would re-render five layers of inline SVG at 60 Hz.
   */
  const readShift = useRef(() => engineRef.current?.backdropShift() ?? 0).current;

  useLayoutEffect(() => {
    const ok = webglAvailable();
    setSupported(ok);
    if (!ok) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: Engine;
    try {
      engine = new Engine({
        canvas,
        scene: cbRef.current.scene,
        palette: paletteFor(cbRef.current.pet),
        reduced: cbRef.current.reduced,
        callbacks: {
          onPet: () => cbRef.current.onPet(),
          onPoke: () => cbRef.current.onPoke(),
          onFeed: () => cbRef.current.onFeed(),
          onMeow: () => cbRef.current.onMeow(),
          onPurrStart: () => cbRef.current.onPurrStart(),
          onPurrEnd: () => cbRef.current.onPurrEnd(),
          onGift: (p) => cbRef.current.onGift(p),
          onHover: (over) => setGrabbing(over),
        },
      });
    } catch {
      // Context creation can still fail on a blocklisted driver.
      setSupported(false);
      return;
    }

    engineRef.current = engine;
    engine.setIntent(cbRef.current.petState);
    engine.setMood(cbRef.current.mood);
    // Seed the sky before the first frame, so there is no flash of midday
    // lighting on a night visit.
    const w = $world.get();
    engine.setDaylight(w.fraction, w.weather);
    engine.start();

    const api: StageApi = {
      deliverGift: () => engineRef.current?.deliverGift(),
      beginDrag: (s) => engineRef.current?.beginDrag(s),
      moveDrag: (x, y) => engineRef.current?.moveDrag(x, y),
      endDrag: (commit) => engineRef.current?.endDrag(commit) ?? false,
      catScreenPos: () => engineRef.current?.catScreenPos() ?? null,
    };
    cbRef.current.onReady(api);
    if (hostRef.current) (hostRef.current as StageHost).__stage = api;

    const ro = new ResizeObserver(() => engine.resize());
    if (hostRef.current) ro.observe(hostRef.current);

    // Pause the loop when the tab is hidden — a background pomodoro tab should
    // not be burning GPU for 25 minutes.
    const onVisibility = () => {
      if (document.hidden) engine.stop();
      else engine.start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      ro.disconnect();
      if (hostRef.current) delete (hostRef.current as StageHost).__stage;
      cbRef.current.onReady(null);
      engineRef.current = null;
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setScene(props.scene);
  }, [props.scene]);

  useEffect(() => {
    engineRef.current?.setPalette(paletteFor(props.pet));
  }, [props.pet]);

  useEffect(() => {
    engineRef.current?.setReduced(props.reduced);
  }, [props.reduced]);

  useEffect(() => {
    engineRef.current?.setIntent(props.petState);
  }, [props.petState]);

  useEffect(() => {
    engineRef.current?.setMood(props.mood);
  }, [props.mood]);

  useEffect(() => {
    engineRef.current?.setDaylight(world.fraction, world.weather);
  }, [world.fraction, world.weather]);

  // The fallback brings its own stage chrome, so it is rendered bare.
  if (supported === false) return <>{props.fallback}</>;

  const weatherNote =
    world.weather.ok && world.weather.condition !== 'clear' ? `, and it is ${world.weather.condition} outside` : '';

  return (
    <div
      ref={hostRef}
      class="pp-stage relative h-full w-full overflow-hidden"
      /* The canvas is opaque to assistive tech and to tests, so the world's
         state is mirrored onto the host element. */
      data-scene={props.scene}
      data-pet-state={props.petState}
      data-reduced={String(props.reduced)}
      data-webgl={supported === true ? 'true' : 'pending'}
      data-phase={world.phase}
      data-weather={world.weather.condition}
    >
      <PaintedBackdrop
        scene={props.scene}
        phase={world.phase}
        condition={world.weather.condition}
        reduced={props.reduced}
        shift={readShift}
      >
        <canvas
          ref={canvasRef}
          class="absolute inset-0 block h-full w-full"
          style={`touch-action: none; cursor: ${grabbing ? 'grab' : 'default'}`}
          role="img"
          aria-label={`${SCENES[props.scene].label} at ${world.phase}${weatherNote} — the cat is ${PET_STATES[props.petState].label.toLowerCase()}. Stroke the cat to pet it, tap it to play, and drag a snack onto the floor to feed it.`}
        />
      </PaintedBackdrop>
      <p class="sr-only" role="status" aria-live="polite">
        {PET_STATES[props.petState].label}
      </p>
      <div class="pp-texture" aria-hidden="true" />
    </div>
  );
}
