/**
 * Bends a world's lighting to the player's real time of day and real weather.
 *
 * Each world in `worlds.ts` ships a `LightRecipe` describing how it looks at
 * its best. That stays the artistic reference; this module treats it as the
 * midday-clear baseline and moves it from there. Keeping it a pure function of
 * (recipe, time, weather) means the same maths drives the 3D stage, the painted
 * stage and anything later, and it can be reasoned about without a GPU.
 *
 * The two effects compose in a deliberate order: the sun sets the base colour
 * and strength, then weather attenuates it. An overcast noon and a clear dusk
 * are both dim, but they are dim in completely different colours, and that
 * distinction is most of what makes a sky feel real.
 */
import * as THREE from 'three';
import type { LightRecipe } from './worlds';
import { sunAzimuth, sunElevation, type Condition, type Weather } from '../game/world';

export interface DaylightInput {
  /** 0..1 through the local day. */
  fraction: number;
  weather: Weather;
  /**
   * How exposed this world is to the sky, 0..1.
   *
   * A living room has windows, not weather. Running an indoor scene at full
   * strength put a sunset inside the lounge, which looked like a fire.
   */
  exposure?: number;
}

/** Below this the sun is considered down and the moon takes over. */
const NIGHT_ELEVATION = 0.08;

interface WeatherEffect {
  /** Multiplies the key light — how much sun actually reaches the ground. */
  key: number;
  /** Multiplies ambient fill. Overcast days are dim but very evenly lit. */
  fill: number;
  /** Multiplies the rim. Diffuse skies have no crisp edge light at all. */
  rim: number;
  /** Multiplies shadow opacity. No sun, no sharp shadow. */
  shadow: number;
  /** Pulls every light towards this colour, by `tint` amount. */
  cast: string;
  tint: number;
  /** Scales fog distance. Below 1 closes the world in. */
  fogFar: number;
  /** Drains colour, 0..1. Grey days are literally less saturated. */
  desaturate: number;
}

const WEATHER: Record<Condition, WeatherEffect> = {
  clear: { key: 1, fill: 1, rim: 1, shadow: 1, cast: '#ffffff', tint: 0, fogFar: 1, desaturate: 0 },
  cloudy: { key: 0.82, fill: 1.08, rim: 0.85, shadow: 0.75, cast: '#e8eef5', tint: 0.16, fogFar: 0.94, desaturate: 0.08 },
  overcast: { key: 0.5, fill: 1.2, rim: 0.5, shadow: 0.35, cast: '#c9d4e0', tint: 0.36, fogFar: 0.82, desaturate: 0.22 },
  fog: { key: 0.42, fill: 1.24, rim: 0.4, shadow: 0.22, cast: '#d7dde3', tint: 0.46, fogFar: 0.42, desaturate: 0.32 },
  rain: { key: 0.44, fill: 1.1, rim: 0.55, shadow: 0.28, cast: '#a8bccd', tint: 0.42, fogFar: 0.7, desaturate: 0.3 },
  snow: { key: 0.72, fill: 1.32, rim: 0.7, shadow: 0.3, cast: '#eaf2fb', tint: 0.34, fogFar: 0.6, desaturate: 0.14 },
  storm: { key: 0.3, fill: 0.92, rim: 0.6, shadow: 0.2, cast: '#7d8ca3', tint: 0.55, fogFar: 0.55, desaturate: 0.36 },
};

/**
 * Sunlight colour at a given elevation.
 *
 * Warm and deep on the horizon, neutral overhead — the long atmospheric path
 * at a low angle scatters out the blue. Below the horizon it crosses to
 * moonlight, which is a cool blue, not a dim white.
 */
function sunColor(elevation: number, out: THREE.Color): THREE.Color {
  if (elevation < NIGHT_ELEVATION) {
    // 0 at full dark, 1 right at the crossover — a brief lilac transition.
    const k = elevation / NIGHT_ELEVATION;
    return out.set('#a9c2ec').lerp(new THREE.Color('#ffb27a'), k * 0.55);
  }
  const stops: Array<[number, string]> = [
    [NIGHT_ELEVATION, '#ff9552'],
    [0.2, '#ffc384'],
    [0.42, '#ffe4bb'],
    [0.75, '#fffaf0'],
    [1, '#ffffff'],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [hi, hiC] = stops[i];
    if (elevation <= hi) {
      const [lo, loC] = stops[i - 1];
      return out.set(loC).lerp(new THREE.Color(hiC), (elevation - lo) / (hi - lo));
    }
  }
  return out.set('#ffffff');
}

/** Sky dome colours for the time of day, before weather is applied. */
function skyFor(elevation: number, azimuth: number): { top: string; middle: string; bottom: string } {
  if (elevation < NIGHT_ELEVATION) {
    const k = elevation / NIGHT_ELEVATION;
    return {
      top: mix('#0b1430', '#2c3f68', k),
      middle: mix('#17243f', '#5b5580', k),
      bottom: mix('#2b3550', '#b3728a', k),
    };
  }
  // Low sun reddens the horizon band far more than the zenith.
  const day = Math.min(1, (elevation - NIGHT_ELEVATION) / 0.5);
  // Which side the warm band sits on follows the sun across the sky.
  const warm = 1 - day;
  return {
    top: mix('#3f6fa8', '#2f86cc', day),
    middle: mix('#8f8fb4', '#79b7de', day),
    bottom: mix(azimuth < 0 ? '#f2a173' : '#ffa877', '#d8ecf6', 1 - warm * 0.85),
  };
}

function mix(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))).getHexString();
}

/** Desaturate towards grey, in place. */
function drain(c: THREE.Color, amount: number): THREE.Color {
  if (amount <= 0) return c;
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  return c.lerp(new THREE.Color(l, l, l), amount);
}

const _c = new THREE.Color();

export function modulate(base: LightRecipe, input: DaylightInput): LightRecipe {
  const exposure = Math.max(0, Math.min(1, input.exposure ?? 1));
  const f = input.fraction;
  const elevation = sunElevation(f);
  const azimuth = sunAzimuth(f);
  const w = WEATHER[input.weather.condition] ?? WEATHER.clear;

  // `exposure` scales every departure from the recipe, so an indoor world can
  // feel the time of day without being rained on.
  const at = (v: number) => 1 + (v - 1) * exposure;

  const night = elevation < NIGHT_ELEVATION;
  // Night is dim but not black; a fully dark stage is unreadable and unfun.
  const dayStrength = night ? 0.3 : 0.42 + elevation * 0.58;

  const cast = new THREE.Color(w.cast);
  const applyCast = (c: THREE.Color) => drain(c.lerp(cast, w.tint * exposure), w.desaturate * exposure);

  // --- key ------------------------------------------------------------------
  const keyColor = applyCast(sunColor(elevation, _c.clone()));
  const keyIntensity = base.key.intensity * at(dayStrength) * at(w.key);

  // The sun tracks across the sky, and sits low at both ends of the day. Its
  // distance is kept constant so the shadow camera never needs resizing.
  const R = Math.hypot(base.key.position[0], base.key.position[2]) || 4;
  const height = Math.max(1.2, 1.2 + elevation * 6.5);
  const keyPosition: [number, number, number] = [
    azimuth * R * 1.4 * exposure + base.key.position[0] * (1 - exposure),
    height * exposure + base.key.position[1] * (1 - exposure),
    base.key.position[2],
  ];

  // --- fill -----------------------------------------------------------------
  const fillSky = applyCast(_c.clone().set(base.fill.sky).lerp(new THREE.Color(skyFor(elevation, azimuth).middle), 0.5 * exposure));
  const fillGround = applyCast(_c.clone().set(base.fill.ground));
  const fillIntensity = base.fill.intensity * at(night ? 0.62 : 0.78 + elevation * 0.32) * at(w.fill);

  // --- rim ------------------------------------------------------------------
  // Moonlight rims hard: at night it is often the only thing separating the pet
  // from the background, so it is boosted rather than dimmed.
  const rimColor = applyCast(_c.clone().set(night ? '#9db9ea' : base.rim.color));
  const rimIntensity = base.rim.intensity * at(night ? 1.35 : 1) * at(w.rim);

  // --- sky and fog ----------------------------------------------------------
  const s = skyFor(elevation, azimuth);
  const skyMix = (baseHex: THREE.ColorRepresentation, timeHex: string) => {
    const c = _c.clone().set(baseHex).lerp(new THREE.Color(timeHex), exposure);
    return '#' + applyCast(c).getHexString();
  };
  const sky = {
    top: skyMix(base.sky.top, s.top),
    middle: skyMix(base.sky.middle, s.middle),
    bottom: skyMix(base.sky.bottom, s.bottom),
  };

  // Fog takes the horizon's colour, which is what makes distance read as air
  // rather than as a grey wash laid over the scene.
  const fogColor = '#' + applyCast(_c.clone().set(base.fog.color).lerp(new THREE.Color(s.bottom), 0.55 * exposure)).getHexString();

  return {
    sky,
    fog: {
      color: fogColor,
      near: base.fog.near,
      far: Math.max(base.fog.near + 1, base.fog.far * at(w.fogFar)),
    },
    key: { color: '#' + keyColor.getHexString(), intensity: keyIntensity, position: keyPosition },
    fill: {
      sky: '#' + fillSky.getHexString(),
      ground: '#' + fillGround.getHexString(),
      intensity: fillIntensity,
    },
    rim: { color: '#' + rimColor.getHexString(), intensity: rimIntensity, position: base.rim.position },
    shadowOpacity: Math.max(0, Math.min(1, base.shadowOpacity * at(night ? 0.45 : 0.5 + elevation * 0.5) * at(w.shadow))),
  };
}
