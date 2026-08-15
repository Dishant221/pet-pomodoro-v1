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
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let sfxBus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

let volumes = { master: 0.7, sfx: 0.8 };
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
    sfxBus.connect(master);
    master.connect(ctx.destination);
    noiseBuffer = makeNoise(ctx, 2);
    applyVolumes();
    // Warm the meow samples so the first one isn't late. Fire-and-forget: a
    // missing file is a handled miss, not an error.
    MEOW_SAMPLES.forEach((f) => void loadSample(f));
  }
  if (ctx.state === 'suspended') await ctx.resume();
}

export function setVolumes(v: { master: number; sfx: number }): void {
  volumes = v;
  applyVolumes();
}

export function setMuted(m: boolean): void {
  muted = m;
  applyVolumes();
  if (m) stopPurr();
}

export function isMuted(): boolean {
  return muted;
}

function applyVolumes(): void {
  if (!ctx || !master || !sfxBus) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(muted ? 0 : volumes.master, t, 0.02);
  sfxBus.gain.setTargetAtTime(volumes.sfx, t, 0.02);
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

let lastMeowAt = 0;

/**
 * Three distinct meows, chosen by index (0..2) or at random. Uses a real
 * recording from `public/assets/audio/sfx/meow-{1,2,3}.wav` when one is
 * present, otherwise synthesizes it.
 *
 * Rate-limited by default — most calls are deliberately silent. Pass
 * `{ force: true }` for the Settings preview buttons, where the player asked
 * to hear it right now and a no-op would read as a bug.
 */
export function playMeow(variant = Math.floor(Math.random() * 3), opts: { force?: boolean } = {}): void {
  if (!ready() || !ctx) return;

  if (!opts.force) {
    const now = Date.now();
    if (now - lastMeowAt < MEOW_MIN_GAP_MS) return;
    if (Math.random() > MEOW_CHANCE) return;
    lastMeowAt = now;
  }

  const file = MEOW_SAMPLES[variant % MEOW_SAMPLES.length];
  const sample = samples.get(file);
  if (sample) {
    // Slight pitch variation keeps repeated meows from sounding mechanical.
    playSample(sample, 0.9, 0.94 + Math.random() * 0.12);
    return;
  }
  // Not decoded yet (first call raced the prefetch) — start it for next time.
  if (sample === undefined) void loadSample(file);
  synthMeow(variant);
}

function synthMeow(variant: number): void {
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime;
  const base = [560, 640, 490][variant % 3];
  const dur = [0.42, 0.34, 0.5][variant % 3];

  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base * 0.75, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.18, t + dur * 0.28);
  osc.frequency.exponentialRampToValueAtTime(base * 0.62, t + dur);

  const g = c.createGain();
  env(g, 0.45, 0.05, dur, t);
  g.connect(bus()!);

  // Two formants give the vowel its "meow" character. They must run in
  // PARALLEL and be summed: chained in series, a Q=6 band at ~760 Hz and a Q=4
  // band at 2400 Hz have almost no overlap, so the second filter throws away
  // what the first one passed and the meow is inaudible.
  const f1 = c.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.setValueAtTime(760, t);
  f1.frequency.linearRampToValueAtTime(1180, t + dur * 0.3);
  f1.frequency.linearRampToValueAtTime(620, t + dur);
  f1.Q.value = 6;

  const f2 = c.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 2400;
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

  osc.start(t);
  osc.stop(t + dur + 0.1);
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
}
