/**
 * The world as the player has asked to see it.
 *
 * `$world` is reality: the real local hour, the real weather, the real season.
 * It stays that way, because a store that quietly reports a fake sky is one
 * nobody can debug — "is it actually raining, or did I pin rain three weeks
 * ago?" should never be a question you have to answer by reading code.
 *
 * So the override lives here instead, as a derived view. Everything that draws
 * reads `$view`; anything that wants the truth reads `$world`. The readout in
 * the corner uses `$view` and says so when it is pinned, which is how a player
 * can tell the difference from the outside.
 */
import { computed } from 'nanostores';
import { $world, fractionForPhase, type PhaseId, type Weather } from './world';
import { $profile } from '../stores/profile';
import { phaseForFraction } from './world';
import type { SeasonId } from '../world/season';

export interface WorldView {
  fraction: number;
  phase: PhaseId;
  season: SeasonId;
  weather: Weather;
  /** True when any of the three is pinned rather than following reality. */
  pinned: boolean;
}

/**
 * The three switches, flattened to a string.
 *
 * This looks like a silly indirection and is load-bearing. `$profile` changes
 * every few seconds — vitals drift, the timer ticks, the player buys a hat —
 * and a computed store hands its subscribers a fresh object every time one of
 * its sources fires, whether or not anything it read actually changed. Deriving
 * `$view` straight from `$profile` therefore re-rendered the 3D stage on every
 * vitals tick, which was enough to drop pointer interactions mid-stroke.
 *
 * A primitive is the fix: nanostores compares by identity before it notifies,
 * so this store stays silent until one of the three is actually changed, and
 * `$view` below only recomputes when reality moves or a pin is set.
 *
 * The string is a trigger, never a value — `$view` reads the settings back off
 * `$profile` rather than parsing it, so the three can never be silently swapped
 * by an edit to the template.
 */
const $pins = computed(
  $profile,
  (p) => `${p.settings.phaseMode}|${p.settings.weatherMode}|${p.settings.seasonMode}`,
);

export const $view = computed([$world, $pins], (w): WorldView => {
  const { phaseMode, weatherMode, seasonMode } = $profile.get().settings;

  // Pinning a phase means pinning a *moment*, not a preset: the lighting reads
  // the fraction so the sun moves smoothly, and handing it a phase name would
  // leave it with nothing to place the sun by.
  const fraction = phaseMode === 'auto' ? w.fraction : fractionForPhase(phaseMode);
  const phase = phaseMode === 'auto' ? w.phase : phaseForFraction(fraction);
  const season = seasonMode === 'auto' ? w.season : seasonMode;

  const weather: Weather =
    weatherMode === 'auto'
      ? w.weather
      : {
          ...w.weather,
          condition: weatherMode,
          // A pinned sky is not a reading, and it must not be presented as one:
          // `ok` false is what makes the readout say "set by you" rather than
          // reporting a temperature nobody measured.
          ok: false,
          temperature: null,
        };

  return {
    fraction,
    phase,
    season,
    weather,
    pinned: phaseMode !== 'auto' || weatherMode !== 'auto' || seasonMode !== 'auto',
  };
});
