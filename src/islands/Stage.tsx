import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { gsap } from 'gsap';
import { PET_STATES, SCENES, SCENE_VIEWBOX, type PetState, type SceneId } from '../game/manifest';
import { animatePet, animateScene, attachDayNight, attachParallax, burst, type Teardown } from '../game/anim';
import type { Snack } from '../game/economy';

/**
 * The whole world lives in one 800x450 SVG so that the manifest's scene
 * coordinates (petGround, snackSlot) can be used directly. The cat is a nested
 * <svg> with its own 200x200 viewBox, which keeps every pose pixel-identical
 * regardless of where it stands.
 */

/** Strips the outer <svg> wrapper, leaving the inner markup to re-host. */
function innerOf(svg: string): string {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>\s*$/);
  return m ? m[1] : svg;
}

/** Cat-space y of the paws — used to sit the feet on the ground anchor. */
const CAT_FEET_Y = 182;
const CAT_SIZE = 200;
/** Drop within this many scene units of the cat's centre counts as a feed. */
const FEED_RADIUS = 95;
const PET_HOLD_MS = 1000;

interface Layer {
  key: number;
  state: PetState;
}

export interface StageProps {
  scene: SceneId;
  petState: PetState;
  reduced: boolean;
  snack: Snack;
  /** True while the timer is in a break — the snack is only offerable then. */
  snackEnabled: boolean;
  onFeed: () => void;
  onPet: () => void;
  onPlay: () => void;
  onPetStart: () => void;
  onPetEnd: () => void;
}

export default function Stage(props: StageProps) {
  const { scene, petState, reduced, snack, snackEnabled } = props;

  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneGroupRef = useRef<SVGGElement>(null);
  const catWrapRef = useRef<SVGGElement>(null);
  const fxRef = useRef<SVGGElement>(null);

  const ground = SCENES[scene].petGround;
  const [catX, setCatX] = useState((ground.xRange[0] + ground.xRange[1]) / 2);

  // Crossfade: the outgoing pose lingers for 150ms while the new one fades in.
  const keyRef = useRef(0);
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, state: petState }]);

  const sceneInner = useMemo(() => innerOf(SCENES[scene].svg), [scene]);

  // --- pose swap -----------------------------------------------------------
  useEffect(() => {
    setLayers((prev) => {
      if (prev.length && prev[prev.length - 1].state === petState) return prev;
      keyRef.current += 1;
      return [...prev, { key: keyRef.current, state: petState }];
    });
  }, [petState]);

  useEffect(() => {
    if (layers.length < 2) return;
    const id = setTimeout(() => setLayers((prev) => prev.slice(-1)), 160);
    return () => clearTimeout(id);
  }, [layers]);

  // --- scene wiring: ambient, parallax, day/night ---------------------------
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const host = hostRef.current;
    if (!svg || !host) return;
    const teardowns: Teardown[] = [
      animateScene(svg, scene, reduced),
      attachParallax(host, svg, scene, reduced),
      attachDayNight(svg, scene),
    ];
    return () => teardowns.forEach((t) => t());
  }, [scene, reduced, sceneInner]);

  // Re-centre the cat when the scene (and therefore the ground range) changes.
  useEffect(() => {
    setCatX((ground.xRange[0] + ground.xRange[1]) / 2);
  }, [scene]);

  // --- idle wandering -------------------------------------------------------
  useEffect(() => {
    if (reduced) return;
    if (petState !== 'idle') return;
    let cancelled = false;
    const schedule = () => {
      const wait = 12_000 + Math.random() * 9_000;
      const id = setTimeout(() => {
        if (cancelled) return;
        const [lo, hi] = ground.xRange;
        setCatX(lo + Math.random() * (hi - lo));
        schedule();
      }, wait);
      timers.push(id);
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    schedule();
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [petState, reduced, scene]);

  // Smoothly walk to the new x with a slight bob.
  useEffect(() => {
    const wrap = catWrapRef.current;
    if (!wrap) return;
    if (reduced) {
      gsap.set(wrap, { x: catX });
      return;
    }
    const current = (gsap.getProperty(wrap, 'x') as number) || 0;
    const distance = Math.abs(catX - current);
    gsap.to(wrap, { x: catX, duration: Math.min(3.2, 0.9 + distance / 160), ease: 'sine.inOut' });
    if (distance > 4) {
      gsap.fromTo(
        wrap,
        { y: 0 },
        { y: -3, duration: 0.28, yoyo: true, repeat: Math.ceil(distance / 30), ease: 'sine.inOut' },
      );
    }
  }, [catX, reduced]);

  // --- pointer -> scene coordinate mapping ----------------------------------
  const toSceneCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  // --- petting --------------------------------------------------------------
  const petTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const petMoved = useRef(false);
  const petFired = useRef(false);
  const pointerDownAt = useRef(0);

  const clearPet = () => {
    if (petTimer.current) clearTimeout(petTimer.current);
    petTimer.current = undefined;
  };

  const onCatPointerDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    petMoved.current = false;
    petFired.current = false;
    pointerDownAt.current = Date.now();
    props.onPetStart();
    clearPet();
    // Stroking = held for >= 1s with some movement.
    petTimer.current = setTimeout(() => {
      if (petMoved.current && !petFired.current) {
        petFired.current = true;
        props.onPet();
        spawnHearts();
      }
    }, PET_HOLD_MS);
  };

  const onCatPointerMove = (e: PointerEvent) => {
    if (!pointerDownAt.current) return;
    petMoved.current = true;
    // A long, continuous stroke keeps producing hearts.
    if (petFired.current && Math.random() < 0.06) spawnHearts(e.clientX, e.clientY);
  };

  const onCatPointerUp = (e: PointerEvent) => {
    const held = Date.now() - pointerDownAt.current;
    clearPet();
    props.onPetEnd();
    // A quick tap that never became a stroke is a play poke.
    if (pointerDownAt.current && held < 400 && !petFired.current) {
      props.onPlay();
    }
    pointerDownAt.current = 0;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  const spawnHearts = (clientX?: number, clientY?: number) => {
    const fx = fxRef.current;
    if (!fx) return;
    let x = catX;
    let y = ground.y - 130;
    if (clientX != null && clientY != null) {
      const p = toSceneCoords(clientX, clientY);
      if (p) {
        x = p.x;
        y = p.y;
      }
    }
    burst(fx, x, y, 'heart', reduced);
  };

  /** Public-ish helper used by the parent for celebration coin bursts. */
  useEffect(() => {
    if (petState !== 'celebrating') return;
    const fx = fxRef.current;
    if (!fx) return;
    burst(fx, catX, ground.y - 150, 'coin', reduced);
    const id = setTimeout(() => burst(fx, catX, ground.y - 120, 'star', reduced), 380);
    return () => clearTimeout(id);
  }, [petState, catX, reduced]);

  // --- draggable snack ------------------------------------------------------
  const [snackPos, setSnackPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const slotPos = useRef<{ x: number; y: number }>({ x: 68, y: 346 });

  // Read the real #snack-slot position out of the mounted scene.
  useLayoutEffect(() => {
    const group = sceneGroupRef.current;
    if (!group) return;
    const slot = group.querySelector<SVGGraphicsElement>(`#${CSS.escape(SCENES[scene].snackSlot)}`);
    if (slot) {
      try {
        const b = slot.getBBox();
        slotPos.current = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      } catch {
        /* not laid out yet — keep the previous anchor */
      }
    }
    setSnackPos(null);
  }, [scene, sceneInner]);

  const onSnackDown = (e: PointerEvent) => {
    if (!snackEnabled) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDragging(true);
    const p = toSceneCoords(e.clientX, e.clientY);
    if (p) setSnackPos(p);
  };

  const onSnackMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const p = toSceneCoords(e.clientX, e.clientY);
    if (p) setSnackPos(p);
  };

  const onSnackUp = (e: PointerEvent) => {
    if (!dragging) return;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    setDragging(false);
    const p = toSceneCoords(e.clientX, e.clientY) ?? snackPos;
    const catCentreY = ground.y - 90;
    if (p && Math.hypot(p.x - catX, p.y - catCentreY) < FEED_RADIUS) {
      props.onFeed();
      const fx = fxRef.current;
      if (fx) burst(fx, catX, ground.y - 120, 'star', reduced);
    }
    setSnackPos(null);
  };

  const snackAt = snackPos ?? slotPos.current;

  return (
    <div
      ref={hostRef}
      class="pp-stage relative h-full w-full overflow-hidden select-none"
      style="touch-action: none;"
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SCENE_VIEWBOX.w} ${SCENE_VIEWBOX.h}`}
        preserveAspectRatio="xMidYMid slice"
        class="pp-scene-filter absolute inset-0 h-full w-full"
        role="img"
        aria-label={`${SCENES[scene].label} — the cat is ${PET_STATES[petState].label.toLowerCase()}`}
      >
        <g ref={sceneGroupRef} dangerouslySetInnerHTML={{ __html: sceneInner }} />

        {/* The cat. One nested <svg> per crossfade layer. */}
        <g ref={catWrapRef} style="cursor: grab">
          {layers.map((layer, i) => (
            <CatLayer
              key={layer.key}
              state={layer.state}
              reduced={reduced}
              groundY={ground.y}
              fading={i < layers.length - 1}
              onPointerDown={onCatPointerDown}
              onPointerMove={onCatPointerMove}
              onPointerUp={onCatPointerUp}
              onPointerCancel={onCatPointerUp}
            />
          ))}
        </g>

        {/* Particle bursts draw above the cat but below the snack. */}
        <g ref={fxRef} style="pointer-events: none" />

        {/* Draggable snack token. */}
        <g
          transform={`translate(${snackAt.x} ${snackAt.y})`}
          style={`cursor: ${snackEnabled ? (dragging ? 'grabbing' : 'grab') : 'not-allowed'}; opacity: ${snackEnabled ? 1 : 0.4}`}
          onPointerDown={onSnackDown}
          onPointerMove={onSnackMove}
          onPointerUp={onSnackUp}
          onPointerCancel={onSnackUp}
          role="button"
          tabIndex={snackEnabled ? 0 : -1}
          aria-label={`Drag ${snack.name} to the cat to feed it`}
          onKeyDown={(e: KeyboardEvent) => {
            if (!snackEnabled) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              props.onFeed();
            }
          }}
        >
          <circle r="20" fill="rgba(255,255,255,0.72)" stroke="rgba(0,0,0,0.10)" />
          <text
            y="9"
            text-anchor="middle"
            font-size="24"
            style="user-select: none"
          >
            {snack.glyph}
          </text>
        </g>
      </svg>

      {/* Theme texture overlays (Ghibli grain / Van Gogh swirl). */}
      <div class="pp-texture" aria-hidden="true" />
    </div>
  );
}

interface CatLayerProps {
  state: PetState;
  reduced: boolean;
  groundY: number;
  fading: boolean;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
}

function CatLayer({ state, reduced, groundY, fading, ...handlers }: CatLayerProps) {
  const ref = useRef<SVGSVGElement>(null);
  const inner = useMemo(() => innerOf(PET_STATES[state].svg), [state]);
  // Mount transparent, then fade in on the next frame — that plus the outgoing
  // layer fading out gives the 150ms crossfade without moving anything.
  const [entered, setEntered] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => setEntered(true));
    const stop = animatePet(el, state, reduced);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [state, reduced, inner]);

  return (
    <svg
      ref={ref}
      x={-CAT_SIZE / 2}
      y={groundY - CAT_FEET_Y}
      width={CAT_SIZE}
      height={CAT_SIZE}
      viewBox="0 0 200 200"
      overflow="visible"
      style={`opacity: ${fading || !entered ? 0 : 1}; transition: opacity 150ms linear;`}
      dangerouslySetInnerHTML={{ __html: inner }}
      {...handlers}
    />
  );
}
