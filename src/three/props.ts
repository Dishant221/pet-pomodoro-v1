/**
 * Everything the cat can pick up in its mouth: the four shop snacks and the
 * toys it fetches when a session ends. Each builder returns a Group whose
 * origin sits at the object's resting point on the floor, so props can be
 * dropped straight onto the ground or parented to the cat's `carry` anchor.
 */
import * as THREE from 'three';
import { flat, inked, toon } from './toon';
import type { SnackId } from '../game/economy';

export type ToyId = 'yarn' | 'mouse' | 'feather' | 'bell';
export type PropId = SnackId | ToyId;

export interface PropSpec {
  id: PropId;
  kind: 'food' | 'toy';
  label: string;
  /** Emoji echo used by the HUD tray and the toast copy. */
  glyph: string;
}

export const TOYS: Record<ToyId, PropSpec> = {
  yarn: { id: 'yarn', kind: 'toy', label: 'Ball of yarn', glyph: '🧶' },
  mouse: { id: 'mouse', kind: 'toy', label: 'Toy mouse', glyph: '🐭' },
  feather: { id: 'feather', kind: 'toy', label: 'Feather wand', glyph: '🪶' },
  bell: { id: 'bell', kind: 'toy', label: 'Jingle bell', glyph: '🔔' },
};

export const TOY_IDS = Object.keys(TOYS) as ToyId[];

const INK = 0x3a3350;

/** Mesh + toon material + outline, with shadows on by default. */
function m(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, thickness = 0.8): THREE.Mesh {
  return inked(geo, color, { thickness, lineColor: INK, steps: 3 });
}

// --- food -------------------------------------------------------------------

function fish(): THREE.Group {
  const g = new THREE.Group();
  const body = m(new THREE.SphereGeometry(0.062, 14, 12), '#9fd8ea');
  body.scale.set(1.7, 0.85, 0.55);
  body.position.y = 0.05;
  g.add(body);

  const tail = m(new THREE.ConeGeometry(0.05, 0.06, 3), '#7cc3da', 0.6);
  tail.rotation.z = Math.PI / 2;
  tail.rotation.y = Math.PI / 2;
  tail.position.set(-0.115, 0.05, 0);
  g.add(tail);

  const fin = m(new THREE.ConeGeometry(0.026, 0.04, 3), '#7cc3da', 0.5);
  fin.position.set(0, 0.095, 0);
  g.add(fin);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), flat('#241f33'));
  eye.position.set(0.07, 0.062, 0.026);
  g.add(eye);
  return g;
}

function cookie(): THREE.Group {
  const g = new THREE.Group();
  const disc = m(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16), '#e0a86a');
  disc.position.y = 0.018;
  g.add(disc);

  // Chocolate chips, placed on a fixed ring so they never overlap.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const chip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), toon('#5b3a24', { steps: 2 }));
    chip.position.set(Math.cos(a) * 0.04, 0.034, Math.sin(a) * 0.04);
    chip.castShadow = true;
    g.add(chip);
  }
  return g;
}

function milk(): THREE.Group {
  const g = new THREE.Group();
  const bowl = m(new THREE.CylinderGeometry(0.085, 0.06, 0.055, 18), '#8fb8e8');
  bowl.position.y = 0.028;
  g.add(bowl);

  const surface = new THREE.Mesh(new THREE.CircleGeometry(0.072, 18), flat('#fdfdff'));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.05;
  g.add(surface);
  return g;
}

function sushi(): THREE.Group {
  const g = new THREE.Group();
  const rice = m(new THREE.SphereGeometry(0.06, 14, 12), '#fbf7ef');
  rice.scale.set(1.35, 0.72, 0.85);
  rice.position.y = 0.042;
  g.add(rice);

  const salmon = m(new THREE.SphereGeometry(0.06, 14, 10), '#f89a7a', 0.6);
  salmon.scale.set(1.45, 0.3, 0.95);
  salmon.position.y = 0.078;
  salmon.rotation.z = -0.1;
  g.add(salmon);

  const nori = m(new THREE.BoxGeometry(0.032, 0.075, 0.115), '#2f4a3d', 0.5);
  nori.position.y = 0.05;
  g.add(nori);
  return g;
}

// --- toys -------------------------------------------------------------------

function yarn(): THREE.Group {
  const g = new THREE.Group();
  const ball = m(new THREE.SphereGeometry(0.075, 16, 14), '#f28ab0');
  ball.position.y = 0.075;
  g.add(ball);

  // Three wound bands at different tilts read as wrapped yarn.
  const bands: [number, number, number][] = [
    [0, 0, 0],
    [0.9, 0.5, 0],
    [-0.7, 1.2, 0.4],
  ];
  for (const [x, y, z] of bands) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.072, 0.008, 6, 22),
      toon('#d96f96', { steps: 2 }),
    );
    band.rotation.set(x, y, z);
    band.position.y = 0.075;
    band.castShadow = true;
    g.add(band);
  }

  // A loose end trailing onto the floor.
  const tail = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.006, 5, 14, Math.PI * 1.2),
    toon('#d96f96', { steps: 2 }),
  );
  tail.rotation.set(Math.PI / 2, 0, 0.5);
  tail.position.set(0.08, 0.008, 0.05);
  g.add(tail);
  return g;
}

function mouse(): THREE.Group {
  const g = new THREE.Group();
  const body = m(new THREE.SphereGeometry(0.055, 14, 12), '#b8b3c9');
  body.scale.set(1.5, 0.9, 0.95);
  body.position.y = 0.05;
  g.add(body);

  for (const sx of [-1, 1]) {
    const ear = m(new THREE.CircleGeometry(0.028, 12), '#f0b7c6', 0.5);
    ear.position.set(0.03, 0.095, sx * 0.03);
    ear.rotation.y = sx * 0.6;
    (ear.material as THREE.Material).side = THREE.DoubleSide;
    g.add(ear);
  }

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), flat('#f2839c'));
  nose.position.set(0.082, 0.045, 0);
  g.add(nose);

  const tail = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.005, 5, 14, Math.PI),
    toon('#f0b7c6', { steps: 2 }),
  );
  tail.rotation.set(Math.PI / 2, 0, -0.4);
  tail.position.set(-0.12, 0.02, 0);
  g.add(tail);
  return g;
}

function feather(): THREE.Group {
  const g = new THREE.Group();
  const stick = m(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 8), '#c99a63', 0.5);
  stick.rotation.z = Math.PI / 2 - 0.25;
  stick.position.set(-0.05, 0.04, 0);
  g.add(stick);

  const plume = m(new THREE.ConeGeometry(0.045, 0.16, 8), '#6fc3d8', 0.6);
  plume.scale.set(1, 1, 0.35);
  plume.rotation.z = -1.05;
  plume.position.set(0.1, 0.11, 0);
  g.add(plume);

  const plume2 = m(new THREE.ConeGeometry(0.032, 0.12, 8), '#f2c14e', 0.5);
  plume2.scale.set(1, 1, 0.35);
  plume2.rotation.z = -0.6;
  plume2.position.set(0.08, 0.15, 0.02);
  g.add(plume2);
  return g;
}

function bell(): THREE.Group {
  const g = new THREE.Group();
  const ball = m(new THREE.SphereGeometry(0.06, 16, 14), '#f2c14e');
  ball.position.y = 0.06;
  g.add(ball);

  const seam = new THREE.Mesh(new THREE.TorusGeometry(0.059, 0.006, 6, 20), toon('#c9992e', { steps: 2 }));
  seam.rotation.x = Math.PI / 2;
  seam.position.y = 0.06;
  seam.castShadow = true;
  g.add(seam);

  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.012), flat('#7a5c15'));
  slit.position.set(0, 0.06, 0.055);
  g.add(slit);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 14), toon('#c9992e', { steps: 2 }));
  ring.position.y = 0.128;
  g.add(ring);
  return g;
}

// --- registry ---------------------------------------------------------------

const BUILDERS: Record<PropId, () => THREE.Group> = {
  fish,
  cookie,
  milk,
  sushi,
  yarn,
  mouse,
  feather,
  bell,
};

export function buildProp(id: PropId): THREE.Group {
  const g = BUILDERS[id]();
  g.name = `prop:${id}`;
  g.userData.propId = id;
  return g;
}

/** A shallow food bowl the cat eats from — part of the world, not carried. */
export function buildBowl(color: THREE.ColorRepresentation = '#e08a6a'): THREE.Group {
  const g = new THREE.Group();
  const outer = m(new THREE.CylinderGeometry(0.13, 0.1, 0.05, 20), color);
  outer.position.y = 0.025;
  g.add(outer);
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.02, 20), toon('#8b5540', { steps: 2 }));
  inner.position.y = 0.045;
  inner.receiveShadow = true;
  g.add(inner);
  return g;
}
