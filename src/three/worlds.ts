/**
 * The four purchasable environments, rebuilt as 3D sets.
 *
 * Each world returns a Group plus a lighting/fog recipe that the engine applies
 * to its shared light rig, so swapping scenes never rebuilds the renderer. All
 * geometry is primitives and all textures are painted onto canvases at runtime
 * — nothing is fetched, so an equipped scene still works offline.
 *
 * Shared stage convention: the cat performs in x ∈ [-1.7, 1.7], z ∈ [-1.1, 0.9],
 * with the camera looking down -Z. Set dressing lives outside that box.
 */
import * as THREE from 'three';
import type { SceneId } from '../game/manifest';
import { buildBowl } from './props';
import { disposeTree, dotTexture, flat, inked, sky, toon, type SkyColors } from './toon';

const INK = 0x3a3350;

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
  update(dt: number, now: number, dayPhase: number): void;
  dispose(): void;
}

// --- shared helpers ---------------------------------------------------------

function part(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, thickness = 0.7): THREE.Mesh {
  return inked(geo, color, { thickness, lineColor: INK, steps: 3 });
}

/** Un-outlined mesh — used for distant dressing where ink lines add noise. */
function soft(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, steps = 3): THREE.Mesh {
  const m = new THREE.Mesh(geo, toon(color, { steps }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function canvasTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
  repeat: [number, number] = [1, 1],
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function plankTexture(base: string, line: string, grain: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = line;
      ctx.lineWidth = 3;
      for (let y = 0; y <= 256; y += 42) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(256, y);
        ctx.stroke();
      }
      // Staggered board ends plus a little grain so the floor is not a grid.
      ctx.lineWidth = 2;
      for (let y = 0, row = 0; y < 256; y += 42, row++) {
        const x = ((row % 2) * 128 + 64) % 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 42);
        ctx.stroke();
      }
      ctx.strokeStyle = grain;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 40; i++) {
        const y = Math.random() * 256;
        ctx.beginPath();
        ctx.moveTo(Math.random() * 256, y);
        ctx.lineTo(Math.random() * 256, y + (Math.random() - 0.5) * 8);
        ctx.stroke();
      }
    },
    [6, 6],
  );
}

function grassTexture(base: string, tuft: string, dark: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 700; i++) {
        ctx.strokeStyle = Math.random() > 0.5 ? tuft : dark;
        ctx.lineWidth = 2;
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (Math.random() - 0.5) * 5, y - 4 - Math.random() * 5);
        ctx.stroke();
      }
    },
    [10, 10],
  );
}

/** Big flat ground plane, always the shadow catcher. */
function groundPlane(color: THREE.ColorRepresentation, map?: THREE.Texture, size = 40): THREE.Mesh {
  const mat = toon(color, { steps: 2 });
  if (map) mat.map = map;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/** A billowy cloud made from overlapping squashed spheres. */
function cloud(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const blobs: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [0.9, -0.1, 0.1, 0.75],
    [-0.85, -0.12, -0.05, 0.7],
    [0.35, 0.35, 0, 0.62],
    [-0.35, 0.28, 0.08, 0.55],
  ];
  for (const [x, y, z, r] of blobs) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), toon('#ffffff', { steps: 2 }));
    b.position.set(x, y, z);
    b.scale.y = 0.7;
    g.add(b);
  }
  g.scale.setScalar(scale);
  return g;
}

/** Leafy canopy: a cluster of icosahedra, cheap and reads as stylised foliage. */
function canopy(color: THREE.ColorRepresentation, r: number, count = 5, spread = 0.7): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const blob = soft(new THREE.IcosahedronGeometry(r * (0.65 + (i % 2) * 0.3), 1), color, 2);
    blob.position.set(Math.cos(a) * r * spread, (i % 3) * r * 0.28, Math.sin(a) * r * spread);
    g.add(blob);
  }
  const core = soft(new THREE.IcosahedronGeometry(r, 1), color, 2);
  g.add(core);
  return g;
}

/** Points cloud used for fireflies, dust motes and pollen. */
function motes(count: number, color: string, box: [number, number, number], size: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * box[0];
    pos[i * 3 + 1] = Math.random() * box[1];
    pos[i * 3 + 2] = (Math.random() - 0.5) * box[2];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size,
    map: dotTexture(color),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

/** Warms/cools a colour toward night. `p` is 0 at midnight, 0.5 at noon. */
function dayMix(day: THREE.Color, night: THREE.Color, phase: number, out: THREE.Color): THREE.Color {
  // Smooth window: full day 09:00-17:00, full night 21:00-05:00.
  const t = THREE.MathUtils.smoothstep(phase, 0.24, 0.36) * (1 - THREE.MathUtils.smoothstep(phase, 0.68, 0.84));
  return out.copy(night).lerp(day, t);
}

// --- living room ------------------------------------------------------------

function livingroom(): World {
  const group = new THREE.Group();
  const disposables: THREE.Texture[] = [];

  const floorTex = plankTexture('#d9b489', '#b28a5f', '#c9a17a');
  disposables.push(floorTex);
  group.add(groundPlane('#e8c9a0', floorTex, 30));

  // Rug under the performance area.
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.75, 40), toon('#f0dcc4', { steps: 2 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.004;
  rug.receiveShadow = true;
  group.add(rug);
  const rugRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.62, 40), flat('#e0b98f'));
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.y = 0.006;
  group.add(rugRing);

  // Back wall + skirting.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), toon('#f6e6d0', { steps: 2 }));
  wall.position.set(0, 3, -3.4);
  wall.receiveShadow = true;
  group.add(wall);
  const skirt = soft(new THREE.BoxGeometry(16, 0.16, 0.08), '#e2cdb0', 2);
  skirt.position.set(0, 0.08, -3.36);
  group.add(skirt);

  // Window: frame, mullions, and a lit pane that tracks the real clock.
  const windowGroup = new THREE.Group();
  windowGroup.position.set(-1.55, 1.75, -3.33);
  group.add(windowGroup);

  const paneMat = flat('#bfe3f5');
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.3), paneMat);
  windowGroup.add(pane);

  const frame = soft(new THREE.BoxGeometry(1.9, 1.5, 0.09), '#fffaf2', 2);
  frame.position.z = -0.03;
  windowGroup.add(frame);
  for (const [w, h] of [
    [1.72, 0.05],
    [0.05, 1.32],
  ] as [number, number][]) {
    const bar = soft(new THREE.BoxGeometry(w, h, 0.06), '#fffaf2', 2);
    bar.position.z = 0.02;
    windowGroup.add(bar);
  }

  // A moon/sun disc drifting behind the glass sells the day/night swing.
  const orb = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), flat('#fff3c4'));
  orb.position.set(0.45, 0.3, 0.005);
  windowGroup.add(orb);

  // Sofa.
  const sofa = new THREE.Group();
  sofa.position.set(2.55, 0, -1.5);
  sofa.rotation.y = -0.55;
  group.add(sofa);
  const seat = part(new THREE.BoxGeometry(1.9, 0.34, 0.9), '#8fae8b', 0.6);
  seat.position.y = 0.35;
  sofa.add(seat);
  const back = part(new THREE.BoxGeometry(1.9, 0.62, 0.24), '#7f9d7c', 0.6);
  back.position.set(0, 0.72, -0.34);
  sofa.add(back);
  for (const sx of [-1, 1]) {
    const arm = part(new THREE.BoxGeometry(0.22, 0.5, 0.9), '#7f9d7c', 0.6);
    arm.position.set(sx * 0.86, 0.47, 0);
    sofa.add(arm);
  }
  for (const sx of [-1, 1]) {
    const cushion = part(new THREE.BoxGeometry(0.44, 0.12, 0.4), '#f2a65a', 0.5);
    cushion.position.set(sx * 0.35, 0.58, -0.2);
    cushion.rotation.x = -0.3;
    sofa.add(cushion);
  }

  // Bookshelf.
  const shelf = new THREE.Group();
  shelf.position.set(-2.9, 0, -2.7);
  shelf.rotation.y = 0.4;
  group.add(shelf);
  const carcass = part(new THREE.BoxGeometry(1.3, 1.7, 0.32), '#b3814f', 0.6);
  carcass.position.y = 0.85;
  shelf.add(carcass);
  const BOOK_COLORS = ['#d95f5f', '#f2c14e', '#5f8fd9', '#8fae8b', '#c76fb0'];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 7; i++) {
      const book = soft(new THREE.BoxGeometry(0.09, 0.3 + (i % 3) * 0.05, 0.24), BOOK_COLORS[(i + row) % 5], 2);
      book.position.set(-0.5 + i * 0.16, 0.42 + row * 0.5, 0.05);
      book.rotation.z = i === 4 ? 0.22 : 0;
      shelf.add(book);
    }
  }

  // Floor lamp — the light source that takes over after dark.
  const lamp = new THREE.Group();
  lamp.position.set(1.9, 0, -2.35);
  group.add(lamp);
  const pole = soft(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), '#6b5744', 2);
  pole.position.y = 0.8;
  lamp.add(pole);
  const foot = soft(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 16), '#6b5744', 2);
  foot.position.y = 0.03;
  lamp.add(foot);
  const shadeMat = toon('#f7dda2', { steps: 2, emissive: '#ffcf70', emissiveIntensity: 0.3 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.32, 0.34, 16, 1, true), shadeMat);
  shade.material.side = THREE.DoubleSide;
  shade.position.y = 1.7;
  lamp.add(shade);
  const bulb = new THREE.PointLight('#ffce80', 0, 4.5, 2);
  bulb.position.set(1.9, 1.62, -2.35);
  group.add(bulb);

  // Pot plant.
  const plant = new THREE.Group();
  plant.position.set(-3.0, 0, -2.1);
  group.add(plant);
  const pot = part(new THREE.CylinderGeometry(0.19, 0.14, 0.3, 14), '#c9713f', 0.6);
  pot.position.y = 0.15;
  plant.add(pot);
  const leaves = canopy('#5f9e63', 0.34, 4, 0.55);
  leaves.position.y = 0.62;
  plant.add(leaves);

  // Cat cushion + bowl.
  const cushion = part(new THREE.CylinderGeometry(0.4, 0.36, 0.11, 20), '#e8899c', 0.6);
  cushion.position.set(-1.05, 0.055, -0.55);
  group.add(cushion);
  const cushionTop = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), flat('#f6b6c2'));
  cushionTop.rotation.x = -Math.PI / 2;
  cushionTop.position.set(-1.05, 0.112, -0.55);
  group.add(cushionTop);

  const bowlMesh = buildBowl('#e08a6a');
  bowlMesh.position.set(1.15, 0, -0.35);
  group.add(bowlMesh);

  const dust = motes(60, '#fff0cf', [7, 3, 5], 0.045);
  dust.position.y = 0.4;
  group.add(dust);

  // Day/night colour targets.
  const DAY_SKY: SkyColors = { top: '#bfe3f5', middle: '#dff0f8', bottom: '#fdf1dd' };
  const NIGHT_SKY: SkyColors = { top: '#1a2447', middle: '#2c3a63', bottom: '#4a4570' };
  const dayPane = new THREE.Color('#bfe3f5');
  const nightPane = new THREE.Color('#26315c');
  const dayOrb = new THREE.Color('#fff3c4');
  const nightOrb = new THREE.Color('#e8ecff');
  const scratch = new THREE.Color();

  const lights: LightRecipe = {
    sky: DAY_SKY,
    fog: { color: '#f6e6d0', near: 7, far: 26 },
    key: { color: '#fff0d4', intensity: 1.05, position: [-3.2, 5, 2.4] },
    fill: { sky: '#ffe9cf', ground: '#c9a17a', intensity: 0.62 },
    rim: { color: '#bfd8ff', intensity: 0.17, position: [3, 3, -4] },
    shadowOpacity: 0.32,
  };

  return {
    group,
    lights,
    bounds: { minX: -1.6, maxX: 1.6, minZ: -1.0, maxZ: 0.85 },
    bed: new THREE.Vector3(-1.05, 0, -0.55),
    bowl: new THREE.Vector3(1.15, 0, -0.05),
    stash: [new THREE.Vector3(2.2, 0, -1.2), new THREE.Vector3(-2.2, 0, -1.6)],
    gift: new THREE.Vector3(0, 0, 0.72),
    update(_dt, now, dayPhase) {
      dust.rotation.y = now * 0.02;
      // Night: pane and orb cool down, the lamp comes up.
      const night = 1 - THREE.MathUtils.smoothstep(dayPhase, 0.24, 0.34) * (1 - THREE.MathUtils.smoothstep(dayPhase, 0.72, 0.84));
      paneMat.color.copy(dayMix(dayPane, nightPane, dayPhase, scratch));
      (orb.material as THREE.MeshBasicMaterial).color.copy(dayMix(dayOrb, nightOrb, dayPhase, scratch));
      orb.position.x = 0.45 - Math.cos(dayPhase * Math.PI * 2) * 0.45;
      orb.position.y = 0.1 + Math.sin((dayPhase - 0.25) * Math.PI * 2) * 0.36;
      bulb.intensity = night * 0.85;
      shadeMat.emissiveIntensity = 0.1 + night * 0.4;
      lights.sky = night > 0.5 ? NIGHT_SKY : DAY_SKY;
    },
    dispose() {
      disposeTree(group);
      disposables.forEach((t) => t.dispose());
    },
  };
}

// --- garden -----------------------------------------------------------------

function garden(): World {
  const group = new THREE.Group();
  const disposables: THREE.Texture[] = [];

  const grass = grassTexture('#7fb865', '#a3d183', '#5f9a4c');
  disposables.push(grass);
  group.add(groundPlane('#8fc472', grass, 60));

  // A mown ring around the stage, then a stone path leading off.
  const mown = new THREE.Mesh(new THREE.CircleGeometry(2.1, 44), toon('#a3d183', { steps: 2 }));
  mown.rotation.x = -Math.PI / 2;
  mown.position.y = 0.006;
  mown.receiveShadow = true;
  group.add(mown);

  // The path recedes to the back right rather than running under the camera.
  for (let i = 0; i < 7; i++) {
    const stone = soft(new THREE.CylinderGeometry(0.26, 0.28, 0.04, 9), '#cfc6b4', 2);
    stone.position.set(2.3 + i * 0.62, 0.02, -1.3 - i * 0.5);
    stone.rotation.y = i * 0.7;
    stone.scale.set(1, 1, 0.8);
    group.add(stone);
  }

  // Hedge wall at the back.
  for (let i = 0; i < 9; i++) {
    const bush = soft(new THREE.IcosahedronGeometry(0.8, 1), i % 2 ? '#4f8a4a' : '#5c9a54', 2);
    bush.position.set(-6.3 + i * 1.6, 0.5, -7.2);
    bush.scale.set(1, 0.85, 0.8);
    group.add(bush);
  }

  // Picket fence behind the hedge.
  for (let i = 0; i < 16; i++) {
    const picket = soft(new THREE.BoxGeometry(0.1, 0.72, 0.05), '#f7f2e6', 2);
    picket.position.set(-5 + i * 0.66, 0.36, -8.4);
    group.add(picket);
    const cap = soft(new THREE.ConeGeometry(0.075, 0.12, 4), '#f7f2e6', 2);
    cap.position.set(-5 + i * 0.66, 0.78, -8.4);
    cap.rotation.y = Math.PI / 4;
    group.add(cap);
  }

  // Flowers, instanced. Stems and heads are two instanced meshes.
  const FLOWERS = 90;
  const stemGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5);
  const headGeo = new THREE.SphereGeometry(0.042, 8, 6);
  const stems = new THREE.InstancedMesh(stemGeo, toon('#4f8a4a', { steps: 2 }), FLOWERS);
  const heads = new THREE.InstancedMesh(headGeo, toon('#ffffff', { steps: 2 }), FLOWERS);
  heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FLOWERS * 3), 3);
  const PETALS = ['#f2a65a', '#f28ab0', '#f2e04e', '#c78ff2', '#ffffff'];
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const flowerSway: number[] = [];
  for (let i = 0; i < FLOWERS; i++) {
    // A meadow band *behind* the stage. Anything in front of the cat would
    // read as a giant lollipop at this camera distance.
    const x = -7 + Math.random() * 14;
    const z = -2.2 - Math.random() * 4.5;
    flowerSway.push(Math.random() * Math.PI * 2);
    dummy.position.set(x, 0.1, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.21;
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, col.set(PETALS[i % PETALS.length]));
  }
  stems.castShadow = true;
  heads.castShadow = true;
  group.add(stems, heads);

  // A shade tree off to one side.
  const tree = new THREE.Group();
  tree.position.set(4.6, 0, -4.6);
  group.add(tree);
  const trunk = part(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 10), '#8a6242', 0.6);
  trunk.position.y = 1.1;
  tree.add(trunk);
  const crown = canopy('#4f8a4a', 1.15, 6, 0.68);
  crown.position.y = 2.6;
  tree.add(crown);

  // Drifting clouds.
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 5; i++) {
    const c = cloud(1.1 + Math.random() * 0.9);
    c.position.set(-16 + i * 8, 4.5 + Math.random() * 2.5, -20 - Math.random() * 10);
    clouds.push(c);
    group.add(c);
  }

  // Butterflies orbiting the flowerbeds.
  const butterflies: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: dotTexture(i % 2 ? '#ffd36e' : '#ff9ecb'), transparent: true, depthWrite: false }),
    );
    s.scale.setScalar(0.16);
    butterflies.push(s);
    group.add(s);
  }

  const pollen = motes(70, '#fff6c9', [10, 3.5, 8], 0.05);
  pollen.position.y = 0.6;
  group.add(pollen);

  // Flat sunning stone doubles as the bed.
  const sunStone = part(new THREE.CylinderGeometry(0.46, 0.5, 0.09, 16), '#d8cfbb', 0.6);
  sunStone.position.set(-1.15, 0.045, -0.5);
  group.add(sunStone);

  const bowlMesh = buildBowl('#8fae8b');
  bowlMesh.position.set(1.25, 0, -0.4);
  group.add(bowlMesh);

  const lights: LightRecipe = {
    sky: { top: '#6ec6f2', middle: '#a9e0f7', bottom: '#e9f8e4' },
    fog: { color: '#d9f0e4', near: 10, far: 38 },
    key: { color: '#fff6d8', intensity: 1.15, position: [-4, 6.5, 3] },
    fill: { sky: '#cdeeff', ground: '#7fb865', intensity: 0.62 },
    rim: { color: '#a8ffd2', intensity: 0.17, position: [4, 2.5, -5] },
    shadowOpacity: 0.3,
  };

  return {
    group,
    lights,
    bounds: { minX: -1.7, maxX: 1.7, minZ: -1.1, maxZ: 0.9 },
    bed: new THREE.Vector3(-1.15, 0, -0.5),
    bowl: new THREE.Vector3(1.25, 0, -0.1),
    stash: [new THREE.Vector3(2.6, 0, -1.4), new THREE.Vector3(-2.6, 0, -1.0)],
    gift: new THREE.Vector3(0, 0, 0.78),
    update(dt, now) {
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * (0.16 + i * 0.03);
        if (clouds[i].position.x > 20) clouds[i].position.x = -20;
      }
      for (let i = 0; i < butterflies.length; i++) {
        const a = now * (0.4 + i * 0.11) + i * 2.1;
        butterflies[i].position.set(
          Math.cos(a) * (2.6 + i * 0.5),
          0.55 + Math.sin(now * 2.2 + i) * 0.28,
          Math.sin(a) * (2.0 + i * 0.4) - 1.2,
        );
      }
      // Whole-field flower sway, cheap: rotate the instanced meshes slightly.
      stems.rotation.z = Math.sin(now * 1.1) * 0.03;
      heads.rotation.z = Math.sin(now * 1.1 + 0.4) * 0.05;
      pollen.rotation.y = now * 0.04;
    },
    dispose() {
      disposeTree(group);
      disposables.forEach((t) => t.dispose());
    },
  };
}

// --- jungle -----------------------------------------------------------------

function jungle(): World {
  const group = new THREE.Group();
  const disposables: THREE.Texture[] = [];

  const moss = grassTexture('#3d6b4a', '#54885c', '#2c5138');
  disposables.push(moss);
  group.add(groundPlane('#447550', moss, 60));

  const clearing = new THREE.Mesh(new THREE.CircleGeometry(2.2, 40), toon('#579060', { steps: 2 }));
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.y = 0.006;
  clearing.receiveShadow = true;
  group.add(clearing);

  // Big trunks framing the shot, with vines wrapped around them.
  const TRUNKS: [number, number, number][] = [
    [-3.1, -2.4, 0.42],
    [3.3, -2.8, 0.5],
    [-4.6, -5.2, 0.6],
    [4.4, -5.6, 0.55],
  ];
  for (const [x, z, r] of TRUNKS) {
    const trunk = part(new THREE.CylinderGeometry(r * 0.8, r, 7, 10), '#5a4433', 0.6);
    trunk.position.set(x, 3.5, z);
    group.add(trunk);
    for (let i = 0; i < 4; i++) {
      const vine = soft(new THREE.TorusGeometry(r * 1.02, 0.035, 5, 16), '#4f8a4a', 2);
      vine.position.set(x, 0.8 + i * 1.3, z);
      vine.rotation.set(Math.PI / 2 + 0.12, i * 0.7, 0);
      group.add(vine);
    }
  }

  // Overhead canopy — dense enough to justify the shafts of light.
  for (let i = 0; i < 7; i++) {
    const c = canopy(i % 2 ? '#2f5c3c' : '#3a7048', 1.9, 4, 0.6);
    c.position.set(-6 + i * 2.1, 5.2 + (i % 3) * 0.6, -4 - (i % 2) * 2);
    group.add(c);
  }

  // Foreground fronds — flattened cones angled into frame.
  // Fronds frame the shot from the far edges only — anything nearer turns
  // into a flat dark sail across the middle of the picture.
  const fronds: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const frond = part(new THREE.ConeGeometry(0.3, 1.1, 5), i % 2 ? '#59a86a' : '#69bd79', 0.5);
    frond.scale.set(1, 1, 0.22);
    frond.position.set(side * (2.9 + (i % 3) * 0.5), 1.1 + (i % 3) * 0.45, -2.4 - (i % 2) * 0.8);
    frond.rotation.set(0.35, side * 1.1, side * (0.75 + i * 0.1));
    fronds.push(frond);
    group.add(frond);
  }

  // Shafts of light: additive cones from the canopy down to the clearing.
  const shafts: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const shaft = new THREE.Mesh(
      new THREE.ConeGeometry(0.75 + i * 0.2, 6.5, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: '#d8ffcf',
        transparent: true,
        opacity: 0.07,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    shaft.position.set(-1.8 + i * 1.9, 3.2, -1.6 - i * 0.5);
    shaft.rotation.z = 0.16 - i * 0.12;
    shafts.push(shaft);
    group.add(shaft);
  }

  // Mossy rock the cat sleeps on, plus a fallen log.
  const rock = part(new THREE.IcosahedronGeometry(0.52, 1), '#6f7c68', 0.6);
  rock.scale.set(1.15, 0.55, 1);
  rock.position.set(-1.2, 0.2, -0.55);
  group.add(rock);

  const log = part(new THREE.CylinderGeometry(0.28, 0.3, 2.6, 10), '#6b503a', 0.6);
  log.rotation.set(0, 0.4, Math.PI / 2);
  log.position.set(3.3, 0.28, -2.7);
  group.add(log);

  const fireflies = motes(90, '#c8ff9a', [12, 4, 9], 0.05);
  fireflies.position.y = 0.5;
  group.add(fireflies);
  const mist = motes(30, '#dff5e4', [16, 1.2, 11], 0.22);
  mist.position.y = 0.25;
  group.add(mist);

  const bowlMesh = buildBowl('#7a6a4f');
  bowlMesh.position.set(1.2, 0, -0.4);
  group.add(bowlMesh);

  const lights: LightRecipe = {
    sky: { top: '#123a2a', middle: '#1e5540', bottom: '#3c7a55' },
    fog: { color: '#1f4a35', near: 5, far: 22 },
    key: { color: '#e4ffd0', intensity: 1.15, position: [-3.4, 4.2, 3.6] },
    fill: { sky: '#8fe8b4', ground: '#2f5a3f', intensity: 0.72 },
    rim: { color: '#7fffc4', intensity: 0.26, position: [3.5, 2, -4] },
    shadowOpacity: 0.42,
  };

  return {
    group,
    lights,
    bounds: { minX: -1.65, maxX: 1.65, minZ: -1.05, maxZ: 0.9 },
    bed: new THREE.Vector3(-1.2, 0.24, -0.55),
    bowl: new THREE.Vector3(1.2, 0, -0.1),
    stash: [new THREE.Vector3(2.4, 0, -1.5), new THREE.Vector3(-2.4, 0, -1.3)],
    gift: new THREE.Vector3(0, 0, 0.75),
    update(_dt, now) {
      fireflies.rotation.y = now * 0.05;
      const mat = fireflies.material as THREE.PointsMaterial;
      // Fireflies pulse together — cheaper than per-point opacity, still alive.
      mat.opacity = 0.42 + Math.sin(now * 1.6) * 0.22;
      mist.rotation.y = -now * 0.02;
      for (let i = 0; i < shafts.length; i++) {
        (shafts[i].material as THREE.MeshBasicMaterial).opacity = 0.05 + Math.sin(now * 0.5 + i) * 0.025;
      }
      for (let i = 0; i < fronds.length; i++) {
        fronds[i].rotation.z += Math.sin(now * 0.8 + i) * 0.0006;
      }
    },
    dispose() {
      disposeTree(group);
      disposables.forEach((t) => t.dispose());
    },
  };
}

// --- treehouse --------------------------------------------------------------

function treehouse(): World {
  const group = new THREE.Group();
  const disposables: THREE.Texture[] = [];

  const deckTex = plankTexture('#c49a68', '#96703f', '#b08753');
  disposables.push(deckTex);

  // The deck is the whole world — there is no ground, just sky below.
  const deckMat = toon('#c49a68', { steps: 2 });
  deckMat.map = deckTex;
  deckTex.repeat.set(3, 3);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.0, 0.22, 24), deckMat);
  deck.position.y = -0.11;
  deck.receiveShadow = true;
  deck.castShadow = true;
  group.add(deck);

  const deckRim = new THREE.Mesh(new THREE.TorusGeometry(3.06, 0.07, 8, 32), toon('#96703f', { steps: 2 }));
  deckRim.rotation.x = Math.PI / 2;
  deckRim.position.y = -0.02;
  group.add(deckRim);

  // The host trunk rising through the deck, with a big branch overhead.
  const trunk = part(new THREE.CylinderGeometry(0.42, 0.55, 9, 12), '#7a5a3e', 0.7);
  trunk.position.set(-3.7, 3.4, -4.3);
  group.add(trunk);

  const branch = part(new THREE.CylinderGeometry(0.16, 0.24, 3.6, 8), '#7a5a3e', 0.6);
  branch.rotation.set(0, 0.5, -1.15);
  branch.position.set(-1.9, 2.7, -2.9);
  group.add(branch);

  for (let i = 0; i < 5; i++) {
    const c = canopy('#5f9e4e', 1.5, 4, 0.6);
    c.position.set(-3 + i * 1.5, 4.4 + (i % 2) * 0.5, -2.6 - (i % 3) * 0.9);
    group.add(c);
  }

  // Rope railing, wrapped around the far half of the deck only — a rail across
  // the near edge would sit between the camera and the cat.
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    const post = soft(new THREE.CylinderGeometry(0.055, 0.06, 0.72, 7), '#8a6242', 2);
    post.position.set(Math.cos(a) * 2.85, 0.36, Math.sin(a) * 2.85);
    group.add(post);
  }
  for (const y of [0.32, 0.62]) {
    // The arc must stay in the deck plane: tilt on X only, offset the start on Y.
    // The half-arc is authored over +Z; a half turn puts it behind the cat,
    // matching where the posts stand.
    const ropeGroup = new THREE.Group();
    ropeGroup.rotation.y = Math.PI;
    const rope = new THREE.Mesh(
      new THREE.TorusGeometry(2.85, 0.022, 6, 40, Math.PI),
      toon('#d9c39a', { steps: 2 }),
    );
    rope.rotation.x = Math.PI / 2;
    ropeGroup.add(rope);
    ropeGroup.position.y = y;
    group.add(ropeGroup);
  }

  // Hanging lantern.
  const lantern = new THREE.Group();
  lantern.position.set(2.1, 1.85, -2.0);
  group.add(lantern);
  const cord = soft(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 6), '#6b5744', 2);
  cord.position.y = 0.55;
  lantern.add(cord);
  const lanternMat = toon('#ffe6a8', { steps: 2, emissive: '#ffc85e', emissiveIntensity: 0.8 });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.26, 10), lanternMat);
  lantern.add(glass);
  const lanternLight = new THREE.PointLight('#ffcf80', 0.8, 4, 2);
  lanternLight.position.copy(lantern.position);
  group.add(lanternLight);

  // Distant treetops below the deck, plus clouds — this is a view, not a room.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    const r = 9 + (i % 5) * 3.5;
    const top = soft(new THREE.ConeGeometry(1.5 + (i % 3) * 0.5, 3.4 + (i % 4), 7), i % 2 ? '#3f7a4d' : '#4f8f56', 2);
    top.position.set(Math.cos(a) * r, -4.5 - (i % 4) * 0.8, Math.sin(a) * r);
    top.castShadow = false;
    group.add(top);
  }

  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const c = cloud(1.1 + Math.random() * 0.7);
    c.position.set(-24 + i * 9, -2 + (i % 3) * 3, -22 - (i % 4) * 7);
    clouds.push(c);
    group.add(c);
  }

  // Birds: small sprites that cross the view on a long loop.
  const birds: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: dotTexture('#3b3550'), transparent: true, opacity: 0.75, depthWrite: false }),
    );
    s.scale.setScalar(0.2);
    birds.push(s);
    group.add(s);
  }

  // Folded blanket as the bed.
  const blanket = part(new THREE.BoxGeometry(0.86, 0.1, 0.66), '#e8899c', 0.6);
  blanket.position.set(-1.1, 0.05, -0.5);
  group.add(blanket);
  const blanket2 = part(new THREE.BoxGeometry(0.72, 0.08, 0.54), '#f6b6c2', 0.5);
  blanket2.position.set(-1.1, 0.13, -0.5);
  group.add(blanket2);

  const bowlMesh = buildBowl('#c9713f');
  bowlMesh.position.set(1.2, 0, -0.35);
  group.add(bowlMesh);

  const leafFall = motes(45, '#ffe08a', [7, 5, 6], 0.07);
  leafFall.position.y = 2;
  group.add(leafFall);

  const lights: LightRecipe = {
    sky: { top: '#5fb8ea', middle: '#a5dcf2', bottom: '#ffe4bf' },
    fog: { color: '#cfeaf7', near: 12, far: 44 },
    key: { color: '#fff1cc', intensity: 1.1, position: [3.5, 6, 3.5] },
    fill: { sky: '#cdeeff', ground: '#c49a68', intensity: 0.62 },
    rim: { color: '#ffd39e', intensity: 0.2, position: [-4, 2.5, -4] },
    shadowOpacity: 0.34,
  };

  return {
    group,
    lights,
    bounds: { minX: -1.6, maxX: 1.6, minZ: -1.0, maxZ: 0.95 },
    bed: new THREE.Vector3(-1.1, 0.18, -0.5),
    bowl: new THREE.Vector3(1.2, 0, -0.05),
    stash: [new THREE.Vector3(2.2, 0, -1.5), new THREE.Vector3(-2.3, 0, -1.2)],
    gift: new THREE.Vector3(0, 0, 0.8),
    update(dt, now) {
      for (let i = 0; i < clouds.length; i++) {
        clouds[i].position.x += dt * (0.22 + i * 0.05);
        if (clouds[i].position.x > 24) clouds[i].position.x = -24;
      }
      for (let i = 0; i < birds.length; i++) {
        const t = (now * 0.09 + i * 0.37) % 1;
        birds[i].position.set(-22 + t * 44, 1.5 + Math.sin(now * 0.9 + i * 2) * 0.8 + i * 0.7, -10 - i * 3);
      }
      lantern.rotation.z = Math.sin(now * 0.9) * 0.06;
      lanternLight.intensity = 0.75 + Math.sin(now * 3.1) * 0.1;
      leafFall.rotation.y = now * 0.03;
    },
    dispose() {
      disposeTree(group);
      disposables.forEach((t) => t.dispose());
    },
  };
}

// --- registry ---------------------------------------------------------------

const BUILDERS: Record<SceneId, () => World> = { livingroom, garden, jungle, treehouse };

export function buildWorld(id: SceneId): World {
  return BUILDERS[id]();
}

export { sky };
