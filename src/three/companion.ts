import * as THREE from 'three';
import {
  buildAnimal,
  copyPose,
  DEFAULT_PALETTE,
  lerpPose,
  makePose,
  type PetPalette,
  type PetRig,
} from './animal';
import { ACTION_LENGTH, blendTime, evaluate, isOneShot, type Action, type AnimCtx } from './animations';
import type { SpeciesId } from './species';
import { softenInk } from './toon';

/**
 * The pet, rendered on its own, small, and anywhere on the page.
 *
 * This is deliberately NOT a second animal. It builds the same rig from
 * `buildAnimal` and drives it with the same `evaluate` the stage uses, so every
 * species, every palette, every one of the fifteen actions and every mood bias
 * is the real thing — a companion that reimplemented the cat would drift from
 * the stage's cat the first time either was touched.
 *
 * What it leaves out is the *world*: no painted scene, no props, no ground, no
 * shadow map, no weather and no gift errands. Those belong to a stage the
 * player is looking at. This one has to sit over a settings page at 140px and
 * cost almost nothing, so it is the animal, three lights, and a transparent
 * background.
 *
 * The engine keeps ownership of where the pet *is*. This class only knows which
 * action to play and which way to face; the island above it decides where on
 * the page the box goes and when the animal should walk. That split is what
 * lets the same renderer be a walking cat at the bottom of the window and a cat
 * sitting still in a corner without knowing the difference.
 */

/** Matches the stage, so a cat is the same size relative to itself. */
const PET_SCALE = 0.62;
/**
 * A long lens, for the same reason the stage uses one: a wide angle bends the
 * animal at the edges of frame and reads as a fisheye toy rather than a pet.
 */
const FOV = 26;
/**
 * Closer than the stage's 4.6. The stage frames a cat inside a landscape; this
 * frames a cat and nothing else, so the animal has to fill the box.
 */
const CAM_DIST = 1.42;
const CAM_HEIGHT = 0.30;
/** Aim a little above the floor — at the body, not the feet. */
const LOOK_AT = new THREE.Vector3(0, 0.26, 0);

export interface CompanionOptions {
  canvas: HTMLCanvasElement;
  species?: SpeciesId;
  palette?: PetPalette;
  reduced?: boolean;
}

export class Companion {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pet: PetRig;

  private pose = makePose();
  private poseA = makePose();
  private poseB = makePose();

  private action: Action = 'idle';
  private prevAction: Action = 'idle';
  private actionT = 0;
  private prevActionT = 0;
  private blend = 1;
  private blendDur = 0.3;
  /** A one-shot holds the rig until it finishes, so a click is never eaten. */
  private lockUntil = 0;

  private mood = 0.7;
  private facing = 0;
  private targetFacing = 0;
  private speed = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private blinkAt = 0;
  private blinkT = -1;

  private reduced: boolean;
  private raf = 0;
  private running = false;
  private lastT = 0;
  private clock = 0;
  private disposed = false;

  constructor(opts: CompanionOptions) {
    this.reduced = opts.reduced ?? false;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      // The page shows through everywhere the animal is not — this canvas sits
      // over whatever the player is actually reading.
      alpha: true,
      // Explicitly not 'high-performance'. This runs on every page, often
      // alongside the stage, and asking a laptop to spin up its discrete GPU
      // to draw a 140px cat is how a pomodoro timer earns a reputation for
      // flattening batteries.
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    // No shadow map. There is no ground here to catch a shadow, and enabling
    // one costs a second render pass per frame for nothing.

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
    this.camera.position.set(0, CAM_HEIGHT, CAM_DIST);
    this.camera.lookAt(LOOK_AT);

    this.setupLights();

    this.pet = buildAnimal(opts.species ?? 'cat', opts.palette ?? DEFAULT_PALETTE);
    this.pet.root.scale.setScalar(PET_SCALE * this.pet.species.scale);
    this.scene.add(this.pet.root);
    softenInk(this.pet.root, 0x6b5b73, 0.55);

    this.pet.apply(this.pose);
    this.resize();
  }

  private setupLights(): void {
    // Three lights, no scene lighting recipe: this pet is not standing in any
    // particular weather, so it gets a neutral, flattering key that reads the
    // same over a light page and a dark one.
    const key = new THREE.DirectionalLight(0xffffff, 1.55);
    key.position.set(2.4, 3.2, 2.6);
    this.scene.add(key);

    const fill = new THREE.HemisphereLight(0xfff4e8, 0x8d84a0, 1.05);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.55);
    rim.position.set(-2.2, 1.6, -2.4);
    this.scene.add(rim);
  }

  // --- what the animal is doing ---------------------------------------------

  /**
   * Ask for an action. One-shots (petted, celebrate, jump) hold until they are
   * done, so a burst of clicks does not leave the rig twitching between frames.
   */
  setAction(next: Action, force = false): void {
    if (this.disposed) return;
    if (!force && this.clock < this.lockUntil) return;
    if (next === this.action) return;

    copyPose(this.pose, this.poseA);
    this.prevAction = this.action;
    this.prevActionT = this.actionT;
    this.action = next;
    this.actionT = 0;
    this.blend = 0;
    this.blendDur = Math.max(0.001, blendTime(next));

    if (isOneShot(next)) {
      this.lockUntil = this.clock + (ACTION_LENGTH[next] ?? 0.9);
    }
  }

  /** Which action is on screen right now. */
  currentAction(): Action {
    return this.action;
  }

  /** True while a one-shot is still playing out. */
  busy(): boolean {
    return this.clock < this.lockUntil;
  }

  /** -1 faces left, 1 faces right. Turns smoothly rather than snapping. */
  setFacing(dir: -1 | 1): void {
    // The rig's neutral faces the camera; a quarter turn either way reads as
    // "walking that way" without ever showing a pure side-on silhouette, which
    // at this size loses the face entirely.
    this.targetFacing = dir === 1 ? 0.85 : -0.85;
  }

  /** Ground speed, so walk blends into run exactly as it does on the stage. */
  setSpeed(v: number): void {
    this.speed = Math.max(0, v);
  }

  /** 0 miserable, 1 delighted. Biases ears and tail through every action. */
  setMood(m: number): void {
    this.mood = Math.min(1, Math.max(0, m));
  }

  setReduced(r: boolean): void {
    this.reduced = r;
  }

  /** Aim the head, in radians relative to the body — used to follow a pointer. */
  setLook(yaw: number, pitch: number): void {
    this.lookYaw = yaw;
    this.lookPitch = pitch;
  }

  setPet(species: SpeciesId, palette: PetPalette): void {
    if (this.disposed) return;
    if (species === this.pet.species.id) {
      this.pet.setPalette(palette);
      return;
    }
    // A different animal is a different rig — bone counts and proportions both
    // change — so it is rebuilt rather than re-skinned, exactly as the stage
    // does it.
    const facing = this.pet.root.rotation.y;
    this.scene.remove(this.pet.root);
    this.pet.dispose();

    this.pet = buildAnimal(species, palette);
    this.pet.root.scale.setScalar(PET_SCALE * this.pet.species.scale);
    this.pet.root.rotation.y = facing;
    this.scene.add(this.pet.root);
    softenInk(this.pet.root, 0x6b5b73, 0.55);
    this.pet.apply(this.pose);
  }

  // --- frame ----------------------------------------------------------------

  resize(): void {
    if (this.disposed) return;
    const c = this.renderer.domElement;
    const w = Math.max(1, c.clientWidth);
    const h = Math.max(1, c.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastT = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      const dt = Math.min((now - this.lastT) / 1000, 0.05);
      this.lastT = now;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private update(dt: number): void {
    this.clock += dt;
    this.actionT += dt;
    this.prevActionT += dt;

    // Turn towards the way it is walking rather than snapping, so a cat that
    // changes its mind at a wall pivots like an animal.
    const turn = 1 - Math.exp(-9 * dt);
    this.facing += (this.targetFacing - this.facing) * turn;
    this.pet.root.rotation.y = this.facing;

    // A one-shot that has run its length hands back to a resting pose.
    if (isOneShot(this.action) && this.clock >= this.lockUntil) {
      this.setAction(this.speed > 0.02 ? 'walk' : 'idle', true);
    }

    // Blink on a wandering timer. Cheap, and its absence is the single biggest
    // reason a rig reads as a puppet rather than an animal.
    if (!this.reduced) {
      if (this.clock > this.blinkAt) {
        this.blinkT = 0;
        this.blinkAt = this.clock + 2.4 + Math.random() * 3.6;
      }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        if (this.blinkT > 0.16) this.blinkT = -1;
      }
    }

    const ctx: AnimCtx = {
      t: this.actionT,
      now: this.clock,
      speed: this.speed,
      lookYaw: this.lookYaw,
      lookPitch: this.lookPitch,
      mood: this.mood,
      air: 0,
      reduced: this.reduced,
    };

    evaluate(this.action, ctx, this.poseB);

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / this.blendDur);
      // The outgoing action keeps advancing while it fades, or a walk cycle
      // would freeze mid-stride for the length of the crossfade.
      const prevCtx: AnimCtx = { ...ctx, t: this.prevActionT };
      evaluate(this.prevAction, prevCtx, this.poseA);
      lerpPose(this.poseA, this.poseB, this.blend, this.pose);
    } else {
      copyPose(this.poseB, this.pose);
    }

    if (this.blinkT >= 0) this.pose.eye = 0;

    this.pet.apply(this.pose);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.scene.remove(this.pet.root);
    this.pet.dispose();
    this.renderer.dispose();
  }
}
