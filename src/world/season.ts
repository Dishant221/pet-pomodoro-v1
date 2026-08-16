/**
 * The season, and what it does to the palette.
 *
 * Weather is what the sky is doing this hour; a season is what the year is
 * doing. They are separate and they compose: a rainy day in autumn is a grey
 * wash over rust-coloured trees, not the same grey over the same green.
 *
 * The season is derived from the date and the hemisphere — December is
 * midsummer in Sydney, and a world that paints snow on a Sydney Christmas is
 * a world built by someone who only checked their own window. The hemisphere
 * arrives from `/api/weather`, reduced server-side to one bit so no location
 * ever reaches the client.
 *
 * Like the weather wash, a season is a *transform* of the existing palettes
 * rather than a new set of them. Six phases times six scenes is already
 * thirty-six palettes; multiplying that by four seasons would be unmaintainable
 * by hand and unnecessary — autumn is the same afternoon with the greens pushed
 * towards amber and a little colour taken out of everything else.
 */
import type { TimeOfDay } from './palette';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export type Hemisphere = 'north' | 'south';

export interface SeasonSpec {
  id: SeasonId;
  label: string;
  /** Foliage target. Canopies and grass are pulled towards this. */
  foliage: string;
  /** How far towards `foliage`, 0..1. */
  foliageMix: number;
  /** Ground target — dry summer grass, wet spring green, winter straw. */
  ground: string;
  groundMix: number;
  /** Overall saturation multiplier applied to the scene wash. */
  saturate: number;
  /** Warmth of the light, as a tint laid over the whole frame. */
  tint: string;
  tintAlpha: number;
}

export const SEASONS: Record<SeasonId, SeasonSpec> = {
  spring: {
    id: 'spring',
    label: 'Spring',
    // New growth is yellower and lighter than high-summer leaf.
    foliage: '#8fce6a',
    foliageMix: 0.34,
    ground: '#9ad46e',
    groundMix: 0.3,
    saturate: 1.06,
    tint: '#eaffd8',
    tintAlpha: 0.05,
  },
  summer: {
    id: 'summer',
    label: 'Summer',
    foliage: '#4f9440',
    foliageMix: 0.22,
    // Grass burns off: high summer is drier and yellower, not greener.
    ground: '#c2c25a',
    groundMix: 0.2,
    saturate: 1.1,
    tint: '#fff2c2',
    tintAlpha: 0.07,
  },
  autumn: {
    id: 'autumn',
    label: 'Autumn',
    foliage: '#c9743a',
    foliageMix: 0.52,
    ground: '#b08a4a',
    groundMix: 0.38,
    saturate: 0.98,
    tint: '#ffcf94',
    tintAlpha: 0.1,
  },
  winter: {
    id: 'winter',
    label: 'Winter',
    // Not white: snow is weather, not season. Winter is bare and cold-grey, and
    // painting it white would mean a snowfield in every mild coastal January.
    //
    // It does have to commit, though. A first pass at 0.44 came out looking
    // like a slightly tired summer — next to autumn, which reads instantly,
    // the difference was invisible. Winter needs to take most of the green out,
    // not some of it.
    foliage: '#66706a',
    foliageMix: 0.66,
    ground: '#a8ab9c',
    groundMix: 0.58,
    saturate: 0.78,
    tint: '#cfe0f2',
    tintAlpha: 0.11,
  },
};

export const SEASON_IDS = Object.keys(SEASONS) as SeasonId[];

/**
 * Meteorological seasons, which start on the first of the month rather than at
 * the solstice. They are what people mean by "it's autumn now", and they avoid
 * a season boundary that moves by a day or two each year for no visible gain.
 */
export function seasonFor(date: Date, hemisphere: Hemisphere = 'north'): SeasonId {
  const m = date.getMonth(); // 0 = January
  const north: SeasonId[] = [
    'winter', // Jan
    'winter',
    'spring', // Mar
    'spring',
    'spring',
    'summer', // Jun
    'summer',
    'summer',
    'autumn', // Sep
    'autumn',
    'autumn',
    'winter', // Dec
  ];
  const n = north[m];
  if (hemisphere === 'north') return n;
  const opposite: Record<SeasonId, SeasonId> = {
    winter: 'summer',
    summer: 'winter',
    spring: 'autumn',
    autumn: 'spring',
  };
  return opposite[n];
}

/** Blend two hex colours. Local copy so this module depends on nothing. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

/**
 * Apply a season to a time-of-day palette.
 *
 * Only the living things move. Sky, sun, cloud and rock are the same in April
 * as in October — it is the leaves and the grass that carry a season, and
 * tinting the sky along with them is what makes seasonal filters look like a
 * colour wash instead of a year passing.
 */
export function seasonalise(t: TimeOfDay, season: SeasonId): TimeOfDay {
  // Summer barely moves: the palettes are authored at high summer, so it is the
  // one season that is already on the page.
  const s = SEASONS[season];
  return {
    ...t,
    treeLit: mix(t.treeLit, s.foliage, s.foliageMix),
    treeDark: mix(t.treeDark, s.foliage, s.foliageMix * 0.7),
    groundLit: mix(t.groundLit, s.ground, s.groundMix),
    groundMid: mix(t.groundMid, s.ground, s.groundMix * 0.85),
    groundDark: mix(t.groundDark, s.ground, s.groundMix * 0.6),
    frontGrass: mix(t.frontGrass, s.ground, s.groundMix * 0.7),
    // The hills are half vegetation, so they move at half rate.
    hillNear: mix(t.hillNear, s.foliage, s.foliageMix * 0.45),
  };
}
