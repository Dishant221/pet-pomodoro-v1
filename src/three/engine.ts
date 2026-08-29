/**
 * The stage engine: renderer, world, cat, behaviour and input in one object.
 *
 * The app talks to it in intents ("the cat should be sleeping now") rather than
 * animations. The engine decides how to get there — walk to the cushion first,
 * circle, then curl up — which is what makes the cat feel like it has its own
 * agenda instead of snapping between poses.
 */
import * as THREE from 'three';
import type { SceneId } from '../game/manifest';
import type { PetState } from '../game/manifest';
import type { SnackId } from '../game/economy';
import { buildAnimal, DEFAULT_PALETTE, type PetPalette, type PetRig, copyPose, lerpPose, makePose } from './animal';
import type { SpeciesId } from './species';
import { ACTION_LENGTH, MEOW_PERIOD, blendTime, evaluate, type Action, type AnimCtx } from './animations';
import { buildProp, TOY_IDS, TOYS, type PropId, type PropSpec } from './props';
import { buildPaintedWorld } from './painted';
import type { LightRecipe, World } from './stage-types';
import { createFx, type FxSystem } from './fx';
import { disposeTree, softenInk } from './toon';
import { modulate } from './daylight';
import { horizonFraction } from '../world/paint';
import { dayFraction, FAIR_WEATHER, type Weather } from '../game/world';

export interface EngineCallbacks {
  /** A completed stroke — worth coins and happiness. */
  onPet(): void;
  /** A quick poke — the cat plays. */
  onPoke(): void;
  /** The cat reached dropped food and started eating. */
  onFeed(): void;
  /** A begging meow beat, so the audio layer can play a matching sound. */
  onMeow(): void;
  onPurrStart(): void;
  onPurrEnd(): void;
  /** The cat has presented a fetched gift at the front of the stage. */
  onGift(prop: PropSpec): void;
  /** Pointer is over the cat — the wrapper swaps the cursor. */
  onHover(over: boolean): void;
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  scene: SceneId;
  species?: SpeciesId;
  palette?: PetPalette;
  reduced?: boolean;
  callbacks: EngineCallbacks;
}

type Behaviour = 'roam' | 'sleep' | 'beg' | 'eat' | 'play' | 'gift' | 'sad' | 'petted' | 'celebrate' | 'wake' | 'sofa';

const UP = new THREE.Vector3(0, 1, 0);
const GROUND = new THREE.Plane(UP, 0);

/** Camera framing for the painted stage. See the constructor for the why. */
const FOV = 26;
const CAM_DIST = 4.6;
const CAM_HEIGHT = 0.62;
/**
 * The cat is small in frame on purpose. Every reference the art direction is
 * built from is a landscape with an animal in it, not a portrait of an animal.
 */
const PET_SCALE = 0.62;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const damp = (a: number, b: number, lambda: number, dt: number) => THREE.MathUtils.lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private canvas: HTMLCanvasElement;
  private cb: EngineCallbacks;

  private key!: THREE.DirectionalLight;
  private fill!: THREE.HemisphereLight;
  private rim!: THREE.DirectionalLight;

  private world!: World;
  private worldId: SceneId;

  /**
   * The player's real time and weather. Defaults keep the stage looking right
   * before the world store has had a chance to report in.
   */
  private dayFrac = dayFraction();
  private weather: Weather = FAIR_WEATHER;
  /** Seconds since the lighting was last recomputed. */
  private lightAge = Infinity;
  /** Camera pitch that lands the 3D horizon on the painted one, in radians. */
  private horizonPitch = 0;
  private pet: PetRig;
  private fx: FxSystem;

  // --- pose state ---
  private pose = makePose();
  private poseA = makePose();
  private poseB = makePose();
  private action: Action = 'idle';
  private prevAction: Action = 'idle';
  private actionT = 0;
  private prevActionT = 0;
  private blend = 1;
  private blendDur = 0.3;
  /** Set while a one-shot action must finish before behaviour may change it. */
  private lockUntil = 0;

  // --- locomotion ---
  private pos = new THREE.Vector3();
  private facing = 0;
  private speed = 0;
  private target: THREE.Vector3 | null = null;
  private arriveAt = 0.12;
  private onArrive: (() => void) | null = null;
  private wantRun = false;
  private airT = -1;
  private airDur = 0.7;

  // --- behaviour ---
  private behaviour: Behaviour = 'roam';
  private intent: PetState = 'idle';
  private nextIdleAt = 0;
  private nextMeowAt = 0;
  private begT = 0;
  /** 0 = not on the sofa; 1 = jumping up; 2 = rolling; 3 = asleep. Its own
   * field, deliberately — sharing `begT` across two unrelated errands is how
   * the sofa sequence silently deadlocked the first time a beg had happened. */
  private sofaPhase = 0;
  private giftPhase = 0;
  private giftProp: THREE.Group | null = null;
  private giftSpec: PropSpec | null = null;
  private mood = 0.7;
  /** True while the cat is on an errand the store must not interrupt. */
  private busy = false;

  // --- ground objects the cat can interact with ---
  private droppedFood: { mesh: THREE.Group; at: THREE.Vector3 } | null = null;
  private groundToys: THREE.Group[] = [];
  private dragProp: THREE.Group | null = null;
  /** Was the pointer over the stage at the last drag move? Decides the drop. */
  private dragOverStage = false;

  // --- input ---
  private pointer = new THREE.Vector2(0, 0);
  private pointerActive = false;
  private ray = new THREE.Raycaster();
  private hovering = false;
  private pressing = false;
  private pressAt = 0;
  private pressMoved = 0;
  private petting = false;
  private lastPetCredit = 0;
  private lookYaw = 0;
  private lookPitch = 0;

  // --- loop ---
  /** Seconds, from performance.now(). Reset on start so a paused tab can't jump. */
  private lastT = 0;
  private now = 0;
  private raf = 0;
  private running = false;
  private reduced: boolean;
  private blinkAt = 0;
  private blinkT = -1;
  private disposed = false;

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas;
    this.cb = opts.callbacks;
    this.reduced = opts.reduced ?? false;
    this.worldId = opts.scene;

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      // Transparent: the painted layers sit behind this canvas in the DOM and
      // have to show through everywhere the cat and its props are not.
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearAlpha(0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // flat, poster-like anime colour
    this.renderer.shadowMap.enabled = true;
    // Soft shadows: a hard-edged shadow on a painted, brush-textured ground is
    // the tell that gives the composite away.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // A long lens, deliberately. Painted backgrounds are effectively
    // orthographic — an illustrator does not draw wide-angle distortion — so a
    // wide camera makes the pet diverge from the painting's perspective
    // towards the edges of frame.
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.camera.position.set(0, CAM_HEIGHT, CAM_DIST);

    this.setupLights();

    this.pet = buildAnimal(opts.species ?? 'cat', opts.palette ?? DEFAULT_PALETTE);
    this.pet.root.scale.setScalar(PET_SCALE * this.pet.species.scale);
    this.scene.add(this.pet.root);

    this.fx = createFx(this.reduced);
    this.scene.add(this.fx.group);

    this.loadWorld(opts.scene);
    this.attachInput();
    this.resize();
  }

  // --- setup ---------------------------------------------------------------

  private setupLights(): void {
    this.key = new THREE.DirectionalLight(0xffffff, 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 0.5;
    this.key.shadow.camera.far = 22;
    const c = this.key.shadow.camera;
    c.left = -4.5;
    c.right = 4.5;
    c.top = 4.5;
    c.bottom = -4.5;
    // A small bias stops the classic shadow acne on the flat ground plane.
    this.key.shadow.bias = -0.0012;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target);

    this.fill = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
    this.scene.add(this.fill);

    this.rim = new THREE.DirectionalLight(0xffffff, 0.8);
    this.scene.add(this.rim);

    // No sky dome. The sky is painted, in the DOM, behind this canvas — a
    // modelled dome would simply cover it up.
  }

  private loadWorld(id: SceneId): void {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    this.worldId = id;
    this.world = buildPaintedWorld(id);
    this.scene.add(this.world.group);

    // Match the ink to the scene's own darks. Re-applied per world because
    // each scene's shadows are a different colour.
    const ink = this.world.lights.fill.ground;
    softenInk(this.pet.root, ink, 0.62);
    softenInk(this.world.group, ink, 0.7);

    this.lightAge = Infinity;
    this.refreshLighting();

    // Re-home everything that lives on the old floor.
    this.clearGround();
    this.busy = false;
    this.pos.set(0, 0, 0.1);
    this.pet.root.position.copy(this.pos);
    this.target = null;
    this.speed = 0;
  }

  /**
   * How much of the outdoor sky each world actually sees.
   *
   * The living room has windows, not weather — running it at full strength put
   * a sunset inside the lounge and it read as a house fire. The treehouse is
   * partly sheltered; the garden and jungle are wide open.
   *
   * The two alpine scenes are over 1: there is no canopy at altitude, and a
   * snowfield is a mirror, so it throws a good deal of the sky back up at
   * whatever is standing on it.
   */
  private static readonly EXPOSURE: Partial<Record<SceneId, number>> = {
    livingroom: 0.35,
    treehouse: 0.8,
    mountain: 1.1,
    snow: 1.2,
  };

  /**
   * Rebuild the lighting from the world's own recipe, bent to the player's
   * real time and weather.
   *
   * Worlds animate their own `lights` during `update` (window light moving
   * across a room, for one), so this modulates whatever the world currently
   * says rather than a snapshot taken at load.
   */
  private refreshLighting(): void {
    const L: LightRecipe = modulate(this.world.lights, {
      fraction: this.dayFrac,
      weather: this.weather,
      exposure: Engine.EXPOSURE[this.worldId] ?? 1,
    });

    this.key.color.set(L.key.color);
    this.key.intensity = L.key.intensity;
    this.key.position.set(...L.key.position);
    this.fill.color.set(L.fill.sky);
    this.fill.groundColor.set(L.fill.ground);
    this.fill.intensity = L.fill.intensity;
    this.rim.color.set(L.rim.color);
    this.rim.intensity = L.rim.intensity;
    this.rim.position.set(...L.rim.position);

    // Reuse the fog object; replacing it every quarter second would churn.
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(L.fog.color);
      this.scene.fog.near = L.fog.near;
      this.scene.fog.far = L.fog.far;
    } else {
      this.scene.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);
    }

    this.lightAge = 0;
  }

  /**
   * How far the painted backdrop must slide to stay under the cat's feet,
   * as a fraction of the canvas width.
   *
   * The camera pans laterally to follow the cat. On a modelled set that is
   * free, because the set moves with it; against a painting it is not — leave
   * the backdrop still and the ground visibly slides out from under the paws.
   * The caller multiplies this by a per-layer depth so the sky barely moves
   * and the near ground moves fully, which is the same parallax the camera is
   * already producing for the 3D objects.
   */
  backdropShift(): number {
    const halfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    // Width of the world visible at the plane the cat stands on.
    const visibleW = 2 * this.camera.position.z * halfV * this.camera.aspect;
    return visibleW > 0 ? -this.camera.position.x / visibleW : 0;
  }

  /** Tell the stage what time it is and what the sky is doing. */
  setDaylight(fraction: number, weather: Weather): void {
    this.dayFrac = fraction;
    this.weather = weather;
    if (this.world) this.refreshLighting();
  }

  private clearGround(): void {
    for (const t of this.groundToys) {
      t.parent?.remove(t);
      disposeTree(t);
    }
    this.groundToys.length = 0;
    if (this.droppedFood) {
      this.droppedFood.mesh.parent?.remove(this.droppedFood.mesh);
      disposeTree(this.droppedFood.mesh);
      this.droppedFood = null;
    }
    if (this.giftProp) {
      this.giftProp.parent?.remove(this.giftProp);
      disposeTree(this.giftProp);
      this.giftProp = null;
    }
  }

  // --- public API ----------------------------------------------------------

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastT = performance.now() / 1000;
    const tick = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.frame();
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setScene(id: SceneId): void {
    if (id === this.worldId) return;
    this.loadWorld(id);
  }

  setPalette(p: PetPalette): void {
    this.pet.setPalette(p);
  }

  /**
   * Equip a character: a species and a coat.
   *
   * A recolour is a material change and costs nothing. A different species is a
   * different skeleton, so it has to be rebuilt — but only the rig is thrown
   * away. The world, the lighting, the camera and the animation state all
   * survive, and the new animal is dropped in exactly where the old one stood,
   * facing the same way, so equipping reads as the pet changing rather than as
   * the scene reloading.
   */
  setPet(species: SpeciesId, p: PetPalette): void {
    if (species === this.pet.species.id) {
      this.pet.setPalette(p);
      return;
    }

    const at = this.pet.root.position.clone();
    const facing = this.pet.root.rotation.y;
    this.scene.remove(this.pet.root);
    this.pet.dispose();

    this.pet = buildAnimal(species, p);
    this.pet.root.scale.setScalar(PET_SCALE * this.pet.species.scale);
    this.pet.root.position.copy(at);
    this.pet.root.rotation.y = facing;
    this.scene.add(this.pet.root);

    // The ink tint belongs to the scene, not to the animal, so a fresh rig has
    // to be told about it or it wears default outlines in a graded world.
    if (this.world) softenInk(this.pet.root, this.world.lights.fill.ground, 0.62);
    this.pet.apply(this.pose);
  }

  setReduced(r: boolean): void {
    this.reduced = r;
  }

  /**
   * Hide the animal without tearing the stage down.
   *
   * Used when the player has moved the pet onto the page: the painted world,
   * the weather and the props all stay, and only the cat leaves. Drawing it in
   * both places at once would put two of the same animal on one screen, which
   * reads as a bug however it is explained.
   *
   * The rig keeps simulating while hidden — it costs almost nothing, and a pet
   * that had been frozen for an hour would snap through a stale walk cycle the
   * moment the setting was switched back.
   */
  setPetVisible(v: boolean): void {
    this.pet.root.visible = v;
  }

  /** Drives the cat's agenda from the app's pet-state store. */
  setIntent(state: PetState): void {
    if (state === this.intent) return;
    this.intent = state;
    // An errand and an active stroke both outrank a store-driven change.
    // Without this, a `begging` state arriving mid-walk would send the cat to
    // the front of the stage and abandon the food it was on its way to eat.
    if (this.busy || this.petting) return;
    this.applyIntent(state);
  }

  /** 0 = miserable, 1 = delighted. Biases ears, tail and idle behaviour. */
  setMood(m: number): void {
    this.mood = clamp(m, 0, 1);
  }

  /** Kick off the fetch-a-present errand after a completed session. */
  deliverGift(preferred?: PropId): void {
    if (this.behaviour === 'gift') return;
    const id = preferred ?? TOY_IDS[Math.floor(Math.random() * TOY_IDS.length)];
    this.giftSpec = TOYS[id as keyof typeof TOYS] ?? { id, kind: 'food', label: id, glyph: '🎁' };
    this.behaviour = 'gift';
    this.giftPhase = 0;
    this.petting = false;
    this.busy = true;
    // Run to the nearest stash first — the cat has to go and get it.
    const stash = this.nearest(this.world.stash);
    this.goTo(stash, 0.35, true, () => this.giftArrive());
  }

  // --- snack drag & drop ---------------------------------------------------

  /** Begins a HUD-initiated drag. Shows the snack floating over the floor. */
  beginDrag(snack: SnackId): void {
    this.endDrag(false);
    this.dragProp = buildProp(snack);
    this.dragProp.scale.setScalar(1.15);
    this.scene.add(this.dragProp);
  }

  /** Moves the dragged snack to wherever the pointer projects onto the floor. */
  moveDrag(clientX: number, clientY: number): void {
    if (!this.dragProp) return;

    // Whether the drop counts is a *screen-space* question — is the pointer
    // over the stage? — so it is answered in screen space. It used to be
    // inferred from where the pointer projected onto the ground, which worked
    // only because the camera was wide. On the painted stage's long lens, a
    // point aimed at the cat's body projects a long way behind it, and drops
    // aimed squarely at the cat were being rejected as off-stage.
    const r = this.canvas.getBoundingClientRect();
    this.dragOverStage =
      clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;

    const p = this.projectToGround(clientX, clientY);
    if (!p) return;
    this.dragProp.position.set(p.x, 0.16 + Math.sin(this.now * 6) * 0.02, p.z);
    this.dragProp.rotation.y = this.now * 1.6;
  }

  /**
   * Ends the drag. When dropped inside the play area the snack lands on the
   * floor and the cat goes to investigate; otherwise it is returned to the tray.
   * Returns true when the food actually landed.
   */
  endDrag(commit = true): boolean {
    const prop = this.dragProp;
    this.dragProp = null;
    if (!prop) return false;

    // Dropped on the stage at all? Then it lands, pulled inside the play area
    // if it has to be. The player aimed at the cat; refusing because the ray
    // happened to hit the floor two metres behind it would feel broken, and
    // with a long lens that is exactly where an aim at the cat's body lands.
    const onStage = commit && this.dragOverStage;
    this.dragOverStage = false;

    if (!onStage) {
      this.scene.remove(prop);
      disposeTree(prop);
      return false;
    }

    const b = this.world.bounds;
    prop.position.x = clamp(prop.position.x, b.minX, b.maxX);
    prop.position.z = clamp(prop.position.z, b.minZ, b.maxZ);

    if (this.droppedFood) {
      this.droppedFood.mesh.parent?.remove(this.droppedFood.mesh);
      disposeTree(this.droppedFood.mesh);
    }
    prop.position.y = 0;
    prop.rotation.y = Math.random() * Math.PI;
    prop.scale.setScalar(1);
    this.droppedFood = { mesh: prop, at: prop.position.clone() };
    this.fx.burst('sparkle', new THREE.Vector3(prop.position.x, 0.2, prop.position.z), { count: 5, size: 0.16 });

    // The cat notices immediately and trots over. `busy` protects the walk so
    // a `begging` or `sad` state arriving mid-stride can't cancel dinner.
    this.behaviour = 'eat';
    this.petting = false;
    this.busy = true;
    this.goTo(this.approachPoint(this.droppedFood.at, 0.3), 0.16, false, () => {
      this.busy = false;
      this.faceTowards(this.droppedFood?.at ?? this.pos);
      this.playAction('eat', 3.2);
      // The snack disappears partway through the meal rather than lingering
      // on the floor for the cat to walk back to.
      window.setTimeout(() => {
        if (!this.droppedFood) return;
        this.fx.burst('sparkle', new THREE.Vector3(this.droppedFood.at.x, 0.18, this.droppedFood.at.z), {
          count: 4,
          size: 0.14,
        });
        this.droppedFood.mesh.parent?.remove(this.droppedFood.mesh);
        disposeTree(this.droppedFood.mesh);
        this.droppedFood = null;
      }, 1800);
      // Fires last: it flips the store to `eating`, which re-enters setIntent.
      this.cb.onFeed();
    });
    return true;
  }

  /**
   * Where the cat currently is in client coordinates, or null when it is off
   * screen. Used to anchor HTML overlays to the cat and to let tests aim the
   * pointer at a target that moves under its own steam.
   */
  catScreenPos(): { x: number; y: number } | null {
    const v = new THREE.Vector3();
    this.pet.hit.getWorldPosition(v);
    v.project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.detachInput();
    this.clearGround();
    if (this.dragProp) {
      this.scene.remove(this.dragProp);
      disposeTree(this.dragProp);
    }
    this.world.dispose();
    this.pet.dispose();
    this.fx.dispose();
    this.renderer.dispose();
  }

  /**
   * Where the painted horizon actually lands on screen, 0..1 down the frame.
   *
   * The background layers are `preserveAspectRatio="slice"`, so a container
   * that is not 16:9 crops them — and the horizon moves with the crop. Reading
   * that back means the camera can follow it instead of assuming a fixed 62%,
   * which is what keeps the two ground planes agreeing at every window size.
   */
  /**
   * Where the painted horizon is, asked of the painter rather than recomputed.
   *
   * This used to derive it here from the overscan and the crop. It now also
   * depends on the deliberate vertical lift the backdrop applies to keep the
   * horizon near a chosen fraction, and a second copy of that arithmetic would
   * drift from the first — the symptom being a pet lit and pitched for a ground
   * plane a few degrees away from the one it is standing on.
   */
  private horizonFraction(w: number, h: number): number {
    return horizonFraction(w, h);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;

    // Pull the camera back on narrow viewports so the stage always fits
    // horizontally — otherwise the cat walks straight out of frame on a phone.
    const halfV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const needed = 1.9 / Math.max(0.35, aspect * halfV);
    this.camera.position.z = clamp(needed, CAM_DIST, CAM_DIST * 1.7);
    // Low, near cat-height framing — looking down on a pet reads as detachment.
    this.camera.position.y = clamp(0.42 + needed * 0.06, CAM_HEIGHT, 1.0);

    // The pitch that puts the camera's horizon exactly on the painted one. A
    // camera looking level puts the horizon at the vertical centre; tilting up
    // pushes it down the frame.
    const ndcY = (0.5 - this.horizonFraction(w, h)) * 2;
    this.horizonPitch = Math.atan(-ndcY * halfV);

    this.camera.updateProjectionMatrix();
  }

  // --- intent --------------------------------------------------------------

  private applyIntent(state: PetState): void {
    switch (state) {
      case 'sleeping':
        this.behaviour = 'sleep';
        this.goTo(this.world.bed, 0.14, false, () => {
          this.faceTowards(new THREE.Vector3(this.pos.x + 0.6, 0, this.pos.z + 0.3));
          this.playAction('sleep');
        });
        break;
      case 'begging':
        this.behaviour = 'beg';
        this.begT = 0;
        this.nextMeowAt = 0.6;
        // Come to the front of the stage and ask the player directly.
        this.goTo(new THREE.Vector3(0.15, 0, this.world.bounds.maxZ - 0.15), 0.14, false, () => {
          this.faceCamera();
          this.playAction('beg');
        });
        break;
      case 'eating':
        if (this.behaviour !== 'eat') {
          this.behaviour = 'eat';
          this.goTo(this.approachPoint(this.world.bowl, 0.32), 0.16, false, () => {
            this.faceTowards(this.world.bowl);
            this.playAction('eat', 3.2);
          });
        }
        break;
      case 'petted':
        this.behaviour = 'petted';
        this.stopMoving();
        this.playAction('petted', 2.4);
        break;
      case 'playing':
        this.behaviour = 'play';
        this.stopMoving();
        this.playAction('play', 3.2);
        break;
      case 'celebrating':
        this.behaviour = 'celebrate';
        this.stopMoving();
        this.faceCamera();
        this.playAction('celebrate', 3.0);
        this.fx.burst('star', this.pet.headWorld, { count: 8, rise: 1.2, size: 0.26 });
        break;
      case 'waking':
        this.behaviour = 'wake';
        this.stopMoving();
        this.playAction('stretch', 2.4);
        break;
      case 'sad':
        this.behaviour = 'sad';
        this.stopMoving();
        break;
      default:
        this.behaviour = 'roam';
        this.nextIdleAt = this.now + 1.5;
        break;
    }
  }

  // --- navigation ----------------------------------------------------------

  private goTo(dest: THREE.Vector3, arrive: number, run: boolean, done?: () => void): void {
    const b = this.world.bounds;
    this.target = new THREE.Vector3(clamp(dest.x, b.minX, b.maxX), 0, clamp(dest.z, b.minZ, b.maxZ));
    this.arriveAt = arrive;
    this.wantRun = run;
    this.onArrive = done ?? null;
  }

  private stopMoving(): void {
    this.target = null;
    this.onArrive = null;
    this.wantRun = false;
  }

  /** A point `dist` from `at`, on the side the cat is already standing. */
  private approachPoint(at: THREE.Vector3, dist: number): THREE.Vector3 {
    const dir = new THREE.Vector3().subVectors(this.pos, at).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    return dir.normalize().multiplyScalar(dist).add(at).setY(0);
  }

  private nearest(list: THREE.Vector3[]): THREE.Vector3 {
    let best = list[0];
    let bestD = Infinity;
    for (const v of list) {
      const d = v.distanceToSquared(this.pos);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private faceTowards(p: THREE.Vector3): void {
    this.facing = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  private faceCamera(): void {
    this.faceTowards(new THREE.Vector3(this.camera.position.x, 0, this.camera.position.z));
  }

  private randomSpot(): THREE.Vector3 {
    const b = this.world.bounds;
    return new THREE.Vector3(
      b.minX + Math.random() * (b.maxX - b.minX),
      0,
      b.minZ + Math.random() * (b.maxZ - b.minZ),
    );
  }

  // --- actions -------------------------------------------------------------

  private playAction(a: Action, lockFor?: number): void {
    if (this.action === a && lockFor == null) return;
    this.prevAction = this.action;
    this.prevActionT = this.actionT;
    this.action = a;
    this.actionT = 0;
    this.blend = 0;
    this.blendDur = this.reduced ? 0.08 : blendTime(a);
    const lock = lockFor ?? ACTION_LENGTH[a];
    this.lockUntil = lock ? this.now + lock : 0;
    if (a === 'jump') {
      this.airT = 0;
      this.airDur = 0.7;
    }
  }

  private get locked(): boolean {
    return this.now < this.lockUntil;
  }

  // --- behaviour tick ------------------------------------------------------

  private tickBehaviour(dt: number): void {
    switch (this.behaviour) {
      case 'roam':
        this.tickRoam();
        break;
      case 'beg':
        this.tickBeg(dt);
        break;
      case 'gift':
        break; // driven entirely by arrival callbacks
      case 'sofa':
        break; // driven entirely by arrival callbacks
      case 'sad':
        if (!this.locked && !this.target) this.playAction('sad');
        break;
      case 'petted':
        if (!this.locked && !this.petting) this.behaviour = 'roam';
        break;
      case 'sleep':
      case 'eat':
      case 'play':
      case 'celebrate':
      case 'wake':
        // These hold until their one-shot expires or the store changes intent.
        if (!this.locked && !this.target && this.behaviour !== 'sleep') {
          this.behaviour = 'roam';
          this.nextIdleAt = this.now + 0.5;
        }
        break;
    }
  }

  private tickRoam(): void {
    if (this.target || this.locked) return;

    // A toy on the floor is more interesting than anything else.
    if (this.groundToys.length && Math.random() < 0.5 && this.now > this.nextIdleAt) {
      const toy = this.groundToys[Math.floor(Math.random() * this.groundToys.length)];
      this.nextIdleAt = this.now + 6 + Math.random() * 5;
      this.goTo(this.approachPoint(toy.position, 0.34), 0.18, Math.random() < 0.4, () => {
        this.faceTowards(toy.position);
        this.playAction('play', 3.2);
      });
      return;
    }

    if (this.now < this.nextIdleAt) {
      if (this.action !== 'idle' && !this.locked) this.playAction('idle');
      return;
    }

    // Pick something cat-like to do next, weighted by mood. The sofa gets the
    // largest slice on purpose — it's the newest, most visible thing the cat
    // does, and a rare 12%-of-the-time roll made it nearly impossible to spot.
    const roll = Math.random();
    this.nextIdleAt = this.now + 5 + Math.random() * 7;
    if (roll < 0.12) {
      this.goTo(this.randomSpot(), 0.14, this.mood > 0.6 && Math.random() < 0.25);
    } else if (roll < 0.2) {
      this.playAction('groom', 4);
    } else if (roll < 0.28) {
      this.playAction('stretch', 2.4);
    } else if (roll < 0.35 && this.mood > 0.45) {
      this.playAction('jump', 0.75);
      this.fx.burst('sparkle', new THREE.Vector3(this.pos.x, 0.15, this.pos.z), { count: 4, size: 0.13, rise: 0.4 });
    } else if (this.mood > 0.15) {
      this.sofaErrand();
    } else {
      this.playAction('idle');
      this.nextIdleAt = this.now + 3 + Math.random() * 4;
    }
  }

  /** Walk to the sofa, jump onto it, roll around, then curl up and nap there. */
  private sofaErrand(): void {
    this.behaviour = 'sofa';
    this.sofaPhase = 0;
    this.goTo(this.world.sofa, 0.22, false, () => this.sofaJump());
  }

  private sofaJump(): void {
    if (this.behaviour !== 'sofa') return;
    this.sofaPhase = 1;
    this.faceTowards(this.world.sofa);
    this.playAction('jump', 0.8);
    this.fx.burst('sparkle', new THREE.Vector3(this.pos.x, 0.15, this.pos.z), { count: 4, size: 0.13, rise: 0.4 });
    window.setTimeout(() => {
      if (this.behaviour === 'sofa' && this.sofaPhase === 1) this.sofaRoll();
    }, 800);
  }

  private sofaRoll(): void {
    this.sofaPhase = 2;
    this.playAction('roll', 2.4);
    this.fx.burst('sparkle', this.pet.headWorld, { count: 5, size: 0.14, rise: 0.3 });
    window.setTimeout(() => {
      if (this.behaviour === 'sofa' && this.sofaPhase === 2) this.sofaNap();
    }, 2400);
  }

  private sofaNap(): void {
    this.sofaPhase = 3;
    this.playAction('sleep', 3.0);
    window.setTimeout(() => {
      if (this.behaviour === 'sofa' && this.sofaPhase === 3) {
        this.sofaPhase = 0;
        this.behaviour = 'roam';
        this.nextIdleAt = this.now + 1;
      }
    }, 3000);
  }

  private tickBeg(dt: number): void {
    if (this.target) return;
    if (this.action !== 'beg') this.playAction('beg');
    this.begT += dt;

    // Ask, and keep asking. Each beat opens the mouth and fires a meow.
    if (this.begT >= this.nextMeowAt) {
      this.nextMeowAt = this.begT + MEOW_PERIOD;
      this.cb.onMeow();
      const at = this.pet.headWorld.clone().add(new THREE.Vector3(0, 0.12, 0));
      this.fx.burst(Math.random() < 0.35 ? 'question' : 'note', at, { count: 1, size: 0.2, rise: 0.55, spread: 0.18 });
    }
  }

  private giftArrive(): void {
    if (this.giftPhase === 0) {
      // Picked it up — the prop rides in the cat's mouth from here.
      this.giftPhase = 1;
      const prop = buildProp((this.giftSpec?.id ?? 'yarn') as PropId);
      prop.scale.setScalar(0.85);
      prop.position.set(0, -0.02, 0.02);
      this.pet.carry.add(prop);
      this.giftProp = prop;
      this.playAction('carry');
      this.goTo(this.world.gift, 0.14, false, () => this.giftArrive());
      return;
    }

    if (this.giftPhase === 1) {
      // Presented. Drop it at the player's feet and show off.
      this.giftPhase = 2;
      this.faceCamera();
      const prop = this.giftProp;
      if (prop) {
        const world = new THREE.Vector3();
        prop.getWorldPosition(world);
        this.pet.carry.remove(prop);
        this.scene.add(prop);
        prop.position.set(world.x, 0, world.z + 0.12);
        prop.rotation.set(0, Math.random() * Math.PI, 0);
        prop.scale.setScalar(1);
        this.groundToys.push(prop);
        this.giftProp = null;
        this.fx.burst('sparkle', new THREE.Vector3(prop.position.x, 0.25, prop.position.z), { count: 7, size: 0.18 });
      }
      this.playAction('celebrate', 2.6);
      this.fx.burst('star', this.pet.headWorld, { count: 6, rise: 1.1, size: 0.24 });
      if (this.giftSpec) this.cb.onGift(this.giftSpec);
      window.setTimeout(() => {
        this.busy = false;
        if (this.behaviour === 'gift') {
          this.behaviour = 'roam';
          this.nextIdleAt = this.now + 0.5;
          // Whatever the store wanted while the cat was busy applies now.
          this.applyIntent(this.intent);
        }
      }, 2600);
    }
  }

  // --- input ---------------------------------------------------------------

  private attachInput(): void {
    const c = this.canvas;
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerdown', this.onPointerDown);
    c.addEventListener('pointerup', this.onPointerUp);
    c.addEventListener('pointercancel', this.onPointerUp);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('webglcontextlost', this.onContextLost);
  }

  private detachInput(): void {
    const c = this.canvas;
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.removeEventListener('pointerup', this.onPointerUp);
    c.removeEventListener('pointercancel', this.onPointerUp);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('webglcontextlost', this.onContextLost);
  }

  private onContextLost = (e: Event): void => {
    e.preventDefault();
    this.stop();
  };

  private setNdc(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.pointerActive = true;
  }

  private projectToGround(clientX: number, clientY: number): THREE.Vector3 | null {
    this.setNdc(clientX, clientY);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(GROUND, hit) ? hit : null;
  }

  private hitsCat(): boolean {
    this.ray.setFromCamera(this.pointer, this.camera);
    return this.ray.intersectObject(this.pet.hit, false).length > 0;
  }

  /** Ground toys are clickable — a click sends the cat off to pounce on one. */
  private hitToy(): THREE.Group | null {
    if (!this.groundToys.length) return null;
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObjects(this.groundToys, true);
    if (!hits.length) return null;
    let o: THREE.Object3D | null = hits[0].object;
    while (o && !o.userData.propId) o = o.parent;
    return (o as THREE.Group) ?? null;
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.setNdc(e.clientX, e.clientY);
    if (this.dragProp) {
      this.moveDrag(e.clientX, e.clientY);
      return;
    }

    if (this.pressing) {
      this.pressMoved += Math.abs(e.movementX ?? 0) + Math.abs(e.movementY ?? 0);
      // A held, moving pointer on the cat is a stroke rather than a click.
      if (!this.petting && this.pressMoved > 14 && this.now - this.pressAt > 0.22 && this.hitsCat()) {
        this.startPetting();
      }
      if (this.petting && Math.random() < 0.08) {
        this.fx.burst('heart', this.pet.headWorld, { count: 1, size: 0.2, rise: 0.7, spread: 0.22 });
      }
      return;
    }

    const over = this.hitsCat();
    if (over !== this.hovering) {
      this.hovering = over;
      this.cb.onHover(over);
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.setNdc(e.clientX, e.clientY);
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pressing = true;
    this.pressAt = this.now;
    this.pressMoved = 0;

    const toy = this.hitToy();
    if (toy && !this.hitsCat()) {
      // Send the cat to play with whatever was clicked.
      this.behaviour = 'play';
      this.petting = false;
      this.goTo(this.approachPoint(toy.position, 0.32), 0.18, true, () => {
        this.faceTowards(toy.position);
        this.playAction('play', 3.2);
      });
      this.fx.burst('sparkle', new THREE.Vector3(toy.position.x, 0.22, toy.position.z), { count: 3, size: 0.14 });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.canvas.releasePointerCapture?.(e.pointerId);
    const held = this.now - this.pressAt;
    const wasPressing = this.pressing;
    this.pressing = false;

    if (this.dragProp) {
      this.endDrag(true);
      return;
    }

    if (this.petting) {
      this.stopPetting();
      return;
    }

    // A quick tap on the cat is a poke: it startles, then plays.
    if (wasPressing && held < 0.4 && this.pressMoved < 16 && this.hitsCat()) {
      this.cb.onPoke();
      this.fx.burst('star', this.pet.headWorld, { count: 3, size: 0.2, rise: 0.8 });
    }
  };

  private onPointerLeave = (): void => {
    this.pointerActive = false;
    if (this.petting) this.stopPetting();
    if (this.hovering) {
      this.hovering = false;
      this.cb.onHover(false);
    }
  };

  private startPetting(): void {
    this.petting = true;
    this.behaviour = 'petted';
    this.stopMoving();
    this.playAction('petted', 999);
    this.cb.onPurrStart();
    this.fx.burst('heart', this.pet.headWorld, { count: 3, size: 0.22, rise: 0.8 });
    this.creditPet();
  }

  private stopPetting(): void {
    this.petting = false;
    this.lockUntil = this.now + 0.5;
    this.cb.onPurrEnd();
    this.behaviour = 'roam';
    this.nextIdleAt = this.now + 1;
  }

  /** Petting pays out on a cooldown so a long stroke is not a coin faucet. */
  private creditPet(): void {
    if (this.now - this.lastPetCredit < 1.6) return;
    this.lastPetCredit = this.now;
    this.cb.onPet();
  }

  // --- frame ---------------------------------------------------------------

  private frame(): void {
    const t = performance.now() / 1000;
    // Clamping keeps a long stall (tab switch, GC pause) from teleporting the
    // cat across the room in a single step.
    const dt = Math.min(0.05, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.now += dt;

    if (this.petting) this.creditPet();
    this.tickBehaviour(dt);
    this.tickLocomotion(dt);
    this.tickLook(dt);
    this.tickPose(dt);
    this.tickCamera(dt);

    this.world.update(dt, this.now, this.dayFrac);

    // Worlds animate their own lights, so the modulation has to be reapplied
    // rather than done once. Four times a second is far below the rate any of
    // this changes, and keeps the colour maths off the per-frame budget.
    this.lightAge += dt;
    if (this.lightAge >= 0.25) this.refreshLighting();

    this.fx.update(dt);

    // Sleeping cats get Zzz, on a slow rhythm.
    if (this.action === 'sleep' && !this.reduced && Math.random() < dt * 0.55) {
      this.fx.burst('sleep', this.pet.headWorld.clone().add(new THREE.Vector3(0.05, 0.16, 0)), {
        count: 1,
        size: 0.2,
        rise: 0.35,
        spread: 0.1,
        life: 2.6,
      });
    }

    // Keep the shadow frustum centred on the cat so it never falls outside.
    this.key.target.position.set(this.pos.x, 0, this.pos.z);
    this.key.target.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
  }

  private tickLocomotion(dt: number): void {
    // Jump arc, applied on top of whatever the pose does.
    if (this.airT >= 0) {
      this.airT += dt;
      const k = this.airT / this.airDur;
      if (k >= 1) {
        this.airT = -1;
        this.pet.root.position.y = 0;
      } else {
        this.pet.root.position.y = Math.sin(k * Math.PI) * 0.42;
      }
    }

    if (!this.target) {
      this.speed = damp(this.speed, 0, 9, dt);
      return;
    }

    const toTarget = new THREE.Vector3().subVectors(this.target, this.pos).setY(0);
    const dist = toTarget.length();
    if (dist < this.arriveAt) {
      const done = this.onArrive;
      this.target = null;
      this.onArrive = null;
      this.speed = 0;
      done?.();
      return;
    }

    // Turn toward the target first, then accelerate — cats do not strafe.
    const want = Math.atan2(toTarget.x, toTarget.z);
    const turn = angleDelta(this.facing, want);
    const maxTurn = (this.wantRun ? 5.0 : 3.4) * dt;
    this.facing += clamp(turn, -maxTurn, maxTurn);

    const aligned = 1 - Math.min(1, Math.abs(turn) / 1.2);
    const top = this.wantRun ? 1.75 : 0.72;
    // Ease off on the last few centimetres so arrivals are not abrupt.
    const approach = Math.min(1, dist / 0.4);
    this.speed = damp(this.speed, top * aligned * approach, 4.5, dt);
    this.pos.addScaledVector(toTarget.normalize(), this.speed * dt);

    const b = this.world.bounds;
    this.pos.x = clamp(this.pos.x, b.minX, b.maxX);
    this.pos.z = clamp(this.pos.z, b.minZ, b.maxZ);
  }

  private tickLook(dt: number): void {
    // The head tracks the pointer, but only when the cat is calm and awake.
    const trackable =
      this.pointerActive &&
      !this.reduced &&
      (this.action === 'idle' || this.action === 'sit' || this.action === 'beg' || this.action === 'walk');

    let wantYaw = 0;
    let wantPitch = 0;
    if (trackable) {
      this.ray.setFromCamera(this.pointer, this.camera);
      // Aim at a point on a vertical plane through the cat, so looking "up"
      // at a pointer near the top of the screen actually raises the chin.
      const aim = this.ray.ray.at(this.camera.position.distanceTo(this.pet.headWorld), new THREE.Vector3());
      const dx = aim.x - this.pet.headWorld.x;
      const dz = aim.z - this.pet.headWorld.z;
      const dy = aim.y - this.pet.headWorld.y;
      const world = Math.atan2(dx, dz);
      wantYaw = clamp(angleDelta(this.facing, world), -0.75, 0.75);
      wantPitch = clamp(-dy * 0.6, -0.42, 0.34);
    }
    this.lookYaw = damp(this.lookYaw, wantYaw, 5, dt);
    this.lookPitch = damp(this.lookPitch, wantPitch, 5, dt);
  }

  private tickPose(dt: number): void {
    this.actionT += dt;
    this.prevActionT += dt;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / Math.max(0.001, this.blendDur));

    // Locomotion overrides the resting action while the cat is actually moving.
    const moving = this.speed > 0.06;
    if (moving) {
      const want: Action = this.giftPhase === 1 && this.behaviour === 'gift' ? 'carry' : this.speed > 1.0 ? 'run' : 'walk';
      if (this.action !== want) this.playAction(want);
    } else if (
      (this.action === 'walk' || this.action === 'run' || this.action === 'carry') &&
      !this.target &&
      !this.locked
    ) {
      this.playAction(this.behaviour === 'sad' ? 'sad' : 'idle');
    }

    const ctx: AnimCtx = {
      t: this.actionT,
      now: this.now,
      speed: this.speed,
      lookYaw: this.lookYaw,
      lookPitch: this.lookPitch,
      mood: this.mood,
      air: this.airT >= 0 ? this.airT / this.airDur : 0,
      reduced: this.reduced,
    };

    evaluate(this.action, ctx, this.poseB);
    if (this.blend < 1) {
      evaluate(this.prevAction, { ...ctx, t: this.prevActionT }, this.poseA);
      // Smoothstep the blend so transitions ease in and out.
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      lerpPose(this.poseA, this.poseB, k, this.pose);
    } else {
      copyPose(this.poseB, this.pose);
    }

    this.applyBlink(dt);
    this.pet.apply(this.pose);
    this.pet.root.position.x = this.pos.x;
    this.pet.root.position.z = this.pos.z;
    this.pet.root.rotation.y = this.facing;
  }

  private applyBlink(dt: number): void {
    if (this.pose.eye < 0.3) return; // already shut — nothing to blink
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const k = this.blinkT / 0.16;
      if (k >= 1) {
        this.blinkT = -1;
      } else {
        // Down and back up over 160ms.
        this.pose.eye *= 1 - Math.sin(k * Math.PI);
      }
      return;
    }
    if (this.now > this.blinkAt) {
      this.blinkAt = this.now + 2.5 + Math.random() * 4.5;
      this.blinkT = 0;
    }
  }

  private tickCamera(dt: number): void {
    /**
     * Follow the cat laterally, but barely.
     *
     * Every unit the camera pans is a unit the painted backdrop has to slide
     * to stay under the cat's feet, and the backdrop only has `OVERSCAN` of
     * slack before its own edge shows. The roam bounds are set so the cat
     * stays in frame without much help, which lets this stay small.
     */
    const targetX = clamp(this.pos.x * 0.12, -0.24, 0.24);
    const parallaxX = this.pointerActive && !this.reduced ? this.pointer.x * 0.06 : 0;
    const parallaxY = this.pointerActive && !this.reduced ? this.pointer.y * 0.05 : 0;

    this.camera.position.x = damp(this.camera.position.x, targetX + parallaxX, 2.4, dt);

    /**
     * Aim so the view direction sits at exactly `horizonPitch`.
     *
     * The obvious thing is to look at the cat, but that tilts the camera as the
     * cat moves and drags the horizon up and down the frame with it — against
     * a painted backdrop whose horizon cannot move, that is instantly wrong.
     * So the target's height is *derived* from the required pitch rather than
     * chosen, and only the lateral aim follows the cat.
     */
    const lookX = this.pos.x * 0.5;
    const lookZ = this.pos.z * 0.4 - 0.1;
    const dist = Math.hypot(lookX - this.camera.position.x, lookZ - this.camera.position.z) || 1;
    const breathe = Math.sin(this.now * 0.35) * (this.reduced ? 0 : 0.008);
    const lookY = this.camera.position.y + Math.tan(this.horizonPitch) * dist + parallaxY + breathe;

    this.camera.lookAt(lookX, lookY, lookZ);

    // Keep the soft contact patch under the cat. Painted floors have no
    // modelled ground bouncing light back, so without this a low sun leaves
    // the pet hovering.
    const contact = this.world.contact;
    if (contact) {
      contact.position.x = this.pos.x;
      contact.position.z = this.pos.z;
    }
  }
}

/** True when the browser can actually give us a WebGL context. */
// `webglAvailable` used to live here. It moved to `webgl.ts`, because asking
// whether the browser can do 3D must not require downloading the 3D engine.
