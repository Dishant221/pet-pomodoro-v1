/**
 * Fully synthesized audio layer — no files to ship, nothing to 404, works
 * offline from the first paint. Every cue is built from oscillators and noise
 * buffers with short envelopes. Swap in sampled CC0 files later by replacing
 * the `play*` bodies; the call sites and mixer stay the same.
 *
 * Browsers require a user gesture before an AudioContext may produce sound, so
 * nothing is created until `unlock()` is called from a real interaction.
 *
 * There is no ambient/background bed: every sound here is a short cue tied to
 * something the player did. Cues are deliberately sparse — see MEOW_MIN_GAP_MS.
 *
 * The pet's own voice is the one cue that varies: it is synthesized from the
 * equipped species' recipe, so a dog barks where a cat meows without a second
 * code path. See `setVoice`.
 */
import { SPECIES, type SpeciesId, type VoiceSpec } from '../three/species';
import type { Condition } from './world';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
/**
 * The weather bed, on its own bus.
 *
 * This file used to say there was no ambient layer, and that every sound was a
 * short cue tied to something the player did. That was the right call while the
 * only candidate was generic "room tone", which is noise for its own sake. Rain
 * you can hear while it is visibly raining is a different thing: it is the same
 * reading as the sky, arriving through the other sense, and it is most of what
 * makes the world feel like a place rather than a backdrop.
 *
 * It gets its own bus and its own slider because it is the one sound that plays
 * continuously while someone is trying to concentrate. Anyone who wants the
 * cues but not the weather can have exactly that, without muting the bell.
 */
let ambientBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

let volumes = { master: 0.7, sfx: 0.8, ambient: 0.45 };
let muted = true;

let purrNode: { stop: () => void } | null = null;

/**
 * Optional sampled cues. Drop a file into `public/assets/audio/sfx/` under one
 * of these names and it replaces the synthesized version automatically; if the
 * file isn't there the fetch 404s once, we remember the miss, and the synth
 * fallback runs instead. That keeps the "nothing to ship, nothing to 404"
 * promise intact while letting real recordings win when they exist.
 */
const SAMPLE_BASE = '/assets/audio/sfx';
const MEOW_SAMPLES = ['meow-1.wav', 'meow-2.wav', 'meow-3.wav'];

/** Decoded buffer, or null once we know the file isn't there. */
const samples = new Map<string, AudioBuffer | null>();
const sampleLoads = new Map<string, Promise<AudioBuffer | null>>();

function loadSample(file: string): Promise<AudioBuffer | null> {
  const done = sampleLoads.get(file);
  if (done) return done;
  const task = (async (): Promise<AudioBuffer | null> => {
    if (!ctx) return null;
    try {
      const res = await fetch(`${SAMPLE_BASE}/${file}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      samples.set(file, buf);
      return buf;
    } catch {
      // Missing or undecodable — fall back to the synth for the rest of the session.
      samples.set(file, null);
      return null;
    }
  })();
  sampleLoads.set(file, task);
  return task;
}

/** One-shot playback of a decoded sample through the sfx bus. */
function playSample(buffer: AudioBuffer, peak: number, rate: number): void {
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = peak;
  src.connect(g);
  g.connect(bus()!);
  src.start(t);
  src.stop(t + buffer.duration / rate + 0.05);
}

export function isUnlocked(): boolean {
  return ctx != null && ctx.state === 'running';
}

/** Must be called from inside a user-gesture handler. Safe to call repeatedly. */
export async function unlock(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    sfxBus = ctx.createGain();
    ambientBus = ctx.createGain();
    sfxBus.connect(master);
    ambientBus.connect(master);
    master.connect(ctx.destination);
    noiseBuffer = makeNoise(ctx, 2);
    applyVolumes();
    // Warm the meow samples so the first one isn't late. Fire-and-forget: a
    // missing file is a handled miss, not an error.
    MEOW_SAMPLES.forEach((f) => void loadSample(f));
  }
  if (ctx.state === 'suspended') await ctx.resume();
}

export function setVolumes(v: { master: number; sfx: number; ambient?: number }): void {
  volumes = { ...volumes, ...v };
  applyVolumes();
}

export function setMuted(m: boolean): void {
  muted = m;
  applyVolumes();
  if (m) {
    stopPurr();
    stopAmbience();
  }
}

export function isMuted(): boolean {
  return muted;
}

function applyVolumes(): void {
  if (!ctx || !master || !sfxBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(muted ? 0 : volumes.master, t, 0.02);
  sfxBus.gain.setTargetAtTime(volumes.sfx, t, 0.02);
  // A slower constant on the bed: a continuous sound that jumps when a slider
  // moves is far more noticeable than a cue that does.
  ambientBus?.gain.setTargetAtTime(volumes.ambient, t, 0.12);
}

function makeNoise(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  // Brown-ish noise: smoother and warmer than white, better for purrs/wind.
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

/** The only bus now that the ambient bed is gone. */
function bus(): GainNode | null {
  return sfxBus;
}

/** Guard used by every cue: bail silently when muted or not yet unlocked. */
function ready(): boolean {
  return !muted && ctx != null && ctx.state === 'running';
}

function env(g: GainNode, peak: number, attack: number, decay: number, at: number): void {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

// --- cues ------------------------------------------------------------------

/**
 * How sparse the meowing is. A meow is a foreground noise in a room where
 * someone is trying to concentrate, so it stays rare: at most one per gap, and
 * even then only sometimes. Tune these two numbers to taste — a shorter gap or
 * a higher chance makes her chattier.
 */
const MEOW_MIN_GAP_MS = 45_000;
const MEOW_CHANCE = 0.35;

let lastVoiceAt = 0;

/**
 * Whose voice to use.
 *
 * The species owns its call, and the synthesizer is general enough to say any
 * of them: a meow and a bark differ in the sweep, the formants, the roughness
 * and how many times the animal repeats itself. Holding it in a module variable
 * rather than threading it through every call site keeps `playVoice()` callable
 * from the places that just want the pet to make a noise.
 */
let voice: VoiceSpec = SPECIES.cat.voice;
let voiceIsCat = true;

export function setVoice(id: SpeciesId): void {
  voice = SPECIES[id]?.voice ?? SPECIES.cat.voice;
  voiceIsCat = id === 'cat';
}

/**
 * How talkative the animal is right now, as a multiplier on the rate limit.
 *
 * Above 1 speaks more often and with a shorter minimum gap; below 1, less. The
 * caller derives it from mood and time of day — a hungry animal nags, a sick
 * one goes quiet, and everything goes quiet at night. Applied to *both* the
 * chance and the gap, because raising the chance alone just makes the animal
 * hit the same ceiling more often.
 */
let voiceRate = 1;

export function setVoiceRate(rate: number): void {
  voiceRate = Math.min(4, Math.max(0.05, Number.isFinite(rate) ? rate : 1));
}

/**
 * The pet's call: a meow, a bark, whatever this animal says.
 *
 * `variant` (0..2) picks one of three shadings of the same voice, so repeats
 * don't sound identical. A real recording is used when one is present, but only
 * for the cat — the sample files are meows, and playing one for a dog would be
 * a worse bug than having no sample at all.
 *
 * Rate-limited by default — most calls are deliberately silent. Pass
 * `{ force: true }` for the Settings preview buttons, where the player asked
 * to hear it right now and a no-op would read as a bug.
 */
export function playVoice(variant = Math.floor(Math.random() * 3), opts: { force?: boolean } = {}): void {
  if (!ready() || !ctx) return;

  if (!opts.force) {
    const now = Date.now();
    if (now - lastVoiceAt < MEOW_MIN_GAP_MS / voiceRate) return;
    if (Math.random() > MEOW_CHANCE * voiceRate) return;
    lastVoiceAt = now;
  }

  if (voiceIsCat) {
    const file = MEOW_SAMPLES[variant % MEOW_SAMPLES.length];
    const sample = samples.get(file);
    if (sample) {
      // Slight pitch variation keeps repeated meows from sounding mechanical.
      playSample(sample, 0.9, 0.94 + Math.random() * 0.12);
      return;
    }
    // Not decoded yet (first call raced the prefetch) — start it for next time.
    if (sample === undefined) void loadSample(file);
  }
  synthVoice(voice, variant);
}

/**
 * One call, built from a species' voice recipe.
 *
 * The shape is the same for every animal: a sawtooth swept through two parallel
 * bandpass formants, plus a little dry signal so the note has body. What the
 * species changes is where the sweep goes, where the formants sit, how rough
 * the source is, and how many syllables it repeats — which is enough distance
 * to get from a meow to a bark to a bleat.
 */
function synthVoice(spec: VoiceSpec, variant: number): void {
  if (!ctx) return;
  const c = ctx;
  // Three shadings of the same voice: a little higher, a little shorter.
  const tune = [1, 1.12, 0.9][variant % 3];
  const stretch = [1, 0.82, 1.18][variant % 3];

  for (let r = 0; r < Math.max(1, spec.repeats); r++) {
    const t = c.currentTime + r * spec.gap;
    const dur = spec.duration * stretch;
    const from = spec.from * tune;
    const to = spec.to * tune;

    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    // Up into the call and back down out of it — the arc every animal call has.
    osc.frequency.setValueAtTime(from * 0.75, t);
    osc.frequency.exponentialRampToValueAtTime(from * 1.18, t + dur * 0.28);
    osc.frequency.exponentialRampToValueAtTime(to * 0.85, t + dur);

    const g = c.createGain();
    env(g, 0.45, 0.05 * stretch, dur, t);
    g.connect(bus()!);

    // The two formants must run in PARALLEL and be summed. Chained in series, a
    // Q=6 band at ~760 Hz and a Q=4 band at 2400 Hz have almost no overlap, so
    // the second filter throws away what the first passed and the call is
    // inaudible. This cost an evening the first time.
    const f1 = c.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.setValueAtTime(spec.formants[0], t);
    f1.frequency.linearRampToValueAtTime(spec.formants[0] * 1.55, t + dur * 0.3);
    f1.frequency.linearRampToValueAtTime(spec.formants[0] * 0.82, t + dur);
    f1.Q.value = 6;

    const f2 = c.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = spec.formants[1];
    f2.Q.value = 4;
    const f2Gain = c.createGain();
    f2Gain.gain.value = 0.35; // upper formant sits behind the lower one

    // A little unfiltered saw underneath keeps the body of the note audible.
    const dry = c.createGain();
    dry.gain.value = 0.18;

    osc.connect(f1);
    f1.connect(g);
    osc.connect(f2);
    f2.connect(f2Gain);
    f2Gain.connect(g);
    osc.connect(dry);
    dry.connect(g);

    // Roughness: a detuned twin beating against the fundamental. Cheaper than a
    // noise layer and it stays pitched, which is what a growl or a bray is.
    if (spec.rasp > 0.01) {
      const rough = c.createOscillator();
      rough.type = 'sawtooth';
      rough.frequency.setValueAtTime(from * 0.75, t);
      rough.frequency.exponentialRampToValueAtTime(to * 0.85, t + dur);
      rough.detune.value = 18 + spec.rasp * 55;
      const rg = c.createGain();
      rg.gain.value = spec.rasp * 0.5;
      rough.connect(rg);
      rg.connect(f1);
      rough.start(t);
      rough.stop(t + dur + 0.1);
    }

    // Weight below the fundamental. A moo is mostly this.
    if (spec.body > 0.01) {
      const sub = c.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(from * 0.5, t);
      sub.frequency.exponentialRampToValueAtTime(to * 0.45, t + dur);
      const sg = c.createGain();
      env(sg, spec.body * 0.5, 0.04 * stretch, dur, t);
      sub.connect(sg);
      sg.connect(bus()!);
      sub.start(t);
      sub.stop(t + dur + 0.1);
    }

    osc.start(t);
    osc.stop(t + dur + 0.1);
  }
}

/** Looping purr. Call `stopPurr()` when the petting ends. */
export function startPurr(): void {
  if (!ready() || !ctx || !noiseBuffer || purrNode) return;
  const c = ctx;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  lp.Q.value = 1.2;

  // ~26 Hz tremolo is what makes a purr read as a purr.
  const trem = c.createGain();
  trem.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 26;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.45;
  lfo.connect(lfoGain);
  lfoGain.connect(trem.gain);

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.25);

  src.connect(lp);
  lp.connect(trem);
  trem.connect(g);
  g.connect(bus()!);
  src.start(t);
  lfo.start(t);

  purrNode = {
    stop: () => {
      const now = c.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0002, g.gain.value), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      src.stop(now + 0.35);
      lfo.stop(now + 0.35);
    },
  };
}

export function stopPurr(): void {
  purrNode?.stop();
  purrNode = null;
}

/** Wet crunchy chews — three bursts of filtered noise. */
export function playMunch(): void {
  if (!ready() || !ctx || !noiseBuffer) return;
  const c = ctx;
  for (let i = 0; i < 3; i++) {
    const t = c.currentTime + i * 0.16;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 1.6 + Math.random() * 0.5;

    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 500;
    bp.Q.value = 2.4;

    const g = c.createGain();
    env(g, 0.3, 0.008, 0.1, t);

    src.connect(bp);
    bp.connect(g);
    g.connect(bus()!);
    src.start(t);
    src.stop(t + 0.14);
  }
}

/** Bright two-note pickup. */
export function playCoin(): void {
  if (!ready() || !ctx) return;
  const c = ctx;
  const t = c.currentTime;
  [988, 1319].forEach((hz, i) => {
    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.value = hz;
    const g = c.createGain();
    env(g, 0.16, 0.005, 0.11, t + i * 0.075);
    osc.connect(g);
    g.connect(bus()!);
    osc.start(t + i * 0.075);
    osc.stop(t + i * 0.075 + 0.16);
  });
}

/**
 * A soft UI tap for button presses.
 *
 * Deliberately tiny: two quick triangle blips a hair apart, low peak and a
 * short decay, so it reads as a tactile "tick" rather than a game sound. It
 * plays on every button, so anything with a tail or a pitch that draws
 * attention would wear out its welcome by the third click.
 */
export function playTap(): void {
  if (!ready() || !ctx) return;
  const c = ctx;
  const t = c.currentTime;
  [1180, 1560].forEach((hz, i) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = hz;
    const g = c.createGain();
    env(g, 0.05, 0.002, 0.045, t + i * 0.012);
    osc.connect(g);
    g.connect(bus()!);
    osc.start(t + i * 0.012);
    osc.stop(t + i * 0.012 + 0.07);
  });
}

/** Session-complete bell: struck partials with a long tail. */
export function playBell(): void {
  if (!ready() || !ctx) return;
  const c = ctx;
  const t = c.currentTime;
  const fundamental = 660;
  // Inharmonic ratios are what separate a bell from an organ.
  [1, 2.01, 2.99, 4.21, 5.43].forEach((ratio, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = fundamental * ratio;
    const g = c.createGain();
    const peak = 0.28 / (i + 1.4);
    const decay = 2.6 / (1 + i * 0.55);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g);
    g.connect(bus()!);
    osc.start(t);
    osc.stop(t + decay + 0.1);
  });
}

// --- weather bed -------------------------------------------------------------

/**
 * What each condition sounds like, as a filter shape over the same noise.
 *
 * All of it is one brown-noise loop bent into different weather, because that
 * is genuinely what these sounds are: rain is noise with the low end rolled off
 * and a lot of top, wind is noise with a narrow band swept slowly through it,
 * and snow is wind with almost everything taken away. Sampling four weather
 * loops would cost more than the whole audio layer and sound less alive, since
 * a loop repeats and a filter sweep does not.
 *
 * `gain` values are deliberately small. This plays while someone is trying to
 * concentrate; it should be the sound of a room with the window open, not a
 * rain machine.
 */
interface BedSpec {
  /** Lowpass corner, Hz. */
  cutoff: number;
  /** Highpass corner — what stops rain turning into rumble. */
  floor: number;
  /** Resonance of the swept band, 0 to skip the sweep entirely. */
  sweepQ: number;
  /** How far the sweep travels, as a fraction of `cutoff`. */
  sweepDepth: number;
  /** Seconds per sweep. Slow: this is weather, not a synth patch. */
  sweepPeriod: number;
  gain: number;
}

const BEDS: Partial<Record<Condition, BedSpec>> = {
  clear: { cutoff: 900, floor: 220, sweepQ: 0.6, sweepDepth: 0.45, sweepPeriod: 19, gain: 0.035 },
  cloudy: { cutoff: 1000, floor: 200, sweepQ: 0.7, sweepDepth: 0.5, sweepPeriod: 16, gain: 0.05 },
  overcast: { cutoff: 800, floor: 180, sweepQ: 0.7, sweepDepth: 0.5, sweepPeriod: 15, gain: 0.06 },
  fog: { cutoff: 600, floor: 150, sweepQ: 0.5, sweepDepth: 0.3, sweepPeriod: 24, gain: 0.045 },
  rain: { cutoff: 5200, floor: 700, sweepQ: 0, sweepDepth: 0, sweepPeriod: 0, gain: 0.1 },
  snow: { cutoff: 700, floor: 160, sweepQ: 0.6, sweepDepth: 0.55, sweepPeriod: 21, gain: 0.04 },
  storm: { cutoff: 6000, floor: 600, sweepQ: 0, sweepDepth: 0, sweepPeriod: 0, gain: 0.14 },
};

let bed: { stop: () => void; condition: Condition } | null = null;

/**
 * Start (or switch to) the bed for a condition.
 *
 * Crossfades rather than cuts: weather changing is a slow event and a hard
 * switch between two noise beds is the most noticeable thing in the mix.
 */
export function setAmbience(condition: Condition): void {
  if (!ready() || !ctx || !noiseBuffer || !ambientBus) return;
  if (bed?.condition === condition) return;

  const spec = BEDS[condition];
  stopAmbience();
  if (!spec) return;

  const c = ctx;
  const t = c.currentTime;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = spec.floor;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = spec.cutoff;
  lp.Q.value = 0.7;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(spec.gain, t + 2.5);

  src.connect(hp);
  hp.connect(lp);
  lp.connect(g);
  g.connect(ambientBus);

  /**
   * The gust. A slow sine on the filter corner, which is what turns a flat hiss
   * into wind — the ear reads a moving spectrum as air and a static one as
   * static.
   */
  let lfo: OscillatorNode | null = null;
  let lfoGain: GainNode | null = null;
  if (spec.sweepQ > 0) {
    lfo = c.createOscillator();
    lfo.frequency.value = 1 / spec.sweepPeriod;
    lfoGain = c.createGain();
    lfoGain.gain.value = spec.cutoff * spec.sweepDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start(t);
  }

  src.start(t);

  bed = {
    condition,
    stop: () => {
      const now = c.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0002, g.gain.value), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      try {
        src.stop(now + 1.4);
        lfo?.stop(now + 1.4);
      } catch {
        /* already stopped */
      }
    },
  };
}

export function stopAmbience(): void {
  bed?.stop();
  bed = null;
}

/**
 * A roll of thunder, `delay` seconds from now.
 *
 * Called by the lightning, not alongside it: light arrives before sound, and
 * that gap is the only thing that makes a storm read as having a distance. A
 * flash and a bang together sound like a switch being thrown.
 *
 * Built as a long low burst rather than a crack — the sharp attack of a nearby
 * strike is exactly the kind of noise that makes someone lose their thread,
 * which is the one thing a focus timer must not do.
 */
export function playThunder(delay = 1.5): void {
  if (!ready() || !ctx || !noiseBuffer || !ambientBus) return;
  const c = ctx;
  const t = c.currentTime + Math.max(0, delay);
  const dur = 2.6 + Math.random() * 1.8;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  // Opens then closes: distant thunder starts dull, brightens as the front of
  // the wave arrives, and rolls off again into the tail.
  lp.frequency.setValueAtTime(90, t);
  lp.frequency.linearRampToValueAtTime(320, t + 0.5);
  lp.frequency.exponentialRampToValueAtTime(70, t + dur);
  lp.Q.value = 0.8;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  src.connect(lp);
  lp.connect(g);
  g.connect(ambientBus);
  src.start(t);
  src.stop(t + dur + 0.2);
}

/** Sad descending glide for abandon / neglect. */
export function playWhimper(): void {
  if (!ready() || !ctx) return;
  const c = ctx;
  const t = c.currentTime;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.exponentialRampToValueAtTime(230, t + 0.55);

  const vib = c.createOscillator();
  vib.frequency.value = 11;
  const vibGain = c.createGain();
  vibGain.gain.value = 14;
  vib.connect(vibGain);
  vibGain.connect(osc.frequency);

  const g = c.createGain();
  env(g, 0.22, 0.06, 0.55, t);
  osc.connect(g);
  g.connect(bus()!);
  osc.start(t);
  vib.start(t);
  osc.stop(t + 0.7);
  vib.stop(t + 0.7);
}

/** Tears everything down — used on unmount. */
export function dispose(): void {
  stopPurr();
  // The bed loops forever by design, so it is the one thing here that outlives
  // the island unless something stops it.
  stopAmbience();
}
