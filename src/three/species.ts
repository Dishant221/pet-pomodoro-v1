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
    /**
     * Horizontal squash of the skull.
     *
     * A long-faced animal is narrow as well as long, and leaving this at 1 was
     * what kept the horse reading as a round-headed alpaca even after its
     * muzzle and eyes were right — from the front it was a ball with a ball on
     * it. Narrowness is most of what "long face" means head-on.
     */
    narrow: number;
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

export type SpeciesId = 'cat' | 'dog' | 'puppy' | 'horse' | 'donkey' | 'cow' | 'sheep' | 'deer' | 'bear';

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
    narrow: 1,
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
    narrow: 0.94,
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

/**
 * The rest of the roster.
 *
 * Each one is a variation on the two above, and the variations that matter are
 * the ones you would name if you were describing the animal to someone: how
 * long its legs are, where its eyes sit, what is on its head. Nothing here is a
 * new shape — the shapes are all in `animal.ts` behind the flags — which is the
 * test of whether the contract was drawn in the right place.
 */

/** A dog, younger: shorter legs, a bigger head, and a higher voice. */
const PUPPY: Species = {
  ...DOG,
  id: 'puppy',
  label: 'Puppy',
  scale: 0.86,
  body: { ...DOG.body, standH: 0.3, upperLen: 0.1, lowerLen: 0.092, length: 0.23 },
  // Young animals are head-heavy and big-eyed, and that single pair of numbers
  // does more to read as "young" than any change to the body.
  head: { ...DOG.head, radius: 0.132, muzzle: 0.085, muzzleR: 0.36, eye: 1.12, neck: 0.008 },
  ears: { shape: 'droop', size: 1.2, splay: 0.45 },
  tail: { shape: 'plume', segs: 3, len: 0.06, thick: 0.032, carriage: 0.3 },
  gait: { speed: 1.3, bob: 1.25 },
  voice: { from: 520, to: 340, duration: 0.13, formants: [700, 1700], rasp: 0.4, body: 0.2, repeats: 3, gap: 0.15 },
};

const HORSE: Species = {
  id: 'horse',
  label: 'Horse',
  scale: 1.75,
  body: {
    radius: 0.145,
    length: 0.33,
    // Long legs are most of what a horse is. The stand height has to rise with
    // them or the body sits on the ground with the knees bent outward.
    standH: 0.46,
    hipX: 0.088,
    hipFrontZ: 0.17,
    hipBackZ: -0.175,
    hipY: -0.06,
    upperLen: 0.2,
    lowerLen: 0.19,
    pawR: 0.045,
    haunches: false,
  },
  head: {
    radius: 0.1,
    squash: 0.88,
    narrow: 0.76,
    muzzle: 0.17,
    muzzleDrop: 0.03,
    muzzleWide: 0.8,
    muzzleR: 0.42,
    muzzleLight: false,
    neck: 0.16,
    cheeks: false,
    eye: 0.68,
    // Eyes on the sides of the head: the giveaway of a prey animal, and the
    // single change that stops a long-faced quadruped reading as a big dog.
    eyeSplay: 1.45,
  },
  ears: { shape: 'tall', size: 0.8, splay: 0.34 },
  tail: { shape: 'plume', segs: 3, len: 0.09, thick: 0.026, carriage: 0.1 },
  features: { whiskers: false, hooves: true, headgear: 'none', mane: true, wool: false },
  gait: { speed: 1.35, bob: 0.75 },
  voice: { from: 620, to: 240, duration: 0.55, formants: [640, 1500], rasp: 0.8, body: 0.55, repeats: 1, gap: 0 },
  diet: 'herbivore',
};

/** A horse's smaller, greyer, far louder cousin. The ears are the joke. */
const DONKEY: Species = {
  ...HORSE,
  id: 'donkey',
  label: 'Donkey',
  scale: 1.4,
  body: { ...HORSE.body, standH: 0.42, upperLen: 0.17, lowerLen: 0.16, length: 0.3 },
  head: { ...HORSE.head, radius: 0.105, muzzle: 0.15, neck: 0.11 },
  ears: { shape: 'tall', size: 1.5, splay: 0.42 },
  tail: { shape: 'tuft', segs: 3, len: 0.08, thick: 0.022, carriage: -0.1 },
  features: { whiskers: false, hooves: true, headgear: 'none', mane: true, wool: false },
  gait: { speed: 1.1, bob: 0.85 },
  // A bray is two notes: a long rasping inhale and a short fall. Two repeats
  // with a wide sweep and heavy rasp is as close as one recipe gets.
  voice: { from: 700, to: 170, duration: 0.5, formants: [560, 1300], rasp: 1, body: 0.6, repeats: 2, gap: 0.62 },
};

const COW: Species = {
  id: 'cow',
  label: 'Cow',
  scale: 1.65,
  body: {
    radius: 0.175,
    length: 0.36,
    standH: 0.4,
    hipX: 0.1,
    hipFrontZ: 0.175,
    hipBackZ: -0.185,
    hipY: -0.065,
    upperLen: 0.15,
    lowerLen: 0.14,
    pawR: 0.05,
    haunches: false,
  },
  head: {
    radius: 0.11,
    squash: 0.9,
    narrow: 0.92,
    muzzle: 0.115,
    muzzleDrop: 0.035,
    // A broad wet muzzle is the one feature everyone draws on a cow.
    muzzleWide: 1.5,
    muzzleR: 0.56,
    muzzleLight: true,
    neck: 0.055,
    cheeks: false,
    eye: 0.62,
    eyeSplay: 1.4,
  },
  ears: { shape: 'round', size: 1.15, splay: 1.15 },
  tail: { shape: 'tuft', segs: 4, len: 0.085, thick: 0.018, carriage: -0.15 },
  features: { whiskers: false, hooves: true, headgear: 'horns', mane: false, wool: false },
  gait: { speed: 0.75, bob: 0.6 },
  voice: { from: 300, to: 150, duration: 1.1, formants: [420, 900], rasp: 0.35, body: 0.9, repeats: 1, gap: 0 },
  diet: 'herbivore',
};

const SHEEP: Species = {
  id: 'sheep',
  label: 'Sheep',
  scale: 1.15,
  body: {
    radius: 0.15,
    length: 0.26,
    standH: 0.34,
    hipX: 0.078,
    hipFrontZ: 0.135,
    hipBackZ: -0.14,
    hipY: -0.05,
    upperLen: 0.12,
    lowerLen: 0.11,
    pawR: 0.04,
    haunches: false,
  },
  head: {
    radius: 0.092,
    squash: 0.95,
    narrow: 0.9,
    muzzle: 0.085,
    muzzleDrop: 0.03,
    muzzleWide: 1,
    muzzleR: 0.42,
    muzzleLight: false,
    neck: 0.03,
    cheeks: false,
    eye: 0.9,
    eyeSplay: 1.3,
  },
  ears: { shape: 'droop', size: 0.85, splay: 1.1 },
  tail: { shape: 'stub', segs: 1, len: 0.05, thick: 0.03, carriage: -0.4 },
  // The fleece is the whole silhouette: a small dark head and legs poking out
  // of a cloud. Without it a sheep is just a short goat.
  features: { whiskers: false, hooves: true, headgear: 'none', mane: false, wool: true },
  gait: { speed: 0.85, bob: 0.9 },
  voice: { from: 480, to: 400, duration: 0.6, formants: [800, 1900], rasp: 0.9, body: 0.25, repeats: 1, gap: 0 },
  diet: 'herbivore',
};

const DEER: Species = {
  id: 'deer',
  label: 'Deer',
  scale: 1.3,
  body: {
    radius: 0.115,
    length: 0.28,
    standH: 0.44,
    hipX: 0.072,
    hipFrontZ: 0.15,
    hipBackZ: -0.155,
    hipY: -0.05,
    // Fine legs, and more of them above the knee than below: the proportion
    // that makes a deer look like it could leave at any moment.
    upperLen: 0.19,
    lowerLen: 0.17,
    pawR: 0.032,
    haunches: false,
  },
  head: {
    radius: 0.088,
    squash: 0.9,
    narrow: 0.82,
    muzzle: 0.105,
    muzzleDrop: 0.028,
    muzzleWide: 0.8,
    muzzleR: 0.38,
    muzzleLight: false,
    neck: 0.1,
    cheeks: false,
    eye: 1.15,
    eyeSplay: 1.45,
  },
  ears: { shape: 'tall', size: 1.05, splay: 0.75 },
  tail: { shape: 'stub', segs: 1, len: 0.045, thick: 0.028, carriage: 0.25 },
  features: { whiskers: false, hooves: true, headgear: 'antlers', mane: false, wool: false },
  gait: { speed: 1.45, bob: 1.15 },
  voice: { from: 420, to: 300, duration: 0.28, formants: [700, 1600], rasp: 0.7, body: 0.3, repeats: 1, gap: 0 },
  diet: 'herbivore',
};

const BEAR: Species = {
  id: 'bear',
  label: 'Bear',
  scale: 1.55,
  body: {
    radius: 0.185,
    length: 0.3,
    // Heavy and low: short legs under a big barrel, which is why a bear looks
    // slow even standing still.
    standH: 0.33,
    hipX: 0.105,
    hipFrontZ: 0.15,
    hipBackZ: -0.155,
    hipY: -0.06,
    upperLen: 0.115,
    lowerLen: 0.105,
    pawR: 0.07,
    haunches: true,
  },
  head: {
    radius: 0.125,
    squash: 0.92,
    narrow: 1,
    muzzle: 0.1,
    muzzleDrop: 0.04,
    muzzleWide: 1.15,
    muzzleR: 0.5,
    muzzleLight: false,
    neck: 0.02,
    cheeks: false,
    eye: 0.7,
    eyeSplay: 1.05,
  },
  ears: { shape: 'round', size: 1.2, splay: 0.5 },
  tail: { shape: 'stub', segs: 1, len: 0.04, thick: 0.032, carriage: -0.2 },
  features: { whiskers: false, hooves: false, headgear: 'none', mane: false, wool: false },
  gait: { speed: 0.7, bob: 0.7 },
  voice: { from: 240, to: 110, duration: 0.75, formants: [340, 780], rasp: 0.85, body: 1, repeats: 1, gap: 0 },
  diet: 'omnivore',
};

export const SPECIES: Record<SpeciesId, Species> = {
  cat: CAT,
  dog: DOG,
  puppy: PUPPY,
  horse: HORSE,
  donkey: DONKEY,
  cow: COW,
  sheep: SHEEP,
  deer: DEER,
  bear: BEAR,
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

export function speciesFor(id: SpeciesId | undefined): Species {
  return SPECIES[id as SpeciesId] ?? CAT;
}
