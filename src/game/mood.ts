/**
 * How the animal feels, as distinct from what it is doing.
 *
 * `PetState` is a pose — sleeping, eating, begging — and it changes several
 * times a minute. Mood is slower and quieter: it is the reading of the vitals
 * that decides *how* those poses are played, how often the animal speaks, and
 * what the player sees on the meter. A cat can be eating while grumpy, or
 * sleeping while unwell, and the two facts do not fight.
 *
 * Derived, never stored. Everything mood depends on is already in the save, and
 * a stored mood is one more thing that can disagree with the numbers it came
 * from — a save claiming "happy" next to a happiness of 4.
 */
import type { PetVitals } from '../stores/profile';
import type { PhaseId } from './world';

export type MoodId = 'content' | 'happy' | 'affectionate' | 'grumpy' | 'sad' | 'unwell';

export interface MoodSpec {
  id: MoodId;
  label: string;
  glyph: string;
  /** Meter tint. */
  tone: string;
  /**
   * How talkative this mood is, as a multiplier on the voice rate limit.
   *
   * Above 1 is more frequent, below 1 less. A hungry, cross animal nags; a sick
   * one goes quiet. That asymmetry is most of what makes the sound feel like it
   * is coming from something alive rather than from a timer.
   */
  voice: number;
  /** One line, shown on the meter. Written from the animal's side. */
  blurb: string;
}

export const MOODS: Record<MoodId, MoodSpec> = {
  content: { id: 'content', label: 'Content', glyph: '🙂', tone: '#8fb98a', voice: 1, blurb: 'Settled and easy.' },
  happy: { id: 'happy', label: 'Happy', glyph: '😸', tone: '#f2b544', voice: 1.4, blurb: 'Delighted with everything.' },
  affectionate: {
    id: 'affectionate',
    label: 'Affectionate',
    glyph: '💗',
    tone: '#f5788f',
    voice: 1.6,
    blurb: 'Wants to be near you.',
  },
  grumpy: { id: 'grumpy', label: 'Grumpy', glyph: '😾', tone: '#e08a4a', voice: 1.9, blurb: 'Hungry and unimpressed.' },
  sad: { id: 'sad', label: 'Sad', glyph: '😿', tone: '#7b8bb5', voice: 0.6, blurb: 'Feeling neglected.' },
  unwell: { id: 'unwell', label: 'Unwell', glyph: '🤒', tone: '#9d8bb5', voice: 0.35, blurb: 'Not feeling well at all.' },
};

export const MOOD_IDS = Object.keys(MOODS) as MoodId[];

/** Below this, the animal is ill rather than merely unhappy. */
export const UNWELL_HEALTH = 35;

/**
 * Read the vitals as a mood.
 *
 * Ordered worst-first and returning on the first match, so the most serious
 * thing wins. An animal that is both ill and hungry is ill: telling the player
 * it is "grumpy" would bury the one state that actually needs them to do
 * something.
 */
export function moodFor(v: PetVitals, now = Date.now()): MoodId {
  if (v.health < UNWELL_HEALTH) return 'unwell';
  if (v.ignoredBreaks >= 2 || v.happiness <= 25) return 'sad';
  if (v.hunger >= 75 && v.happiness < 60) return 'grumpy';
  // Recently stroked, fed or played with, and in a good way about it.
  if (now - v.lastInteractAt < 45_000 && v.happiness >= 60) return 'affectionate';
  if (v.happiness >= 78 && v.hunger < 50) return 'happy';
  return 'content';
}

/**
 * How often the animal should speak, given its mood and the hour.
 *
 * Time matters as much as mood. A cat that meows at the same rate at 3am as at
 * noon is a sound effect on a timer; one that goes quiet after dark is an
 * animal in a room with you. The night factor is deliberately the strongest
 * term here — it can silence an otherwise nagging mood almost completely.
 */
export function voiceRateFor(mood: MoodId, phase: PhaseId): number {
  const byPhase: Record<PhaseId, number> = {
    dawn: 0.7,
    morning: 1.15,
    noon: 1,
    afternoon: 1,
    dusk: 0.85,
    night: 0.35,
  };
  return MOODS[mood].voice * (byPhase[phase] ?? 1);
}
