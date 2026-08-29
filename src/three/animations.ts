/**
 * Every animation the cat can play, written as a pure function of time into a
 * `Pose`. Nothing here touches the scene graph — the engine evaluates the
 * outgoing and incoming actions each frame and lerps between them, which is how
 * a walk melts into a sit instead of snapping.
 */
import { BL, BR, FL, FR, LEG_COUNT, TAIL_SEGS, type Pose } from './animal';

export type Action =
  | 'idle'
  | 'walk'
  | 'run'
  | 'carry'
  | 'sit'
  | 'beg'
  | 'sleep'
  | 'stretch'
  | 'eat'
  | 'play'
  | 'jump'
  | 'celebrate'
  | 'sad'
  | 'petted'
  | 'groom'
  | 'roll';

export interface AnimCtx {
  /** Seconds since this action started. */
  t: number;
  /** Monotonic clock, for effects that must not restart with the action. */
  now: number;
  /** Ground speed in units/sec — blends walk into run. */
  speed: number;
  /** Where the head should aim, in radians relative to the body. */
  lookYaw: number;
  lookPitch: number;
  /** 0 = miserable, 1 = delighted. Biases ears and tail everywhere. */
  mood: number;
  /** Normalised height through a jump arc, 0 on the ground. */
  air: number;
  reduced: boolean;
}

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Smooth 0->1 ramp. */
const ease = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
// --- neutral pose -----------------------------------------------------------
// The cat's resting stance. Every action starts from here and edits channels,
// so an action only has to describe what makes it different.

const STAND_HIP = [0.1, 0.1, -0.3, -0.3];
const STAND_KNEE = [-0.14, -0.14, 0.55, 0.55];
const STAND_ANKLE = [0.04, 0.04, -0.25, -0.25];

export function stand(o: Pose): void {
  o.lift = 0;
  o.pitch = 0;
  o.roll = 0;
  o.yaw = 0;
  o.arch = 0;
  o.spine = 0;
  o.neck = 0;
  o.headPitch = 0;
  o.headYaw = 0;
  o.headRoll = 0;
  o.ear = 0;
  o.earTwitch = 0;
  o.eye = 1;
  o.squint = 0;
  o.mouth = 0;
  o.tailSway = 0;
  o.tailPuff = 0;
  o.stretch = 1;
  // A relaxed cat carries its tail in a gentle upward arc, not dragging.
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.16;
  for (let i = 0; i < LEG_COUNT; i++) {
    o.hip[i] = STAND_HIP[i];
    o.knee[i] = STAND_KNEE[i];
    o.ankle[i] = STAND_ANKLE[i];
  }
}

/** Applies the head-tracking aim on top of whatever an action already set. */
function look(o: Pose, ctx: AnimCtx, weight = 1): void {
  o.headYaw += ctx.lookYaw * weight;
  o.headPitch += ctx.lookPitch * weight;
  o.headRoll += -ctx.lookYaw * 0.18 * weight;
}

/** Slow chest rise — present in every grounded, calm action. */
function breathe(o: Pose, t: number, depth = 1): void {
  const b = sin(t * 1.7);
  o.lift += b * 0.006 * depth;
  o.spine += b * 0.02 * depth;
}

/**
 * Lazy S-curve down the tail.
 *
 * Tail values are PER JOINT and accumulate down the chain, so a whole-tail
 * bend of ~90° is only ~0.3 rad each. Authoring these as if they were absolute
 * angles spirals the tail into a corkscrew.
 */
function tailWave(o: Pose, t: number, amp: number, rate: number, curl = 0.16): void {
  for (let i = 0; i < TAIL_SEGS; i++) {
    o.tail[i] = curl + sin(t * rate - i * 0.55) * amp * (0.4 + i * 0.18);
  }
  o.tailSway = sin(t * rate * 0.72) * amp * 1.2;
}

// --- gait -------------------------------------------------------------------
// Cats walk in a lateral sequence: LF, RH, RF, LH. These phase offsets are what
// stop the walk cycle from reading as a pantomime horse.

const WALK_PHASE = [0, 0.5, 0.75, 0.25];
/** Bounding gait: the front pair and the back pair each move together. */
const RUN_PHASE = [0, 0.06, 0.5, 0.56];

function gait(o: Pose, ctx: AnimCtx, running: boolean): void {
  const phases = running ? RUN_PHASE : WALK_PHASE;
  const rate = running ? 2.7 : 1.65;
  const cycle = ctx.t * rate * (0.6 + ctx.speed * 0.9);
  const reach = running ? 0.78 : 0.5;
  const liftAmt = running ? 0.9 : 0.62;

  for (let i = 0; i < LEG_COUNT; i++) {
    const back = i === BL || i === BR;
    const p = ((cycle + phases[i]) % 1 + 1) % 1;
    // Stance is the slower half; swing snaps the leg forward.
    const swinging = p > 0.55;
    const swing = swinging ? (p - 0.55) / 0.45 : 0;
    const stance = swinging ? 0 : p / 0.55;

    const fore = swinging ? -reach * (1 - cos(swing * Math.PI)) * 0.5 : reach * 0.5 - stance * reach;
    o.hip[i] = STAND_HIP[i] + fore;
    o.knee[i] = STAND_KNEE[i] + (swinging ? sin(swing * Math.PI) * liftAmt * (back ? 0.85 : 0.7) : 0);
    o.ankle[i] = STAND_ANKLE[i] - (swinging ? sin(swing * Math.PI) * 0.35 : 0);
  }

  // Two bobs per stride, plus a little roll, plus the head bobbing against it.
  o.lift += sin(cycle * TAU * 2) * (running ? 0.03 : 0.014) + (running ? 0.02 : 0);
  o.roll = sin(cycle * TAU) * (running ? 0.05 : 0.035);
  o.pitch = running ? -0.06 + sin(cycle * TAU * 2) * 0.09 : sin(cycle * TAU * 2) * 0.02;
  o.headPitch += -sin(cycle * TAU * 2) * 0.05;
  o.spine += running ? sin(cycle * TAU * 2 + 0.6) * 0.12 : 0;
}

// --- actions ----------------------------------------------------------------

function idle(o: Pose, ctx: AnimCtx): void {
  stand(o);
  breathe(o, ctx.now);
  tailWave(o, ctx.now, 0.09 + ctx.mood * 0.06, 0.85, 0.12 + ctx.mood * 0.12);

  // Slow weight shift so the cat never looks frozen.
  const shift = sin(ctx.now * 0.31);
  o.roll = shift * 0.02;
  o.hip[FL] += shift * 0.03;
  o.hip[FR] -= shift * 0.03;

  o.ear = (1 - ctx.mood) * 0.25;
  // An ear flick every few seconds, on a prime-ish period so it feels random.
  const flick = ((ctx.now * 0.37) % 1);
  if (flick < 0.06) o.earTwitch = sin(flick / 0.06 * Math.PI) * 0.3;

  look(o, ctx);
}

function walk(o: Pose, ctx: AnimCtx): void {
  stand(o);
  gait(o, ctx, false);
  tailWave(o, ctx.now, 0.12, 1.4, 0.15 + ctx.mood * 0.08);
  o.ear = (1 - ctx.mood) * 0.2;
  look(o, ctx, 0.5);
}

function run(o: Pose, ctx: AnimCtx): void {
  stand(o);
  gait(o, ctx, true);
  tailWave(o, ctx.now, 0.16, 2.4, 0.08);
  o.ear = 0.25;
  o.eye = 1;
}

function carry(o: Pose, ctx: AnimCtx): void {
  stand(o);
  gait(o, ctx, false);
  // Head held high and level so the prize does not drag on the floor.
  o.neck = -0.22;
  o.headPitch = 0.16;
  o.spine = 0.1;
  o.mouth = 0.35;
  o.squint = 0.25;
  tailWave(o, ctx.now, 0.14, 1.5, 0.2);
  o.ear = 0;
}

function sit(o: Pose, ctx: AnimCtx): void {
  stand(o);
  // Hips drop to the floor, hind legs fold flat, front legs stay as pillars.
  o.lift = -0.115;
  o.pitch = -0.2;
  o.spine = 0.24;
  o.neck = -0.06;

  o.hip[FL] = 0.2;
  o.hip[FR] = 0.2;
  o.knee[FL] = -0.2;
  o.knee[FR] = -0.2;
  o.ankle[FL] = 0.02;
  o.ankle[FR] = 0.02;

  o.hip[BL] = -1.15;
  o.hip[BR] = -1.15;
  o.knee[BL] = 1.95;
  o.knee[BR] = 1.95;
  o.ankle[BL] = -0.75;
  o.ankle[BR] = -0.75;

  breathe(o, ctx.now, 0.8);
  // The tail curls forward around the front paws, the way a sitting cat does.
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.2 + i * 0.03;
  o.tailSway = sin(ctx.now * 0.7) * 0.09;
  o.ear = (1 - ctx.mood) * 0.3;
  look(o, ctx);
}

function beg(o: Pose, ctx: AnimCtx): void {
  sit(o, { ...ctx, lookYaw: 0, lookPitch: 0 });

  // Front paws come off the floor and paddle — the "feed me" ask.
  const paddle = sin(ctx.t * 6.5);
  o.hip[FL] = -1.5 + paddle * 0.22;
  o.hip[FR] = -1.5 - paddle * 0.22;
  o.knee[FL] = -0.85 - paddle * 0.2;
  o.knee[FR] = -0.85 + paddle * 0.2;
  o.ankle[FL] = -0.3;
  o.ankle[FR] = -0.3;

  o.pitch = -0.34;
  o.spine = 0.3;
  o.lift = -0.09;
  o.neck = -0.14;
  // Head tilt is what turns a beg from "standing up" into "please".
  o.headRoll = sin(ctx.t * 1.1) * 0.24;
  o.headPitch = 0.14;
  o.ear = 0;
  o.eye = 1;
  o.tailSway = sin(ctx.now * 2.1) * 0.3;

  // The mouth opens on each meow beat — the engine fires audio on the same beat.
  const beat = (ctx.t % MEOW_PERIOD) / MEOW_PERIOD;
  o.mouth = beat < 0.18 ? sin((beat / 0.18) * Math.PI) * 0.9 : 0;

  look(o, ctx, 0.5);
}

/** Seconds between begging meows. The engine reads this to sync the sound. */
export const MEOW_PERIOD = 2.6;

function sleep(o: Pose, ctx: AnimCtx): void {
  stand(o);
  // Belly on the floor, every leg folded *underneath*, curled into a loaf.
  // Splaying a leg outward reads as a dead cat, not a sleeping one.
  o.lift = -0.2;
  o.pitch = 0.02;
  o.roll = 0.07;
  o.arch = 0.05;
  o.spine = -0.06;

  for (let i = 0; i < LEG_COUNT; i++) {
    const back = i === BL || i === BR;
    // Front: upper leg swings back under the chest, lower folds forward.
    // Back: thigh forward along the flank, shank folded flat beneath it.
    o.hip[i] = back ? -1.75 : 1.35;
    o.knee[i] = back ? 2.7 : -2.5;
    o.ankle[i] = back ? -1.0 : 0.9;
  }

  // Chin tucked down toward the front paws, face turned slightly away.
  o.neck = 0.6;
  o.headPitch = 0.3;
  o.headYaw = 0.3;
  o.headRoll = 0.2;
  o.eye = 0;
  o.squint = 1;
  o.ear = 0.42;

  // The tail comes round the flank and rests against the nose.
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.06;
  o.tailSway = 0.42 + sin(ctx.now * 0.4) * 0.04;

  // Deep, slow sleeping breath.
  const b = sin(ctx.now * 0.85);
  o.lift += b * 0.011;
  o.arch += b * 0.02;
}

function stretch(o: Pose, ctx: AnimCtx): void {
  stand(o);
  const t = ctx.t;
  // Beat 1: the downward-dog. Beat 2: rise, arch and yawn. Beat 3: settle.
  const down = ease(t / 0.5) * (1 - ease((t - 0.9) / 0.5));
  const up = ease((t - 0.9) / 0.5) * (1 - ease((t - 1.7) / 0.5));

  o.pitch = down * 0.55 - up * 0.2;
  o.lift = -down * 0.08 + up * 0.05;
  o.stretch = 1 + down * 0.22;
  o.spine = -down * 0.5 + up * 0.35;
  o.neck = down * 0.4 - up * 0.5;
  o.headPitch = -up * 0.45;

  o.hip[FL] = 0.1 - down * 0.95;
  o.hip[FR] = 0.1 - down * 0.95;
  o.knee[FL] = -0.14 + down * 0.25;
  o.knee[FR] = -0.14 + down * 0.25;
  o.hip[BL] = -0.3 + down * 0.35;
  o.hip[BR] = -0.3 + down * 0.35;
  o.knee[BL] = 0.55 - down * 0.45;
  o.knee[BR] = 0.55 - down * 0.45;

  // A proper yawn: eyes screwed shut, mouth wide.
  o.mouth = up * 0.95;
  o.eye = 1 - Math.max(down, up) * 0.95;
  o.squint = Math.max(down, up) * 0.8;
  o.ear = up * 0.3;

  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.12 - down * 0.2 + up * 0.12;
  o.tailSway = sin(ctx.now * 2) * 0.08;
}

function eat(o: Pose, ctx: AnimCtx): void {
  stand(o);
  // Front end lowered to the bowl.
  o.lift = -0.075;
  o.pitch = 0.22;
  o.spine = 0.16;
  o.neck = 0.52;
  o.headPitch = 0.3;

  o.hip[FL] = 0.34;
  o.hip[FR] = 0.34;
  o.knee[FL] = -0.42;
  o.knee[FR] = -0.42;

  // Chew — mouth on a fast cycle, head nodding on the same beat.
  const chew = (sin(ctx.t * 11) + 1) * 0.5;
  o.mouth = chew * 0.55;
  o.headPitch += chew * 0.09;
  o.squint = 0.55;
  o.eye = 0.5;
  o.ear = 0.1;

  tailWave(o, ctx.now, 0.2, 2.6, 0.14);
}

function play(o: Pose, ctx: AnimCtx): void {
  stand(o);
  // A 3.2s loop: stalk and wiggle, pounce, then swat at the prize.
  const t = ctx.t % 3.2;

  if (t < 1.5) {
    // Crouch low, haunches wound up, rear end wiggling.
    const k = ease(t / 0.45);
    const wiggle = sin(t * 13) * ease((t - 0.5) / 0.4);
    o.lift = -0.11 * k;
    o.pitch = 0.16 * k;
    o.spine = -0.2 * k;
    o.neck = 0.28 * k;
    o.roll = wiggle * 0.07;
    o.yaw = wiggle * 0.09;
    o.hip[BL] = -0.3 - 0.55 * k;
    o.hip[BR] = -0.3 - 0.55 * k;
    o.knee[BL] = 0.55 + 0.75 * k;
    o.knee[BR] = 0.55 + 0.75 * k;
    o.hip[FL] = 0.1 + 0.28 * k;
    o.hip[FR] = 0.1 + 0.28 * k;
    o.knee[FL] = -0.14 - 0.3 * k;
    o.knee[FR] = -0.14 - 0.3 * k;
    o.ear = 0.55 * k;
    o.eye = 1;
    // Tail lashing side to side — the tell before a pounce.
    tailWave(o, ctx.now, 0.1, 6.5, 0.02);
  } else if (t < 2.1) {
    // The pounce itself. Vertical travel is added by the engine.
    const k = (t - 1.5) / 0.6;
    o.lift = sin(k * Math.PI) * 0.16;
    o.pitch = -0.3 + k * 0.5;
    o.spine = 0.25;
    o.neck = -0.1;
    for (let i = 0; i < LEG_COUNT; i++) {
      const back = i === BL || i === BR;
      o.hip[i] = back ? 0.5 - k * 0.9 : -0.9 + k * 0.7;
      o.knee[i] = back ? 0.2 : -0.4;
    }
    o.ear = 0.3;
    o.mouth = 0.25;
    for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.05;
  } else {
    // Landed — sit up and swat with alternating paws.
    const k = (t - 2.1) / 1.1;
    const swipe = sin(k * TAU * 2.5);
    o.lift = -0.06;
    o.pitch = -0.16;
    o.spine = 0.2;
    o.hip[FL] = 0.1 - Math.max(0, swipe) * 1.5;
    o.hip[FR] = 0.1 - Math.max(0, -swipe) * 1.5;
    o.knee[FL] = -0.14 - Math.max(0, swipe) * 0.7;
    o.knee[FR] = -0.14 - Math.max(0, -swipe) * 0.7;
    o.headRoll = swipe * 0.16;
    o.headPitch = 0.12;
    o.squint = 0.3;
    o.ear = 0.15;
    tailWave(o, ctx.now, 0.18, 4.5, 0.12);
  }

  look(o, ctx, 0.35);
}

function jump(o: Pose, ctx: AnimCtx): void {
  stand(o);
  const k = clamp(ctx.air, 0, 1);
  // Tuck on the way up, reach on the way down.
  o.pitch = -0.25 + k * 0.15;
  o.spine = 0.2;
  o.lift = 0;
  for (let i = 0; i < LEG_COUNT; i++) {
    const back = i === BL || i === BR;
    o.hip[i] = back ? -0.9 - k * 0.4 : -0.5 + k * 0.5;
    o.knee[i] = back ? 1.5 : -0.9 + k * 0.5;
    o.ankle[i] = back ? -0.5 : 0.2;
  }
  o.ear = 0.3;
  o.eye = 1;
  o.mouth = 0.2;
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.06 - i * 0.015;
  o.tailSway = sin(ctx.now * 5) * 0.12;
}

function celebrate(o: Pose, ctx: AnimCtx): void {
  stand(o);
  // Little vertical hops on the spot, tail straight up and quivering.
  const hop = Math.abs(sin(ctx.t * 5.2));
  o.lift = hop * 0.1;
  o.pitch = -0.14 - hop * 0.1;
  o.spine = 0.2;
  o.neck = -0.28;
  o.headPitch = -0.22;

  for (let i = 0; i < LEG_COUNT; i++) {
    const back = i === BL || i === BR;
    o.hip[i] = STAND_HIP[i] + (back ? -0.25 : -0.35) * hop;
    o.knee[i] = STAND_KNEE[i] + (back ? 0.5 : -0.4) * hop;
  }

  o.squint = 0.85;
  o.eye = 1;
  o.mouth = 0.35 + hop * 0.3;
  o.ear = 0;
  // A vertical, quivering tail is a cat's happiest possible signal.
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.32 + sin(ctx.now * 18 - i) * 0.03;
  o.tailSway = sin(ctx.now * 16) * 0.05;
}

function sad(o: Pose, ctx: AnimCtx): void {
  stand(o);
  o.lift = -0.05;
  o.pitch = 0.1;
  o.spine = -0.18;
  o.neck = 0.42;
  o.headPitch = 0.3;
  o.headRoll = sin(ctx.now * 0.5) * 0.06;
  o.ear = 0.92;
  o.eye = 0.42;
  o.squint = 0.12;
  o.hip[FL] = 0.24;
  o.hip[FR] = 0.24;
  o.knee[FL] = -0.3;
  o.knee[FR] = -0.3;
  // Tail hangs limp and drags.
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = -0.05 - i * 0.012;
  o.tailSway = sin(ctx.now * 0.45) * 0.04;
  breathe(o, ctx.now, 1.4);
}

function petted(o: Pose, ctx: AnimCtx): void {
  stand(o);
  o.lift = -0.02;
  // Leaning up into the hand, eyes shut, head rolling under the stroke.
  o.spine = 0.24;
  o.neck = -0.3;
  o.headPitch = -0.24;
  o.headRoll = sin(ctx.now * 1.6) * 0.2;
  o.headYaw = sin(ctx.now * 1.1) * 0.16;
  o.eye = 0;
  o.squint = 1;
  o.mouth = 0;
  o.ear = 0.12;

  // Purr — a fast, tiny tremor layered over the calm pose.
  const purr = sin(ctx.now * 26) * (ctx.reduced ? 0 : 0.0035);
  o.lift += purr;
  o.roll += purr * 1.4;

  // Kneading: the front paws alternate, slowly.
  const knead = sin(ctx.now * 2.6);
  o.hip[FL] = 0.1 - Math.max(0, knead) * 0.45;
  o.hip[FR] = 0.1 - Math.max(0, -knead) * 0.45;
  o.knee[FL] = -0.14 - Math.max(0, knead) * 0.3;
  o.knee[FR] = -0.14 - Math.max(0, -knead) * 0.3;

  // Tail high with a hooked tip: the friendly greeting shape.
  for (let i = 0; i < TAIL_SEGS; i++) o.tail[i] = 0.28 + (i > 2 ? 0.14 : 0);
  o.tailSway = sin(ctx.now * 1.3) * 0.1;
}

function groom(o: Pose, ctx: AnimCtx): void {
  sit(o, { ...ctx, lookYaw: 0, lookPitch: 0 });
  // Sitting, one paw raised, head down licking it.
  const lick = sin(ctx.t * 7);
  o.hip[FR] = -1.15;
  o.knee[FR] = -0.5;
  o.neck = 0.62 + lick * 0.08;
  o.headPitch = 0.34;
  o.headYaw = -0.3;
  o.headRoll = -0.18;
  o.mouth = (lick + 1) * 0.12;
  o.eye = 0.35;
  o.squint = 0.4;
}

function roll(o: Pose, ctx: AnimCtx): void {
  // Lie on side, rolling playfully. Roll progress from 0 to 1 over the duration.
  const rollPhase = Math.min(1, ctx.t / 2.4);
  // Tip the body to one side.
  o.roll = Math.sin(rollPhase * Math.PI) * 1.2;
  o.lift = -rollPhase * 0.2; // belly gets lower
  o.spine = rollPhase * 0.8;
  o.neck = rollPhase * 0.4;
  o.headPitch = rollPhase * 0.35;
  // Legs floppy and relaxed.
  for (const leg of [FL, FR, BL, BR]) {
    o.hip[leg] = rollPhase * 0.8;
    o.knee[leg] = -rollPhase * 1.2;
  }
  for (let i = 0; i < o.tail.length; i++) {
    o.tail[i] = 0.3 + Math.sin(ctx.now * 4 + i * 0.4) * 0.2;
  }
  o.mouth = 0.3;
  o.eye = 0.4;
}

// --- dispatch ---------------------------------------------------------------

const TABLE: Record<Action, (o: Pose, ctx: AnimCtx) => void> = {
  idle,
  walk,
  run,
  carry,
  sit,
  beg,
  sleep,
  stretch,
  eat,
  play,
  jump,
  celebrate,
  sad,
  petted,
  groom,
  roll,
};

export function evaluate(action: Action, ctx: AnimCtx, out: Pose): void {
  TABLE[action](out, ctx);
}

/** How long a one-shot action occupies the cat before it hands control back. */
export const ACTION_LENGTH: Partial<Record<Action, number>> = {
  stretch: 2.4,
  celebrate: 3.0,
  eat: 3.2,
  play: 3.2,
  roll: 2.4,
  petted: 2.4,
  groom: 4.0,
  jump: 0.75,
};

/** True when an action should hold the stage until it finishes. */
export function isOneShot(a: Action): boolean {
  return ACTION_LENGTH[a] != null;
}

/** Blend time into each action. Snappy for reactions, slow for settling. */
export function blendTime(a: Action): number {
  switch (a) {
    case 'jump':
    case 'play':
      return 0.12;
    case 'celebrate':
    case 'petted':
    case 'eat':
      return 0.2;
    case 'sleep':
      return 0.9;
    case 'sad':
      return 0.7;
    default:
      return 0.35;
  }
}
