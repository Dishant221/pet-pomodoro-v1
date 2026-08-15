/**
 * A painted garden scene, generated as layered SVG.
 *
 * This is a stand-in. The real product wants actual painted artwork — the
 * references the brief is built from are illustrations, and no amount of
 * procedural cleverness equals a human (or a good image model) with a brush.
 * What this file exists to prove is the *pipeline*: separate parallax layers,
 * a palette driven entirely by `TimeOfDay`, and a foreground plate that the pet
 * can stand behind.
 *
 * Swapping in real art later means replacing `paintScene` with a lookup of
 * six PNGs per layer per scene. Nothing downstream changes — the stage only
 * ever sees `SceneLayers`.
 *
 * Two tricks do most of the painterly work:
 *
 *   1. Every shape is drawn through a turbulence displacement filter, so no
 *      edge is ever mathematically clean. Vector art reads as "computer" almost
 *      entirely because of perfect edges.
 *   2. Colour is layered, not filled — canopies and grass are built from many
 *      overlapping translucent strokes, which is how paint actually behaves.
 */
import type { TimeOfDay } from './timeofday';
import { sunScreenPos } from './timeofday';

export const VIEW_W = 1600;
export const VIEW_H = 900;
/** Where the ground meets the sky. Everything is composed around this line. */
export const HORIZON = 560;

export interface SceneLayers {
  /** Sky, sun and clouds — the furthest thing, barely parallaxes. */
  sky: string;
  /** Distant hills. */
  hills: string;
  /** Midground treeline. */
  trees: string;
  /** The grass field the pet stands on. */
  ground: string;
  /** Grass drawn *in front of* the pet. The single best anti-sticker trick. */
  front: string;
}

// --- deterministic noise -----------------------------------------------------
// Layers must be stable across re-renders, so nothing here may use Math.random.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// --- filters -----------------------------------------------------------------

/**
 * Brush-edge filter. `scale` is how far edges wander, in user units.
 *
 * Bigger shapes need bigger displacement to read as hand-painted at the same
 * apparent roughness, which is why callers pass their own scale rather than
 * sharing one.
 */
function brushFilter(id: string, scale: number, freq: string, seed: number): string {
  return `<filter id="${id}" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
}

/** Canvas tooth — a faint noise wash that unifies every layer. */
function grainFilter(id: string, seed: number): string {
  return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" seed="${seed}" result="g"/>
    <feColorMatrix in="g" type="saturate" values="0"/>
  </filter>`;
}

function svg(inner: string, extraStyle = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice" style="display:block;width:100%;height:100%;${extraStyle}">${inner}</svg>`;
}

// --- sky ---------------------------------------------------------------------

/**
 * One cumulus, built from overlapping discs along a shallow arc.
 *
 * The lit body is drawn first and a shaded copy is offset downwards behind it,
 * so the cloud has a heavy underside. Flat white blobs are the giveaway of
 * cheap cloud art; real ones are lit from one side and dark underneath.
 */
function cloud(cx: number, cy: number, w: number, h: number, lit: string, shade: string, rand: () => number): string {
  // Ellipses rather than circles, each tilted a little. Perfect circles are
  // what make procedural clouds look like a bag of marbles.
  const puffs: Array<[number, number, number, number, number]> = [];
  const n = 8 + Math.floor(rand() * 6);
  const baseline = cy + h * 0.34;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // Tall through the middle, tapering both ends — a cumulus silhouette.
    const arch = Math.pow(Math.sin(t * Math.PI), 0.75);
    const px = cx + (t - 0.5) * w + (rand() - 0.5) * w * 0.06;
    const rx = h * (0.3 + arch * 0.34) * (0.8 + rand() * 0.5);
    const ry = rx * (0.62 + rand() * 0.34);
    // Anchored to a shared baseline, which is what gives cumulus flat bottoms.
    const py = baseline - ry * (0.55 + arch * 0.5);
    const rot = (rand() - 0.5) * 26;
    puffs.push([r2(px), r2(py), r2(rx), r2(ry), r2(rot)]);
  }

  const blobs = (fill: string, dy: number, sc: number, op: number) =>
    puffs
      .map(
        ([x, y, rx, ry, rot]) =>
          `<ellipse cx="${x}" cy="${r2(y + dy)}" rx="${r2(rx * sc)}" ry="${r2(ry * sc)}" fill="${fill}" opacity="${op}" transform="rotate(${rot} ${x} ${r2(y + dy)})"/>`,
      )
      .join('');

  return `<g>
    ${blobs(shade, h * 0.16, 1, 1)}
    ${blobs(lit, 0, 1, 1)}
    ${blobs(lit, -h * 0.14, 0.74, 0.5)}
  </g>`;
}

function paintSky(t: TimeOfDay, rand: () => number): string {
  const sun = sunScreenPos(t);
  const isNight = t.id === 'night';

  const stars = isNight
    ? Array.from({ length: 90 }, () => {
        const x = r2(rand() * VIEW_W);
        const y = r2(rand() * (HORIZON - 60));
        const rr = r2(0.8 + rand() * 1.8);
        // Fainter towards the horizon, where the atmosphere is thickest.
        const op = r2(0.25 + (1 - y / HORIZON) * 0.7 * rand());
        return `<circle cx="${x}" cy="${y}" r="${rr}" fill="#eaf0ff" opacity="${op}"/>`;
      }).join('')
    : '';

  const clouds = Array.from({ length: 7 }, () => {
    const x = r2(120 + rand() * (VIEW_W - 240));
    // Clouds bunch towards the horizon, which is what gives depth to a sky.
    const y = r2(90 + Math.pow(rand(), 0.7) * (HORIZON - 170));
    const depth = y / HORIZON; // 0 near top, 1 at horizon
    const w = r2((520 - depth * 260) * (0.7 + rand() * 0.6));
    const h = r2((150 - depth * 85) * (0.7 + rand() * 0.6));
    const op = r2(0.55 + (1 - depth) * 0.45);
    return `<g opacity="${op}" filter="url(#f-cloud)">${cloud(x, y, w, h, t.cloudLit, t.cloudShade, rand)}</g>`;
  }).join('');

  return svg(`
    <defs>
      ${brushFilter('f-cloud', 18, '0.011', 7)}
      ${grainFilter('f-grain-sky', 3)}
      <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.skyTop}"/>
        <stop offset="55%" stop-color="${t.skyMid}"/>
        <stop offset="100%" stop-color="${t.skyLow}"/>
      </linearGradient>
      <radialGradient id="g-sun" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${t.sunGlow}" stop-opacity="0.85"/>
        <stop offset="45%" stop-color="${t.sunGlow}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${t.sunGlow}" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#g-sky)"/>
    ${stars}

    <circle cx="${r2(sun.x)}" cy="${r2(sun.y)}" r="${isNight ? 210 : 340}" fill="url(#g-sun)"/>
    <circle cx="${r2(sun.x)}" cy="${r2(sun.y)}" r="${isNight ? 34 : 44}" fill="${t.sunColor}" opacity="${isNight ? 0.95 : 0.9}"/>

    ${clouds}

    <rect width="${VIEW_W}" height="${VIEW_H}" filter="url(#f-grain-sky)" opacity="0.05" style="mix-blend-mode:overlay"/>
  `);
}

// --- hills -------------------------------------------------------------------

/** A soft ridge line across the frame, as a closed path down to the bottom. */
function ridge(baseY: number, amp: number, seed: number, fill: string, op: number): string {
  const rand = mulberry32(seed);
  const steps = 7;
  let d = `M -50 ${VIEW_H} L -50 ${r2(baseY)}`;
  let prevY = baseY;
  for (let i = 1; i <= steps; i++) {
    const x = r2(-50 + ((VIEW_W + 100) * i) / steps);
    const y = r2(baseY - Math.sin((i / steps) * Math.PI * 1.6) * amp * (0.5 + rand()));
    const cx = r2(x - (VIEW_W + 100) / steps / 2);
    d += ` Q ${cx} ${r2(prevY)} ${x} ${y}`;
    prevY = y;
  }
  d += ` L ${VIEW_W + 50} ${VIEW_H} Z`;
  return `<path d="${d}" fill="${fill}" opacity="${op}"/>`;
}

function paintHills(t: TimeOfDay): string {
  return svg(`
    <defs>${brushFilter('f-hill', 11, '0.008', 21)}</defs>
    <g filter="url(#f-hill)">
      ${ridge(HORIZON - 96, 78, 11, t.hillFar, 0.85)}
      ${ridge(HORIZON - 40, 54, 29, t.hillNear, 0.95)}
    </g>
  `);
}

// --- trees -------------------------------------------------------------------

/**
 * A broadleaf canopy: a dark mass, then lit clumps on whichever side the sun
 * is. Many small lobes rather than a few big ones, so the silhouette breaks up
 * into something leafy instead of reading as a cloud of bubbles.
 */
function canopy(cx: number, cy: number, r: number, t: TimeOfDay, rand: () => number): string {
  const lobes = 12 + Math.floor(rand() * 8);
  const dark: string[] = [];
  const litside: string[] = [];
  const sunSide = Math.sign(t.sunX) || 1;

  for (let i = 0; i < lobes; i++) {
    const a = rand() * Math.PI * 2;
    // sqrt keeps lobes spread across the disc rather than clustered at the hub.
    const d = Math.sqrt(rand()) * r * 0.62;
    const x = r2(cx + Math.cos(a) * d);
    const y = r2(cy + Math.sin(a) * d * 0.68);
    const rx = r2(r * (0.26 + rand() * 0.3));
    const ry = r2(rx * (0.72 + rand() * 0.4));
    dark.push(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${t.treeDark}"/>`);
    if (Math.sign(Math.cos(a)) === sunSide || rand() > 0.7) {
      litside.push(
        `<ellipse cx="${r2(x + sunSide * r * 0.09)}" cy="${r2(y - r * 0.11)}" rx="${r2(rx * 0.74)}" ry="${r2(ry * 0.74)}" fill="${t.treeLit}" opacity="0.88"/>`,
      );
    }
  }

  const trunkW = r2(r * 0.14);
  return `<g>
    <rect x="${r2(cx - trunkW / 2)}" y="${r2(cy)}" width="${trunkW}" height="${r2(r * 1.2)}" fill="${t.treeDark}" opacity="0.95"/>
    ${dark.join('')}
    ${litside.join('')}
  </g>`;
}

/**
 * A conifer — stacked tapering triangles.
 *
 * Worth having as a second species: a treeline of nothing but round canopies
 * looks like a hedge. Both mountain references are full of these.
 */
function conifer(cx: number, baseY: number, h: number, t: TimeOfDay, rand: () => number): string {
  const tiers = 4 + Math.floor(rand() * 2);
  const w = h * (0.38 + rand() * 0.12);
  const parts: string[] = [];
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const tierTop = baseY - h * (0.28 + f * 0.72);
    const tierBase = baseY - h * f * 0.62;
    const tw = (w / 2) * (1 - f * 0.62);
    parts.push(
      `<path d="M ${r2(cx)} ${r2(tierTop)} L ${r2(cx + tw)} ${r2(tierBase)} L ${r2(cx - tw)} ${r2(tierBase)} Z" fill="${t.treeDark}"/>`,
      `<path d="M ${r2(cx)} ${r2(tierTop)} L ${r2(cx + tw * 0.72 * (Math.sign(t.sunX) || 1))} ${r2(tierBase)} L ${r2(cx)} ${r2(tierBase)} Z" fill="${t.treeLit}" opacity="0.75"/>`,
    );
  }
  return `<g>
    <rect x="${r2(cx - h * 0.022)}" y="${r2(baseY - h * 0.12)}" width="${r2(h * 0.044)}" height="${r2(h * 0.16)}" fill="${t.treeDark}"/>
    ${parts.join('')}
  </g>`;
}

function paintTrees(t: TimeOfDay): string {
  const rand = mulberry32(53);

  // Back row is small, hazy and sits high; front row is large and saturated.
  const back = Array.from({ length: 13 }, (_, i) => {
    const x = r2(-40 + (i / 12) * (VIEW_W + 80) + (rand() - 0.5) * 80);
    const y = HORIZON - 34 - rand() * 16;
    return rand() > 0.62
      ? conifer(x, y + 10, r2(90 + rand() * 60), t, rand)
      : canopy(x, y, r2(36 + rand() * 26), t, rand);
  }).join('');

  const front = Array.from({ length: 6 }, (_, i) => {
    const x = r2(70 + (i / 5) * (VIEW_W - 140) + (rand() - 0.5) * 140);
    const y = HORIZON - 54 - rand() * 24;
    return rand() > 0.72
      ? conifer(x, y + 18, r2(170 + rand() * 90), t, rand)
      : canopy(x, y, r2(72 + rand() * 46), t, rand);
  }).join('');

  return svg(`
    <defs>${brushFilter('f-tree', 9, '0.016', 41)}</defs>
    <g filter="url(#f-tree)">
      <g opacity="0.6">${back}</g>
      <g opacity="0.95">${front}</g>
    </g>
  `);
}

// --- ground ------------------------------------------------------------------

/**
 * The grass field.
 *
 * Built as a base gradient plus a few hundred short curved strokes, densest and
 * longest near the camera. The gradient alone looks like felt; the strokes are
 * what make it read as grass without costing a texture download.
 */
function paintGround(t: TimeOfDay): string {
  const rand = mulberry32(97);
  const strokes: string[] = [];

  // Grass grows in clumps, not an even scatter. Picking a few dozen clump
  // centres and crowding blades around them is the whole difference between
  // "field" and "green carpet with hairs on it".
  const clumps = Array.from({ length: 46 }, () => {
    const depth = Math.pow(rand(), 0.5);
    return { x: rand() * VIEW_W, y: HORIZON + depth * (VIEW_H - HORIZON), depth };
  });

  for (let i = 0; i < 1100; i++) {
    const c = clumps[Math.floor(rand() * clumps.length)];
    const spread = 30 + c.depth * 120;
    const x = r2(c.x + (rand() - 0.5) * spread * 2);
    const y = r2(c.y + (rand() - 0.5) * spread * 0.5);
    if (y < HORIZON - 4) continue;

    // Perspective: blades nearer the camera are longer, thicker and darker.
    const depth = (y - HORIZON) / (VIEW_H - HORIZON);
    const len = r2(8 + depth * 46 * (0.5 + rand()));
    const lean = r2((rand() - 0.5) * len * 0.9);
    const w = r2(1.2 + depth * 3.6);
    const pick = rand();
    const col = pick > 0.62 ? t.groundLit : pick > 0.25 ? t.groundMid : t.groundDark;
    const op = r2(0.2 + rand() * 0.45);
    strokes.push(
      `<path d="M ${x} ${y} q ${r2(lean / 2)} ${r2(-len * 0.6)} ${lean} ${r2(-len)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" fill="none" opacity="${op}"/>`,
    );
  }

  // Wildflowers. Both meadow references are speckled with them, and they do a
  // lot to stop a large green area from reading as empty.
  const flowerLit = t.id === 'night' ? '#8fa4c8' : '#ffe27a';
  const flowers = Array.from({ length: 130 }, () => {
    const depth = Math.pow(rand(), 0.45);
    const y = r2(HORIZON + 20 + depth * (VIEW_H - HORIZON - 20));
    const x = r2(rand() * VIEW_W);
    const rr = r2(1.6 + depth * 4.2);
    const col = rand() > 0.78 ? (t.id === 'night' ? '#b8c6e0' : '#fdfbf0') : flowerLit;
    return `<circle cx="${x}" cy="${y}" r="${rr}" fill="${col}" opacity="${r2(0.35 + rand() * 0.5)}"/>`;
  }).join('');

  return svg(`
    <defs>
      ${brushFilter('f-ground', 7, '0.02', 61)}
      ${grainFilter('f-grain-ground', 9)}
      <linearGradient id="g-ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.groundMid}"/>
        <stop offset="30%" stop-color="${t.groundLit}"/>
        <stop offset="100%" stop-color="${t.groundDark}"/>
      </linearGradient>
      <linearGradient id="g-haze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.skyLow}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${t.skyLow}" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <g filter="url(#f-ground)">
      <rect x="-20" y="${HORIZON - 6}" width="${VIEW_W + 40}" height="${VIEW_H - HORIZON + 26}" fill="url(#g-ground)"/>
      ${strokes.join('')}
      ${flowers}
    </g>
    <!-- Atmospheric haze where the field meets the sky. Without it the horizon
         is a hard seam between two flat colours, which no landscape has. -->
    <rect x="-20" y="${HORIZON - 10}" width="${VIEW_W + 40}" height="110" fill="url(#g-haze)"/>
    <rect y="${HORIZON}" width="${VIEW_W}" height="${VIEW_H - HORIZON}" filter="url(#f-grain-ground)" opacity="0.07" style="mix-blend-mode:overlay"/>
  `);
}

// --- foreground --------------------------------------------------------------

/**
 * Tall blades along the bottom edge, drawn over the pet.
 *
 * This is the layer that does the most work for the hybrid look. A 3D model
 * composited *onto* a painting always reads as pasted on; the same model with
 * painted grass crossing in front of its paws reads as being *in* the painting.
 * Occlusion is a far stronger depth cue than lighting.
 */
function paintFront(t: TimeOfDay): string {
  const rand = mulberry32(131);
  const blades: string[] = [];
  for (let i = 0; i < 260; i++) {
    const x = r2(rand() * (VIEW_W + 60) - 30);
    const baseY = VIEW_H + 12;
    const h = r2(60 + rand() * 230);
    const lean = r2((rand() - 0.5) * h * 0.6);
    // A mix of thick hero blades and thin filler — all one weight reads as a
    // picket fence, which is exactly what the first pass looked like.
    const thick = rand() > 0.68;
    const w = r2(thick ? 4 + rand() * 5 : 1.2 + rand() * 2.2);
    const op = r2(thick ? 0.6 + rand() * 0.4 : 0.28 + rand() * 0.4);
    // Tips catch light, bases stay in shadow, so a blade is a two-stop gradient.
    const col = rand() > 0.6 ? t.groundDark : t.frontGrass;
    blades.push(
      `<path d="M ${x} ${baseY} q ${r2(lean * 0.35)} ${r2(-h * 0.55)} ${lean} ${r2(-h)}" stroke="${col}" stroke-width="${w}" stroke-linecap="round" fill="none" opacity="${op}"/>`,
    );
  }
  // A couple of blown seed heads, purely for life.
  const seeds = Array.from({ length: 14 }, () => {
    const x = r2(rand() * VIEW_W);
    const y = r2(VIEW_H - 60 - rand() * 240);
    return `<circle cx="${x}" cy="${y}" r="${r2(2 + rand() * 3)}" fill="${t.cloudLit}" opacity="${r2(0.25 + rand() * 0.4)}"/>`;
  }).join('');

  return svg(`
    <defs>${brushFilter('f-front', 6, '0.03', 83)}</defs>
    <g filter="url(#f-front)">${blades.join('')}</g>
    ${seeds}
  `);
}

// --- entry point -------------------------------------------------------------

export function paintScene(t: TimeOfDay): SceneLayers {
  // Each layer gets its own generator so adding a layer cannot reshuffle the
  // others — otherwise every tweak repaints the whole scene differently.
  return {
    sky: paintSky(t, mulberry32(17)),
    hills: paintHills(t),
    trees: paintTrees(t),
    ground: paintGround(t),
    front: paintFront(t),
  };
}
