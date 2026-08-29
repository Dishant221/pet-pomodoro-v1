# How to edit PetPomo's content

A reference for changing the game's *content* — themes, animals, furniture,
sounds, weather, and pet behaviour — as opposed to its infrastructure (see
DEPLOY.md) or its plain-language overview (see GUIDE.md). Written so that
whoever picks up a "change the cat to a fox" or "add a new toy" request —
human or agent — can find the exact file and the exact shape to edit, without
re-deriving the architecture from scratch.

**Every catalog in this file is a plain array or record of data, not code.**
Adding an item almost never means writing new logic; it means adding one more
entry that the existing systems already know how to render, animate, shop-list
and save. If a change you're making feels like it needs new *logic* rather
than a new *entry*, re-read the relevant section below — there is probably a
data shape that already covers it.

---

## 0. The map

```
economy.ts (the shop catalog)          — WHAT exists: themes, pet skins, scenes, snacks, prices
  ├─ species.ts                        — HOW an animal is built: proportions, voice, diet
  ├─ animal.ts                         — the ONE skeleton every species shares (rarely touched)
  ├─ animations.ts                     — POSES: what the body does for each Action
  ├─ engine.ts                         — BEHAVIOUR: which Action plays when, and why
  ├─ manifest.ts                       — PetState (app-level intent) + SceneId + scene metadata
  ├─ painted.ts                        — SCENES: static per-scene furniture/lighting recipe
  ├─ props.ts                          — OBJECTS: portable food/toys + the food bowl
  ├─ audio.ts                          — SOUNDS: synthesized SFX + per-species voice playback
  ├─ world.ts (game/)                  — WEATHER: the Condition type + client-side fetch/cache
  └─ daylight.ts                       — weather/time → lighting recipe
worker/src/index.ts  /api/weather      — WEATHER: server-side source of truth
global.css  .theme-*                   — THEME: the actual colours or a theme
PaintedBackdrop.tsx                     — WEATHER: the visible rain/snow/lightning layer
```

Read top to bottom once; after that, jump straight to the section you need.

---

## 1. Themes

A theme is a CSS palette plus a shop entry. There is no per-theme logic
anywhere — every component reads `var(--ink)`, `var(--accent)`, etc., so a new
theme is exactly two edits:

1. **`src/styles/global.css`** — add a `.theme-<id> { ... }` block defining the
   same variables the existing four themes define (`--ink`, `--ink-soft`,
   `--accent`, `--accent-ink`, plus the background/surface tokens above them
   in each block — copy an existing block as the template, e.g. `.theme-ghibli`
   at line ~30). If the theme is dark (like `.theme-vangogh`), also add
   `.theme-<id> { color-scheme: dark; }` near line 102 so form controls and
   scrollbars render correctly.
2. **`src/game/economy.ts`** — add the id to the `ThemeId` union (line 4) and
   an entry to `THEME_ITEMS` (line 65) with `name`, `blurb`, and `price`
   (`free: true` only for the starter theme).

That's it — the shop, the equip flow, and the save system all key off
`ThemeId` and need no further changes.

**Test to update:** `tests/acceptance.mjs` has `'all 4 themes apply live'`,
which iterates every `ThemeId` — bump the count in its assertion message (it's
cosmetic, the loop itself is generic) and it covers the new theme for free.

---

## 2. Animals

There are two levels here — know which one you're changing before you start.

### 2a. A new *skin* of an existing species (fastest — recolour or reflavour)

A "pet skin" (what the shop calls a character — Mochi, Shadow, Biscuit...) is
a species plus a coat. To add one:

- **`src/game/economy.ts`** — add the id to `PetSkinId` (line 5) and an entry
  to `PET_ITEMS` (line 72): `name`, `blurb`, `price`, `species` (must be an
  existing `SpeciesId`), and `colors` (`{ fur, furDark, belly, line }` hex
  strings, or `null` to use the theme's default fur colours).

No other file needs to change — `speciesOf()` at the bottom of `economy.ts`
resolves the skin to its species everywhere the rig is built.

### 2b. A whole new species (cat → fox, e.g.)

Every animal — cat, dog, horse, bear, everything — shares **one skeleton**
(`src/three/animal.ts`): spine, neck, head, two ears, four legs of three
joints, a tail. A species is *data describing that skeleton's proportions*,
not new code. To add one:

1. **`src/three/species.ts`** — add the id to `SpeciesId` (line 165), then add
   an entry to `SPECIES` (line 510) shaped like the interface at the top of
   the file: `scale`, `body` (radius/length/stand height/leg lengths/haunches
   flag), `head` (radius + squash + the enumerated `EarShape` /
   `TailShape` / `Headgear` — these three are closed unions on purpose; if
   your animal's ears/tail genuinely don't fit `pointed | droop | round |
   tall` etc., that is the one case that needs a real design conversation,
   not just a data entry), `legs` (speed/bob), `voice` (see §5), and `diet`.
   The file's own header comment explains the unit system (numbers are
   authored at the cat's scale, ~0.6 long, then scaled) — copy the closest
   existing species as your starting point and nudge numbers rather than
   inventing from zero.
2. **`src/game/economy.ts`** — add at least one `PET_ITEMS` skin using the new
   species (see §2a), or it's unreachable from the shop.

**Test to update:** `tests/acceptance.mjs` has per-character and per-species
checks (`'character X equips without tearing down the stage'`,
`'equipping a dog builds a dog, not a repainted cat'`) that loop the roster —
add the new skin id to whatever array drives that loop.

---

## 3. Scenes (the rooms/worlds)

A scene is a shop item plus a lighting-and-furniture recipe:

1. **`src/game/manifest.ts`** — add the id to `SceneId` (line 39).
2. **`src/game/economy.ts`** — add an entry to `SCENE_ITEMS` (line 56):
   `name`, `blurb`, `price`.
3. **`src/three/painted.ts`** — inside `buildPaintedWorld()` (line 196), add
   the branch that builds this scene's `THREE.Group`: ground, static
   furniture (see §4), and a `LightRecipe` (sky/fog/key/fill/rim colours —
   the `Engine.EXPOSURE` map in `engine.ts`, line ~281, controls how much of
   the real-time sky bleeds in; rooms with less window get a lower number).
   The function must return a `World` — see `stage-types.ts` for the full
   contract: `bounds` (where the cat may roam), `bed`, `bowl`, `stash[]`
   (off-stage spots for fetched gifts), `gift` (presentation spot).

**Test to update:** `'scene X builds and frames the cat'` in
`tests/acceptance.mjs` loops every `SceneId` — the new scene is covered
automatically once it's in the union.

---

## 4. Furniture & objects

Two different things live here — decide which one you're adding.

### 4a. Static furniture (decoration — a lamp, a plant, a rug)

Lives directly in `src/three/painted.ts`, inside that scene's branch of
`buildPaintedWorld()`. Write the geometry inline (see the existing cushion at
line ~224) or, if it's reusable across scenes, add a `buildX()` function to
`src/three/props.ts` next to `buildBowl()` (line 241) and call it from
`painted.ts`. Use the `m()` / `inked()` helper (toon shading + outline) so it
matches the house art style — see any existing prop function in `props.ts`
for the pattern (a `THREE.Group`, each mesh built with `inked()` or `toon()`,
positioned in metres, name it `prop:<id>` if it's meant to be identifiable).
No behaviour, no interaction — it just sits in the `group.add(...)` tree.

### 4b. Portable objects (food, toys — things the cat interacts with)

Lives in `src/three/props.ts`:

1. Add the id to `ToyId` (line 11) or reuse `SnackId` from `economy.ts` for
   food.
2. Write a `build<name>()` function (copy `yarn()` or `fish()` as a template)
   and register it in the `BUILDERS` record (line 222).
3. If it's a toy, add a `TOYS` entry (line 22) with `label` and `glyph`
   (emoji — used by the HUD tray and toast copy). If it's food, add it to
   `SNACK_ITEMS` in `economy.ts` instead (`restores` hunger points, `joy`
   happiness, `glyph`, `price`).

Interaction (drag-and-drop feeding, the cat fetching a toy as a gift) is
already generic over `PropId` in `engine.ts` (`beginDrag`/`moveDrag`/
`endDrag`, `deliverGift()`) — a new toy or snack id needs no new interaction
code, only the registry entries above.

### 4c. A genuinely new *kind* of interactive furniture (a scratching post the cat climbs, a bed it can nap on outside of "sleeping")

This is the one case in this file that's a real feature, not a data entry —
see §6b (new Behaviour) once the object itself exists as a `World` anchor
point (extend the `World` interface in `stage-types.ts` the same way `bed`/
`bowl`/`stash` already work, then give the new behaviour a `goTo()` target
there).

---

## 5. Sounds

Everything is **synthesized from oscillators at runtime** in `src/game/
audio.ts` — there are no audio files to ship or 404. Three distinct sound
systems live there:

### 5a. Pet voices (meow, bark, moo, ...)

A species' voice is a *recipe*, not a recording: `VoiceSpec` in
`src/three/species.ts` (line 147) — `from`/`to` pitch sweep in Hz, `duration`,
two `formants` (the vowel shape), `rasp` (0 = pure tone, 1 = rough), `body`
(sub-bass weight — cows and horses have a lot), `repeats`/`gap` (a bark is two
short syllables; a moo is one long one). To change how an animal sounds, tune
its `voice` block in that species' `SPECIES` entry — no code, just the seven
numbers. `audio.ts`'s `setVoice()` reads whichever species is currently
equipped, so a dog barks where a cat meows through the same code path.

### 5b. Object/UI sound effects (coin pickup, button tap, session bell, ...)

Each cue is a `play<Name>()` function in `audio.ts` built from oscillator/
noise envelopes — find the closest existing cue (there's one per game event:
feeding, petting, coins, the session bell, etc.) and copy its envelope shape
rather than starting from Web Audio API docs. **Optional sampled override:**
drop a file into `public/assets/audio/sfx/` under a name listed in the
`MEOW_SAMPLES`-style array near the top of `audio.ts` (line 53) and it plays
instead of the synth automatically — the fetch 404s once and falls back
silently if the file isn't there, so this is safe to leave unconfigured.

### 5c. Ambient weather bed (rain/storm background sound)

Its own mixer bus (`ambientBus`, line 37) so it can be muted independently of
SFX — it is the one sound that loops continuously. Tied to `Condition` (see
§6) rather than to a game event.

---

## 6. Weather

Weather flows through four layers, in order — know which one to touch:

1. **Source of truth — `worker/src/index.ts`, `GET /api/weather`.** Reads
   Cloudflare's coarse geolocation (`request.cf`), asks Open-Meteo, and maps
   the WMO weather code to one of the game's `Condition` values via
   `conditionFor()` (line 450). **To add a new `Condition`, start here** —
   decide which upstream WMO codes map to it.
2. **The type — `src/game/world.ts`.** `Condition` (line 125) is the closed
   union (`'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' |
   'storm'`); `Weather` (line 127) is the full payload (condition +
   temperature/wind/day-or-night/hemisphere). Adding a condition means adding
   it here too, and everywhere below switches on it exhaustively (TypeScript
   will point at every place that needs a new case).
3. **Lighting — `src/three/daylight.ts`.** `modulate()` bends a scene's
   baseline `LightRecipe` (from `painted.ts`) toward the real sky — an
   overcast day dims and flattens the key light, a storm goes further, snow
   throws more fill light back up. This is where a new condition needs its
   own lighting bias.
4. **Visuals — `src/islands/PaintedBackdrop.tsx`.** The actual rain streaks,
   snowfall, and lightning flash are a DOM/CSS layer behind the 3D canvas
   (search that file for `storm`/`lightning`) — not WebGL. A new condition's
   visual treatment goes here. Respect `reduced` (prefers-reduced-motion) —
   see the existing lightning code for the pattern of removing the flash
   entirely rather than just slowing it down.
5. **Sound — `src/game/audio.ts`**, §5c above.

**Indoor scenes are exempt from some of this** — `SceneSpec.indoor` in
`manifest.ts` (§3) suppresses rain/snow/lightning for rooms with a ceiling;
weather still tints the light through the windows.

---

## 7. Behaviours and Actions — the two-layer distinction

These are two different systems that are easy to conflate:

- **Action** (`src/three/animations.ts`) is a **pose** — a pure function of
  elapsed time that returns a `Pose` (joint angles). It has no opinion about
  *why* the cat is sitting, only what sitting looks like frame to frame.
- **Behaviour** (`src/three/engine.ts`) is a **decision** — which Action
  plays, for how long, and what happens next. It's the state machine.

### 6a. A new Action (a new pose/animation — "roll over", "stretch on a post")

1. Add the id to the `Action` union in `animations.ts` (line 9).
2. Write its pose function — same signature as every existing one: takes
   `AnimCtx` (`t` seconds since the action started, `now` the monotonic
   clock, `speed`, `lookYaw`/`lookPitch`) and returns a `Pose`. Copy the
   closest existing action as a template; the engine blends in and out of
   whatever Action is active automatically (`blendTime()`), so a new pose
   only has to define *itself*, not its transitions.
3. If it's one-shot (plays once then hands off, like `petted` or
   `celebrate`), add its length to `ACTION_LENGTH` (line 562).
4. Check `animal.ts` has the joints your pose needs before designing
   something exotic — the skeleton is shared by every species, so a pose
   that only makes sense with, say, wings isn't reachable through this
   system without extending the skeleton itself (a much bigger change,
   worth a design conversation first).

### 6b. A new Behaviour (an autonomous decision — "the cat scratches furniture when bored")

Two different triggers, pick one:

- **Driven from outside** (the app tells the cat what to be doing) — this is
  how `sleeping`/`begging`/`eating`/`petted`/`playing`/`celebrating`/`sad`
  already work. Add the state to `PetState` in `manifest.ts` (line 28), then
  a case in `Engine.applyIntent()` in `engine.ts` (line 649) — the existing
  cases are the templates: set `this.behaviour`, call `goTo()` if it needs to
  walk somewhere first, then `playAction()` in the arrival callback (or
  immediately, for stationary behaviours like `petted`).
- **Fully autonomous** (the cat decides on its own, unprompted) — this is how
  the `gift` errand and idle sleep-particle chance already work. Add the case
  inside `tickBehaviour()` in `engine.ts`, following the `gift` pattern:
  flip `this.behaviour`, `goTo()` a `World` anchor point, run the payoff in
  the arrival callback. A `Math.random() < dt * <rate>` roll (see the sleep
  Zzz particles) is the standard way to make something happen "sometimes,
  rarely" without a timer to manage.

Either way, add the corresponding id to the `Behaviour` union (line 51) first
— TypeScript's exhaustiveness checking in the `switch` statements will then
point at every place that needs a new case, which is the fastest way to be
sure nothing was missed.

---

## 8. After making any of the above changes

```bash
npm run check      # astro check — typechecks the whole project
npx tsc --noEmit   # stricter pass across plain .ts/.tsx files astro check skims
npm run build      # confirms the production build itself succeeds
```

Then run the acceptance suite against a local `wrangler dev` (see DEPLOY.md
§"Local development" for the two-terminal setup):

```bash
PETPOMO_BASE=http://localhost:4332 npm run test:e2e
```

**Two tests are known-flaky on an unmodified tree** —
`'drag-feed reaches eating state'` and `'stroking >=1s reaches petted'` —
because they depend on the 3D cat's physics and gesture timing. A single run
proves nothing for either of them; run twice before blaming a change. Any
*other* failure is real and worth investigating immediately.

Several tests **loop every entry in a catalog** (every `SceneId`, every
`PetSkinId`, every `ThemeId`) — adding a new item to one of the catalogs above
is usually covered by an existing loop for free; search `tests/
acceptance.mjs` for the catalog's type name to confirm before assuming you
need a new test.

Finally: **back up the branch before merging**, per the repo's standing house
rule — see BACKLOG.md / project memory for the exact commands.
