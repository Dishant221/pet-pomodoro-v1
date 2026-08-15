/**
 * Time of day, shared by the painted background and the 3D pet.
 *
 * The whole hybrid gamble rests on one thing: the painting and the WebGL layer
 * must agree about where the sun is and what colour it is. If they disagree by
 * even a little the pet reads as a sticker — the eye is astonishingly good at
 * catching a shadow that falls the wrong way.
 *
 * So there is exactly one source of truth. A `TimeOfDay` gives the sun's screen
 * position and colour; the painter uses it to place the disc and pick its
 * palette, and the stage uses the same numbers to aim the key light. Neither
 * one is allowed its own opinion.
 */

export type PhaseId = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'night';

export interface TimeOfDay {
  id: PhaseId;
  label: string;

  /** Sun/moon horizontal position, -1 = hard left, 0 = centre, 1 = hard right. */
  sunX: number;
  /** Sun/moon height, 0 = on the horizon, 1 = directly overhead. */
  sunY: number;
  /** The light source itself, and the bloom around it. */
  sunColor: string;
  sunGlow: string;

  /** Sky gradient, top of frame down to the horizon. */
  skyTop: string;
  skyMid: string;
  skyLow: string;

  /** Cloud bodies: lit face and shadowed underside. */
  cloudLit: string;
  cloudShade: string;

  /** Distant hills — always hazier and bluer than the midground. */
  hillFar: string;
  hillNear: string;

  /** Tree canopies. */
  treeLit: string;
  treeDark: string;

  /** The grass field the pet stands on. */
  groundLit: string;
  groundMid: string;
  groundDark: string;

  /** Foreground grass, drawn in front of the pet. */
  frontGrass: string;

  /** Atmospheric wash laid over the entire composite, pet included. */
  gradeColor: string;
  gradeAlpha: number;

  /** Lighting recipe for the WebGL layer. */
  light: {
    keyColor: string;
    keyIntensity: number;
    ambientSky: string;
    ambientGround: string;
    ambientIntensity: number;
    rimColor: string;
    rimIntensity: number;
    /** Contact-shadow opacity. Soft and pale at dusk, crisp at noon. */
    shadowOpacity: number;
  };
}

/**
 * Six phases rather than a continuous curve.
 *
 * A continuous sun would be more "correct", but painted backgrounds are
 * discrete assets — you cannot smoothly interpolate between two paintings of a
 * sky. Six is enough that the day feels like it moves and few enough that an
 * artist can actually paint every scene six times.
 */
export const PHASES: Record<PhaseId, TimeOfDay> = {
  dawn: {
    id: 'dawn',
    label: 'Dawn',
    sunX: -0.62,
    sunY: 0.12,
    sunColor: '#ffd9a8',
    sunGlow: '#ff9e6b',
    skyTop: '#3b5a86',
    skyMid: '#8f7fa8',
    skyLow: '#f0a882',
    cloudLit: '#ffc9a4',
    cloudShade: '#8c7596',
    hillFar: '#6d7ba0',
    hillNear: '#4e6480',
    treeLit: '#4a6f6a',
    treeDark: '#2f4a4d',
    groundLit: '#7d9a6a',
    groundMid: '#5d7d55',
    groundDark: '#40593f',
    frontGrass: '#33492f',
    gradeColor: '#ff9e6b',
    gradeAlpha: 0.14,
    light: {
      keyColor: '#ffc79a',
      keyIntensity: 1.5,
      ambientSky: '#8fa8cc',
      ambientGround: '#6b7a5a',
      ambientIntensity: 1.3,
      rimColor: '#ffb98a',
      rimIntensity: 0.9,
      shadowOpacity: 0.2,
    },
  },

  morning: {
    id: 'morning',
    label: 'Morning',
    sunX: -0.4,
    sunY: 0.52,
    sunColor: '#fff6d8',
    sunGlow: '#ffe6a8',
    skyTop: '#2f7fc4',
    skyMid: '#69b0dd',
    skyLow: '#bfe0ef',
    cloudLit: '#ffffff',
    cloudShade: '#c3d6e6',
    hillFar: '#8fb3c4',
    hillNear: '#6f9a8c',
    treeLit: '#6ba05a',
    treeDark: '#3f6b45',
    groundLit: '#9ec96b',
    groundMid: '#78ad55',
    groundDark: '#548540',
    frontGrass: '#3f6b38',
    gradeColor: '#fff3cf',
    gradeAlpha: 0.07,
    light: {
      keyColor: '#fff8e4',
      keyIntensity: 2.1,
      ambientSky: '#bfe0ef',
      ambientGround: '#8aa86a',
      ambientIntensity: 1.5,
      rimColor: '#dff0ff',
      rimIntensity: 0.75,
      shadowOpacity: 0.3,
    },
  },

  noon: {
    id: 'noon',
    label: 'Noon',
    sunX: 0.08,
    sunY: 0.92,
    sunColor: '#ffffff',
    sunGlow: '#fff8dc',
    skyTop: '#1f6fbe',
    skyMid: '#5aa5da',
    skyLow: '#cfe6f2',
    cloudLit: '#ffffff',
    cloudShade: '#cbdce9',
    hillFar: '#9dbecb',
    hillNear: '#74a189',
    treeLit: '#74ad5c',
    treeDark: '#43733f',
    groundLit: '#a8d46e',
    groundMid: '#7fb657',
    groundDark: '#598c42',
    frontGrass: '#40703a',
    gradeColor: '#ffffff',
    gradeAlpha: 0.04,
    light: {
      keyColor: '#ffffff',
      keyIntensity: 2.4,
      ambientSky: '#cfe6f2',
      ambientGround: '#93b473',
      ambientIntensity: 1.5,
      rimColor: '#eaf6ff',
      rimIntensity: 0.6,
      shadowOpacity: 0.38,
    },
  },

  afternoon: {
    id: 'afternoon',
    label: 'Afternoon',
    sunX: 0.48,
    sunY: 0.58,
    sunColor: '#fff0c2',
    sunGlow: '#ffd98f',
    skyTop: '#3a86c0',
    skyMid: '#7cb8d8',
    skyLow: '#e2ddc4',
    cloudLit: '#fff6e4',
    cloudShade: '#c9c9c4',
    hillFar: '#a3b6b4',
    hillNear: '#7d9c78',
    treeLit: '#84ac54',
    treeDark: '#4c7038',
    groundLit: '#b4cf68',
    groundMid: '#8aae4f',
    groundDark: '#61833c',
    frontGrass: '#476935',
    gradeColor: '#ffdf9e',
    gradeAlpha: 0.1,
    light: {
      keyColor: '#fff0c8',
      keyIntensity: 2.2,
      ambientSky: '#dbe8ee',
      ambientGround: '#9fb06a',
      ambientIntensity: 1.4,
      rimColor: '#ffe9bd',
      rimIntensity: 0.8,
      shadowOpacity: 0.34,
    },
  },

  dusk: {
    id: 'dusk',
    label: 'Dusk',
    sunX: 0.66,
    sunY: 0.1,
    sunColor: '#ffd28a',
    sunGlow: '#ff7a52',
    skyTop: '#2b4a72',
    skyMid: '#7a6b96',
    skyLow: '#ff8f66',
    cloudLit: '#ffb389',
    cloudShade: '#6f5f84',
    hillFar: '#5f6d92',
    hillNear: '#43536f',
    treeLit: '#43604f',
    treeDark: '#283c3c',
    groundLit: '#6b8558',
    groundMid: '#4e6645',
    groundDark: '#354833',
    frontGrass: '#293a26',
    gradeColor: '#ff7a52',
    gradeAlpha: 0.16,
    light: {
      keyColor: '#ffb582',
      keyIntensity: 1.6,
      ambientSky: '#7d86ad',
      ambientGround: '#5c6247',
      ambientIntensity: 1.2,
      rimColor: '#ff9a6a',
      rimIntensity: 1.1,
      shadowOpacity: 0.18,
    },
  },

  night: {
    id: 'night',
    label: 'Night',
    // The "sun" is the moon after dark. Same maths, cooler colour.
    sunX: 0.3,
    sunY: 0.72,
    sunColor: '#e8f0ff',
    sunGlow: '#9fb8e0',
    skyTop: '#0d1730',
    skyMid: '#1b2b4d',
    skyLow: '#38456b',
    cloudLit: '#4a5878',
    cloudShade: '#232f4d',
    hillFar: '#2a3654',
    hillNear: '#1d2740',
    treeLit: '#22503f',
    treeDark: '#132b2a',
    groundLit: '#2f4a3c',
    groundMid: '#22382e',
    groundDark: '#182a22',
    frontGrass: '#101f1a',
    gradeColor: '#4a6ba8',
    gradeAlpha: 0.2,
    light: {
      keyColor: '#b9cdf0',
      keyIntensity: 0.85,
      ambientSky: '#33456e',
      ambientGround: '#1b2a24',
      ambientIntensity: 0.9,
      rimColor: '#8fb0e8',
      rimIntensity: 1.2,
      shadowOpacity: 0.12,
    },
  },
};

export const PHASE_IDS = Object.keys(PHASES) as PhaseId[];

/**
 * Which phase it is for a given local hour.
 *
 * Local to the *visitor*, not to the server — a Cloudflare edge node has no
 * meaningful time of day. The caller passes `new Date().getHours()`, which is
 * already in the browser's own zone, so this needs no timezone handling at all.
 */
export function phaseForHour(hour: number): PhaseId {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 'night';
  if (h < 8) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 15) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 21) return 'dusk';
  return 'night';
}

/** Where the sun sits in the painted frame, in viewBox units (1600×900). */
export function sunScreenPos(t: TimeOfDay): { x: number; y: number } {
  return {
    x: 800 + t.sunX * 700,
    // The horizon sits at y=560; the sun climbs from there towards the top.
    y: 560 - t.sunY * 500,
  };
}

/**
 * The key light's world position, derived from the same sun.
 *
 * The camera looks down -Z from about z=3, so +X is screen-right and +Y is up.
 * Keeping z positive puts the sun on the camera's side of the pet, which is
 * what the paintings show — none of them backlight the animal.
 */
export function keyLightPosition(t: TimeOfDay): [number, number, number] {
  return [t.sunX * 7, 0.6 + t.sunY * 7, 2.2 + (1 - t.sunY) * 1.6];
}
