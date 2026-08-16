/**
 * The pet: a quadruped assembled entirely from primitives and driven by a
 * hand-built hierarchical rig. No model file, no skinning — every part is a
 * Group whose rotation is written from a flat `Pose` bag each frame, which
 * makes blending between animations a plain numeric lerp.
 *
 * One rig serves every species. What changes between a cat and a dog is the
 * numbers in `species.ts` and a handful of silhouette choices — ear shape, tail
 * shape, headgear — chosen from a closed set. The joint hierarchy itself does
 * not change, which is precisely why one library of animations drives all of
 * them: a walk cycle is a pattern of hip, knee and ankle angles, and that
 * pattern is a property of having four legs rather than of being a cat.
 *
 * Facing convention: the animal looks down +Z. Steering rotates `root.rotation.y`.
 */
import * as THREE from 'three';
import { flat, outline, toon } from './toon';
import { speciesFor, type Species, type SpeciesId } from './species';

export const LEG_COUNT = 4;
/** Leg index order used everywhere: front-left, front-right, back-left, back-right. */
export const FL = 0;
export const FR = 1;
export const BL = 2;
export const BR = 3;

/**
 * Tail channels in a `Pose`, which is not the same as joints in a rig.
 *
 * Species have different numbers of tail joints — a dog has four, a stub-tailed
 * animal would have one — but the animations are written once, against a fixed
 * vocabulary. So the pose always carries five channels and a rig with fewer
 * joints simply reads the first few. Sizing the pose to the species instead
 * would mean every animation had to ask how long the tail was.
 */
export const TAIL_SEGS = 5;

// --- palette ----------------------------------------------------------------

export interface PetPalette {
  /** The coat. */
  coat: string;
  /** Shadow tint used on the underside and inner legs. */
  coatShade: string;
  /** Ears, paws, tail tip, head patch — this is what a shop skin recolours. */
  marking: string;
  markingDark: string;
  belly: string;
  /**
   * The muzzle, when the species wears a pale one.
   *
   * Separate from `belly` because they only look like the same colour on a
   * white cat. A cow wants a pink muzzle and a cream underside, and sharing one
   * value gave it a pink stomach.
   */
  muzzle?: string;
  eye: string;
  nose: string;
  line: string;
}

export const DEFAULT_PALETTE: PetPalette = {
  coat: '#ffffff',
  coatShade: '#e7e9f2',
  marking: '#f2a65a',
  markingDark: '#e8894a',
  belly: '#fdf6ee',
  eye: '#4fc3a1',
  nose: '#ff9db1',
  line: '#3a3350',
};

// --- pose -------------------------------------------------------------------

export interface Pose {
  /** Body height above the standing default, in world units. */
  lift: number;
  pitch: number;
  roll: number;
  /** Extra yaw on top of the steering yaw — used for looking around. */
  yaw: number;
  /** Sideways body arch, e.g. the Halloween-cat spook pose. */
  arch: number;
  /** Chest pitch relative to the hips. */
  spine: number;
  neck: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 0 = pricked up, 1 = flattened back (annoyed / sad / scared). */
  ear: number;
  earTwitch: number;
  /** 0 = shut, 1 = wide open. */
  eye: number;
  /** Happy `^ ^` squint, independent of blinking. */
  squint: number;
  mouth: number;
  /** Per-segment tail curl (+ lifts the tail over the back). */
  tail: number[];
  tailSway: number;
  /** Tail bottle-brush puff, 0..1. */
  tailPuff: number;
  hip: number[];
  knee: number[];
  ankle: number[];
  /** Torso z-scale — the long luxurious stretch after a nap. */
  stretch: number;
}

export function makePose(): Pose {
  return {
    lift: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    arch: 0,
    spine: 0,
    neck: 0,
    headPitch: 0,
    headYaw: 0,
    headRoll: 0,
    ear: 0,
    earTwitch: 0,
    eye: 1,
    squint: 0,
    mouth: 0,
    tail: [0, 0, 0, 0, 0],
    tailSway: 0,
    tailPuff: 0,
    hip: [0, 0, 0, 0],
    knee: [0, 0, 0, 0],
    ankle: [0, 0, 0, 0],
    stretch: 1,
  };
}

export function copyPose(src: Pose, dst: Pose): Pose {
  dst.lift = src.lift;
  dst.pitch = src.pitch;
  dst.roll = src.roll;
  dst.yaw = src.yaw;
  dst.arch = src.arch;
  dst.spine = src.spine;
  dst.neck = src.neck;
  dst.headPitch = src.headPitch;
  dst.headYaw = src.headYaw;
  dst.headRoll = src.headRoll;
  dst.ear = src.ear;
  dst.earTwitch = src.earTwitch;
  dst.eye = src.eye;
  dst.squint = src.squint;
  dst.mouth = src.mouth;
  dst.tailSway = src.tailSway;
  dst.tailPuff = src.tailPuff;
  dst.stretch = src.stretch;
  for (let i = 0; i < TAIL_SEGS; i++) dst.tail[i] = src.tail[i];
  for (let i = 0; i < LEG_COUNT; i++) {
    dst.hip[i] = src.hip[i];
    dst.knee[i] = src.knee[i];
    dst.ankle[i] = src.ankle[i];
  }
  return dst;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Blends `a` -> `b` by `t` into `out`. All channels are plain scalars. */
export function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  out.lift = lerp(a.lift, b.lift, t);
  out.pitch = lerp(a.pitch, b.pitch, t);
  out.roll = lerp(a.roll, b.roll, t);
  out.yaw = lerp(a.yaw, b.yaw, t);
  out.arch = lerp(a.arch, b.arch, t);
  out.spine = lerp(a.spine, b.spine, t);
  out.neck = lerp(a.neck, b.neck, t);
  out.headPitch = lerp(a.headPitch, b.headPitch, t);
  out.headYaw = lerp(a.headYaw, b.headYaw, t);
  out.headRoll = lerp(a.headRoll, b.headRoll, t);
  out.ear = lerp(a.ear, b.ear, t);
  out.earTwitch = lerp(a.earTwitch, b.earTwitch, t);
  out.eye = lerp(a.eye, b.eye, t);
  out.squint = lerp(a.squint, b.squint, t);
  out.mouth = lerp(a.mouth, b.mouth, t);
  out.tailSway = lerp(a.tailSway, b.tailSway, t);
  out.tailPuff = lerp(a.tailPuff, b.tailPuff, t);
  out.stretch = lerp(a.stretch, b.stretch, t);
  for (let i = 0; i < TAIL_SEGS; i++) out.tail[i] = lerp(a.tail[i], b.tail[i], t);
  for (let i = 0; i < LEG_COUNT; i++) {
    out.hip[i] = lerp(a.hip[i], b.hip[i], t);
    out.knee[i] = lerp(a.knee[i], b.knee[i], t);
    out.ankle[i] = lerp(a.ankle[i], b.ankle[i], t);
  }
  return out;
}

// --- rig --------------------------------------------------------------------

interface Leg {
  root: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
}

interface Eye {
  group: THREE.Group;
  open: THREE.Group;
  closed: THREE.Object3D;
  pupil: THREE.Object3D;
}

export interface PetRig {
  root: THREE.Group;
  /** Everything above the legs — the part that bobs and pitches. */
  body: THREE.Group;
  head: THREE.Group;
  /** Empty at the mouth; parent a prop here and the animal carries it. */
  carry: THREE.Object3D;
  /** Invisible capsule used for pointer picking. */
  hit: THREE.Mesh;
  /** World position of the head, refreshed by `apply`. */
  headWorld: THREE.Vector3;
  /** Which animal this rig is, so the engine knows when a rebuild is needed. */
  species: Species;
  apply(pose: Pose): void;
  setPalette(p: PetPalette): void;
  dispose(): void;
}

export function buildAnimal(speciesId: SpeciesId = 'cat', palette: PetPalette = DEFAULT_PALETTE): PetRig {
  const S = speciesFor(speciesId);
  const B = S.body;
  const H = S.head;

  const matCoat = toon(palette.coat, { steps: 3 });
  const matShade = toon(palette.coatShade, { steps: 3 });
  const matBelly = toon(palette.belly, { steps: 3 });
  const matMark = toon(palette.marking, { steps: 3 });
  const matMarkDark = toon(palette.markingDark, { steps: 3 });
  const matMuzzle = toon(palette.muzzle ?? palette.belly, { steps: 3 });
  const matNose = toon(palette.nose, { steps: 2 });
  const matIris = flat(palette.eye);
  const matDark = flat('#241f33');
  const matWhite = flat('#ffffff');
  const matLine = flat(palette.line);

  const owned: THREE.BufferGeometry[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T): T => {
    owned.push(g);
    return g;
  };

  /** Mesh helper that shares one of the palette materials and adds an outline. */
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, thickness = 0.9): THREE.Mesh => {
    const m = new THREE.Mesh(keep(geo), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    if (thickness > 0) outline(m, thickness, palette.line);
    return m;
  };

  const root = new THREE.Group();
  root.name = 'pet';

  const body = new THREE.Group();
  body.position.y = B.standH;
  root.add(body);

  // --- torso ---------------------------------------------------------------
  const torsoScale = new THREE.Group(); // isolated so `stretch` doesn't scale children
  body.add(torsoScale);

  const torso = part(new THREE.CapsuleGeometry(B.radius, B.length, 6, 20), matCoat);
  torso.rotation.x = Math.PI / 2; // capsule runs along Y by default; lay it along Z
  torso.scale.set(1, 1, 0.92);
  torsoScale.add(torso);

  // Belly panel: a slightly smaller capsule pushed down and forward.
  const belly = part(new THREE.CapsuleGeometry(B.radius * 0.82, B.length * 0.9, 5, 16), matBelly, 0);
  belly.rotation.x = Math.PI / 2;
  belly.position.y = -0.045;
  belly.castShadow = false;
  torsoScale.add(belly);

  // Fleece: clumps over the torso, which is the whole read of a sheep at this
  // size — the silhouette does more than any amount of surface texture.
  if (S.features.wool) {
    const woolRand = [0.1, 0.63, 0.29, 0.86, 0.44, 0.71, 0.17, 0.95, 0.37, 0.52, 0.78, 0.24];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = woolRand[i];
      const puff = part(new THREE.SphereGeometry(B.radius * (0.42 + r * 0.2), 8, 7), matCoat, 0.5);
      puff.position.set(
        Math.cos(a) * B.radius * 0.82,
        Math.sin(a) * B.radius * 0.7 + 0.01,
        (r - 0.5) * B.length * 1.5,
      );
      torsoScale.add(puff);
    }
  }

  // Haunch bulges give a cat or a dog its silhouette; hoofed animals read
  // flatter over the rump, so they opt out rather than being given smaller ones.
  if (B.haunches) {
    for (const sx of [-1, 1]) {
      const haunch = part(new THREE.SphereGeometry(B.radius * 0.8, 14, 12), matCoat, 0.8);
      haunch.position.set(sx * 0.055, -0.012, B.hipBackZ + 0.015);
      haunch.scale.set(0.9, 1, 1.05);
      body.add(haunch);
    }
  }

  // --- neck + head ---------------------------------------------------------
  const chest = new THREE.Group();
  chest.position.set(0, 0.02, B.hipFrontZ - 0.01);
  body.add(chest);

  const neck = new THREE.Group();
  neck.position.set(0, 0.055, 0.055);
  chest.add(neck);

  // A long neck is a column, not a gap: without geometry between chest and
  // skull, a horse's head floats.
  if (H.neck > 0.004) {
    const column = part(new THREE.CapsuleGeometry(B.radius * 0.42, H.neck, 5, 12), matCoat, 0.8);
    column.position.set(0, H.neck * 0.5, H.neck * 0.34);
    column.rotation.x = 0.4;
    neck.add(column);

    if (S.features.mane) {
      const crest = part(new THREE.BoxGeometry(0.018, H.neck * 1.15, B.radius * 0.5), matMarkDark, 0.5);
      crest.position.set(0, H.neck * 0.55, H.neck * 0.1);
      crest.rotation.x = 0.4;
      neck.add(crest);
    }
  }

  const head = new THREE.Group();
  head.position.set(0, 0.055 + H.neck * 0.9, 0.045 + H.neck * 0.5);
  neck.add(head);

  /**
   * Facial features scale with the skull, not with the world.
   *
   * Everything on the face below was authored against the cat's 0.128 head, in
   * absolute units. That is invisible until a species has a smaller head: the
   * horse's eyes stayed the same size while its skull shrank by a fifth, and it
   * came out looking like an alpaca. The bear, whose head is almost exactly the
   * cat's, looked right — which is how the cause was found.
   */
  const hk = H.radius / 0.128;

  const skull = part(new THREE.SphereGeometry(H.radius, 20, 16), matCoat);
  skull.scale.set(H.narrow, H.squash, 0.92);
  head.add(skull);

  // Cheek floof — two spheres that widen the face into the anime shape. A long
  // muzzle and round cheeks fight each other, so species with one skip the other.
  if (H.cheeks) {
    for (const sx of [-1, 1]) {
      const cheek = part(new THREE.SphereGeometry(H.radius * 0.48, 12, 10), matCoat, 0.7);
      cheek.position.set(sx * H.radius * 0.66, -0.03, 0.045);
      head.add(cheek);
    }
  }

  /**
   * The muzzle, as a snout growing out of the skull rather than a ball in front
   * of it.
   *
   * A sphere placed at the muzzle distance works while that distance is inside
   * the skull — a cat's nose pad. Push it out to a horse's length and it
   * detaches: a pale ball hovering a centimetre off the face, which is exactly
   * how the horse looked. A capsule spanning from inside the skull to the tip
   * stays connected at any length.
   *
   * `snout` is how much of that length is *beyond* the skull, so a short-faced
   * animal gets a capsule with almost no barrel and is a sphere again. The cat's
   * comes out at 0.009 — visually the shape it always had.
   */
  const snout = Math.max(0, H.muzzle - H.radius * 0.62);
  const muzzlePivot = new THREE.Group();
  muzzlePivot.position.set(0, -H.muzzleDrop, H.radius * 0.62 + snout / 2);
  muzzlePivot.scale.set(H.muzzleWide, 0.82, 1);
  head.add(muzzlePivot);

  const muzzle = part(
    new THREE.CapsuleGeometry(H.radius * H.muzzleR, snout, 6, 14),
    H.muzzleLight ? matMuzzle : matCoat,
    0.7,
  );
  muzzle.rotation.x = Math.PI / 2; // capsules run along Y; lay it along Z
  muzzlePivot.add(muzzle);

  const nose = part(new THREE.ConeGeometry(0.019 * hk, 0.02 * hk, 3), matNose, 0.5);
  nose.rotation.set(Math.PI / 2, 0, Math.PI);
  nose.position.set(0, -H.muzzleDrop + 0.02 * hk, H.muzzle + H.radius * 0.32);
  head.add(nose);

  // A head patch in the marking colour, so shop skins read at a glance.
  const patch = part(new THREE.SphereGeometry(H.radius * 0.99, 16, 14), matMark, 0);
  patch.scale.set(0.72, 0.5, 0.62);
  patch.position.set(0, 0.062, -0.018);
  patch.castShadow = false;
  head.add(patch);

  // --- headgear ------------------------------------------------------------
  if (S.features.headgear !== 'none') {
    for (const sx of [-1, 1]) {
      // Mounted on the crown, not inside it: the first pass put the base below
      // the top of the skull and the horns were swallowed by the head patch.
      const mount = new THREE.Group();
      mount.position.set(sx * H.radius * 0.42 * H.narrow, H.radius * H.squash * 0.88, -0.012);
      head.add(mount);

      if (S.features.headgear === 'horns') {
        // A curved horn, as three shortening segments rather than one cone —
        // a straight spike reads as a party hat.
        let parent: THREE.Object3D = mount;
        for (let i = 0; i < 3; i++) {
          const seg = new THREE.Group();
          seg.position.y = i === 0 ? 0 : 0.032 * hk;
          seg.rotation.z = sx * (i === 0 ? 0.5 : 0.34);
          parent.add(seg);
          const geo = new THREE.ConeGeometry((0.019 - i * 0.005) * hk, 0.038 * hk, 6);
          const mesh = part(geo, matMarkDark, 0.5);
          mesh.position.y = 0.019 * hk;
          seg.add(mesh);
          parent = seg;
        }
      } else {
        // Antlers: a beam with two tines, which is enough to read as a deer.
        const beam = part(new THREE.CylinderGeometry(0.008 * hk, 0.011 * hk, 0.11 * hk, 6), matMarkDark, 0.5);
        beam.position.y = 0.055 * hk;
        beam.rotation.z = sx * 0.32;
        mount.add(beam);
        for (const [ty, tr] of [
          [0.05, 0.8],
          [0.09, 0.6],
        ] as const) {
          const tine = part(new THREE.CylinderGeometry(0.005 * hk, 0.007 * hk, 0.05 * hk, 5), matMarkDark, 0.4);
          tine.position.set(sx * 0.026 * hk, ty * hk, 0);
          tine.rotation.z = sx * tr;
          mount.add(tine);
        }
      }
    }
  }

  // --- ears ----------------------------------------------------------------
  //
  // A hanging ear mounts lower and tilts only slightly outward. The first pass
  // gave it the same high mount as a pricked ear plus a large outward rotation,
  // and the flaps stuck out horizontally like wings — a hanging ear is defined
  // by falling *along* the side of the head, not away from it.
  const droopEars = S.ears.shape === 'droop';
  const earRest = S.ears.splay + (droopEars ? 0.25 : 0);
  const ears: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(sx * H.radius * (droopEars ? 0.62 : 0.56), H.radius * (droopEars ? 0.42 : 0.77), -0.008);
    ear.rotation.z = sx * earRest;
    head.add(ear);
    ears.push(ear);

    // Ears scale with the skull too, for the same reason the eyes do.
    const k = S.ears.size * hk;
    switch (S.ears.shape) {
      case 'droop': {
        // Hanging flaps, mounted at the side of the head and falling past the
        // jaw. Wider than they are deep, so they read as flaps from the front
        // and as blades from the side rather than as sausages from both.
        const flap = part(new THREE.CapsuleGeometry(0.032 * k, 0.11 * k, 5, 10), matCoat, 0.7);
        flap.position.y = -0.062 * k;
        flap.scale.set(0.85, 1, 0.5);
        ear.add(flap);
        const innerFlap = part(new THREE.CapsuleGeometry(0.019 * k, 0.075 * k, 4, 8), matMarkDark, 0);
        innerFlap.position.set(0, -0.058 * k, 0.013);
        innerFlap.scale.set(0.8, 1, 0.35);
        innerFlap.castShadow = false;
        ear.add(innerFlap);
        break;
      }
      case 'round': {
        const disc = part(new THREE.SphereGeometry(0.046 * k, 12, 10), matCoat, 0.8);
        disc.position.y = 0.03 * k;
        disc.scale.set(1, 1, 0.5);
        ear.add(disc);
        const innerDisc = part(new THREE.SphereGeometry(0.028 * k, 10, 8), matMark, 0);
        innerDisc.position.set(0, 0.03 * k, 0.016);
        innerDisc.scale.set(1, 1, 0.4);
        innerDisc.castShadow = false;
        ear.add(innerDisc);
        break;
      }
      case 'tall': {
        const shell = part(new THREE.ConeGeometry(0.042 * k, 0.16 * k, 5), matCoat, 0.8);
        shell.position.y = 0.078 * k;
        shell.scale.z = 0.6;
        ear.add(shell);
        // Kept small and pushed forward: a full-height dark inner cone swamped
        // the coat-coloured shell and the ears read as a pair of horns.
        const inner = part(new THREE.ConeGeometry(0.019 * k, 0.085 * k, 5), matMark, 0);
        inner.position.set(0, 0.056 * k, 0.016 * k);
        inner.scale.z = 0.45;
        inner.castShadow = false;
        ear.add(inner);
        break;
      }
      default: {
        const shell = part(new THREE.ConeGeometry(0.052 * k, 0.105 * k, 4), matCoat, 0.8);
        shell.position.y = 0.05 * k;
        shell.rotation.y = Math.PI / 4;
        ear.add(shell);
        const inner = part(new THREE.ConeGeometry(0.033 * k, 0.072 * k, 4), matMark, 0);
        inner.position.set(0, 0.046 * k, 0.018);
        inner.rotation.y = Math.PI / 4;
        inner.castShadow = false;
        ear.add(inner);
      }
    }
  }

  // --- eyes ----------------------------------------------------------------
  const eyes: Eye[] = [];
  const eyeK = H.eye * hk;
  for (const sx of [-1, 1]) {
    const group = new THREE.Group();
    /**
     * Lateral eyes are a rotation, not an offset.
     *
     * Sliding a forward-facing eye sideways gives you a forward-facing eye in
     * the wrong place. A prey animal's eye sits on the *side* of the skull
     * looking outward, so the whole group swings round and back along the
     * muzzle as `eyeSplay` rises. At 1 these expressions reduce exactly to the
     * cat's original numbers, which is what keeps it the control.
     */
    group.position.set(
      sx * H.radius * 0.45 * H.eyeSplay,
      0.012 * hk,
      H.radius * 0.73 - (H.eyeSplay - 1) * H.radius * 1.1,
    );
    group.rotation.y = sx * (0.22 + (H.eyeSplay - 1) * 1.6);
    head.add(group);

    const open = new THREE.Group();
    group.add(open);

    // Big almond eye: dark backing, coloured iris, pupil, two glints.
    const backing = new THREE.Mesh(keep(new THREE.SphereGeometry(0.045 * eyeK, 14, 12)), matDark);
    backing.scale.set(0.82, 1, 0.5);
    open.add(backing);

    const iris = new THREE.Mesh(keep(new THREE.SphereGeometry(0.036 * eyeK, 14, 12)), matIris);
    iris.scale.set(0.82, 1, 0.42);
    iris.position.z = 0.014;
    open.add(iris);

    const pupil = new THREE.Mesh(keep(new THREE.SphereGeometry(0.022 * eyeK, 10, 10)), matDark);
    pupil.scale.set(0.42, 1.05, 0.4);
    pupil.position.z = 0.026;
    open.add(pupil);

    const glint = new THREE.Mesh(keep(new THREE.SphereGeometry(0.013 * eyeK, 8, 8)), matWhite);
    glint.position.set(sx * -0.012 * eyeK, 0.018 * eyeK, 0.033 * eyeK);
    glint.scale.z = 0.5;
    open.add(glint);

    const glint2 = new THREE.Mesh(keep(new THREE.SphereGeometry(0.0065 * eyeK, 8, 8)), matWhite);
    glint2.position.set(sx * 0.014 * eyeK, -0.016 * eyeK, 0.031 * eyeK);
    glint2.scale.z = 0.5;
    open.add(glint2);

    // The `⌒` closed eye — the anime shorthand for content or asleep.
    const closed = new THREE.Mesh(keep(new THREE.TorusGeometry(0.036 * eyeK, 0.0075 * hk, 5, 12, Math.PI)), matLine);
    closed.position.z = 0.03 * eyeK;
    closed.visible = false;
    group.add(closed);

    eyes.push({ group, open, closed, pupil });
  }

  // --- mouth ---------------------------------------------------------------
  const mouthY = -H.muzzleDrop - 0.01;
  const mouthZ = H.muzzle + H.radius * 0.23;

  const mouthClosed = new THREE.Group();
  mouthClosed.position.set(0, mouthY, mouthZ);
  head.add(mouthClosed);
  for (const sx of [-1, 1]) {
    // Two mirrored arcs make the classic `ω` mouth.
    const arc = new THREE.Mesh(keep(new THREE.TorusGeometry(0.016 * hk, 0.005 * hk, 5, 10, Math.PI)), matLine);
    arc.position.x = sx * 0.016 * hk;
    arc.rotation.z = Math.PI;
    mouthClosed.add(arc);
  }

  const mouthOpen = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03 * hk, 12, 10)), matDark);
  mouthOpen.position.set(0, mouthY - 0.006 * hk, mouthZ - 0.01 * hk);
  mouthOpen.scale.set(0.9, 0.1, 0.5);
  head.add(mouthOpen);

  // --- whiskers ------------------------------------------------------------
  let whiskers: THREE.LineSegments | null = null;
  if (S.features.whiskers) {
    const whiskerPts: number[] = [];
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const y = (-0.028 + i * 0.017) * hk;
        const spread = (0.16 + i * 0.012) * hk;
        const droop = (0.02 - i * 0.018) * hk;
        whiskerPts.push(sx * 0.045 * hk, y, 0.1 * hk, sx * spread, y + droop, 0.055 * hk);
      }
    }
    const whiskerGeo = keep(new THREE.BufferGeometry());
    whiskerGeo.setAttribute('position', new THREE.Float32BufferAttribute(whiskerPts, 3));
    whiskers = new THREE.LineSegments(
      whiskerGeo,
      new THREE.LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.75 }),
    );
    head.add(whiskers);
  }

  const carry = new THREE.Object3D();
  carry.position.set(0, mouthY - 0.008, mouthZ + 0.05);
  head.add(carry);

  // --- legs ----------------------------------------------------------------
  const legs: Leg[] = [];
  const legSpec: [number, number][] = [
    [-B.hipX, B.hipFrontZ],
    [B.hipX, B.hipFrontZ],
    [-B.hipX - 0.012, B.hipBackZ],
    [B.hipX + 0.012, B.hipBackZ],
  ];

  for (let i = 0; i < LEG_COUNT; i++) {
    const [x, z] = legSpec[i];
    const legRoot = new THREE.Group();
    legRoot.position.set(x, B.hipY, z);
    body.add(legRoot);

    const upper = part(new THREE.CapsuleGeometry(0.042, B.upperLen - 0.03, 4, 10), matCoat, 0.7);
    upper.position.y = -B.upperLen / 2;
    legRoot.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -B.upperLen;
    legRoot.add(knee);

    const lower = part(new THREE.CapsuleGeometry(0.034, B.lowerLen - 0.03, 4, 10), matCoat, 0.7);
    lower.position.y = -B.lowerLen / 2;
    knee.add(lower);

    const ankle = new THREE.Group();
    ankle.position.y = -B.lowerLen;
    knee.add(ankle);

    if (S.features.hooves) {
      // A hoof is hard and cut off flat, so it is a short cylinder rather than
      // the squashed sphere a soft paw uses.
      const hoof = part(new THREE.CylinderGeometry(B.pawR * 0.62, B.pawR * 0.7, B.pawR * 0.9, 8), matMarkDark, 0.7);
      hoof.position.set(0, -B.pawR * 0.4, 0.004);
      ankle.add(hoof);
    } else {
      // Marking-coloured socks — the second place a shop skin shows up.
      const paw = part(new THREE.SphereGeometry(B.pawR, 12, 10), matMarkDark, 0.7);
      paw.scale.set(0.85, 0.62, 1.15);
      paw.position.set(0, -0.012, 0.014);
      ankle.add(paw);
    }

    legs.push({ root: legRoot, knee, ankle });
  }

  // --- tail ----------------------------------------------------------------
  const tailJoints: THREE.Group[] = [];
  const tailMeshes: THREE.Mesh[] = [];
  const segs = Math.min(TAIL_SEGS, S.tail.segs);
  let tailParent: THREE.Object3D = body;
  for (let i = 0; i < segs; i++) {
    const joint = new THREE.Group();
    joint.position.set(0, i === 0 ? 0.04 : 0, i === 0 ? B.hipBackZ - 0.06 : -S.tail.len);
    // Rest carriage, applied once at build: a dog's tail is up by default and a
    // cat's is level, and the pose channels then work from there.
    joint.rotation.x = S.tail.carriage;
    tailParent.add(joint);
    tailJoints.push(joint);

    const last = i === segs - 1;
    const r = S.tail.thick - i * (S.tail.thick * 0.12);
    // The last segment wears the marking colour: a dipped tail tip.
    const mat = last ? matMark : matCoat;
    const seg = part(new THREE.CapsuleGeometry(r, S.tail.len - r, 4, 10), mat, 0.7);
    seg.rotation.x = Math.PI / 2;
    seg.position.z = -S.tail.len / 2;
    joint.add(seg);
    tailMeshes.push(seg);

    if (last && S.tail.shape === 'tuft') {
      const tuft = part(new THREE.SphereGeometry(S.tail.thick * 1.7, 10, 8), matMarkDark, 0.6);
      tuft.position.z = -S.tail.len;
      joint.add(tuft);
    }
    if (last && S.tail.shape === 'plume') {
      // A fanned brush: three flattened lobes rather than one, so the tail
      // silhouette breaks up instead of ending in a bead.
      for (const [ox, oy] of [
        [0, 0.014],
        [-0.012, -0.006],
        [0.012, -0.006],
      ] as const) {
        const lobe = part(new THREE.SphereGeometry(S.tail.thick * 1.25, 8, 7), matCoat, 0.5);
        lobe.position.set(ox, oy, -S.tail.len * 0.85);
        lobe.scale.set(0.8, 1, 1.6);
        joint.add(lobe);
      }
    }

    tailParent = joint;
  }

  // --- pointer pick proxy --------------------------------------------------
  const hit = new THREE.Mesh(
    keep(new THREE.CapsuleGeometry(0.24, 0.34, 4, 10)),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.rotation.x = Math.PI / 2;
  hit.position.set(0, B.standH, 0.02);
  hit.name = 'pet-hit';
  root.add(hit);

  // --- pose application ----------------------------------------------------
  const headWorld = new THREE.Vector3();

  const apply = (p: Pose): void => {
    body.position.y = B.standH + p.lift;
    body.rotation.set(p.pitch, p.yaw, p.roll + p.arch);
    torsoScale.scale.z = p.stretch;

    chest.rotation.x = p.spine;
    neck.rotation.x = p.neck;
    head.rotation.set(p.headPitch, p.headYaw, p.headRoll);

    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      // Ears rotate back and splay outward as `ear` rises toward 1. A hanging
      // ear has nowhere further to fall, so on those the same channel swings
      // them back along the skull instead of down.
      ears[i].rotation.x = p.ear * (droopEars ? 0.7 : 1.15);
      ears[i].rotation.z = sx * (earRest + p.ear * (droopEars ? 0.25 : 0.5)) + (i === 0 ? p.earTwitch : -p.earTwitch);
    }

    const lidOpen = Math.max(0, p.eye - p.squint);
    const showClosed = lidOpen < 0.16;
    for (const e of eyes) {
      e.open.visible = !showClosed;
      e.closed.visible = showClosed;
      e.open.scale.y = Math.max(0.02, lidOpen);
      e.closed.scale.set(1, 0.85 + p.squint * 0.3, 1);
    }

    mouthOpen.scale.y = 0.1 + p.mouth * 1.5;
    mouthOpen.scale.x = 0.9 + p.mouth * 0.25;
    mouthOpen.visible = p.mouth > 0.04;
    mouthClosed.visible = p.mouth <= 0.04;

    for (let i = 0; i < segs; i++) {
      const j = tailJoints[i];
      j.rotation.x = S.tail.carriage + p.tail[i];
      // Sway accumulates down the chain so the tip travels furthest.
      j.rotation.y = p.tailSway * (0.35 + i * 0.22);
      const puff = 1 + p.tailPuff * (0.6 + i * 0.35);
      tailMeshes[i].scale.set(puff, 1, puff);
    }

    for (let i = 0; i < LEG_COUNT; i++) {
      legs[i].root.rotation.x = p.hip[i];
      legs[i].knee.rotation.x = p.knee[i];
      legs[i].ankle.rotation.x = p.ankle[i];
    }

    head.getWorldPosition(headWorld);
  };

  apply(makePose());

  // --- skin swapping -------------------------------------------------------
  const setPalette = (next: PetPalette): void => {
    matCoat.color.set(next.coat);
    matShade.color.set(next.coatShade);
    matBelly.color.set(next.belly);
    matMuzzle.color.set(next.muzzle ?? next.belly);
    matMark.color.set(next.marking);
    matMarkDark.color.set(next.markingDark);
    matNose.color.set(next.nose);
    matIris.color.set(next.eye);
    matLine.color.set(next.line);
    if (whiskers) (whiskers.material as THREE.LineBasicMaterial).color.set(next.line);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.userData.isOutline) return;
      const mat = mesh.material as THREE.ShaderMaterial;
      (mat.uniforms.lineColor.value as THREE.Color).set(next.line);
    });
  };

  const dispose = (): void => {
    owned.forEach((g) => g.dispose());
    [matCoat, matShade, matBelly, matMuzzle, matMark, matMarkDark, matNose, matIris, matDark, matWhite, matLine].forEach((m) =>
      m.dispose(),
    );
    if (whiskers) (whiskers.material as THREE.Material).dispose();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.userData.isOutline) (mesh.material as THREE.Material).dispose();
    });
  };

  return { root, body, head, carry, hit, headWorld, species: S, apply, setPalette, dispose };
}
