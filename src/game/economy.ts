import type { SceneId } from './manifest';
import type { SpeciesId } from '../three/species';

export type ThemeId = 'playful' | 'ghibli' | 'anime' | 'vangogh';
export type PetSkinId =
  | 'mochi'
  | 'shadow'
  | 'cloud'
  | 'inky'
  | 'biscuit'
  | 'pepper'
  | 'pip'
  | 'clover'
  | 'juniper'
  | 'marigold'
  | 'winter'
  | 'birch'
  | 'barley';
export type SnackId = 'fish' | 'cookie' | 'milk' | 'sushi';

export interface ShopItem {
  id: string;
  name: string;
  blurb: string;
  price: number;
  /** Owned from the start — cannot be sold, always equippable. */
  free?: boolean;
}

export interface PetSkin extends ShopItem {
  id: PetSkinId;
  /**
   * Which animal this is.
   *
   * A shop entry is a species plus a coat, not a species *or* a coat: "Mochi"
   * is a ginger cat and "Biscuit" is a tan dog, and the player picks a
   * character rather than assembling one. Keeping it on the existing pet item
   * means ownership, equipping, the shop tab and the save's trust boundary all
   * work for species with no new machinery.
   */
  species: SpeciesId;
  /** Overrides the theme's fur variables when equipped. */
  colors: { fur: string; furDark: string; belly: string; line: string } | null;
}

export interface Snack extends ShopItem {
  id: SnackId;
  /** Hunger points restored. */
  restores: number;
  /** Happiness granted on eat. */
  joy: number;
  /** Emoji rendered as the draggable token. */
  glyph: string;
}

export const SCENE_ITEMS: (ShopItem & { id: SceneId })[] = [
  { id: 'livingroom', name: 'Living Room', blurb: 'Warm lamp light and a real-clock window.', price: 0, free: true },
  { id: 'garden', name: 'Garden', blurb: 'Drifting clouds, swaying flowers, a butterfly.', price: 120 },
  { id: 'jungle', name: 'Jungle', blurb: 'Deep canopy with fireflies after dark.', price: 200 },
  { id: 'treehouse', name: 'Treehouse', blurb: 'Up in the branches. A bird passes through.', price: 320 },
  { id: 'mountain', name: 'Mountain', blurb: 'An alpine meadow under snow-capped peaks.', price: 420 },
  { id: 'snow', name: 'Snowfield', blurb: 'Deep winter. Drifts, laden pines, cold blue light.', price: 520 },
];

export const THEME_ITEMS: (ShopItem & { id: ThemeId })[] = [
  { id: 'playful', name: 'Playful', blurb: 'The house style — warm, round, bright.', price: 0, free: true },
  { id: 'ghibli', name: 'Ghibli', blurb: 'Pastel wash, film grain, soft corners.', price: 150 },
  { id: 'anime', name: 'Anime', blurb: 'High saturation, sharp edges, speed lines.', price: 250 },
  { id: 'vangogh', name: 'Van Gogh', blurb: 'Deep blue night and swirling impasto.', price: 400 },
];

export const PET_ITEMS: PetSkin[] = [
  { id: 'mochi', name: 'Mochi', blurb: 'Ginger tabby. The original.', price: 0, free: true, species: 'cat', colors: null },
  {
    id: 'shadow',
    name: 'Shadow',
    blurb: 'Charcoal coat, moonlit belly.',
    price: 180,
    species: 'cat',
    colors: { fur: '#5c5f6e', furDark: '#43465a', belly: '#c9cddb', line: '#23252f' },
  },
  {
    id: 'cloud',
    name: 'Cloud',
    blurb: 'Snow-white with silver stripes.',
    price: 260,
    species: 'cat',
    colors: { fur: '#f0f1f5', furDark: '#d3d7e2', belly: '#ffffff', line: '#5b5f70' },
  },
  {
    id: 'inky',
    name: 'Inky',
    blurb: 'Deep teal, the colour of a good idea.',
    price: 380,
    species: 'cat',
    colors: { fur: '#3f8a86', furDark: '#2d6a67', belly: '#d6f0ec', line: '#1d3b3a' },
  },
  {
    id: 'biscuit',
    name: 'Biscuit',
    blurb: 'A dog. Ears down, tail up, barks at the bell.',
    price: 340,
    species: 'dog',
    colors: { fur: '#d8a765', furDark: '#b8834a', belly: '#f6e6cd', line: '#4a3728' },
  },
  {
    id: 'pepper',
    name: 'Pepper',
    blurb: 'Slate-grey dog with white socks. Endlessly pleased.',
    price: 460,
    species: 'dog',
    colors: { fur: '#7f8794', furDark: '#5f6773', belly: '#e6eaf0', line: '#2f343d' },
  },
  {
    id: 'pip',
    name: 'Pip',
    blurb: 'A puppy. All head and no patience.',
    price: 300,
    species: 'puppy',
    colors: { fur: '#e6c08a', furDark: '#c69c62', belly: '#faeed8', line: '#4a3728' },
  },
  {
    id: 'clover',
    name: 'Clover',
    blurb: 'A sheep in a very good coat. Unhurried.',
    price: 540,
    species: 'sheep',
    colors: { fur: '#f2efe6', furDark: '#d6d1c2', belly: '#fbfaf5', line: '#3c3a33' },
  },
  {
    id: 'juniper',
    name: 'Juniper',
    blurb: 'A deer. Antlers, long legs, ready to bolt.',
    price: 680,
    species: 'deer',
    colors: { fur: '#c08a5a', furDark: '#9c6a41', belly: '#f0dcc4', line: '#4a3324' },
  },
  {
    id: 'marigold',
    name: 'Marigold',
    blurb: 'A cow. Horns, a broad wet nose, and all the time in the world.',
    price: 760,
    species: 'cow',
    colors: { fur: '#f4efe8', furDark: '#3f3a36', belly: '#fffdf8', line: '#332e2a' },
  },
  {
    id: 'winter',
    name: 'Winter',
    blurb: 'A horse. Long neck, longer legs, a mane that catches the light.',
    price: 900,
    species: 'horse',
    colors: { fur: '#d9d3cb', furDark: '#8d8378', belly: '#f2eee8', line: '#3a352f' },
  },
  {
    id: 'birch',
    name: 'Birch',
    blurb: 'A donkey. Enormous ears, and opinions about the timer.',
    price: 820,
    species: 'donkey',
    colors: { fur: '#a8a29a', furDark: '#7a746c', belly: '#e4e0da', line: '#38342f' },
  },
  {
    id: 'barley',
    name: 'Barley',
    blurb: 'A bear. Slow, round, and surprisingly good company.',
    price: 1100,
    species: 'bear',
    colors: { fur: '#8a6244', furDark: '#63452f', belly: '#c9a884', line: '#2e2119' },
  },
];

export const SNACK_ITEMS: Snack[] = [
  { id: 'fish', name: 'Dried Fish', blurb: 'Restores 40 hunger.', price: 0, free: true, restores: 40, joy: 6, glyph: '🐟' },
  { id: 'cookie', name: 'Cat Cookie', blurb: 'Restores 60 hunger, +joy.', price: 90, restores: 60, joy: 12, glyph: '🍪' },
  { id: 'milk', name: 'Warm Milk', blurb: 'Restores 80 hunger, big joy.', price: 160, restores: 80, joy: 18, glyph: '🥛' },
  { id: 'sushi', name: 'Sushi', blurb: 'Full restore. Mochi will remember this.', price: 300, restores: 100, joy: 26, glyph: '🍣' },
];

/** Coin rewards. Focus pays by the minute so custom durations stay fair. */
export const REWARDS = {
  perFocusMinute: 2,
  focusCompletionBonus: 10,
  longBreakBonus: 15,
  petting: 1,
  feeding: 1,
  play: 2,
};

export function coinsForFocus(durationMs: number): number {
  const minutes = Math.max(0, Math.round(durationMs / 60_000));
  return minutes * REWARDS.perFocusMinute + REWARDS.focusCompletionBonus;
}

export const SNACK_BY_ID = Object.fromEntries(SNACK_ITEMS.map((s) => [s.id, s])) as Record<SnackId, Snack>;
export const PET_BY_ID = Object.fromEntries(PET_ITEMS.map((p) => [p.id, p])) as Record<PetSkinId, PetSkin>;

/**
 * Which animal a shop character is.
 *
 * Falls back to the cat rather than throwing: this is reached from the render
 * path with whatever id the save holds, and a save that survived `hydrate` with
 * an id this build no longer ships — an older device, a rolled-back deploy —
 * should get Mochi rather than a blank stage.
 */
export function speciesOf(id: PetSkinId): SpeciesId {
  return PET_BY_ID[id]?.species ?? 'cat';
}
