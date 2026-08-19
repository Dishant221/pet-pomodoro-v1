import { atom } from 'nanostores';
import { $profile } from '../stores/profile';
import * as audio from './audio';
import { ask, listenOnce, speechAvailable, type ListenHandle } from './speech';

/**
 * Talking to the animal, wherever the animal happens to be living.
 *
 * This is a store rather than component state because the pet has two homes —
 * the painted stage and the loose on-screen companion — and the control that
 * talks to it must work in both. Previously the microphone was a button parented
 * to the on-screen pet, which meant it did not exist at all in stage mode, and
 * in screen mode it was a 22px target bolted to an animal walking away at 34
 * px/s. One shared store lets a single fixed control drive whichever pet is
 * mounted.
 *
 * What lives here is the *conversation*: whether we are listening, what was said
 * back, and the behaviour the pet should perform. How that behaviour is played
 * belongs to whoever owns a renderer, so both islands subscribe and translate it
 * into their own vocabulary.
 */

export interface TalkState {
  /** True only while the microphone is actually open. */
  listening: boolean;
  /** What to show the player: the reply, an error, or the listening hint. */
  bubble: string | null;
  /** True while `/api/ask` is in flight, so the control can show it is working. */
  thinking: boolean;
  /**
   * Bumped on every reaction.
   *
   * Subscribers key off this rather than off `behaviour`, because saying "sit"
   * twice in a row must play twice — comparing behaviour alone would swallow
   * the second one.
   */
  seq: number;
  /** The behaviour the pet should perform, already checked against the whitelist. */
  behaviour: string | null;
  tone: string;
}

const IDLE: TalkState = {
  listening: false,
  bubble: null,
  thinking: false,
  seq: 0,
  behaviour: null,
  tone: 'calm',
};

export const $talk = atom<TalkState>({ ...IDLE });

function patch(next: Partial<TalkState>): void {
  $talk.set({ ...$talk.get(), ...next });
}

/**
 * Behaviours the pet may be asked to perform in reply to being spoken to.
 *
 * Kept in step with the whitelist in `worker/src/index.ts`, and checked here as
 * well rather than trusted. The server's copy is what stops a model inventing an
 * action; this one is what stops a *response* — from a proxy, a cache, or a
 * future version of that endpoint — reaching an animation system unchecked.
 */
export const ALLOWED_REPLIES = new Set<string>([
  'idle',
  'sit',
  'sleep',
  'stretch',
  'play',
  'jump',
  'celebrate',
  'groom',
  'beg',
  'walk',
]);

/** Whether this browser can transcribe. False is not an error — typing works. */
export const canListen = speechAvailable;

let handle: ListenHandle | null = null;
let bubbleTimer: ReturnType<typeof setTimeout> | null = null;

function show(line: string | null, holdMs = 6000): void {
  patch({ bubble: line });
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = null;
  if (line == null) return;
  bubbleTimer = setTimeout(() => {
    patch({ bubble: null });
    bubbleTimer = null;
  }, holdMs);
}

/**
 * Send what was said and publish how the animal reacts.
 *
 * Never throws and never leaves the UI stuck in `thinking`: `ask` already turns
 * a failure into a shrug, and the pet blinking at you beats a control that spins
 * forever because a fetch went wrong.
 */
export async function sayTo(text: string): Promise<void> {
  const said = text.trim();
  if (!said) return;

  patch({ thinking: true });
  show('…', 30_000);

  const r = await ask(said);

  const behaviour = ALLOWED_REPLIES.has(r.behaviour) ? r.behaviour : 'idle';
  patch({
    thinking: false,
    seq: $talk.get().seq + 1,
    behaviour,
    tone: r.tone,
  });
  show(r.say);

  // It answers in its own voice, never in words. Tone picks the variant, so an
  // excited reply is a different noise from a sad one.
  if (!$profile.get().settings.muted) {
    const variant = r.tone === 'excited' ? 2 : r.tone === 'sad' ? 1 : 0;
    void audio.unlock().then(() => audio.playVoice(variant, { force: true }));
  }
}

/**
 * Open the microphone for exactly one sentence.
 *
 * Off until asked for, every time, and closed the moment there is a transcript —
 * see the note at the top of `game/speech.ts` for why there is deliberately no
 * stored "always listening" setting.
 */
export function startListening(): void {
  if ($talk.get().listening) return;
  if (!speechAvailable()) {
    show('this browser cannot listen — type instead');
    return;
  }

  patch({ listening: true });
  show('listening…', 30_000);

  handle = listenOnce({
    onResult: (text) => void sayTo(text),
    onEnd: (reason) => {
      patch({ listening: false });
      handle = null;
      if (reason === 'denied') show('microphone permission was refused');
      else if (reason === 'error') show('could not hear anything');
      else if (!$talk.get().thinking && $talk.get().bubble === 'listening…') show(null);
    },
  });
}

export function stopListening(): void {
  handle?.cancel();
  handle = null;
  patch({ listening: false });
}

export function toggleListening(): void {
  if ($talk.get().listening) stopListening();
  else startListening();
}

/** Drop the bubble early, e.g. when the player dismisses it. */
export function clearBubble(): void {
  show(null);
}
