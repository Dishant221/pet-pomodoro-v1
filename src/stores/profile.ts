import { atom } from 'nanostores';
import type { SceneId } from '../game/manifest';
import { SCENE_IDS } from '../game/manifest';
import type { PetSkinId, SnackId, ThemeId } from '../game/economy';
import { PET_BY_ID, PET_ITEMS, SNACK_ITEMS, THEME_ITEMS } from '../game/economy';
import { SAVE_KEY, debounceWrite, isBrowser, readJSON, writeJSON } from './persist';

export type TimerMode = 'focus' | 'short' | 'long';

/**
 * Where the timer lives on the focus screen.
 *
 * `docked` keeps it in a bar pinned to an edge, which is the honest default:
 * it reserves its own space, so it can never sit on top of the cat. `float`
 * lifts it off the layout into a card the player parks wherever they like —
 * over the empty sky, out of the way of the pet — at the cost of covering
 * whatever is underneath it.
 */
export type ClockMode = 'docked' | 'float';
export type ClockDock = 'top' | 'left';

/**
 * The typeface the countdown is set in.
 *
 * System stacks only — no web fonts. The page has a strict content policy that
 * blocks external hosts, and self-hosting a font to restyle four digits would
 * cost more than the entire first-load budget has to spare. Every option here
 * resolves to something already on the machine.
 */
export type ClockFont = 'rounded' | 'mono' | 'serif';
/** Countdown size. The floating clock is read from across a desk. */
export type ClockSize = 'sm' | 'md' | 'lg';

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
  /**
   * The weather bed, on its own control.
   *
   * It is the only sound that plays continuously while someone is trying to
   * concentrate, so it must be silenceable without also silencing the bell that
   * ends their session.
   */
  volAmbient: number;
  /** Audio starts muted; the HUD speaker toggle is the gesture that unlocks it. */
  muted: boolean;
  notifications: boolean;
  reducedMotion: boolean;
  clockMode: ClockMode;
  /** Which edge the docked bar sits on. Meaningless while floating. */
  clockDock: ClockDock;
  /**
   * Where the floating clock is parked, as a fraction of the room it has to
   * move in: 0 is flush against the left/top edge, 1 flush against the
   * right/bottom, 0.5 centred. Storing the fraction rather than pixels is what
   * makes the position survive a resize, a rotation, or opening the save on a
   * different monitor — a card parked at the right edge of a wide window is
   * still at the right edge of a narrow one, instead of somewhere off-screen.
   */
  clockX: number;
  clockY: number;
  clockFont: ClockFont;
  clockSize: ClockSize;
  /**
   * Width of the floating card in CSS pixels, or 0 for "as wide as it needs".
   *
   * Stored in pixels rather than as a fraction, unlike the position. A window's
   * size is a judgement about how big you want the thing to be, and it should
   * not halve because you moved to a smaller screen — where its *position* very
   * much should scale, or it ends up off the edge. The two settings look alike
   * and want opposite behaviour.
   */
  clockW: number;
}

export interface PetVitals {
  hunger: number; // 0 full .. 100 starving
  happiness: number; // 0 .. 100
  /**
   * Condition, 0 ill .. 100 well.
   *
   * Slower than the other two and harder to move: it only falls after hunger
   * has been high for a sustained stretch, and it only recovers while the
   * animal is both fed and reasonably content. That inertia is the point —
   * "not feeling well" should be something you let happen over a day of
   * neglect, and something that takes real care to put right, rather than
   * another bar that swings with every biscuit.
   */
  health: number;
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
  volAmbient: 0.45,
  muted: true,
  notifications: false,
  reducedMotion: false,
  // Floating by default. Docked put a second full-width bar directly under the
  // site nav, and two stacked bars read as two navigations — the timer looked
  // like page chrome instead of like the thing you came for. Docked is still
  // there in Settings for anyone who wants the stage kept clear.
  clockMode: 'float',
  clockDock: 'top',
  // Centred near the top: clear of the cat, which stands on the ground line.
  clockX: 0.5,
  clockY: 0.04,
  clockFont: 'rounded',
  clockSize: 'md',
  clockW: 0,
};

/**
 * Save format version.
 *
 * Bumped when a *default* changes in a way that an existing save would
 * otherwise carry the old value of forever. A field the player has actually
 * chosen is never touched; the version only lets `hydrate` tell "they picked
 * docked" apart from "this save predates the question being asked".
 *
 * 2 — the timer moved off the page chrome into a floating card.
 */
export const PROFILE_VERSION = 2;

export function defaultProfile(): Profile {
  return {
    v: PROFILE_VERSION,
    coins: 0,
    owned: { scenes: ['livingroom'], themes: ['playful'], pets: ['mochi'], snacks: ['fish'] },
    equipped: { scene: 'livingroom', theme: 'playful', pet: 'mochi', snack: 'fish' },
    settings: { ...DEFAULT_SETTINGS },
    vitals: { hunger: 20, happiness: 70, health: 100, ignoredBreaks: 0, lastInteractAt: 0 },
    sessions: [],
  };
}

/** Merges a loaded save over defaults so added fields never read as undefined. */
// --- untrusted input --------------------------------------------------------
//
// `hydrate` is a trust boundary, and not only for this browser's own storage.
// A save also arrives from `/api/load`, and a sync code can be shared or
// guessed at by whoever holds it — so the JSON coming back is not necessarily
// something this player wrote. An imported save file is worse: it is a file a
// stranger can hand you.
//
// So nothing is merged on faith. Every identifier is checked against the set
// of ids that actually exist, every number is coerced and clamped, and every
// boolean is checked for being a boolean. An unrecognised value is dropped
// rather than repaired, because a save claiming to own a scene called
// `__proto__` is not a save with a typo in it.

const VALID_SCENES = new Set<string>(SCENE_IDS);
const VALID_THEMES = new Set<string>(THEME_ITEMS.map((t) => t.id));
const VALID_PETS = new Set<string>(PET_ITEMS.map((p) => p.id));
const VALID_SNACKS = new Set<string>(SNACK_ITEMS.map((s) => s.id));
const VALID_MODES = new Set<string>(['focus', 'short', 'long']);
const VALID_CLOCK_MODES = new Set<string>(['docked', 'float']);
const VALID_CLOCK_DOCKS = new Set<string>(['top', 'left']);
const VALID_CLOCK_FONTS = new Set<string>(['rounded', 'mono', 'serif']);
const VALID_CLOCK_SIZES = new Set<string>(['sm', 'md', 'lg']);

/** Keep only recognised ids, plus the one that is always owned. */
function ownedIds<T extends string>(raw: unknown, valid: Set<string>, always: T): T[] {
  const list = Array.isArray(raw) ? raw : [];
  const kept = list.filter((v): v is T => typeof v === 'string' && valid.has(v));
  return Array.from(new Set<T>([always, ...kept]));
}

function pickId<T extends string>(raw: unknown, owned: T[], fallback: T): T {
  return typeof raw === 'string' && (owned as string[]).includes(raw) ? (raw as T) : fallback;
}

function num(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function bool(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

/** A value from a closed set, or the default. Unlike ids, nothing owns these. */
function oneOf<T extends string>(raw: unknown, valid: Set<string>, fallback: T): T {
  return typeof raw === 'string' && valid.has(raw) ? (raw as T) : fallback;
}

export function hydrate(raw: Partial<Profile> | null): Profile {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') return base;

  const rawOwned = (raw.owned ?? {}) as Record<string, unknown>;
  const owned = {
    scenes: ownedIds<SceneId>(rawOwned.scenes, VALID_SCENES, 'livingroom'),
    themes: ownedIds<ThemeId>(rawOwned.themes, VALID_THEMES, 'playful'),
    pets: ownedIds<PetSkinId>(rawOwned.pets, VALID_PETS, 'mochi'),
    snacks: ownedIds<SnackId>(rawOwned.snacks, VALID_SNACKS, 'fish'),
  };

  const rawEquipped = (raw.equipped ?? {}) as Record<string, unknown>;
  const rawSettings = (raw.settings ?? {}) as Record<string, unknown>;
  const rawVitals = (raw.vitals ?? {}) as Record<string, unknown>;
  const d = base.settings;

  const savedVersion = num(raw.v, 0);

  const merged: Profile = {
    v: PROFILE_VERSION,
    coins: Math.max(0, Math.floor(num(raw.coins, 0))),
    owned,
    // Equipping is resolved against what is owned, so this cannot end up
    // pointing at something that does not exist even if both halves lie.
    equipped: {
      scene: pickId(rawEquipped.scene, owned.scenes, 'livingroom'),
      theme: pickId(rawEquipped.theme, owned.themes, 'playful'),
      pet: pickId(rawEquipped.pet, owned.pets, 'mochi'),
      snack: pickId(rawEquipped.snack, owned.snacks, 'fish'),
    },
    settings: {
      focusMin: num(rawSettings.focusMin, d.focusMin),
      shortMin: num(rawSettings.shortMin, d.shortMin),
      longMin: num(rawSettings.longMin, d.longMin),
      longEvery: num(rawSettings.longEvery, d.longEvery),
      autoStartBreaks: bool(rawSettings.autoStartBreaks, d.autoStartBreaks),
      volMaster: num(rawSettings.volMaster, d.volMaster),
      volSfx: num(rawSettings.volSfx, d.volSfx),
      volAmbient: num(rawSettings.volAmbient, d.volAmbient),
      muted: bool(rawSettings.muted, d.muted),
      notifications: bool(rawSettings.notifications, d.notifications),
      reducedMotion: bool(rawSettings.reducedMotion, d.reducedMotion),
      clockMode: oneOf<ClockMode>(rawSettings.clockMode, VALID_CLOCK_MODES, d.clockMode),
      clockDock: oneOf<ClockDock>(rawSettings.clockDock, VALID_CLOCK_DOCKS, d.clockDock),
      clockX: num(rawSettings.clockX, d.clockX),
      clockY: num(rawSettings.clockY, d.clockY),
      clockFont: oneOf<ClockFont>(rawSettings.clockFont, VALID_CLOCK_FONTS, d.clockFont),
      clockSize: oneOf<ClockSize>(rawSettings.clockSize, VALID_CLOCK_SIZES, d.clockSize),
      clockW: num(rawSettings.clockW, d.clockW),
    },
    vitals: {
      hunger: clamp(num(rawVitals.hunger, base.vitals.hunger), 0, 100),
      happiness: clamp(num(rawVitals.happiness, base.vitals.happiness), 0, 100),
      health: clamp(num(rawVitals.health, base.vitals.health), 0, 100),
      ignoredBreaks: clamp(Math.floor(num(rawVitals.ignoredBreaks, 0)), 0, 999),
      lastInteractAt: Math.max(0, Math.floor(num(rawVitals.lastInteractAt, 0))),
    },
    // Capped: a save is uploaded whole, and an unbounded history is both a
    // storage cost and a way to make the stats page chew the main thread.
    sessions: Array.isArray(raw.sessions) ? raw.sessions.filter(isSession).slice(-1000) : [],
  };

  merged.settings = clampSettings(merged.settings);

  // A save from before v2 carries `clockMode: 'docked'` as a default nobody
  // chose — the setting did not exist when most of those saves were written.
  // Upgrading it is the difference between the change shipping and every
  // existing player still seeing the old two-bar layout. Anything saved from
  // v2 onward is a real choice and is left alone.
  if (savedVersion < 2) merged.settings.clockMode = DEFAULT_SETTINGS.clockMode;

  return merged;
}

function isSession(s: unknown): s is SessionRecord {
  if (!s || typeof s !== 'object') return false;
  const r = s as Record<string, unknown>;
  return (
    typeof r.at === 'number' &&
    Number.isFinite(r.at) &&
    typeof r.ms === 'number' &&
    Number.isFinite(r.ms) &&
    typeof r.mode === 'string' &&
    VALID_MODES.has(r.mode)
  );
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
    volAmbient: clamp(s.volAmbient, 0, 1),
    // Clamped rather than wrapped: a fraction outside 0..1 is a card parked
    // off-screen, which is indistinguishable from having lost the clock.
    clockX: clamp(s.clockX, 0, 1),
    clockY: clamp(s.clockY, 0, 1),
    // 0 stays 0 — that is "natural width", not a tiny card. Anything else is
    // held between a size the controls still fit in and one that stops the card
    // covering the whole stage.
    clockW: s.clockW === 0 ? 0 : clamp(Math.round(s.clockW), CLOCK_MIN_W, CLOCK_MAX_W),
  };
}

/** The floating card cannot be narrower than its controls or wider than useful. */
export const CLOCK_MIN_W = 260;
export const CLOCK_MAX_W = 760;

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
      health: clamp(patch.health ?? p.vitals.health, 0, 100),
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
  // Remove every theme-* class rather than a hardcoded four. A fixed list
  // leaves anything else behind — including junk from a save written before
  // boot.js validated the theme it was given.
  // Snapshot first: classList is live, and removing while iterating it skips.
  for (const c of Array.from(root.classList)) {
    if (c.startsWith('theme-')) root.classList.remove(c);
  }
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
