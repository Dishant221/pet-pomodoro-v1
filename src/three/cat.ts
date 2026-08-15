/**
 * The cat: a white anime cat assembled entirely from primitives and driven by a
 * hand-built hierarchical rig. No model file, no skinning — every part is a
 * Group whose rotation is written from a flat `Pose` bag each frame, which
 * makes blending between animations a plain numeric lerp.
 *
 * Facing convention: the cat looks down +Z. Steering rotates `root.rotation.y`.
 */
import * as THREE from 'three';
import { flat, outline, toon } from './toon';

// --- proportions ------------------------------------------------------------
// Tuned so the cat is roughly 0.6 units long and 0.36 tall at the shoulder.

const BODY_R = 0.135;
const BODY_LEN = 0.26;
const STAND_H = 0.335;

const HIP_FRONT_Z = 0.145;
const HIP_BACK_Z = -0.15;
const HIP_X = 0.082;
const HIP_Y = -0.055;

const UPPER_LEN = 0.125;
const LOWER_LEN = 0.115;
const PAW_R = 0.05;

const HEAD_R = 0.128;
const TAIL_SEGS = 5;
const TAIL_LEN = 0.085;

export const LEG_COUNT = 4;
/** Leg index order used everywhere: front-left, front-right, back-left, back-right. */
export const FL = 0;
export const FR = 1;
export const BL = 2;
export const BR = 3;

// --- palette ----------------------------------------------------------------

export interface CatPalette {
  /** The coat. Always a white or near-white — this is a white cat. */
  coat: string;
  /** Shadow tint used on the underside and inner legs. */
  coatShade: string;
  /** Ears, paws, tail tip, head patch — this is what a shop skin recolours. */
  marking: string;
  markingDark: string;
  belly: string;
  eye: string;
  nose: string;
  line: string;
}

export const DEFAULT_PALETTE: CatPalette = {
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

export interface CatRig {
  root: THREE.Group;
  /** Everything above the legs — the part that bobs and pitches. */
  body: THREE.Group;
  head: THREE.Group;
  /** Empty at the mouth; parent a prop here and the cat carries it. */
  carry: THREE.Object3D;
  /** Invisible capsule used for pointer picking. */
  hit: THREE.Mesh;
  /** World position of the head, refreshed by `apply`. */
  headWorld: THREE.Vector3;
  apply(pose: Pose): void;
  setPalette(p: CatPalette): void;
  dispose(): void;
}

export function buildCat(palette: CatPalette = DEFAULT_PALETTE): CatRig {
  const matCoat = toon(palette.coat, { steps: 3 });
  const matShade = toon(palette.coatShade, { steps: 3 });
  const matBelly = toon(palette.belly, { steps: 3 });
  const matMark = toon(palette.marking, { steps: 3 });
  const matMarkDark = toon(palette.markingDark, { steps: 3 });
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
  root.name = 'cat';

  const body = new THREE.Group();
  body.position.y = STAND_H;
  root.add(body);

  // --- torso ---------------------------------------------------------------
  const torsoScale = new THREE.Group(); // isolated so `stretch` doesn't scale children
  body.add(torsoScale);

  const torso = part(new THREE.CapsuleGeometry(BODY_R, BODY_LEN, 6, 20), matCoat);
  torso.rotation.x = Math.PI / 2; // capsule runs along Y by default; lay it along Z
  torso.scale.set(1, 1, 0.92);
  torsoScale.add(torso);

  // Belly panel: a slightly smaller capsule pushed down and forward.
  const belly = part(new THREE.CapsuleGeometry(BODY_R * 0.82, BODY_LEN * 0.9, 5, 16), matBelly, 0);
  belly.rotation.x = Math.PI / 2;
  belly.position.y = -0.045;
  belly.castShadow = false;
  torsoScale.add(belly);

  // Haunch bulges give the silhouette its cat-ness.
  for (const sx of [-1, 1]) {
    const haunch = part(new THREE.SphereGeometry(0.108, 14, 12), matCoat, 0.8);
    haunch.position.set(sx * 0.055, -0.012, HIP_BACK_Z + 0.015);
    haunch.scale.set(0.9, 1, 1.05);
    body.add(haunch);
  }

  // --- neck + head ---------------------------------------------------------
  const chest = new THREE.Group();
  chest.position.set(0, 0.02, HIP_FRONT_Z - 0.01);
  body.add(chest);

  const neck = new THREE.Group();
  neck.position.set(0, 0.055, 0.055);
  chest.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.055, 0.045);
  neck.add(head);

  const skull = part(new THREE.SphereGeometry(HEAD_R, 20, 16), matCoat);
  skull.scale.set(1, 0.95, 0.92);
  head.add(skull);

  // Cheek floof — two spheres that widen the face into the anime shape.
  for (const sx of [-1, 1]) {
    const cheek = part(new THREE.SphereGeometry(0.062, 12, 10), matCoat, 0.7);
    cheek.position.set(sx * 0.085, -0.03, 0.045);
    head.add(cheek);
  }

  const muzzle = part(new THREE.SphereGeometry(0.062, 14, 12), matBelly, 0.7);
  muzzle.position.set(0, -0.042, 0.088);
  muzzle.scale.set(1.25, 0.8, 0.85);
  head.add(muzzle);

  const nose = part(new THREE.ConeGeometry(0.019, 0.02, 3), matNose, 0.5);
  nose.rotation.set(Math.PI / 2, 0, Math.PI);
  nose.position.set(0, -0.022, 0.128);
  head.add(nose);

  // A head patch in the marking colour, so shop skins read at a glance.
  const patch = part(new THREE.SphereGeometry(HEAD_R * 0.99, 16, 14), matMark, 0);
  patch.scale.set(0.72, 0.5, 0.62);
  patch.position.set(0, 0.062, -0.018);
  patch.castShadow = false;
  head.add(patch);

  // --- ears ----------------------------------------------------------------
  const ears: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(sx * 0.072, 0.098, -0.008);
    ear.rotation.z = sx * 0.26;
    head.add(ear);
    ears.push(ear);

    const shell = part(new THREE.ConeGeometry(0.052, 0.105, 4), matCoat, 0.8);
    shell.position.y = 0.05;
    shell.rotation.y = Math.PI / 4;
    ear.add(shell);

    const inner = part(new THREE.ConeGeometry(0.033, 0.072, 4), matMark, 0);
    inner.position.set(0, 0.046, 0.018);
    inner.rotation.y = Math.PI / 4;
    inner.castShadow = false;
    ear.add(inner);
  }

  // --- eyes ----------------------------------------------------------------
  const eyes: Eye[] = [];
  for (const sx of [-1, 1]) {
    const group = new THREE.Group();
    group.position.set(sx * 0.058, 0.012, 0.093);
    group.rotation.y = sx * 0.22;
    head.add(group);

    const open = new THREE.Group();
    group.add(open);

    // Big almond eye: dark backing, coloured iris, slit pupil, two glints.
    const backing = new THREE.Mesh(keep(new THREE.SphereGeometry(0.045, 14, 12)), matDark);
    backing.scale.set(0.82, 1, 0.5);
    open.add(backing);

    const iris = new THREE.Mesh(keep(new THREE.SphereGeometry(0.036, 14, 12)), matIris);
    iris.scale.set(0.82, 1, 0.42);
    iris.position.z = 0.014;
    open.add(iris);

    const pupil = new THREE.Mesh(keep(new THREE.SphereGeometry(0.022, 10, 10)), matDark);
    pupil.scale.set(0.42, 1.05, 0.4);
    pupil.position.z = 0.026;
    open.add(pupil);

    const glint = new THREE.Mesh(keep(new THREE.SphereGeometry(0.013, 8, 8)), matWhite);
    glint.position.set(sx * -0.012, 0.018, 0.033);
    glint.scale.z = 0.5;
    open.add(glint);

    const glint2 = new THREE.Mesh(keep(new THREE.SphereGeometry(0.0065, 8, 8)), matWhite);
    glint2.position.set(sx * 0.014, -0.016, 0.031);
    glint2.scale.z = 0.5;
    open.add(glint2);

    // The `⌒` closed eye — the anime shorthand for content or asleep.
    const closed = new THREE.Mesh(keep(new THREE.TorusGeometry(0.036, 0.0075, 5, 12, Math.PI)), matLine);
    closed.position.z = 0.03;
    closed.visible = false;
    group.add(closed);

    eyes.push({ group, open, closed, pupil });
  }

  // --- mouth ---------------------------------------------------------------
  const mouthClosed = new THREE.Group();
  mouthClosed.position.set(0, -0.052, 0.118);
  head.add(mouthClosed);
  for (const sx of [-1, 1]) {
    // Two mirrored arcs make the classic `ω` cat mouth.
    const arc = new THREE.Mesh(keep(new THREE.TorusGeometry(0.016, 0.005, 5, 10, Math.PI)), matLine);
    arc.position.x = sx * 0.016;
    arc.rotation.z = Math.PI;
    mouthClosed.add(arc);
  }

  const mouthOpen = new THREE.Mesh(keep(new THREE.SphereGeometry(0.03, 12, 10)), matDark);
  mouthOpen.position.set(0, -0.058, 0.108);
  mouthOpen.scale.set(0.9, 0.1, 0.5);
  head.add(mouthOpen);

  // --- whiskers ------------------------------------------------------------
  const whiskerPts: number[] = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y = -0.028 + i * 0.017;
      const spread = 0.16 + i * 0.012;
      const droop = 0.02 - i * 0.018;
      whiskerPts.push(sx * 0.045, y, 0.1, sx * spread, y + droop, 0.055);
    }
  }
  const whiskerGeo = keep(new THREE.BufferGeometry());
  whiskerGeo.setAttribute('position', new THREE.Float32BufferAttribute(whiskerPts, 3));
  const whiskers = new THREE.LineSegments(
    whiskerGeo,
    new THREE.LineBasicMaterial({ color: palette.line, transparent: true, opacity: 0.75 }),
  );
  head.add(whiskers);

  const carry = new THREE.Object3D();
  carry.position.set(0, -0.06, 0.17);
  head.add(carry);

  // --- legs ----------------------------------------------------------------
  const legs: Leg[] = [];
  const legSpec: [number, number][] = [
    [-HIP_X, HIP_FRONT_Z],
    [HIP_X, HIP_FRONT_Z],
    [-HIP_X - 0.012, HIP_BACK_Z],
    [HIP_X + 0.012, HIP_BACK_Z],
  ];

  for (let i = 0; i < LEG_COUNT; i++) {
    const [x, z] = legSpec[i];
    const legRoot = new THREE.Group();
    legRoot.position.set(x, HIP_Y, z);
    body.add(legRoot);

    const upper = part(new THREE.CapsuleGeometry(0.042, UPPER_LEN - 0.03, 4, 10), matCoat, 0.7);
    upper.position.y = -UPPER_LEN / 2;
    legRoot.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -UPPER_LEN;
    legRoot.add(knee);

    const lower = part(new THREE.CapsuleGeometry(0.034, LOWER_LEN - 0.03, 4, 10), matCoat, 0.7);
    lower.position.y = -LOWER_LEN / 2;
    knee.add(lower);

    const ankle = new THREE.Group();
    ankle.position.y = -LOWER_LEN;
    knee.add(ankle);

    // Marking-coloured socks — the second place a shop skin shows up.
    const paw = part(new THREE.SphereGeometry(PAW_R, 12, 10), matMarkDark, 0.7);
    paw.scale.set(0.85, 0.62, 1.15);
    paw.position.set(0, -0.012, 0.014);
    ankle.add(paw);

    legs.push({ root: legRoot, knee, ankle });
  }

  // --- tail ----------------------------------------------------------------
  const tailJoints: THREE.Group[] = [];
  const tailMeshes: THREE.Mesh[] = [];
  let tailParent: THREE.Object3D = body;
  for (let i = 0; i < TAIL_SEGS; i++) {
    const joint = new THREE.Group();
    joint.position.set(0, i === 0 ? 0.04 : 0, i === 0 ? HIP_BACK_Z - 0.06 : -TAIL_LEN);
    tailParent.add(joint);
    tailJoints.push(joint);

    const r = 0.038 - i * 0.0045;
    // Last segment wears the marking colour: a dipped tail tip.
    const mat = i === TAIL_SEGS - 1 ? matMark : matCoat;
    const seg = part(new THREE.CapsuleGeometry(r, TAIL_LEN - r, 4, 10), mat, 0.7);
    seg.rotation.x = Math.PI / 2;
    seg.position.z = -TAIL_LEN / 2;
    joint.add(seg);
    tailMeshes.push(seg);

    tailParent = joint;
  }

  // --- pointer pick proxy --------------------------------------------------
  const hit = new THREE.Mesh(
    keep(new THREE.CapsuleGeometry(0.24, 0.34, 4, 10)),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.rotation.x = Math.PI / 2;
  hit.position.set(0, STAND_H, 0.02);
  hit.name = 'cat-hit';
  root.add(hit);

  // --- pose application ----------------------------------------------------
  const headWorld = new THREE.Vector3();

  const apply = (p: Pose): void => {
    body.position.y = STAND_H + p.lift;
    body.rotation.set(p.pitch, p.yaw, p.roll + p.arch);
    torsoScale.scale.z = p.stretch;

    chest.rotation.x = p.spine;
    neck.rotation.x = p.neck;
    head.rotation.set(p.headPitch, p.headYaw, p.headRoll);

    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      // Ears rotate back and splay outward as `ear` rises toward 1.
      ears[i].rotation.x = p.ear * 1.15;
      ears[i].rotation.z = sx * (0.26 + p.ear * 0.5) + (i === 0 ? p.earTwitch : -p.earTwitch);
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

    for (let i = 0; i < TAIL_SEGS; i++) {
      const j = tailJoints[i];
      j.rotation.x = p.tail[i];
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
  const setPalette = (next: CatPalette): void => {
    matCoat.color.set(next.coat);
    matShade.color.set(next.coatShade);
    matBelly.color.set(next.belly);
    matMark.color.set(next.marking);
    matMarkDark.color.set(next.markingDark);
    matNose.color.set(next.nose);
    matIris.color.set(next.eye);
    matLine.color.set(next.line);
    (whiskers.material as THREE.LineBasicMaterial).color.set(next.line);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.userData.isOutline) return;
      const mat = mesh.material as THREE.ShaderMaterial;
      (mat.uniforms.lineColor.value as THREE.Color).set(next.line);
    });
  };

  const dispose = (): void => {
    owned.forEach((g) => g.dispose());
    [matCoat, matShade, matBelly, matMark, matMarkDark, matNose, matIris, matDark, matWhite, matLine].forEach((m) =>
      m.dispose(),
    );
    (whiskers.material as THREE.Material).dispose();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.userData.isOutline) (mesh.material as THREE.Material).dispose();
    });
  };

  return { root, body, head, carry, hit, headWorld, apply, setPalette, dispose };
}

export { STAND_H, HEAD_R, TAIL_SEGS };
