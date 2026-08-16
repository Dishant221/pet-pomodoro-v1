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
  pip: {
    coat: '#e6c08a',
    coatShade: '#c69c62',
    marking: '#b98a52',
    markingDark: '#96693b',
    belly: '#faeed8',
    eye: '#5a3f26',
    nose: '#42352c',
    line: '#4a3728',
  },
  clover: {
    // `marking` is the face and legs on a sheep, not a paw pad: the fleece is
    // the coat colour and everything sticking out of it is the dark tone.
    coat: '#f4f1e9',
    coatShade: '#d8d3c4',
    marking: '#4a453d',
    markingDark: '#332f29',
    belly: '#fbfaf5',
    eye: '#3a352e',
    nose: '#453f38',
    line: '#3c3a33',
  },
  juniper: {
    coat: '#c08a5a',
    coatShade: '#9c6a41',
    // The antlers wear `markingDark`, so it has to be bone rather than a tint.
    marking: '#f0dcc4',
    markingDark: '#8f7a5e',
    belly: '#f0dcc4',
    eye: '#2e2018',
    nose: '#3a2a20',
    line: '#4a3324',
  },
  marigold: {
    coat: '#f4efe8',
    coatShade: '#ded7cd',
    marking: '#3f3a36',
    // Horns, hooves and tail tuft all take this, so it is horn-coloured.
    markingDark: '#a89880',
    belly: '#efe7dc',
    // The one place a cow is pink, and the reason `muzzle` is its own value.
    muzzle: '#f0b6ad',
    eye: '#2f2a26',
    nose: '#d99a90',
    line: '#332e2a',
  },
  winter: {
    coat: '#d9d3cb',
    coatShade: '#b3aca2',
    marking: '#6e6459',
    // The mane and the hooves share this one, which is why it is a dark grey
    // rather than anything with a hue in it.
    markingDark: '#4e463d',
    belly: '#f2eee8',
    eye: '#33302b',
    nose: '#4a423a',
    line: '#3a352f',
  },
  birch: {
    coat: '#a8a29a',
    coatShade: '#837d75',
    marking: '#e4e0da',
    markingDark: '#4c463f',
    belly: '#e4e0da',
    eye: '#2f2b27',
    nose: '#403a34',
    line: '#38342f',
  },
  barley: {
    coat: '#8a6244',
    coatShade: '#63452f',
    marking: '#c9a884',
    markingDark: '#4a3323',
    belly: '#c9a884',
    eye: '#241a12',
    nose: '#2e2119',
    line: '#2e2119',
  },
};

export function paletteFor(id: PetSkinId): PetPalette {
  return PET_PALETTES[id] ?? PET_PALETTES.mochi;
}
