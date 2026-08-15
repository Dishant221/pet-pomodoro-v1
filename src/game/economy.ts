import type { SceneId } from './manifest';

export type ThemeId = 'playful' | 'ghibli' | 'anime' | 'vangogh';
export type PetSkinId = 'mochi' | 'shadow' | 'cloud' | 'inky';
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
];

export const THEME_ITEMS: (ShopItem & { id: ThemeId })[] = [
  { id: 'playful', name: 'Playful', blurb: 'The house style — warm, round, bright.', price: 0, free: true },
  { id: 'ghibli', name: 'Ghibli', blurb: 'Pastel wash, film grain, soft corners.', price: 150 },
  { id: 'anime', name: 'Anime', blurb: 'High saturation, sharp edges, speed lines.', price: 250 },
  { id: 'vangogh', name: 'Van Gogh', blurb: 'Deep blue night and swirling impasto.', price: 400 },
];

export const PET_ITEMS: PetSkin[] = [
  { id: 'mochi', name: 'Mochi', blurb: 'Ginger tabby. The original.', price: 0, free: true, colors: null },
  {
    id: 'shadow',
    name: 'Shadow',
    blurb: 'Charcoal coat, moonlit belly.',
    price: 180,
    colors: { fur: '#5c5f6e', furDark: '#43465a', belly: '#c9cddb', line: '#23252f' },
  },
  {
    id: 'cloud',
    name: 'Cloud',
    blurb: 'Snow-white with silver stripes.',
    price: 260,
    colors: { fur: '#f0f1f5', furDark: '#d3d7e2', belly: '#ffffff', line: '#5b5f70' },
  },
  {
    id: 'inky',
    name: 'Inky',
    blurb: 'Deep teal, the colour of a good idea.',
    price: 380,
    colors: { fur: '#3f8a86', furDark: '#2d6a67', belly: '#d6f0ec', line: '#1d3b3a' },
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
