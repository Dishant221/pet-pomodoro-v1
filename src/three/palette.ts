/**
 * Shop characters, translated for the 3D rig.
 *
 * Cats here are always *white* cats — that is the character. A cat skin
 * therefore recolours its markings (ears, socks, tail tip, head patch) and its
 * eyes rather than its coat, which keeps every purchase visible at a glance
 * without turning Mochi into a different animal.
 *
 * Dogs do not follow that rule, and should not: a dog's colour is its coat, and
 * a white dog with tan ears reads as a cat that has been given the wrong ears.
 * The constraint exists to protect one character's identity, not as a house
 * style, so it stops where that character does.
 */
import type { PetSkinId } from '../game/economy';
import type { PetPalette } from './animal';

export const PET_PALETTES: Record<PetSkinId, PetPalette> = {
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
  biscuit: {
    coat: '#d8a765',
    coatShade: '#b8834a',
    marking: '#a97542',
    markingDark: '#8a5c33',
    belly: '#f6e6cd',
    eye: '#6b4a2a',
    nose: '#4a3a30',
    line: '#4a3728',
  },
  pepper: {
    coat: '#8b939f',
    coatShade: '#6d7684',
    marking: '#eef1f5',
    markingDark: '#cfd6df',
    belly: '#e6eaf0',
    eye: '#4a6fa5',
    nose: '#3a3f47',
    line: '#2f343d',
  },
};

export function paletteFor(id: PetSkinId): PetPalette {
  return PET_PALETTES[id] ?? PET_PALETTES.mochi;
}
