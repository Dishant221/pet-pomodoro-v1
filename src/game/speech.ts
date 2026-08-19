/**
 * Listening to the player, so the animal can react to being spoken to.
 *
 * ------------------------------------------------------------------------
 * READ THIS BEFORE CHANGING ANYTHING HERE
 *
 * `SpeechRecognition` is not local. In Chrome and Edge the browser opens a
 * connection to Google's speech service and streams the microphone to it; the
 * transcript comes back over the network. It looks like an on-device API and it
 * is not one, and that difference is the whole privacy story of this feature.
 *
 * Everything in this file is built around three rules that follow from it:
 *
 *   1. It is off until the player turns it on, every session. There is no
 *      stored "always listening" setting, because there should not be one.
 *   2. It stops the moment it has a sentence. A recogniser left open is a hot
 *      microphone, and one that is open because someone forgot about it is the
 *      failure everybody is right to be afraid of.
 *   3. The audio never reaches our servers. Only the transcript is sent, and
 *      only when the player has spoken. See `/api/ask`.
 *
 * The privacy policy says all of this in plainer words. If this file changes,
 * that page changes with it.
 * ------------------------------------------------------------------------
 */

/** The bits of the recogniser we use, declared narrowly — it is not in lib.dom. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface RecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Whether this browser can transcribe at all.
 *
 * Firefox and Safari cannot, and that is not a failure state — the player types
 * to the cat instead. A control that is present and does nothing is worse than
 * one that was never offered.
 */
export function speechAvailable(): boolean {
  return ctor() != null;
}

export interface ListenHandle {
  /** Stop early. Safe to call more than once. */
  cancel(): void;
}

export interface ListenOptions {
  onResult(text: string): void;
  /** Called on failure and on a silent give-up, so the UI can drop the light. */
  onEnd(reason: 'done' | 'error' | 'denied'): void;
  /** Hard stop, so a forgotten session cannot hold the microphone open. */
  timeoutMs?: number;
}

/**
 * Listen for one sentence, then stop.
 *
 * Single-shot by design: `continuous` would keep the microphone open across
 * pauses, which is a different and much larger promise than this feature is
 * making.
 */
export function listenOnce(opts: ListenOptions): ListenHandle {
  const Ctor = ctor();
  if (!Ctor) {
    opts.onEnd('error');
    return { cancel() {} };
  }

  const rec = new Ctor();
  rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  let finished = false;
  const finish = (reason: 'done' | 'error' | 'denied') => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
    opts.onEnd(reason);
  };

  // A ceiling on how long the microphone can be open, whatever the recogniser
  // decides to do. Chrome will usually end on its own; this is the guarantee
  // that does not depend on it.
  const timer = setTimeout(() => finish('done'), opts.timeoutMs ?? 8000);

  rec.onresult = (e) => {
    const first = e.results?.[0]?.[0]?.transcript;
    if (typeof first === 'string' && first.trim()) opts.onResult(first.trim());
    finish('done');
  };

  rec.onerror = (e) => {
    finish(e?.error === 'not-allowed' || e?.error === 'service-not-allowed' ? 'denied' : 'error');
  };

  rec.onend = () => finish('done');

  try {
    rec.start();
  } catch {
    finish('error');
  }

  return { cancel: () => finish('done') };
}

export interface Reaction {
  behaviour: string;
  tone: string;
  say: string;
  /** False when the answer came from the fallback table rather than the model. */
  model?: boolean;
  /** True when the daily or per-minute cap was hit. */
  capped?: boolean;
}

/**
 * Send what was said and get back how the animal reacts.
 *
 * Text only — the audio never leaves the browser. A failure is not an error
 * state: the caller gets a shrug and the pet blinks at you, because a cat that
 * freezes when a fetch fails is worse than one that did not understand.
 */
export async function ask(text: string, signal?: AbortSignal): Promise<Reaction> {
  const shrug: Reaction = { behaviour: 'idle', tone: 'calm', say: 'tilts her head and blinks slowly', model: false };
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) return shrug;
    const data = (await res.json()) as Partial<Reaction>;
    if (typeof data.behaviour !== 'string' || typeof data.say !== 'string') return shrug;
    return {
      behaviour: data.behaviour,
      tone: typeof data.tone === 'string' ? data.tone : 'calm',
      say: data.say,
      model: data.model === true,
      capped: data.capped === true,
    };
  } catch {
    return shrug;
  }
}
