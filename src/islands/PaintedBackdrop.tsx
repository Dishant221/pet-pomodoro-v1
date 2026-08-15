import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SceneId } from '../game/manifest';
import type { Condition, PhaseId } from '../game/world';
import { PHASES, washFor } from '../world/palette';
import { OVERSCAN, paintScene, type SceneLayers } from '../world/paint';

/**
 * The painted half of the stage: everything that is not the pet.
 *
 * Five layers in the DOM, with the WebGL canvas slotted between `ground` and
 * `front`. That sandwich is the single most important detail here — painted
 * grass drawn *over* the cat's paws is what stops it reading as a sticker,
 * and occlusion is a far stronger depth cue than any amount of lighting work.
 *
 * Layers are SVG strings rather than images only because the art is generated
 * for now. When real paintings arrive, `paintScene` returns `<img>` markup
 * instead and nothing in this file changes.
 */

/** How much of the camera's lateral pan each layer takes, 0 = infinitely far. */
const DEPTH: Record<keyof SceneLayers, number> = {
  sky: 0.06,
  hills: 0.22,
  trees: 0.55,
  ground: 1,
  front: 1.35,
};

/** Extra pointer-driven drift, on top of the camera pan. Pure garnish. */
const POINTER_DEPTH: Record<keyof SceneLayers, number> = {
  sky: 6,
  hills: 14,
  trees: 26,
  ground: 0,
  front: 0,
};

const LAYER_ORDER: Array<keyof SceneLayers> = ['sky', 'hills', 'trees', 'ground', 'front'];

export interface PaintedBackdropProps {
  scene: SceneId;
  phase: PhaseId;
  condition: Condition;
  reduced: boolean;
  /** Reads the engine's current lateral pan, as a fraction of canvas width. */
  shift: () => number;
  /** Rendered between the `ground` and `front` layers — i.e. the canvas. */
  children?: ComponentChildren;
}

interface Painted {
  key: string;
  layers: SceneLayers;
}

export default function PaintedBackdrop(props: PaintedBackdropProps) {
  const { scene, phase, condition, reduced, shift } = props;
  const wash = washFor(condition);

  const key = `${scene}:${phase}`;
  // Painting is a few hundred SVG nodes, so it happens on a scene or phase
  // change and never on a render.
  const layers = useMemo<Painted>(() => ({ key, layers: paintScene(scene, PHASES[phase]) }), [key]);

  /**
   * The outgoing painting, kept mounted so a phase change can cross-fade.
   *
   * Dawn arriving as a hard cut is jarring on a page someone stares at for
   * twenty-five minutes at a time.
   */
  const [previous, setPrevious] = useState<Painted | null>(null);
  const lastKey = useRef(key);
  // Holds the painting that is currently on screen. Effects run in declaration
  // order, so the cross-fade below still sees the *outgoing* one before the
  // effect underneath swaps it for the incoming one.
  const paintedRef = useRef<Painted>(layers);

  useEffect(() => {
    if (lastKey.current === key) return;
    const outgoing = paintedRef.current;
    lastKey.current = key;
    setPrevious(outgoing);
    const timer = setTimeout(() => setPrevious(null), reduced ? 0 : 1400);
    return () => clearTimeout(timer);
  }, [key]);

  useEffect(() => {
    paintedRef.current = layers;
  }, [layers]);

  // --- parallax -------------------------------------------------------------
  // Driven by a rAF loop writing CSS variables, not by Preact state: this
  // updates every frame and re-rendering five layers of inline SVG at 60 Hz
  // would be ruinous.
  const hostRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let lastShift = NaN;
    let lastPx = NaN;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = shift();
      const px = reduced ? 0 : pointer.current.x;
      // Only touch the DOM when something actually moved.
      if (s === lastShift && px === lastPx) return;
      lastShift = s;
      lastPx = px;
      host.style.setProperty('--pan', String(s));
      host.style.setProperty('--px', String(px));
      host.style.setProperty('--py', String(reduced ? 0 : pointer.current.y));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shift, reduced]);

  useEffect(() => {
    if (reduced) return;
    const host = hostRef.current;
    if (!host) return;
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.current = {
        x: (e.clientX - r.left) / r.width - 0.5,
        y: (e.clientY - r.top) / r.height - 0.5,
      };
    };
    const onLeave = () => {
      pointer.current = { x: 0, y: 0 };
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced]);

  const filter = `saturate(${wash.saturate}) brightness(${wash.brightness}) contrast(${wash.contrast})`;

  const layerStyle = (id: keyof SceneLayers) =>
    `position:absolute; inset:${(-OVERSCAN * 100).toFixed(2)}%; pointer-events:none; will-change:transform;` +
    `transform: translate3d(calc(var(--pan,0) * ${DEPTH[id] * 100}% + var(--px,0) * ${POINTER_DEPTH[id]}px),` +
    ` calc(var(--py,0) * ${POINTER_DEPTH[id] * 0.35}px), 0);`;

  const renderSet = (p: Painted, fading: boolean) => (
    <div
      key={p.key}
      class={fading ? 'pp-paint-out' : 'pp-paint-in'}
      style="position:absolute; inset:0; pointer-events:none;"
      aria-hidden="true"
    >
      {LAYER_ORDER.filter((id) => id !== 'front' && p.layers[id]).map((id) => (
        <div key={id} style={layerStyle(id)} dangerouslySetInnerHTML={{ __html: p.layers[id] }} />
      ))}
    </div>
  );

  return (
    <div ref={hostRef} class="absolute inset-0 overflow-hidden" style={`filter:${filter};`}>
      {/* --- everything behind the pet --- */}
      {previous && renderSet(previous, true)}
      {renderSet(layers, false)}

      {/* --- the pet --- */}
      {props.children}

      {/* Weather veil over pet and painting alike, so they share one sky. */}
      {wash.veilAlpha > 0 && (
        <div
          aria-hidden="true"
          style={`position:absolute; inset:0; pointer-events:none; background:${wash.veil}; opacity:${wash.veilAlpha}; mix-blend-mode:soft-light;`}
        />
      )}
      {wash.haze > 0 && (
        <div
          aria-hidden="true"
          style={`position:absolute; inset:0; pointer-events:none; background:linear-gradient(to top, ${wash.veil} 0%, transparent 55%); opacity:${wash.haze};`}
        />
      )}

      {/* --- in front of the pet --- */}
      {layers.layers.front && (
        <div aria-hidden="true" style={layerStyle('front')} dangerouslySetInnerHTML={{ __html: layers.layers.front }} />
      )}

      {wash.precipitation !== 'none' && <Precipitation kind={wash.precipitation} intensity={wash.intensity} reduced={reduced} />}

      {/* Every reference image is darker at the edges. */}
      <div
        aria-hidden="true"
        style="position:absolute; inset:0; pointer-events:none; background: radial-gradient(ellipse at 50% 55%, transparent 45%, rgba(10,14,20,0.32) 100%);"
      />
    </div>
  );
}

/**
 * Rain and snow, as animated CSS gradients.
 *
 * Deliberately not particles. This has to run alongside a WebGL render loop
 * for twenty-five minutes on whatever laptop the player owns, and a
 * compositor-only background animation costs essentially nothing next to a few
 * thousand sprites.
 */
function Precipitation({ kind, intensity, reduced }: { kind: 'rain' | 'snow'; intensity: number; reduced: boolean }) {
  // Reduced motion gets the light and colour of the weather without anything
  // moving, which is the point of the setting.
  if (reduced) {
    return (
      <div
        aria-hidden="true"
        style={`position:absolute; inset:0; pointer-events:none; opacity:${0.1 * intensity}; background:${
          kind === 'rain' ? '#9fb6cc' : '#ffffff'
        };`}
      />
    );
  }

  if (kind === 'rain') {
    return (
      <div
        aria-hidden="true"
        class="pp-rain"
        style={`--rain-opacity:${(0.22 + intensity * 0.3).toFixed(2)}; --rain-speed:${(0.85 - intensity * 0.4).toFixed(2)}s;`}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      class="pp-snow"
      style={`--snow-opacity:${(0.5 + intensity * 0.4).toFixed(2)}; --snow-speed:${(14 - intensity * 5).toFixed(1)}s;`}
    />
  );
}
