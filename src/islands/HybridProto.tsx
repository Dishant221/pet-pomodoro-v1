import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Action } from '../three/animations';
import { paletteFor } from '../three/palette';
import type { PetSkinId } from '../game/economy';
import { paintScene } from '../proto/paint';
import { createStage, webglOk, type InkMode, type ProtoStage } from '../proto/stage';
import { PHASES, PHASE_IDS, phaseForHour, sunScreenPos, type PhaseId } from '../proto/timeofday';

/**
 * Hybrid look test: painted 2D world, 3D pet.
 *
 * Not a game and not shipping code — it exists so the hybrid art direction can
 * be judged by eye before twelve animals are modelled against it. The three
 * grounding tricks are individually switchable precisely so it is obvious how
 * much each one is contributing; with all three off you get the "sticker on a
 * painting" failure this is meant to rule out.
 */

const ACTIONS: Array<{ id: Action; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'sit', label: 'Sit' },
  { id: 'walk', label: 'Walk' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'stretch', label: 'Stretch' },
  { id: 'groom', label: 'Groom' },
  { id: 'play', label: 'Play' },
  { id: 'eat', label: 'Eat' },
];

const SKINS: PetSkinId[] = ['mochi', 'shadow', 'cloud', 'inky'];

export default function HybridProto() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ProtoStage | null>(null);

  const [phase, setPhase] = useState<PhaseId>(() => phaseForHour(new Date().getHours()));
  const [action, setAction] = useState<Action>('idle');
  const [skin, setSkin] = useState<PetSkinId>('mochi');
  const [supported, setSupported] = useState(true);
  // The cat ships with a hard black outline; the painted world has no linework
  // at all. 'soft' is the compromise, and this is here to test whether it works.
  const [ink, setInk] = useState<InkMode>('soft');

  // The three grounding tricks, individually defeatable.
  const [useShadow, setUseShadow] = useState(true);
  const [useGrade, setUseGrade] = useState(true);
  const [useFront, setUseFront] = useState(true);

  const [par, setPar] = useState({ x: 0, y: 0 });

  const tod = PHASES[phase];
  // Repainting six SVG layers is not free, so it happens only on a phase change.
  const layers = useMemo(() => paintScene(tod), [phase]);
  const sun = sunScreenPos(tod);

  useEffect(() => {
    if (!webglOk()) {
      setSupported(false);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;

    const stage = createStage(canvas, PHASES[phase], paletteFor(skin));
    stageRef.current = stage;
    stage.start();

    const ro = new ResizeObserver(() => stage.resize());
    if (hostRef.current) ro.observe(hostRef.current);

    return () => {
      ro.disconnect();
      stageRef.current = null;
      stage.dispose();
    };
    // Built once. Everything else is pushed in through setters below.
  }, []);

  useEffect(() => void stageRef.current?.setPhase(PHASES[phase]), [phase]);
  useEffect(() => void stageRef.current?.setAction(action), [action]);
  useEffect(() => void stageRef.current?.setPalette(paletteFor(skin)), [skin]);
  useEffect(() => void stageRef.current?.setShadows(useShadow), [useShadow]);
  useEffect(() => void stageRef.current?.setInk(ink), [ink]);

  function onMove(e: PointerEvent) {
    const host = hostRef.current;
    if (!host) return;
    const r = host.getBoundingClientRect();
    setPar({
      x: (e.clientX - r.left) / r.width - 0.5,
      y: (e.clientY - r.top) / r.height - 0.5,
    });
  }

  /**
   * Only the layers *behind* the pet parallax. Moving the ground would slide
   * the painted grass out from under the cat's paws, and moving the foreground
   * would break the occlusion that makes the whole thing work.
   */
  const shift = (depth: number) =>
    `transform: translate3d(${(-par.x * depth * 34).toFixed(1)}px, ${(-par.y * depth * 14).toFixed(1)}px, 0) scale(${1 + depth * 0.03});`;

  const layerBase = 'position:absolute; inset:0; pointer-events:none; will-change:transform;';

  return (
    <div class="mx-auto w-full max-w-5xl">
      <div
        ref={hostRef}
        onPointerMove={onMove}
        onPointerLeave={() => setPar({ x: 0, y: 0 })}
        class="relative w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/20"
        style="aspect-ratio: 16 / 9; background:#101820;"
      >
        {/* --- painted world, back to front --- */}
        <div style={`${layerBase}${shift(0.12)}`} dangerouslySetInnerHTML={{ __html: layers.sky }} />
        <div style={`${layerBase}${shift(0.3)}`} dangerouslySetInnerHTML={{ __html: layers.hills }} />
        <div style={`${layerBase}${shift(0.58)}`} dangerouslySetInnerHTML={{ __html: layers.trees }} />
        <div style={layerBase} dangerouslySetInnerHTML={{ __html: layers.ground }} />

        {/* --- the pet --- */}
        {supported ? (
          <canvas
            ref={canvasRef}
            class="absolute inset-0 block h-full w-full"
            style="touch-action:none;"
            role="img"
            aria-label={`A 3D cat on a painted garden background at ${tod.label.toLowerCase()}`}
          />
        ) : (
          <div class="absolute inset-0 grid place-items-center bg-black/40 text-sm text-white">
            WebGL is unavailable in this browser.
          </div>
        )}

        {/* Atmospheric wash over pet and world alike — this is what stops the
            cat's palette from belonging to a different painting. */}
        {useGrade && (
          <>
            <div
              style={`${layerBase} background:${tod.gradeColor}; opacity:${tod.gradeAlpha}; mix-blend-mode:soft-light;`}
            />
            {/* Light wrap: a bloom seeded at the sun, bleeding over everything. */}
            <div
              style={`${layerBase} mix-blend-mode:screen; opacity:0.4; background: radial-gradient(circle at ${((sun.x / 1600) * 100).toFixed(1)}% ${((sun.y / 900) * 100).toFixed(1)}%, ${tod.sunGlow}66 0%, transparent 55%);`}
            />
          </>
        )}

        {/* --- foreground plate, in front of the pet --- */}
        {useFront && <div style={layerBase} dangerouslySetInnerHTML={{ __html: layers.front }} />}

        {/* Vignette. Every one of the reference images is darker at the edges. */}
        <div
          style={`${layerBase} background: radial-gradient(ellipse at 50% 55%, transparent 45%, rgba(10,14,20,0.35) 100%);`}
        />

        <div class="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/45 px-2.5 py-1 text-xs font-medium tracking-wide text-white/90 backdrop-blur-sm">
          {tod.label} · prototype
        </div>
      </div>

      {/* --- controls --------------------------------------------------- */}

      <div class="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <Group title="Time of day">
          <div class="flex flex-wrap gap-1.5">
            {PHASE_IDS.map((id) => (
              <Chip key={id} on={phase === id} onClick={() => setPhase(id)}>
                {PHASES[id].label}
              </Chip>
            ))}
          </div>
          <p class="mt-2 text-xs opacity-60">
            Opened on {PHASES[phaseForHour(new Date().getHours())].label.toLowerCase()} — taken from your device clock,
            which is already in your own timezone.
          </p>
        </Group>

        <Group title="Behaviour">
          <div class="flex flex-wrap gap-1.5">
            {ACTIONS.map((a) => (
              <Chip key={a.id} on={action === a.id} onClick={() => setAction(a.id)}>
                {a.label}
              </Chip>
            ))}
          </div>
        </Group>

        <Group title="Cat">
          <div class="flex flex-wrap gap-1.5">
            {SKINS.map((s) => (
              <Chip key={s} on={skin === s} onClick={() => setSkin(s)}>
                {s}
              </Chip>
            ))}
          </div>
          <h3 class="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wider opacity-55">Outline</h3>
          <div class="flex flex-wrap gap-1.5">
            {(['full', 'soft', 'none'] as InkMode[]).map((m) => (
              <Chip key={m} on={ink === m} onClick={() => setInk(m)}>
                {m}
              </Chip>
            ))}
          </div>
          <p class="mt-2 text-xs opacity-60">
            The painted world has no linework anywhere, so the cat's black outline is the loudest thing marking it as a
            different medium. <strong>Soft</strong> thins it and tints it towards the scene's own shadows.
          </p>
        </Group>

        <Group title="Grounding tricks">
          <div class="flex flex-col gap-1.5">
            <Toggle on={useShadow} onClick={() => setUseShadow(!useShadow)} label="Cast shadow + contact blob" />
            <Toggle on={useGrade} onClick={() => setUseGrade(!useGrade)} label="Colour grade + light wrap" />
            <Toggle on={useFront} onClick={() => setUseFront(!useFront)} label="Foreground grass (occlusion)" />
          </div>
          <p class="mt-2 text-xs opacity-60">
            Turn all three off to see the sticker-on-a-painting problem this test is meant to rule out.
          </p>
        </Group>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="rounded-xl bg-black/5 p-3 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10">
      <h2 class="mb-2 text-xs font-semibold uppercase tracking-wider opacity-55">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      class={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
        on ? 'bg-emerald-600 text-white shadow-sm' : 'bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      class="flex items-center gap-2 text-left text-xs hover:opacity-80"
    >
      <span
        class={`grid h-4 w-4 shrink-0 place-items-center rounded border transition ${
          on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-current opacity-40'
        }`}
      >
        {on ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}
