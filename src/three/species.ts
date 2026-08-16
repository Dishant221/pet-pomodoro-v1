/**
 * What makes one animal a different animal from another.
 *
 * The rig in `animal.ts` is one hierarchy — spine, neck, head, two ears, four
 * legs of three joints each, a tail of N segments — and every species uses it
 * unchanged. That is not a simplification: it is what quadrupeds *are*, and it
 * is why one set of animations can drive all of them. A sheep walks with the
 * same joints as a cat; it differs in how long they are and how fast they move.
 *
 * So a species is data, not code. Everything that varies between animals lives
 * in this file as numbers and flags, and adding one is a matter of describing
 * it rather than modelling it. The three things that genuinely need shape
 * changes — ear silhouette, tail silhouette, headgear — are enumerated rather
 * than free-form, because "a cone or a lobe or a hanging flap" covers every
 * ear in the roster and an open-ended shape parameter would not have kept the
 * outline pass working.
 *
 * The numbers are in the same units as the rest of the stage: the cat is about
 * 0.6 long and 0.34 at the shoulder before `scale`.
 */

/** Ear silhouette. `pointed` is the cat, `droop` the dog, `round` the bear. */
export type EarShape = 'pointed' | 'droop' | 'round' | 'tall';
/** Tail silhouette. `tuft` is a lion-ish end brush; `plume` is a fanned tail. */
export type TailShape = 'taper' | 'tuft' | 'plume' | 'stub';
/** Something on the head, if anything. */
export type Headgear = 'none' | 'horns' | 'antlers';

export interface Species {
  id: SpeciesId;
  label: string;

  /**
   * Uniform scale for the whole rig.
   *
   * Proportions below are authored at the cat's size and then scaled, rather
   * than authored at true size, so that a horse and a cat are describable with
   * the same numbers and the animations — which move in radians, not metres —
   * read identically on both. A horse is not a large cat, but it is a large
   * quadruped, and the difference lives in the proportions, not in the scale.
   */
  scale: number;

  body: {
    radius: number;
    length: number;
    /** Shoulder height: where the body group sits above the ground. */
    standH: number;
    hipX: number;
    hipFrontZ: number;
    hipBackZ: number;
    hipY: number;
    upperLen: number;
    lowerLen: number;
    pawR: number;
    /** Rump bulges. Cats and dogs have them; hoofed animals read flatter. */
    haunches: boolean;
  };

  head: {
    radius: number;
    /** Vertical squash of the skull. Below 1 is a flatter, wider face. */
    squash: number;
    /** How far the muzzle protrudes along +Z. 0 is a flat feline face. */
    muzzle: number;
    /** How far the muzzle hangs below the skull centre. */
    muzzleDrop: number;
    /** Muzzle width relative to its length — a cow's is broad, a deer's fine. */
    muzzleWide: number;
    /** Muzzle thickness, as a fraction of the skull radius. */
    muzzleR: number;
    /**
     * Cream muzzle rather than a coat-coloured one.
     *
     * Right for the white cat, wrong for anything with a coat: a pale muzzle on
     * a tan dog reads as a snowball stuck to its face rather than as a snout.
     */
    muzzleLight: boolean;
    /** Neck length. Long for horse and deer, near zero for cat and bear. */
    neck: number;
    /** The anime cheek floof. Off for anything with a long face. */
    cheeks: boolean;
    /** Eye size relative to the skull. Prey animals get bigger, wider eyes. */
    eye: number;
    /** How far to the side the eyes sit. 1 is forward-facing, 1.5 is lateral. */
    eyeSplay: number;
  };

  ears: {
    shape: EarShape;
    size: number;
    /** Outward tilt at rest, in radians. */
    splay: number;
  };

  tail: {
    shape: TailShape;
    segs: number;
    len: number;
    /** Base thickness; each segment tapers from here. */
    thick: number;
    /** Rest carriage, in radians per joint. Positive lifts it over the back. */
    carriage: number;
  };

  features: {
    whiskers: boolean;
    /** Dark hard feet rather than soft paw pads. */
    hooves: boolean;
    headgear: Headgear;
    /** A crest along the neck — horse, donkey. */
    mane: boolean;
    /** Fleece: bumpy overlay on the torso. */
    wool: boolean;
  };

  gait: {
    /** World units per second at a walk. Drives locomotion and stride timing. */
    speed: number;
    /** Multiplier on the body bob. Heavy animals bob less, relatively. */
    bob: number;
  };

  voice: VoiceSpec;

  /** What this animal eats, in the shop's terms. Used to gate snack choices. */
  diet: 'carnivore' | 'omnivore' | 'herbivore';
}

/**
 * How an animal sounds, as parameters to the synthesizer rather than a file.
 *
 * `audio.ts` builds every cue from oscillators, so a species' voice is a recipe:
 * where the pitch starts and ends, how long it takes, which two formants shape
 * it, and how rough the source is. A meow and a bleat differ mostly in the
 * sweep and the formants; a moo and a whinny differ mostly in length and depth.
 */
export interface VoiceSpec {
  /** Start and end of the pitch sweep, in Hz. */
  from: number;
  to: number;
  /** Seconds. */
  duration: number;
  /** The two bandpass formants that give the call its vowel. */
  formants: [number, number];
  /** 0 = pure tone, 1 = very rough. Adds noise and detuning. */
  rasp: number;
  /** Extra weight below the fundamental. Cows and horses have a lot. */
  body: number;
  /** How many syllables the call repeats. A bark is short and doubled. */
  repeats: number;
  /** Gap between repeats, seconds. */
  gap: number;
}

export type SpeciesId = 'cat' | 'dog';

/**
 * The cat, exactly as it was before species existed.
 *
 * These numbers were lifted unchanged from the original hand-tuned rig, which
 * is the point: the extraction had to be provably not a redesign, so the cat
 * is the control. Anything that looks different on the cat is a bug in the
 * generalisation, not a new art direction.
 */
const CAT: Species = {
  id: 'cat',
  label: 'Cat',
  scale: 1,
  body: {
    radius: 0.135,
    length: 0.26,
    standH: 0.335,
    hipX: 0.082,
    hipFrontZ: 0.145,
    hipBackZ: -0.15,
    hipY: -0.055,
    upperLen: 0.125,
    lowerLen: 0.115,
    pawR: 0.05,
    haunches: true,
  },
  head: {
    radius: 0.128,
    squash: 0.95,
    muzzle: 0.088,
    muzzleDrop: 0.042,
    muzzleWide: 1.25,
    muzzleR: 0.48,
    muzzleLight: true,
    neck: 0,
    cheeks: true,
    eye: 1,
    eyeSplay: 1,
  },
  ears: { shape: 'pointed', size: 1, splay: 0.26 },
  tail: { shape: 'taper', segs: 5, len: 0.085, thick: 0.038, carriage: 0 },
  features: { whiskers: true, hooves: false, headgear: 'none', mane: false, wool: false },
  gait: { speed: 1, bob: 1 },
  voice: { from: 760, to: 520, duration: 0.42, formants: [900, 2100], rasp: 0.18, body: 0.15, repeats: 1, gap: 0 },
  diet: 'carnivore',
};

/**
 * The dog.
 *
 * Longer in the muzzle, shorter in the tail, ears hanging rather than pricked,
 * and a wider stance. The tail carriage is positive at rest because a dog's
 * default is up and a cat's is level — it is a small number that does more for
 * telling the two apart at a glance than any amount of head shape.
 */
const DOG: Species = {
  id: 'dog',
  label: 'Dog',
  scale: 1.08,
  body: {
    radius: 0.138,
    length: 0.28,
    standH: 0.35,
    hipX: 0.092,
    hipFrontZ: 0.15,
    hipBackZ: -0.155,
    hipY: -0.058,
    upperLen: 0.135,
    lowerLen: 0.125,
    pawR: 0.052,
    haunches: true,
  },
  head: {
    radius: 0.122,
    squash: 0.92,
    muzzle: 0.125,
    muzzleDrop: 0.036,
    muzzleWide: 1.05,
    muzzleR: 0.34,
    muzzleLight: false,
    neck: 0.022,
    cheeks: false,
    eye: 0.9,
    eyeSplay: 1.05,
  },
  ears: { shape: 'droop', size: 1.15, splay: 0.5 },
  tail: { shape: 'plume', segs: 4, len: 0.075, thick: 0.036, carriage: 0.22 },
  features: { whiskers: false, hooves: false, headgear: 'none', mane: false, wool: false },
  gait: { speed: 1.15, bob: 1.1 },
  voice: { from: 320, to: 190, duration: 0.16, formants: [520, 1250], rasp: 0.55, body: 0.4, repeats: 2, gap: 0.19 },
  diet: 'omnivore',
};

export const SPECIES: Record<SpeciesId, Species> = { cat: CAT, dog: DOG };

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

export function speciesFor(id: SpeciesId | undefined): Species {
  return SPECIES[id as SpeciesId] ?? CAT;
}
