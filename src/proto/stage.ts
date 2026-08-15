/**
 * The 3D half of the hybrid: the existing cat, on a transparent canvas, lit to
 * match a painted background.
 *
 * Deliberately standalone rather than a mode inside `three/engine.ts`. This is
 * a throwaway used to answer one question — does a 3D pet sit convincingly on a
 * 2D painting — and wiring an experiment into the live game's engine would risk
 * the thing that already works. It reuses the cat rig and the animation
 * evaluator, which is the part actually under test.
 *
 * Four things are doing the grounding work, in rough order of how much each
 * matters:
 *
 *   1. Occlusion — painted grass in front of the paws (that layer lives in the
 *      DOM, not here, but it is the reason the camera is framed this low).
 *   2. A real cast shadow, plus a soft contact blob for when the sun is low and
 *      the cast shadow stretches away to nothing.
 *   3. Key light direction and colour taken from the same `TimeOfDay` the
 *      painter used.
 *   4. A horizon-locked camera, so the pet's ground plane and the painted
 *      ground plane vanish to the same line at every window size.
 */
import * as THREE from 'three';
import { buildCat, makePose, copyPose, lerpPose, type CatRig, type CatPalette, type Pose } from '../three/cat';
import { evaluate, blendTime, type Action, type AnimCtx } from '../three/animations';
import { HORIZON, VIEW_W, VIEW_H } from './paint';
import { keyLightPosition, type TimeOfDay } from './timeofday';

/**
 * A long lens, deliberately.
 *
 * Painted backgrounds are effectively orthographic — an illustrator does not
 * draw wide-angle distortion. A 34° camera made the cat visibly diverge from
 * the painting's perspective at the edges of frame. Narrowing the field and
 * pulling back flattens the pet to match, at the cost of nothing.
 */
const FOV = 26;
/** How far the camera sits from the cat, and how high above the ground. */
const CAM_DIST = 4.8;
const CAM_HEIGHT = 0.55;
/**
 * The cat is small in frame on purpose. Every reference image is a *landscape*
 * with an animal in it, not a portrait of an animal — the world has to have
 * room to breathe or the pet reads as a mascot pasted over wallpaper.
 */
const PET_SCALE = 0.55;
/** How far the cat may wander before turning round, in world units. */
const WALK_BOUND = 1.4;

/** How hard the cat's inverted-hull outline is drawn. */
export type InkMode = 'full' | 'soft' | 'none';

export interface ProtoStage {
  setPhase(t: TimeOfDay): void;
  setAction(a: Action): void;
  setPalette(p: CatPalette): void;
  /** Defeat the cast shadow and contact blob, to show what they were doing. */
  setShadows(on: boolean): void;
  /** How hard to draw the cat's outline — the main style clash with paint. */
  setInk(mode: InkMode): void;
  resize(): void;
  start(): void;
  stop(): void;
  dispose(): void;
}

/**
 * Where the painted horizon actually lands on screen.
 *
 * The background SVGs are `preserveAspectRatio="slice"`, so a container that is
 * not 16:9 crops them — and the horizon moves. Reading that back means the
 * camera can follow it instead of assuming a fixed 62%.
 */
function horizonFraction(w: number, h: number): number {
  const scale = Math.max(w / VIEW_W, h / VIEW_H);
  const offsetY = (h - VIEW_H * scale) / 2;
  return (offsetY + HORIZON * scale) / h;
}

/** A soft dark disc, for the ambient contact shadow directly under the cat. */
function blobTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStage(canvas: HTMLCanvasElement, phase: TimeOfDay, palette?: CatPalette): ProtoStage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    // The whole point — the painting has to show through.
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // No background and no fog: both would paint over the painting.

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, CAM_HEIGHT, CAM_DIST);

  // --- lights ---------------------------------------------------------------

  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  // A touch of bias keeps the toon shading free of shadow acne on curved fur.
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);

  const fill = new THREE.HemisphereLight(0xffffff, 0x888888, 1.4);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(rim);

  // --- ground ---------------------------------------------------------------
  // Invisible except for what falls on it. The painted grass is the real
  // ground; this plane exists only to catch a shadow.

  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.3 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), shadowMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const blobTex = blobTexture();
  const blobMat = new THREE.MeshBasicMaterial({
    map: blobTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
  });
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.95 * PET_SCALE, 0.95 * PET_SCALE), blobMat);
  blob.rotation.x = -Math.PI / 2;
  // Just above the plane, so it never z-fights with the cast shadow.
  blob.position.y = 0.002;
  scene.add(blob);

  // --- cat ------------------------------------------------------------------

  const rig: CatRig = buildCat(palette);
  rig.root.scale.setScalar(PET_SCALE);
  scene.add(rig.root);

  /**
   * The outlines are child hulls the rig planted during `buildCat`, each with
   * its own `thickness` / `lineColor` / `lineOpacity` uniforms. Rather than
   * rebuild the cat without them, they are collected once and retuned in place.
   */
  const inkMats: THREE.ShaderMaterial[] = [];
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (o.userData.isOutline && (m.material as THREE.ShaderMaterial)?.uniforms?.thickness) {
      inkMats.push(m.material as THREE.ShaderMaterial);
    }
  });
  // Remember what the game shipped with, so 'full' can restore it exactly.
  const inkBase = inkMats.map((m) => ({
    thickness: m.uniforms.thickness.value as number,
    color: (m.uniforms.lineColor.value as THREE.Color).clone(),
  }));

  let inkMode: InkMode = 'full';

  function applyInk(): void {
    inkMats.forEach((m, i) => {
      const base = inkBase[i];
      if (inkMode === 'none') {
        m.uniforms.lineOpacity.value = 0;
        m.visible = false;
        return;
      }
      m.visible = true;
      m.transparent = true;
      if (inkMode === 'full') {
        m.uniforms.thickness.value = base.thickness;
        m.uniforms.lineColor.value.copy(base.color);
        m.uniforms.lineOpacity.value = 1;
      } else {
        // Soft: thinner, and tinted towards the scene's own darks instead of
        // near-black, so the line reads as shadow rather than as linework.
        m.uniforms.thickness.value = base.thickness * 0.55;
        m.uniforms.lineColor.value.copy(base.color).lerp(new THREE.Color(current.groundDark), 0.6);
        m.uniforms.lineOpacity.value = 0.5;
      }
    });
  }

  const posePrev = makePose();
  const poseNext = makePose();
  const poseOut = makePose();

  let action: Action = 'idle';
  let actionT = 0;
  let blendFrom: Pose | null = null;
  let blendT = 0;
  let blendLen = 0.3;

  let walkX = 0;
  let walkDir = 1;
  let facing = 0;

  const ctx: AnimCtx = {
    t: 0,
    now: 0,
    speed: 0,
    lookYaw: 0,
    lookPitch: 0,
    mood: 0.75,
    air: 0,
    reduced: false,
  };

  let current = phase;
  let shadowsOn = true;

  function applyPhase(t: TimeOfDay): void {
    current = t;
    const L = t.light;
    key.color.set(L.keyColor);
    key.intensity = L.keyIntensity;
    key.position.set(...keyLightPosition(t));
    key.target.position.set(0, 0, 0);
    key.target.updateMatrixWorld();

    fill.color.set(L.ambientSky);
    fill.groundColor.set(L.ambientGround);
    fill.intensity = L.ambientIntensity;

    rim.color.set(L.rimColor);
    rim.intensity = L.rimIntensity;
    // Opposite the key and slightly behind, which is what separates the pet
    // from the background without lighting it from an impossible direction.
    rim.position.set(-t.sunX * 6, 2.4, -3.4);

    shadowMat.opacity = shadowsOn ? L.shadowOpacity : 0;
    blobMat.opacity = shadowsOn ? 0.28 + L.shadowOpacity * 0.55 : 0;

    // Soft ink is tinted from the scene, so it has to follow the phase.
    applyInk();
  }

  applyPhase(phase);

  // --- loop -----------------------------------------------------------------

  let raf = 0;
  let running = false;
  let last = 0;
  let clock = 0;

  function resize(): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // Pitch the camera so its horizon lands exactly on the painted one. A
    // camera looking level puts the horizon at the vertical centre; tilting up
    // pushes it down the frame.
    const f = horizonFraction(w, h);
    const ndcY = (0.5 - f) * 2;
    const halfFov = THREE.MathUtils.degToRad(FOV) / 2;
    camera.rotation.x = Math.atan(-ndcY * Math.tan(halfFov));

    camera.updateProjectionMatrix();
  }

  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
    last = now;
    clock += dt;
    actionT += dt;

    ctx.t = actionT;
    ctx.now = clock;
    ctx.mood = 0.75;

    if (action === 'walk') {
      ctx.speed = 0.42;
      walkX += walkDir * ctx.speed * dt;
      if (walkX > WALK_BOUND) {
        walkX = WALK_BOUND;
        walkDir = -1;
      } else if (walkX < -WALK_BOUND) {
        walkX = -WALK_BOUND;
        walkDir = 1;
      }
      // Turn to face the way it is going, easing rather than snapping.
      const want = walkDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      facing += (want - facing) * Math.min(1, dt * 4);
    } else {
      ctx.speed = 0;
      // Drift back to centre-ish and face the camera when not walking.
      facing += (0 - facing) * Math.min(1, dt * 3);
    }

    // A slow idle glance, so it never looks frozen between actions.
    ctx.lookYaw = Math.sin(clock * 0.31) * 0.22;
    ctx.lookPitch = Math.sin(clock * 0.23 + 1.1) * 0.08;

    evaluate(action, ctx, poseNext);

    if (blendFrom && blendT < blendLen) {
      blendT += dt;
      const k = Math.min(1, blendT / blendLen);
      // Smoothstep, so a pose change eases in and out rather than ramping.
      lerpPose(blendFrom, poseNext, k * k * (3 - 2 * k), poseOut);
      rig.apply(poseOut);
    } else {
      blendFrom = null;
      rig.apply(poseNext);
    }

    rig.root.position.x = walkX;
    rig.root.rotation.y = facing;
    blob.position.x = walkX;
    // The blob tucks under the body, which sits slightly ahead of the origin.
    blob.position.z = 0.05;

    renderer.render(scene, camera);
  }

  return {
    setPhase: applyPhase,
    setAction(a: Action) {
      if (a === action) return;
      // Capture where the cat is right now so the new action grows out of it.
      copyPose(poseNext, posePrev);
      blendFrom = posePrev;
      blendT = 0;
      blendLen = blendTime(a) || 0.3;
      action = a;
      actionT = 0;
    },
    setPalette(p: CatPalette) {
      rig.setPalette(p);
    },
    setShadows(on: boolean) {
      shadowsOn = on;
      // Re-applying the phase is the single place shadow strength is decided.
      applyPhase(current);
    },
    setInk(mode: InkMode) {
      inkMode = mode;
      applyInk();
    },
    resize,
    start() {
      if (running) return;
      running = true;
      last = 0;
      resize();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      rig.dispose();
      ground.geometry.dispose();
      shadowMat.dispose();
      blob.geometry.dispose();
      blobMat.dispose();
      blobTex.dispose();
      renderer.dispose();
    },
  };
}

/** Cheap capability probe — the caller renders a static fallback if false. */
export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
