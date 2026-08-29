/**
 * Worlds for the painted stage.
 *
 * These implement the `World` contract in `stage-types.ts`, so the engine's
 * behaviour, locomotion, feeding and gift errands are unchanged — the cat
 * still walks to a bowl at a world position and curls up on a bed at another.
 * What changed when the fully-modelled worlds were retired is that almost
 * nothing is *modelled* any more. The environment is a painting behind the
 * canvas, and only the handful of objects the cat physically interacts with
 * stay as geometry.
 *
 * Keeping the bowl and the cushion in 3D rather than painting them is
 * deliberate. They have to sit at a known world position, receive the same
 * light as the cat, and be occluded by it from the right angles. A painted
 * bowl would be a flat sticker the cat's paws pass straight through.
 *
 * Everything is colour-graded from the scene palette at build time, so a
 * cushion in the jungle is not the cushion from the living room in a different
 * room — it belongs to the picture it is standing in.
 */
import * as THREE from 'three';
import type { SceneId } from '../game/manifest';
import { buildBowl, buildSofa } from './props';
import { disposeTree, inked } from './toon';
import type { LightRecipe, World } from './stage-types';
import { PHASES } from '../world/palette';

/**
 * Where each scene's furniture sits, and how much room the cat has.
 *
 * `bounds` is sized so the cat stays inside the frame on its own. It is
 * tempting to let it roam wider and pan the camera to follow, but every unit
 * the camera pans is a unit the painted backdrop must slide to stay under the
 * cat's feet — and a painting has only so much slack before its edge shows.
 * Keeping the pet in frame is cheaper than chasing it.
 */
interface PaintedSpec {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  bed: THREE.Vector3;
  bowl: THREE.Vector3;
  sofa: THREE.Vector3;
  stash: THREE.Vector3[];
  gift: THREE.Vector3;
  /** Cushion colours, so the bed belongs to its scene. */
  bedColor: string;
  bedTrim: string;
  bowlColor: string;
  sofaColor: string;
  /** True for interiors, which get a smaller roaming area. */
  indoor: boolean;
}

const SPECS: Record<SceneId, PaintedSpec> = {
  garden: {
    bounds: { minX: -1.5, maxX: 1.5, minZ: -1.0, maxZ: 0.9 },
    bed: new THREE.Vector3(-1.35, 0, -0.5),
    bowl: new THREE.Vector3(1.4, 0, -0.1),
    // Front-right corner — clear of the bowl (back-right) and the bed
    // (back-left), and out of the middle so the cat still has room to play.
    sofa: new THREE.Vector3(1.3, 0, 0.55),
    stash: [new THREE.Vector3(2.9, 0, -1.3), new THREE.Vector3(-2.9, 0, -1.5)],
    gift: new THREE.Vector3(0, 0, 0.75),
    bedColor: '#d98fa4',
    bedTrim: '#b56b81',
    bowlColor: '#e08a6a',
    sofaColor: '#d98fa4',
    indoor: false,
  },
  jungle: {
    bounds: { minX: -1.4, maxX: 1.4, minZ: -0.9, maxZ: 0.85 },
    bed: new THREE.Vector3(-1.2, 0, -0.45),
    bowl: new THREE.Vector3(1.25, 0, -0.05),
    sofa: new THREE.Vector3(1.2, 0, 0.52),
    stash: [new THREE.Vector3(2.7, 0, -1.2), new THREE.Vector3(-2.7, 0, -1.4)],
    gift: new THREE.Vector3(0, 0, 0.72),
    bedColor: '#8fae6a',
    bedTrim: '#6b8a4c',
    bowlColor: '#b6764f',
    sofaColor: '#8fae6a',
    indoor: false,
  },
  treehouse: {
    // A platform, so the cat genuinely does have edges to respect.
    bounds: { minX: -1.25, maxX: 1.25, minZ: -0.7, maxZ: 0.8 },
    bed: new THREE.Vector3(-1.0, 0, -0.4),
    bowl: new THREE.Vector3(1.05, 0, -0.05),
    sofa: new THREE.Vector3(1.05, 0, 0.48),
    stash: [new THREE.Vector3(2.2, 0, -1.0), new THREE.Vector3(-2.2, 0, -1.1)],
    gift: new THREE.Vector3(0, 0, 0.68),
    bedColor: '#c9a06b',
    bedTrim: '#a67c4d',
    bowlColor: '#7f9c6d',
    sofaColor: '#c9a06b',
    indoor: false,
  },
  mountain: {
    // Open ground, so the cat gets the widest roam of any scene.
    bounds: { minX: -1.6, maxX: 1.6, minZ: -1.05, maxZ: 0.95 },
    bed: new THREE.Vector3(-1.4, 0, -0.5),
    bowl: new THREE.Vector3(1.45, 0, -0.1),
    sofa: new THREE.Vector3(1.4, 0, 0.58),
    stash: [new THREE.Vector3(3.0, 0, -1.35), new THREE.Vector3(-3.0, 0, -1.5)],
    gift: new THREE.Vector3(0, 0, 0.78),
    // Alpine wool and weathered stoneware, rather than the garden's pinks.
    bedColor: '#a8b8c9',
    bedTrim: '#7f92a6',
    bowlColor: '#8c7f6e',
    sofaColor: '#a8b8c9',
    indoor: false,
  },
  snow: {
    bounds: { minX: -1.55, maxX: 1.55, minZ: -1.0, maxZ: 0.9 },
    bed: new THREE.Vector3(-1.35, 0, -0.48),
    bowl: new THREE.Vector3(1.4, 0, -0.08),
    sofa: new THREE.Vector3(1.35, 0, 0.56),
    stash: [new THREE.Vector3(2.9, 0, -1.3), new THREE.Vector3(-2.9, 0, -1.45)],
    gift: new THREE.Vector3(0, 0, 0.76),
    // A warm bed reads as shelter against all that blue — the one spot of heat
    // in the frame is where the cat sleeps, which is the point of the scene.
    bedColor: '#c86f5c',
    bedTrim: '#9d5142',
    bowlColor: '#6f7f92',
    sofaColor: '#c86f5c',
    indoor: false,
  },
  livingroom: {
    bounds: { minX: -1.4, maxX: 1.4, minZ: -1.0, maxZ: 0.85 },
    bed: new THREE.Vector3(-1.05, 0, -0.55),
    bowl: new THREE.Vector3(1.15, 0, -0.05),
    sofa: new THREE.Vector3(1.2, 0, 0.5),
    stash: [new THREE.Vector3(2.2, 0, -1.2), new THREE.Vector3(-2.2, 0, -1.6)],
    gift: new THREE.Vector3(0, 0, 0.72),
    bedColor: '#d3728c',
    bedTrim: '#a9536b',
    bowlColor: '#c0603f',
    sofaColor: '#d3728c',
    indoor: true,
  },
};

/**
 * How much further from the camera everything the pet touches now sits.
 *
 * The pet was standing near the bottom edge of the frame, and only part of that
 * was the crop. The rest is that it was simply very close to the camera: on a
 * ground plane, distance is height on screen, and the last metre before the
 * lens is most of the bottom of the picture.
 *
 * Pushing the whole furnished area back moves the animal up the frame without
 * touching the camera, the horizon or the painting — all of which are tied to
 * each other and expensive to disturb. It moves the bed, the bowl and the gift
 * spot with it, because they are the pet's world and it would be odd for the
 * cushion to stay behind.
 *
 * Applied here rather than folded into the numbers above so each scene's
 * layout stays readable as the thing its author wrote.
 */
const DEPTH_SHIFT = 0.5;

for (const spec of Object.values(SPECS)) {
  spec.bounds.minZ -= DEPTH_SHIFT;
  spec.bounds.maxZ -= DEPTH_SHIFT;
  spec.bed.z -= DEPTH_SHIFT;
  spec.bowl.z -= DEPTH_SHIFT;
  spec.sofa.z -= DEPTH_SHIFT;
  spec.gift.z -= DEPTH_SHIFT;
  for (const s of spec.stash) s.z -= DEPTH_SHIFT;
}

/**
 * The base lighting recipe for a painted scene.
 *
 * This is only a starting point — `daylight.ts` moves it to the player's real
 * time and weather before it ever reaches a light. The values here describe a
 * clear midday, which is the one condition the palettes are authored against.
 */
function baseLights(scene: SceneId): LightRecipe {
  const noon = PHASES.noon;
  const indoor = SPECS[scene].indoor;
  return {
    sky: { top: noon.skyTop, middle: noon.skyMid, bottom: noon.skyLow },
    // Fog is pushed far back: the painting already provides aerial perspective,
    // and fogging the few 3D objects on top of it just makes them muddy.
    fog: { color: noon.skyLow, near: 14, far: 46 },
    key: { color: noon.light.keyColor, intensity: indoor ? 1.7 : 2.2, position: [-3, 6, 3] },
    fill: {
      sky: noon.light.ambientSky,
      ground: noon.light.ambientGround,
      intensity: indoor ? 1.6 : 1.45,
    },
    rim: { color: noon.light.rimColor, intensity: 0.7, position: [3.4, 2.6, -4] },
    shadowOpacity: indoor ? 0.3 : 0.38,
  };
}

/** A soft dark disc for the ambient contact shadow directly under the cat. */
function blobTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildPaintedWorld(scene: SceneId): World {
  const spec = SPECS[scene] ?? SPECS.garden;
  const group = new THREE.Group();
  const disposables: THREE.Texture[] = [];

  // --- the ground -----------------------------------------------------------
  // Invisible except for what falls on it. The painted layer is the real
  // floor; this exists purely to catch the cat's shadow.
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.34 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), shadowMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // A cheap ambient occlusion patch under the cat's usual territory. When the
  // sun is low the cast shadow stretches away to nothing and the pet starts to
  // float; this keeps it planted.
  const blobTex = blobTexture();
  disposables.push(blobTex);
  const blobMat = new THREE.MeshBasicMaterial({
    map: blobTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.3,
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.002;
  group.add(blob);

  // --- the bed --------------------------------------------------------------
  const cushion = inked(new THREE.CylinderGeometry(0.34, 0.38, 0.09, 20), spec.bedTrim, {
    thickness: 0.5,
    steps: 3,
  });
  cushion.position.copy(spec.bed).setY(0.045);
  group.add(cushion);

  const cushionTop = inked(new THREE.CylinderGeometry(0.27, 0.3, 0.05, 20), spec.bedColor, {
    thickness: 0.4,
    steps: 3,
  });
  cushionTop.position.copy(spec.bed).setY(0.095);
  group.add(cushionTop);

  // --- the bowl -------------------------------------------------------------
  const bowl = buildBowl(spec.bowlColor);
  bowl.position.copy(spec.bowl);
  group.add(bowl);

  // --- the sofa -------------------------------------------------------------
  const sofa = buildSofa(spec.sofaColor);
  sofa.position.copy(spec.sofa);
  group.add(sofa);

  const lights = baseLights(scene);

  return {
    group,
    lights,
    bounds: spec.bounds,
    bed: spec.bed.clone(),
    bowl: spec.bowl.clone(),
    sofa: spec.sofa.clone(),
    stash: spec.stash.map((v) => v.clone()),
    gift: spec.gift.clone(),
    contact: blob,

    /**
     * Nothing to animate.
     *
     * In the modelled worlds this moved a sun orb across a window and faded a
     * lamp up at night. Here the painting owns all of that — it is repainted
     * when the phase changes — so the only thing left is to keep the contact
     * patch under the cat, which the engine does directly.
     */
    update() {},

    dispose() {
      disposeTree(group);
      disposables.forEach((d) => d.dispose());
      shadowMat.dispose();
      blobMat.dispose();
    },
  };
}
