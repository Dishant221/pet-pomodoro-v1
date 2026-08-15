/**
 * Shop skins, translated for the 3D cat.
 *
 * The 3D cat is always a *white* cat — that is the character. A skin therefore
 * recolours its markings (ears, socks, tail tip, head patch) and its eyes
 * rather than its coat, which keeps every purchase visible at a glance without
 * turning Mochi into a different animal.
 */
import type { PetSkinId } from '../game/economy';
import type { CatPalette } from './cat';

export const CAT_PALETTES: Record<PetSkinId, CatPalette> = {
  mochi: {
    coat: '#ffffff',
    coatShade: '#f0e6dc',
    marking: '#f2a65a',
    markingDark: '#e8894a',
    belly: '#fff8f0',
    eye: '#57c98b',
    nose: '#ff9db1',
    line: '#463a52',
  },
  shadow: {
    coat: '#fbfbff',
    coatShade: '#dcdde8',
    marking: '#5c5f6e',
    markingDark: '#43465a',
    belly: '#ffffff',
    eye: '#f5c542',
    nose: '#c9788c',
    line: '#2c2b3a',
  },
  cloud: {
    coat: '#ffffff',
    coatShade: '#e6e9f5',
    marking: '#cdd3e4',
    markingDark: '#b3bbd2',
    belly: '#ffffff',
    eye: '#7fc4e8',
    nose: '#f2b6c6',
    line: '#5b5f70',
  },
  inky: {
    coat: '#fcffff',
    coatShade: '#dceeeb',
    marking: '#3f8a86',
    markingDark: '#2d6a67',
    belly: '#f2fffd',
    eye: '#59d6c6',
    nose: '#f08fa4',
    line: '#1d3b3a',
  },
};

export function paletteFor(id: PetSkinId): CatPalette {
  return CAT_PALETTES[id] ?? CAT_PALETTES.mochi;
}
