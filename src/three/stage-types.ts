/**
 * The contract between the engine and whatever it is standing the cat in.
 *
 * Kept separate from any implementation so a world can be swapped without the
 * engine caring. Today the only implementation is `painted.ts`; these types
 * previously described the fully-modelled worlds too, and are deliberately
 * still generic enough to describe another.
 */
import type * as THREE from 'three';
import type { SkyColors } from './toon';

export interface LightRecipe {
  sky: SkyColors;
  fog: { color: string; near: number; far: number };
  key: { color: string; intensity: number; position: [number, number, number] };
  fill: { sky: string; ground: string; intensity: number };
  rim: { color: string; intensity: number; position: [number, number, number] };
  /** Shadow darkness on the ground plane, 0..1. */
  shadowOpacity: number;
}

export interface World {
  group: THREE.Group;
  /**
   * How the scene looks at clear midday.
   *
   * Treated as a baseline, not a final answer: `daylight.ts` moves it to the
   * player's real time and weather before it reaches a light.
   */
  lights: LightRecipe;
  /** Rectangle the cat may roam inside. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the cat curls up to sleep during focus. */
  bed: THREE.Vector3;
  /** Where the food bowl stands — the cat walks here to eat. */
  bowl: THREE.Vector3;
  /** Off-stage spots the cat runs to when fetching a gift. */
  stash: THREE.Vector3[];
  /** Front-of-stage spot where gifts are presented to the player. */
  gift: THREE.Vector3;
  /**
   * Soft contact patch the engine keeps under the cat, if the world has one.
   *
   * With a painted floor there is no modelled ground bouncing light back, so a
   * low sun leaves the cast shadow stretched away to nothing and the pet starts
   * to float. This is what keeps it planted.
   */
  contact?: THREE.Object3D;
  update(dt: number, now: number, dayPhase: number): void;
  dispose(): void;
}
