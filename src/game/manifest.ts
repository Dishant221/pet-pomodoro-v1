/**
 * Typed port of petpomo-assets/manifest.json — the single source of truth for
 * state -> asset, animation specs, parallax factors and ground anchors.
 *
 * The raw SVG sources are inlined into the bundle (`?raw`) rather than fetched,
 * so the whole world is available offline on first paint and GSAP/CSS can reach
 * the internal groups.
 */
import catIdle from '../assets/pet/cat-idle.svg?raw';
import catSleeping from '../assets/pet/cat-sleeping.svg?raw';
import catWaking from '../assets/pet/cat-waking.svg?raw';
import catBegging from '../assets/pet/cat-begging.svg?raw';
import catEating from '../assets/pet/cat-eating.svg?raw';
import catPetted from '../assets/pet/cat-petted.svg?raw';
import catPlaying from '../assets/pet/cat-playing.svg?raw';
import catCelebrating from '../assets/pet/cat-celebrating.svg?raw';
import catSad from '../assets/pet/cat-sad.svg?raw';

import sceneLivingroom from '../assets/scenes/scene-livingroom.svg?raw';
import sceneGarden from '../assets/scenes/scene-garden.svg?raw';
import sceneJungle from '../assets/scenes/scene-jungle.svg?raw';
import sceneTreehouse from '../assets/scenes/scene-treehouse.svg?raw';
import sceneMountain from '../assets/scenes/scene-mountain.svg?raw';
import sceneSnow from '../assets/scenes/scene-snow.svg?raw';

export const MANIFEST_VERSION = 1;

export type PetState =
  | 'idle'
  | 'sleeping'
  | 'waking'
  | 'begging'
  | 'eating'
  | 'petted'
  | 'playing'
  | 'celebrating'
  | 'sad';

export type SceneId = 'livingroom' | 'garden' | 'jungle' | 'treehouse' | 'mountain' | 'snow';

export interface PetStateSpec {
  /** Inlined SVG markup, viewBox "0 0 200 200". */
  svg: string;
  /** True when the state plays once and then hands off to `next`. */
  oneShot: boolean;
  /** Where a one-shot state goes when its timeline finishes. */
  next?: PetState;
  /** Milliseconds a one-shot state occupies before `next` takes over. */
  duration?: number;
  /** Human-readable label used in the HUD. */
  label: string;
}

export interface SceneSpec {
  svg: string;
  label: string;
  /** Multiplier applied to normalised pointer offset, per layer id. */
  parallax: Record<string, number>;
  /** Feet-on-floor anchor in scene viewBox units. */
  petGround: { y: number; xRange: [number, number] };
  /** Element id the draggable snack spawns from. */
  snackSlot: string;
  /** Scene participates in the real-clock day/night cycle. */
  dayNight: boolean;
  /** Base hue for the synthesized ambient bed. */
  ambientHz: number;
  /**
   * The scene is a room: weather still tints the light (grey days come in
   * through the windows) but nothing falls from the ceiling — no rain, no
   * snow, no lightning flash.
   */
  indoor?: boolean;
}

export const PET_STATES: Record<PetState, PetStateSpec> = {
  idle: { svg: catIdle, oneShot: false, label: 'Idle' },
  sleeping: { svg: catSleeping, oneShot: false, label: 'Sleeping' },
  waking: { svg: catWaking, oneShot: true, next: 'idle', duration: 1600, label: 'Waking' },
  begging: { svg: catBegging, oneShot: false, label: 'Hungry' },
  eating: { svg: catEating, oneShot: true, next: 'idle', duration: 2600, label: 'Eating' },
  petted: { svg: catPetted, oneShot: true, next: 'idle', duration: 2400, label: 'Happy' },
  playing: { svg: catPlaying, oneShot: true, next: 'idle', duration: 3000, label: 'Playing' },
  celebrating: { svg: catCelebrating, oneShot: true, next: 'idle', duration: 2800, label: 'Celebrating' },
  sad: { svg: catSad, oneShot: false, label: 'Sad' },
};

export const SCENES: Record<SceneId, SceneSpec> = {
  livingroom: {
    svg: sceneLivingroom,
    label: 'Living Room',
    parallax: { 'layer-sky': 0, 'layer-back': 0.15, 'layer-mid': 0.3, 'layer-front': 0.5 },
    petGround: { y: 392, xRange: [220, 580] },
    snackSlot: 'snack-slot',
    dayNight: true,
    ambientHz: 110,
    indoor: true,
  },
  garden: {
    svg: sceneGarden,
    label: 'Garden',
    parallax: { 'layer-sky': 0, 'layer-back': 0.15, 'layer-mid': 0.3, 'layer-front': 0.5 },
    petGround: { y: 396, xRange: [180, 620] },
    snackSlot: 'snack-slot',
    dayNight: false,
    ambientHz: 220,
  },
  jungle: {
    svg: sceneJungle,
    label: 'Jungle',
    parallax: { 'layer-sky': 0, 'layer-back': 0.12, 'layer-mid': 0.3, 'layer-front': 0.55 },
    petGround: { y: 396, xRange: [200, 600] },
    snackSlot: 'snack-slot',
    dayNight: false,
    ambientHz: 165,
  },
  treehouse: {
    svg: sceneTreehouse,
    label: 'Treehouse',
    parallax: { 'layer-sky': 0, 'layer-back': 0.15, 'layer-mid': 0.3, 'layer-front': 0.5 },
    petGround: { y: 322, xRange: [230, 570] },
    snackSlot: 'snack-slot',
    dayNight: false,
    ambientHz: 147,
  },
  mountain: {
    svg: sceneMountain,
    label: 'Mountain',
    // The far range barely moves: distance is what parallax exists to say, and
    // peaks that slide like the treeline read as painted flats on a stage.
    parallax: { 'layer-sky': 0, 'layer-back': 0.08, 'layer-mid': 0.26, 'layer-front': 0.52 },
    petGround: { y: 396, xRange: [190, 610] },
    snackSlot: 'snack-slot',
    dayNight: true,
    ambientHz: 196,
  },
  snow: {
    svg: sceneSnow,
    label: 'Snowfield',
    parallax: { 'layer-sky': 0, 'layer-back': 0.08, 'layer-mid': 0.24, 'layer-front': 0.5 },
    petGround: { y: 398, xRange: [190, 610] },
    snackSlot: 'snack-slot',
    dayNight: true,
    ambientHz: 174,
  },
};

export const SCENE_IDS = Object.keys(SCENES) as SceneId[];
export const PET_STATE_IDS = Object.keys(PET_STATES) as PetState[];

/** Scene viewBox, shared by every background. */
export const SCENE_VIEWBOX = { w: 800, h: 450 };
/** Cat viewBox, shared by every pose. */
export const CAT_VIEWBOX = { w: 200, h: 200 };
