/**
 * The painted world, generated as layered SVG.
 *
 * The art here is a stand-in. The references this product is built from are
 * illustrations, and no amount of procedural cleverness equals a human — or a
 * good image model — with a brush. What this file provides is the *pipeline*:
 * separate parallax layers, a palette driven entirely by `TimeOfDay`, and a
 * foreground plate the pet stands behind.
 *
 * Replacing it with real artwork means changing `paintScene` into a lookup of
 * six images per layer per scene. Nothing downstream changes; the stage only
 * ever sees `SceneLayers`, and it does not care whether the strings inside are
 * generated SVG or an `<img>` pointing at a painting.
 *
 * Two tricks do most of the painterly work:
 *
 *   1. Every shape is drawn through a turbulence displacement filter, so no
 *      edge is ever mathematically clean. Vector art reads as "computer" almost
 *      entirely because of perfect edges.
 *   2. Colour is layered, not filled — canopies and grass are built from many
 *      overlapping translucent strokes, which is how paint actually behaves.
 */
import type { SceneId } from '../game/manifest';
import type { TimeOfDay } from './palette';
import { sunScreenPos } from './palette';

export const VIEW_W = 1600;
export const VIEW_H = 900;
/** Where the ground meets the sky. Everything is composed around this line. */
export const HORIZON = 560;

/**
 * How far each painted layer is drawn beyond the stage, per edge.
 *
 * The layers slide to stay under the cat as the camera pans. Without slack
 * they slide right off their own edges and expose whatever is behind them —
 * which looked like a rectangular hole punched in the meadow. This must stay
 * larger than the biggest shift the camera can ask for, and the engine has to
 * know about it too, because overscanning moves where the horizon lands.
 */
export const OVERSCAN = 0.09;

/**
 * Five depth slots, back to front. Every scene fills the same five, which is
 * what lets one renderer and one parallax rig serve all of them.
 *
 * The names are the outdoor case; indoors they carry the equivalent depth —
 * `sky` becomes the back wall, `trees` the furniture against it. An empty
 * string is a legitimate value and that layer is simply skipped.
 */
export interface SceneLayers {
  /** Furthest: sky, sun and clouds outdoors; the back wall indoors. */
  sky: string;
  /** Distant mass — hills, or a wall's mouldings. */
  hills: string;
  /** Midground — the treeline, or furniture. */
  trees: string;
  /** The surface the pet stands on. */
  ground: string;
  /** Drawn *in front of* the pet. The single best anti-sticker trick. */
  front: string;
}

const EMPTY_LAYERS: SceneLayers = { sky: '', hills: '', trees: '', ground: '', front: '' };

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
      <!-- Distance mist takes the colour of the *far hills*, not of the sky.
           Using the sky put a sunset orange over green grass, which reads as a
           khaki stripe rather than as air. -->
      <linearGradient id="g-haze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.hillFar}" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="${t.hillFar}" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <g filter="url(#f-ground)">
      <rect x="-20" y="${HORIZON - 6}" width="${VIEW_W + 40}" height="${VIEW_H - HORIZON + 26}" fill="url(#g-ground)"/>
      ${strokes.join('')}
      ${flowers}
    </g>
    <!-- Atmospheric haze where the field meets the sky. Without it the horizon
         is a hard seam between two flat colours, which no landscape has. -->
    <rect x="-20" y="${HORIZON - 10}" width="${VIEW_W + 40}" height="72" fill="url(#g-haze)"/>
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

// --- jungle ------------------------------------------------------------------

/** A big drooping frond, drawn as a spine with leaflets along both sides. */
function frond(x: number, y: number, len: number, angle: number, color: string, rand: () => number): string {
  const parts: string[] = [];
  const tipX = x + Math.cos(angle) * len;
  const tipY = y + Math.sin(angle) * len;
  // A control point above the chord makes the frond droop under its own weight.
  const cx = x + Math.cos(angle) * len * 0.5;
  const cy = y + Math.sin(angle) * len * 0.5 - len * 0.16;
  parts.push(
    `<path d="M ${r2(x)} ${r2(y)} Q ${r2(cx)} ${r2(cy)} ${r2(tipX)} ${r2(tipY)}" stroke="${color}" stroke-width="${r2(len * 0.028)}" fill="none" stroke-linecap="round"/>`,
  );

  /**
   * Leaflets as filled blades, packed tight.
   *
   * The first pass drew them as sparse single strokes and the result read as a
   * fish skeleton — foliage needs mass, not lines. Overlapping filled shapes at
   * roughly half their own spacing is what makes a frond look solid from a
   * distance while still breaking up at the edge.
   */
  const leaflets = 20 + Math.floor(rand() * 10);
  for (let i = 1; i < leaflets; i++) {
    const s = i / leaflets;
    // Quadratic point at s along the spine.
    const px = (1 - s) * (1 - s) * x + 2 * (1 - s) * s * cx + s * s * tipX;
    const py = (1 - s) * (1 - s) * y + 2 * (1 - s) * s * cy + s * s * tipY;
    // Longest just past the middle, tapering to nothing at base and tip.
    const ll = len * 0.24 * Math.sin(Math.pow(s, 0.8) * Math.PI) * (0.85 + rand() * 0.3);
    if (ll < 2) continue;
    for (const side of [-1, 1]) {
      // Leaflets sweep towards the tip rather than sticking out square.
      const a = angle + side * (0.72 + rand() * 0.2);
      const ex = px + Math.cos(a) * ll;
      const ey = py + Math.sin(a) * ll;
      // A lens shape: out along one curve, back along the other.
      const w = ll * 0.3;
      const nx = -Math.sin(a) * w;
      const ny = Math.cos(a) * w;
      parts.push(
        `<path d="M ${r2(px)} ${r2(py)} Q ${r2((px + ex) / 2 + nx)} ${r2((py + ey) / 2 + ny)} ${r2(ex)} ${r2(ey)} Q ${r2((px + ex) / 2 - nx)} ${r2((py + ey) / 2 - ny)} ${r2(px)} ${r2(py)} Z" fill="${color}"/>`,
      );
    }
  }
  return `<g>${parts.join('')}</g>`;
}

function paintJungleCanopy(t: TimeOfDay): string {
  const rand = mulberry32(211);
  // Dense mass overhead, thinning towards the middle so light gets through.
  const fronds = Array.from({ length: 26 }, () => {
    const x = r2(rand() * VIEW_W);
    const y = r2(-40 + rand() * 200);
    const len = r2(220 + rand() * 260);
    // Hanging down and outwards from the top edge.
    const angle = Math.PI * (0.22 + rand() * 0.56);
    const col = rand() > 0.55 ? t.treeLit : t.treeDark;
    return `<g opacity="${r2(0.6 + rand() * 0.4)}">${frond(x, y, len, angle, col, rand)}</g>`;
  }).join('');

  const sun = sunScreenPos(t);
  return svg(`
    <defs>
      ${brushFilter('f-jcan', 8, '0.02', 29)}
      <radialGradient id="g-shaft" cx="50%" cy="0%" r="70%">
        <stop offset="0%" stop-color="${t.sunColor}" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="${t.sunColor}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <!-- God rays through the leaves. Jungle light is the whole point. -->
    <ellipse cx="${r2(sun.x)}" cy="0" rx="520" ry="${r2(420 + t.sunY * 260)}" fill="url(#g-shaft)"/>
    <g filter="url(#f-jcan)">${fronds}</g>
  `);
}

function paintJungleBack(t: TimeOfDay): string {
  const rand = mulberry32(307);
  // A wall of vegetation instead of a horizon — jungles have no distance.
  const mass = Array.from({ length: 34 }, () => {
    const x = r2(rand() * VIEW_W);
    const y = r2(HORIZON - 260 + rand() * 320);
    const rx = r2(90 + rand() * 150);
    const ry = r2(rx * (0.55 + rand() * 0.4));
    const col = rand() > 0.5 ? t.treeDark : t.hillNear;
    return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${col}" opacity="${r2(0.45 + rand() * 0.45)}"/>`;
  }).join('');

  const trunks = Array.from({ length: 7 }, () => {
    const x = r2(rand() * VIEW_W);
    const w = r2(16 + rand() * 34);
    const lean = r2((rand() - 0.5) * 70);
    return `<path d="M ${x} ${HORIZON + 60} q ${r2(lean * 0.4)} -300 ${lean} -620" stroke="${t.treeDark}" stroke-width="${w}" fill="none" opacity="0.8"/>`;
  }).join('');

  return svg(`
    <defs>${brushFilter('f-jback', 10, '0.014', 37)}</defs>
    <g filter="url(#f-jback)">
      ${trunks}
      ${mass}
    </g>
  `);
}

function paintJungle(t: TimeOfDay): SceneLayers {
  const rand = mulberry32(401);
  // A darker, wetter sky: the jungle is roofed, so very little of it shows.
  const sky = svg(`
    <defs>
      <linearGradient id="g-jsky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.skyMid}"/>
        <stop offset="60%" stop-color="${t.treeLit}"/>
        <stop offset="100%" stop-color="${t.treeDark}"/>
      </linearGradient>
    </defs>
    <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#g-jsky)"/>
  `);

  // Floor: leaf litter and moss rather than lawn.
  const litter = Array.from({ length: 420 }, () => {
    const depth = Math.pow(rand(), 0.5);
    const y = r2(HORIZON + depth * (VIEW_H - HORIZON));
    const x = r2(rand() * VIEW_W);
    const rx = r2(6 + depth * 22);
    const rot = r2(rand() * 180);
    const col = rand() > 0.6 ? t.groundLit : rand() > 0.3 ? t.groundMid : t.groundDark;
    return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${r2(rx * 0.45)}" fill="${col}" opacity="${r2(0.25 + rand() * 0.5)}" transform="rotate(${rot} ${x} ${y})"/>`;
  }).join('');

  // Undergrowth along the back edge, so the floor does not meet the wall of
  // vegetation in a dead straight line.
  const scrub = Array.from({ length: 70 }, () => {
    const x = r2(rand() * VIEW_W);
    const h = r2(30 + rand() * 90);
    const w = r2(40 + rand() * 90);
    return `<ellipse cx="${x}" cy="${r2(HORIZON + 6)}" rx="${w}" ry="${h}" fill="${rand() > 0.5 ? t.treeDark : t.groundDark}" opacity="${r2(0.4 + rand() * 0.5)}"/>`;
  }).join('');

  const ground = svg(`
    <defs>
      ${brushFilter('f-jfloor', 7, '0.02', 53)}
      <linearGradient id="g-jfloor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.treeDark}"/>
        <stop offset="22%" stop-color="${t.groundDark}"/>
        <stop offset="60%" stop-color="${t.groundMid}"/>
        <stop offset="100%" stop-color="${t.groundDark}"/>
      </linearGradient>
    </defs>
    <g filter="url(#f-jfloor)">
      <rect x="-20" y="${HORIZON - 6}" width="${VIEW_W + 40}" height="${VIEW_H - HORIZON + 26}" fill="url(#g-jfloor)"/>
      ${scrub}
      ${litter}
    </g>
  `);

  // Foreground: two big fronds reaching in from the sides.
  const frontRand = mulberry32(457);
  const front = svg(`
    <defs>${brushFilter('f-jfront', 7, '0.024', 61)}</defs>
    <g filter="url(#f-jfront)" opacity="0.95">
      ${frond(-60, VIEW_H - 120, 620, -0.62, t.frontGrass, frontRand)}
      ${frond(VIEW_W + 60, VIEW_H - 60, 660, Math.PI + 0.55, t.frontGrass, frontRand)}
      ${frond(240, VIEW_H + 40, 420, -1.15, t.frontGrass, frontRand)}
    </g>
  `);

  return {
    sky,
    hills: paintJungleBack(t),
    trees: paintJungleCanopy(t),
    ground,
    front,
  };
}

// --- treehouse ---------------------------------------------------------------

function paintTreehouse(t: TimeOfDay): SceneLayers {
  const rand = mulberry32(509);

  // Up in the canopy, so the horizon is far below and the sky dominates.
  const boughs = Array.from({ length: 5 }, (_, i) => {
    const y = r2(120 + i * 130 + rand() * 60);
    const fromLeft = i % 2 === 0;
    const x0 = fromLeft ? -40 : VIEW_W + 40;
    const dir = fromLeft ? 1 : -1;
    const len = r2(500 + rand() * 500);
    return `<path d="M ${x0} ${y} q ${r2(dir * len * 0.5)} ${r2(40 + rand() * 60)} ${r2(dir * len)} ${r2(90 + rand() * 80)}" stroke="${t.treeDark}" stroke-width="${r2(18 + rand() * 26)}" fill="none" stroke-linecap="round" opacity="0.9"/>`;
  }).join('');

  const leaves = Array.from({ length: 46 }, () => {
    const x = r2(rand() * VIEW_W);
    const y = r2(rand() * (HORIZON - 60));
    const r = r2(40 + rand() * 90);
    return canopy(x, y, r, t, rand);
  }).join('');

  const trees = svg(`
    <defs>${brushFilter('f-tcan', 9, '0.017', 67)}</defs>
    <g filter="url(#f-tcan)">
      ${boughs}
      <g opacity="0.9">${leaves}</g>
    </g>
  `);

  // The deck the cat stands on: planks, in perspective.
  const planks = Array.from({ length: 16 }, (_, i) => {
    const y = HORIZON + ((VIEW_H - HORIZON + 40) * i) / 16;
    const inset = r2(Math.max(0, (1 - (y - HORIZON) / (VIEW_H - HORIZON)) * 180));
    const shade = i % 2 === 0 ? t.groundMid : t.groundDark;
    return `<rect x="${inset - 20}" y="${r2(y)}" width="${r2(VIEW_W + 40 - inset * 2)}" height="${r2((VIEW_H - HORIZON + 40) / 16 + 2)}" fill="${shade}" opacity="${r2(0.55 + (i / 16) * 0.4)}"/>`;
  }).join('');

  const ground = svg(`
    <defs>${brushFilter('f-deck', 5, '0.03', 71)}</defs>
    <g filter="url(#f-deck)">
      ${planks}
      <rect x="-20" y="${HORIZON - 4}" width="${VIEW_W + 40}" height="10" fill="${t.treeDark}" opacity="0.7"/>
    </g>
  `);

  // A rope rail across the front, so the deck reads as a platform in the air.
  const rail = svg(`
    <defs>${brushFilter('f-rail', 4, '0.03', 79)}</defs>
    <g filter="url(#f-rail)" opacity="0.92">
      <path d="M -40 ${VIEW_H - 210} Q ${VIEW_W / 2} ${VIEW_H - 130} ${VIEW_W + 40} ${VIEW_H - 210}" stroke="${t.frontGrass}" stroke-width="14" fill="none" stroke-linecap="round"/>
      ${Array.from({ length: 7 }, (_, i) => {
        const x = r2(80 + (i / 6) * (VIEW_W - 160));
        return `<rect x="${x}" y="${VIEW_H - 230}" width="16" height="240" fill="${t.frontGrass}" opacity="0.9"/>`;
      }).join('')}
    </g>
  `);

  return {
    sky: paintSky(t, mulberry32(541)),
    hills: paintHills(t),
    trees,
    ground,
    front: rail,
  };
}

// --- living room -------------------------------------------------------------

function paintRoom(t: TimeOfDay): SceneLayers {
  const rand = mulberry32(601);
  // Indoors, the palette is warmed and flattened: walls are not lit like grass.
  const wall = mixHex(t.groundLit, '#e9dcc8', 0.72);
  const wallShade = mixHex(t.groundDark, '#c8b49b', 0.7);
  const floor = mixHex(t.groundMid, '#b98d5f', 0.68);
  const floorDark = mixHex(t.groundDark, '#8d6743', 0.7);

  // The window is the one place the real sky gets in — and therefore the one
  // place the time of day is unmistakable from inside.
  const sun = sunScreenPos(t);
  const winX = 180;
  const winY = 120;
  const winW = 460;
  const winH = 300;

  const sky = svg(`
    <defs>
      ${grainFilter('f-wallgrain', 5)}
      <linearGradient id="g-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${wallShade}"/>
        <stop offset="55%" stop-color="${wall}"/>
        <stop offset="100%" stop-color="${wallShade}"/>
      </linearGradient>
      <linearGradient id="g-win" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${t.skyTop}"/>
        <stop offset="70%" stop-color="${t.skyMid}"/>
        <stop offset="100%" stop-color="${t.skyLow}"/>
      </linearGradient>
      <linearGradient id="g-shafted" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="${t.sunColor}" stop-opacity="${t.sunY > 0.05 ? 0.28 : 0.06}"/>
        <stop offset="100%" stop-color="${t.sunColor}" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#g-wall)"/>

    <!-- window -->
    <rect x="${winX - 14}" y="${winY - 14}" width="${winW + 28}" height="${winH + 28}" rx="8" fill="${floorDark}" opacity="0.9"/>
    <rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" fill="url(#g-win)"/>
    ${
      // Only draw the sun in the window when it is actually up and in view.
      t.sunY > 0.05
        ? `<circle cx="${r2(Math.min(winX + winW - 40, Math.max(winX + 40, sun.x * 0.42 + winX * 0.4)))}" cy="${r2(winY + winH * (1 - t.sunY) * 0.8 + 30)}" r="34" fill="${t.sunColor}" opacity="0.85"/>`
        : `<circle cx="${winX + winW * 0.7}" cy="${winY + 70}" r="22" fill="${t.sunColor}" opacity="0.8"/>`
    }
    <!-- distant hills through the glass -->
    <path d="M ${winX} ${winY + winH * 0.72} Q ${winX + winW * 0.3} ${winY + winH * 0.56} ${winX + winW * 0.62} ${winY + winH * 0.72} T ${winX + winW} ${winY + winH * 0.7} L ${winX + winW} ${winY + winH} L ${winX} ${winY + winH} Z" fill="${t.hillNear}" opacity="0.85"/>
    <!-- mullions -->
    <rect x="${winX + winW / 2 - 6}" y="${winY}" width="12" height="${winH}" fill="${floorDark}" opacity="0.95"/>
    <rect x="${winX}" y="${winY + winH / 2 - 6}" width="${winW}" height="12" fill="${floorDark}" opacity="0.95"/>

    <!-- the light the window throws onto the wall -->
    <polygon points="${winX + winW},${winY} ${VIEW_W},${winY + 60} ${VIEW_W},${winY + winH + 220} ${winX + winW},${winY + winH}" fill="url(#g-shafted)"/>

    <rect width="${VIEW_W}" height="${VIEW_H}" filter="url(#f-wallgrain)" opacity="0.06" style="mix-blend-mode:overlay"/>
  `);

  // Furniture along the back wall.
  const trees = svg(`
    <defs>${brushFilter('f-furn', 5, '0.02', 83)}</defs>
    <g filter="url(#f-furn)">
      <!-- bookshelf -->
      <rect x="${VIEW_W - 430}" y="${HORIZON - 330}" width="300" height="336" rx="6" fill="${floorDark}"/>
      ${Array.from({ length: 12 }, () => {
        const shelf = Math.floor(rand() * 3);
        const x = r2(VIEW_W - 410 + rand() * 250);
        const h = r2(52 + rand() * 34);
        const y = r2(HORIZON - 300 + shelf * 108 + (86 - h));
        const hue = ['#c05f52', '#4f7ea8', '#d3a04a', '#6a9160', '#8a6ba8'][Math.floor(rand() * 5)];
        return `<rect x="${x}" y="${y}" width="${r2(14 + rand() * 14)}" height="${h}" fill="${hue}" opacity="0.92"/>`;
      }).join('')}
      ${Array.from({ length: 3 }, (_, i) => `<rect x="${VIEW_W - 430}" y="${HORIZON - 214 + i * 108}" width="300" height="10" fill="${wallShade}"/>`).join('')}

      <!-- sofa -->
      <rect x="60" y="${HORIZON - 150}" width="440" height="150" rx="20" fill="#6f8f74"/>
      <rect x="60" y="${HORIZON - 190}" width="440" height="70" rx="18" fill="#7fa084"/>
      <rect x="96" y="${HORIZON - 150}" width="170" height="44" rx="10" fill="#d99a5b" opacity="0.9"/>
      <rect x="296" y="${HORIZON - 150}" width="170" height="44" rx="10" fill="#d99a5b" opacity="0.9"/>

      <!-- floor lamp -->
      <rect x="${VIEW_W - 560}" y="${HORIZON - 300}" width="12" height="300" fill="${floorDark}"/>
      <path d="M ${VIEW_W - 620} ${HORIZON - 300} L ${VIEW_W - 488} ${HORIZON - 300} L ${VIEW_W - 506} ${HORIZON - 380} L ${VIEW_W - 602} ${HORIZON - 380} Z" fill="${t.id === 'night' || t.id === 'dusk' ? '#ffe6a8' : '#e8d9b8'}"/>
    </g>
  `);

  // Floorboards and a rug.
  const boards = Array.from({ length: 22 }, (_, i) => {
    const y = HORIZON + ((VIEW_H - HORIZON + 30) * i) / 22;
    const shade = i % 2 === 0 ? floor : floorDark;
    return `<rect x="-20" y="${r2(y)}" width="${VIEW_W + 40}" height="${r2((VIEW_H - HORIZON + 30) / 22 + 2)}" fill="${shade}" opacity="${r2(0.5 + (i / 22) * 0.45)}"/>`;
  }).join('');

  const ground = svg(`
    <defs>${brushFilter('f-floor', 4, '0.03', 89)}</defs>
    <g filter="url(#f-floor)">
      ${boards}
      <ellipse cx="${VIEW_W / 2}" cy="${VIEW_H - 130}" rx="640" ry="230" fill="#d8c6b0" opacity="0.85"/>
      <ellipse cx="${VIEW_W / 2}" cy="${VIEW_H - 130}" rx="560" ry="190" fill="#e6d8c4" opacity="0.7"/>
      <ellipse cx="${VIEW_W / 2}" cy="${VIEW_H - 130}" rx="470" ry="150" fill="#efe4d2" opacity="0.6"/>
    </g>
  `);

  // A pot plant leaning in from the near corner, to sit in front of the cat.
  const frontRand = mulberry32(631);
  const front = svg(`
    <defs>${brushFilter('f-plant', 6, '0.026', 97)}</defs>
    <g filter="url(#f-plant)" opacity="0.95">
      <path d="M -40 ${VIEW_H} L 20 ${VIEW_H - 210} L 250 ${VIEW_H - 210} L 300 ${VIEW_H} Z" fill="#b4674a"/>
      ${Array.from({ length: 9 }, () => {
        const x = r2(60 + frontRand() * 180);
        const y = VIEW_H - 200;
        const len = r2(180 + frontRand() * 260);
        const a = -Math.PI / 2 + (frontRand() - 0.5) * 1.7;
        return frond(x, y, len, a, frontRand() > 0.5 ? '#3f6b45' : '#2f4f36', frontRand);
      }).join('')}
    </g>
  `);

  return { sky, hills: '', trees, ground, front };
}

/** Blend two hex colours without pulling in a colour library. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

// --- mountain & snow ---------------------------------------------------------

/**
 * A range of peaks.
 *
 * `ridge` above draws hills as a sine curve, which is right for hills and wrong
 * for mountains: what makes a mountain read as rock rather than as a green mound
 * is that its silhouette is made of straight lines meeting at angles. So this
 * builds a polyline instead — up a flank, over an apex, down the far side —
 * with a shoulder partway up each flank so no peak is a clean isoceles "V".
 *
 * Passing `snow` draws a cap on every apex, with a ragged lower edge. A snowline
 * is a horizontal band in reality, but drawing it as one exposes the trick: the
 * caps all end at the same y and the range looks like it was dipped in paint.
 * Ending each cap a fraction of the way down its *own* flank keeps the taller
 * peaks capped deeper, which is both what happens and what looks right.
 */
function peakRange(
  baseY: number,
  height: number,
  count: number,
  seed: number,
  rock: string,
  rockLit: string,
  opacity: number,
  snow: string | null,
): string {
  const rand = mulberry32(seed);
  const span = (VIEW_W + 200) / count;
  const pts: Array<[number, number]> = [[-100, baseY]];
  /** apex, left shoulder, right shoulder — kept for the caps and the lit faces. */
  const summits: Array<{ a: [number, number]; l: [number, number]; r: [number, number] }> = [];

  let x = -100;
  for (let i = 0; i < count; i++) {
    const w = span * (0.72 + rand() * 0.56);
    const h = height * (0.42 + rand() * 0.78);
    const ax = x + w * (0.34 + rand() * 0.32);
    const a: [number, number] = [r2(ax), r2(baseY - h)];
    const l: [number, number] = [r2(ax - w * 0.3), r2(baseY - h * (0.4 + rand() * 0.22))];
    const rr: [number, number] = [r2(ax + w * 0.32), r2(baseY - h * (0.36 + rand() * 0.24))];
    pts.push(l, a, rr);
    summits.push({ a, l, r: rr });
    x += w;
    // The col between two peaks, never quite down to the base.
    pts.push([r2(x), r2(baseY - height * 0.16 * rand())]);
  }
  pts.push([VIEW_W + 100, baseY]);

  const outline = `M ${pts.map(([px, py]) => `${px} ${py}`).join(' L ')} L ${VIEW_W + 100} ${VIEW_H} L -100 ${VIEW_H} Z`;

  // One flank of each peak catches light. Two flat tones beat any gradient
  // here — rock reads as faceted, not as an airbrushed cone.
  const lit = summits
    .map(({ a, l, r: rr }) => {
      const face = rand() > 0.5 ? rr : l;
      return `<path d="M ${a[0]} ${a[1]} L ${face[0]} ${face[1]} L ${r2((a[0] + face[0]) / 2)} ${r2(Math.max(a[1], face[1]) + (baseY - a[1]) * 0.42)} Z" fill="${rockLit}" opacity="0.5"/>`;
    })
    .join('');

  const caps = snow
    ? summits
        .map(({ a, l, r: rr }) => {
          // A third of the way down each flank, so tall peaks stay capped deeper.
          const t = 0.34 + rand() * 0.16;
          const lx = r2(a[0] + (l[0] - a[0]) * t);
          const ly = r2(a[1] + (l[1] - a[1]) * t);
          const rx = r2(a[0] + (rr[0] - a[0]) * t);
          const ry = r2(a[1] + (rr[1] - a[1]) * t);
          // Melt fingers running down the gullies, so the lower edge is not a line.
          const teeth = Array.from({ length: 4 }, (_, i) => {
            const f = (i + 1) / 5;
            const bx = r2(rx + (lx - rx) * f);
            const by = r2(ry + (ly - ry) * f + (rand() - 0.2) * (a[1] - ly) * 0.45);
            return `${bx} ${by}`;
          }).join(' L ');
          return `<path d="M ${a[0]} ${a[1]} L ${rx} ${ry} L ${teeth} L ${lx} ${ly} Z" fill="${snow}" opacity="0.95"/>`;
        })
        .join('')
    : '';

  return `<g opacity="${opacity}"><path d="${outline}" fill="${rock}"/>${lit}${caps}</g>`;
}

/** Snow takes its colour from the sky it reflects, which is why it is never white. */
function snowTones(t: TimeOfDay) {
  return {
    lit: mixHex(t.cloudLit, '#ffffff', 0.55),
    mid: mixHex(t.cloudLit, t.skyLow, 0.34),
    shade: mixHex(t.hillFar, t.skyMid, 0.42),
    deep: mixHex(t.hillNear, t.skyMid, 0.3),
  };
}

/**
 * Rock, with distance expressed as colour rather than as transparency.
 *
 * The first pass faded the far range with opacity and it read as glass — you
 * could see the clouds through the mountain. Aerial perspective is not a rock
 * you can see through; it is a rock that has taken on the colour of the air in
 * front of it. So the far tones are mixed towards the low sky and drawn nearly
 * opaque, and the near ones keep their own colour.
 */
function rockTones(t: TimeOfDay) {
  return {
    far: mixHex(mixHex(t.hillFar, '#7d8590', 0.4), t.skyLow, 0.5),
    farLit: mixHex(mixHex(t.hillFar, '#c3ccd6', 0.5), t.skyLow, 0.42),
    near: mixHex(t.hillNear, '#5f5a56', 0.5),
    nearLit: mixHex(t.hillNear, '#a89e93', 0.5),
  };
}

function paintPeaks(t: TimeOfDay, snowy: boolean): string {
  const rock = rockTones(t);
  const snow = snowTones(t);
  return svg(`
    <defs>${brushFilter('f-peak', 9, '0.006', 137)}</defs>
    <g filter="url(#f-peak)">
      ${peakRange(HORIZON - 60, 215, 5, 149, rock.far, rock.farLit, 0.94, mixHex(snow.lit, t.skyLow, 0.4))}
      ${peakRange(HORIZON - 20, 155, 7, 163, rock.near, rock.nearLit, 1, snowy ? snow.lit : snow.mid)}
    </g>
  `);
}

/**
 * A conifer treeline.
 *
 * `paintTrees` mixes broadleaf canopies with the odd conifer, which is right for
 * a temperate garden. Above the treeline nothing else grows, so this is conifers
 * only — and they get smaller and sparser towards the back, because on a
 * mountainside the trees genuinely do thin out as the ground climbs.
 */
function paintConifers(t: TimeOfDay, snowy: boolean): string {
  const rand = mulberry32(179);
  const tone = snowTones(t);

  /** A conifer with snow sitting on its tiers, drawn as the same shapes shifted up. */
  const snowy1 = (cx: number, baseY: number, h: number): string => {
    const body = conifer(cx, baseY, h, t, rand);
    const tiers = 4;
    const caps = Array.from({ length: tiers }, (_, i) => {
      const f = i / tiers;
      const tierTop = baseY - h * (0.28 + f * 0.72);
      const tierBase = baseY - h * f * 0.62;
      const tw = (h * 0.22) * (1 - f * 0.62);
      return `<path d="M ${r2(cx)} ${r2(tierTop)} L ${r2(cx + tw * 0.82)} ${r2(tierBase - h * 0.05)} L ${r2(cx)} ${r2(tierBase - h * 0.09)} L ${r2(cx - tw * 0.82)} ${r2(tierBase - h * 0.05)} Z" fill="${tone.lit}" opacity="0.9"/>`;
    }).join('');
    return `<g>${body}${caps}</g>`;
  };

  const draw = (cx: number, baseY: number, h: number) => (snowy ? snowy1(cx, baseY, h) : conifer(cx, baseY, h, t, rand));

  const back = Array.from({ length: 22 }, (_, i) => {
    const x = r2(-60 + (i / 21) * (VIEW_W + 120) + (rand() - 0.5) * 70);
    return draw(x, HORIZON - 18 + rand() * 10, r2(70 + rand() * 50));
  }).join('');

  const front = Array.from({ length: 8 }, (_, i) => {
    const x = r2(40 + (i / 7) * (VIEW_W - 80) + (rand() - 0.5) * 120);
    return draw(x, HORIZON + 14 + rand() * 16, r2(160 + rand() * 110));
  }).join('');

  return svg(`
    <defs>${brushFilter('f-conif', 8, '0.018', 191)}</defs>
    <g filter="url(#f-conif)">
      <g opacity="0.55">${back}</g>
      <g opacity="0.95">${front}</g>
    </g>
  `);
}

/**
 * A snowfield.
 *
 * Snow is the opposite problem to grass: grass needs thousands of strokes to
 * stop reading as felt, and snow needs almost none — it is a smooth surface, and
 * stippling it is what makes cheap winter art look like porridge. What it does
 * need is *form*: wind-carved drifts, each with a lit crest and a blue shadow
 * pocket on its lee side, because a flat white field has no shape at all.
 */
function paintSnowGround(t: TimeOfDay): string {
  const rand = mulberry32(223);
  const s = snowTones(t);

  const drifts = Array.from({ length: 26 }, () => {
    const depth = Math.pow(rand(), 0.6);
    const y = r2(HORIZON + 10 + depth * (VIEW_H - HORIZON));
    const x = r2(rand() * VIEW_W);
    const rx = r2(120 + depth * 340);
    const ry = r2(rx * (0.16 + rand() * 0.14));
    // Shadow first, offset down-sun; the lit crest sits on top and slightly high.
    return `<g>
      <ellipse cx="${r2(x + rx * 0.08)}" cy="${r2(y + ry * 0.5)}" rx="${rx}" ry="${ry}" fill="${s.shade}" opacity="${r2(0.22 + rand() * 0.26)}"/>
      <ellipse cx="${x}" cy="${y}" rx="${r2(rx * 0.94)}" ry="${r2(ry * 0.9)}" fill="${s.lit}" opacity="${r2(0.4 + rand() * 0.4)}"/>
    </g>`;
  }).join('');

  // Wind scallops: shallow arcs raked across the surface, denser near the camera.
  const scallops = Array.from({ length: 110 }, () => {
    const depth = Math.pow(rand(), 0.5);
    const y = r2(HORIZON + 16 + depth * (VIEW_H - HORIZON - 16));
    const x = r2(rand() * VIEW_W);
    const w = r2(40 + depth * 190);
    return `<path d="M ${x} ${y} q ${r2(w / 2)} ${r2(-6 - depth * 12)} ${w} 0" stroke="${s.shade}" stroke-width="${r2(1 + depth * 3)}" fill="none" opacity="${r2(0.1 + rand() * 0.22)}"/>`;
  }).join('');

  // Ice crystals catching the light. Few and bright beats many and grey.
  const sparkle = Array.from({ length: 70 }, () => {
    const depth = Math.pow(rand(), 0.4);
    const y = r2(HORIZON + 24 + depth * (VIEW_H - HORIZON - 24));
    return `<circle cx="${r2(rand() * VIEW_W)}" cy="${y}" r="${r2(0.9 + depth * 2.2)}" fill="${s.lit}" opacity="${r2(0.35 + rand() * 0.5)}"/>`;
  }).join('');

  return svg(`
    <defs>
      ${brushFilter('f-snow', 8, '0.012', 227)}
      ${grainFilter('f-grain-snow', 13)}
      <linearGradient id="g-snow" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.mid}"/>
        <stop offset="26%" stop-color="${s.lit}"/>
        <stop offset="100%" stop-color="${s.shade}"/>
      </linearGradient>
      <linearGradient id="g-snowhaze" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${s.mid}" stop-opacity="0.6"/>
        <stop offset="100%" stop-color="${s.mid}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <g filter="url(#f-snow)">
      <rect x="-20" y="${HORIZON - 6}" width="${VIEW_W + 40}" height="${VIEW_H - HORIZON + 26}" fill="url(#g-snow)"/>
      ${drifts}
      ${scallops}
    </g>
    ${sparkle}
    <rect x="-20" y="${HORIZON - 12}" width="${VIEW_W + 40}" height="86" fill="url(#g-snowhaze)"/>
    <rect y="${HORIZON}" width="${VIEW_W}" height="${VIEW_H - HORIZON}" filter="url(#f-grain-snow)" opacity="0.05" style="mix-blend-mode:overlay"/>
  `);
}

/** A bank of snow across the bottom edge, with dead stalks pushing through it. */
function paintSnowFront(t: TimeOfDay): string {
  const rand = mulberry32(229);
  const s = snowTones(t);

  const stalks = Array.from({ length: 70 }, () => {
    const x = r2(rand() * (VIEW_W + 60) - 30);
    const h = r2(50 + rand() * 190);
    const lean = r2((rand() - 0.5) * h * 0.5);
    return `<path d="M ${x} ${VIEW_H + 10} q ${r2(lean * 0.3)} ${r2(-h * 0.6)} ${lean} ${r2(-h)}" stroke="${mixHex(t.frontGrass, '#8a7a5e', 0.55)}" stroke-width="${r2(1.4 + rand() * 2.4)}" fill="none" stroke-linecap="round" opacity="${r2(0.3 + rand() * 0.45)}"/>`;
  }).join('');

  /**
   * The near bank, and the reason this layer exists at all.
   *
   * The front plate's whole job is to cross in front of the pet — painted snow
   * over the cat's paws is what puts it *in* the picture instead of on top of
   * it. A bank sitting neatly below the bottom edge does none of that.
   *
   * The crest height is the whole tuning, and it has a narrow correct range: too
   * low and the layer may as well not exist, too high and the drift swallows the
   * animal instead of standing in front of it. These crest at the paws, with a
   * lit upper edge so the overlap reads as a drift rather than as a white bar.
   */
  const bank = Array.from({ length: 9 }, (_, i) => {
    const x = r2((i / 8) * VIEW_W + (rand() - 0.5) * 190);
    const rx = r2(280 + rand() * 260);
    const ry = r2(100 + rand() * 80);
    const cy = r2(VIEW_H + ry * 0.5);
    return `<g>
      <ellipse cx="${x}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${s.mid}" opacity="${r2(0.8 + rand() * 0.2)}"/>
      <ellipse cx="${r2(x - rx * 0.06)}" cy="${r2(cy - ry * 0.1)}" rx="${r2(rx * 0.9)}" ry="${r2(ry * 0.86)}" fill="${s.lit}" opacity="${r2(0.55 + rand() * 0.35)}"/>
    </g>`;
  }).join('');

  return svg(`
    <defs>${brushFilter('f-sfront', 7, '0.02', 233)}</defs>
    <g filter="url(#f-sfront)">
      ${stalks}
      ${bank}
    </g>
  `);
}

function paintMountain(t: TimeOfDay): SceneLayers {
  return {
    sky: paintSky(t, mulberry32(139)),
    hills: paintPeaks(t, false),
    trees: paintConifers(t, false),
    // An alpine meadow is grass with mountains behind it, so the existing field
    // is the right ground rather than a shortcut — the peaks and the treeline
    // are what make the place.
    ground: paintGround(t),
    front: paintFront(t),
  };
}

function paintSnow(t: TimeOfDay): SceneLayers {
  return {
    sky: paintSky(t, mulberry32(151)),
    hills: paintPeaks(t, true),
    trees: paintConifers(t, true),
    ground: paintSnowGround(t),
    front: paintSnowFront(t),
  };
}

// --- entry point -------------------------------------------------------------

function paintGarden(t: TimeOfDay): SceneLayers {
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

const PAINTERS: Record<SceneId, (t: TimeOfDay) => SceneLayers> = {
  garden: paintGarden,
  jungle: paintJungle,
  treehouse: paintTreehouse,
  livingroom: paintRoom,
  mountain: paintMountain,
  snow: paintSnow,
};

/**
 * Paint a scene at a time of day.
 *
 * Pure and deterministic: the same arguments always produce the same markup,
 * which is what lets the caller cache by `${scene}:${phase}` and repaint only
 * when one of them actually changes.
 */
export function paintScene(scene: SceneId, t: TimeOfDay): SceneLayers {
  const painter = PAINTERS[scene];
  return painter ? painter(t) : { ...EMPTY_LAYERS };
}
