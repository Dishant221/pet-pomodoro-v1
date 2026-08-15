import { atom } from 'nanostores';
import type { SceneId } from '../game/manifest';
import type { PetSkinId, SnackId, ThemeId } from '../game/economy';
import { PET_BY_ID } from '../game/economy';
import { SAVE_KEY, debounceWrite, isBrowser, readJSON, writeJSON } from './persist';

export type TimerMode = 'focus' | 'short' | 'long';

export interface SessionRecord {
  /** Completion timestamp, ms since epoch. */
  at: number;
  mode: TimerMode;
  /** Planned duration in ms. */
  ms: number;
  /** False when the user abandoned before the bell. */
  completed: boolean;
}

export interface Settings {
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
  autoStartBreaks: boolean;
  volMaster: number;
  volSfx: number;
  /** Audio starts muted; the HUD speaker toggle is the gesture that unlocks it. */
  muted: boolean;
  notifications: boolean;
  reducedMotion: boolean;
}

export interface PetVitals {
  hunger: number; // 0 full .. 100 starving
  happiness: number; // 0 .. 100
  ignoredBreaks: number;
  lastInteractAt: number;
}

export interface Profile {
  v: number;
  coins: number;
  owned: {
    scenes: SceneId[];
    themes: ThemeId[];
    pets: PetSkinId[];
    snacks: SnackId[];
  };
  equipped: {
    scene: SceneId;
    theme: ThemeId;
    pet: PetSkinId;
    snack: SnackId;
  };
  settings: Settings;
  vitals: PetVitals;
  sessions: SessionRecord[];
}

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStartBreaks: false,
  volMaster: 0.7,
  volSfx: 0.8,
  muted: true,
  notifications: false,
  reducedMotion: false,
};

export function defaultProfile(): Profile {
  return {
    v: 1,
    coins: 0,
    owned: { scenes: ['livingroom'], themes: ['playful'], pets: ['mochi'], snacks: ['fish'] },
    equipped: { scene: 'livingroom', theme: 'playful', pet: 'mochi', snack: 'fish' },
    settings: { ...DEFAULT_SETTINGS },
    vitals: { hunger: 20, happiness: 70, ignoredBreaks: 0, lastInteractAt: 0 },
    sessions: [],
  };
}

/** Merges a loaded save over defaults so added fields never read as undefined. */
export function hydrate(raw: Partial<Profile> | null): Profile {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') return base;
  const owned = raw.owned ?? base.owned;
  const merged: Profile = {
    v: 1,
    coins: Number.isFinite(raw.coins) ? Math.max(0, Math.floor(raw.coins as number)) : 0,
    owned: {
      scenes: uniq(['livingroom', ...(owned.scenes ?? [])]) as SceneId[],
      themes: uniq(['playful', ...(owned.themes ?? [])]) as ThemeId[],
      pets: uniq(['mochi', ...(owned.pets ?? [])]) as PetSkinId[],
      snacks: uniq(['fish', ...(owned.snacks ?? [])]) as SnackId[],
    },
    equipped: { ...base.equipped, ...(raw.equipped ?? {}) },
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    vitals: { ...base.vitals, ...(raw.vitals ?? {}) },
    sessions: Array.isArray(raw.sessions) ? raw.sessions.filter(isSession).slice(-1000) : [],
  };
  // Never leave the player equipped with something they don't own.
  if (!merged.owned.scenes.includes(merged.equipped.scene)) merged.equipped.scene = 'livingroom';
  if (!merged.owned.themes.includes(merged.equipped.theme)) merged.equipped.theme = 'playful';
  if (!merged.owned.pets.includes(merged.equipped.pet)) merged.equipped.pet = 'mochi';
  if (!merged.owned.snacks.includes(merged.equipped.snack)) merged.equipped.snack = 'fish';
  merged.settings = clampSettings(merged.settings);
  merged.vitals.hunger = clamp(merged.vitals.hunger, 0, 100);
  merged.vitals.happiness = clamp(merged.vitals.happiness, 0, 100);
  return merged;
}

function isSession(s: unknown): s is SessionRecord {
  const r = s as SessionRecord;
  return !!r && typeof r.at === 'number' && typeof r.ms === 'number' && typeof r.mode === 'string';
}

function uniq<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

export function clampSettings(s: Settings): Settings {
  return {
    ...s,
    focusMin: clamp(Math.round(s.focusMin), 1, 180),
    shortMin: clamp(Math.round(s.shortMin), 1, 60),
    longMin: clamp(Math.round(s.longMin), 1, 90),
    longEvery: clamp(Math.round(s.longEvery), 2, 12),
    volMaster: clamp(s.volMaster, 0, 1),
    volSfx: clamp(s.volSfx, 0, 1),
  };
}

// --- store -----------------------------------------------------------------

export const $profile = atom<Profile>(hydrate(isBrowser ? readJSON<Profile | null>(SAVE_KEY, null) : null));

const flush = debounceWrite(SAVE_KEY, 200);

export function setProfile(next: Profile): void {
  $profile.set(next);
  flush(next);
}

export function updateProfile(fn: (p: Profile) => Profile): void {
  setProfile(fn($profile.get()));
}

/** Immediate, non-debounced write — used before unload and on reset/import. */
export function flushNow(): void {
  writeJSON(SAVE_KEY, $profile.get());
}

// --- mutations -------------------------------------------------------------

export function addCoins(n: number): void {
  updateProfile((p) => ({ ...p, coins: Math.max(0, p.coins + Math.round(n)) }));
}

export type ShopCategory = 'scenes' | 'themes' | 'pets' | 'snacks';

export function isOwned(p: Profile, cat: ShopCategory, id: string): boolean {
  return (p.owned[cat] as string[]).includes(id);
}

/** Returns false when the player can't afford it or already owns it. */
export function buy(cat: ShopCategory, id: string, price: number): boolean {
  const p = $profile.get();
  if (isOwned(p, cat, id)) return false;
  if (p.coins < price) return false;
  setProfile({
    ...p,
    coins: p.coins - price,
    owned: { ...p.owned, [cat]: [...(p.owned[cat] as string[]), id] } as Profile['owned'],
  });
  return true;
}

const EQUIP_SLOT: Record<ShopCategory, keyof Profile['equipped']> = {
  scenes: 'scene',
  themes: 'theme',
  pets: 'pet',
  snacks: 'snack',
};

export function equip(cat: ShopCategory, id: string): boolean {
  const p = $profile.get();
  if (!isOwned(p, cat, id)) return false;
  setProfile({ ...p, equipped: { ...p.equipped, [EQUIP_SLOT[cat]]: id } as Profile['equipped'] });
  return true;
}

export function updateSettings(patch: Partial<Settings>): void {
  updateProfile((p) => ({ ...p, settings: clampSettings({ ...p.settings, ...patch }) }));
}

export function updateVitals(patch: Partial<PetVitals>): void {
  updateProfile((p) => ({
    ...p,
    vitals: {
      ...p.vitals,
      ...patch,
      hunger: clamp(patch.hunger ?? p.vitals.hunger, 0, 100),
      happiness: clamp(patch.happiness ?? p.vitals.happiness, 0, 100),
    },
  }));
}

export function recordSession(rec: SessionRecord): void {
  updateProfile((p) => ({ ...p, sessions: [...p.sessions, rec].slice(-1000) }));
}

export function resetAll(): void {
  const fresh = defaultProfile();
  $profile.set(fresh);
  writeJSON(SAVE_KEY, fresh);
}

// --- theming ---------------------------------------------------------------

/**
 * Applies theme + pet-skin CSS variables to <html>. Called from the pre-paint
 * inline script and again whenever the profile changes, so there is no flash.
 */
export function applyAppearance(p: Profile): void {
  if (!isBrowser) return;
  const root = document.documentElement;
  root.classList.remove('theme-playful', 'theme-ghibli', 'theme-anime', 'theme-vangogh');
  root.classList.add(`theme-${p.equipped.theme}`);
  root.dataset.reducedMotion = String(p.settings.reducedMotion);

  const skin = PET_BY_ID[p.equipped.pet];
  if (skin?.colors) {
    root.style.setProperty('--fur', skin.colors.fur);
    root.style.setProperty('--fur-dark', skin.colors.furDark);
    root.style.setProperty('--belly', skin.colors.belly);
    root.style.setProperty('--line', skin.colors.line);
  } else {
    // Fall back to whatever the theme declares.
    root.style.removeProperty('--fur');
    root.style.removeProperty('--fur-dark');
    root.style.removeProperty('--belly');
    root.style.removeProperty('--line');
  }
}

/** True when the OS asks for reduced motion, or the player toggled it on. */
export function prefersReducedMotion(p: Profile): boolean {
  if (p.settings.reducedMotion) return true;
  if (!isBrowser) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- import / export -------------------------------------------------------

export function exportJSON(): string {
  return JSON.stringify($profile.get(), null, 2);
}

export function importJSON(text: string): { ok: true } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(text);
    const next = hydrate(parsed);
    $profile.set(next);
    writeJSON(SAVE_KEY, next);
    applyAppearance(next);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not parse that file.' };
  }
}
