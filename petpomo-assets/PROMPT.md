# PROJECT: PetPomo — Animated Virtual-Pet Pomodoro Game
# Astro + Tailwind + Three.js/GSAP on Cloudflare. ASSETS ARE PROVIDED — DO NOT REDRAW THEM.

## MISSION
Build a COMPLETE working MVP: every page renders, every tab works, every
interaction functions using the PROVIDED SVG assets in this folder.
No stubs, no dead buttons, no placeholder screens. First deploy must let a
user run a full pomodoro, watch the cat sleep/wake/beg, feed it, pet it,
earn coins, buy an unlock, switch scene and theme, and see stats.

## PROVIDED ASSETS (already in this repo — wire them, don't recreate them)

petpomo-assets/
├── manifest.json               ← READ THIS FIRST: maps every state/scene
│                                  to its file + animation hints + parallax
│                                  factors + snack-slot & pet-ground anchors
├── cat/                        ← 8 pose SVGs, one per pet state,
│   ├── cat-idle.svg               all share viewBox 0 0 200 200 and the
│   ├── cat-sleeping.svg           same character design
│   ├── cat-waking.svg
│   ├── cat-begging.svg
│   ├── cat-eating.svg
│   ├── cat-petted.svg
│   ├── cat-celebrating.svg
│   └── cat-sad.svg
└── scenes/                     ← 4 backgrounds, viewBox 0 0 800 450,
    ├── scene-livingroom.svg       each with parallax groups
    ├── scene-garden.svg           #layer-sky/#layer-back/#layer-mid/#layer-front
    ├── scene-jungle.svg           and a #snack-slot group
    └── scene-treehouse.svg

### How the assets are built for you (contract — rely on these)
- CAT: every SVG has named groups: #cat, #head, #eyes, #tail, plus
  state-specific parts (#hearts, #zzz, #hunger-bubble, #coin, #sparkles,
  #tear, #cloud, #paw-left/#paw-right, #breath, #bowl). Animate these
  groups with GSAP per the "loop"/"oneShot" hints in manifest.json.
- CAT THEMING: fur uses class="fur" (#F2A65A), stripes class="fur-dark"
  (#E8894A), belly class="belly" (#FBE8D3), outlines/eyes class="line"
  (#4A3728). Themes recolor via CSS: `.theme-x .fur { fill: var(--fur) }`.
  Inline the SVGs into the DOM (fetch + innerHTML or Astro import ?raw)
  so CSS and GSAP can reach the internals — do NOT use <img> tags.
- SCENES: apply mouse-move parallax by translating each #layer-* group by
  (mouse offset × factor) from manifest.json. Ambient loops per the
  manifest "ambient" hints (drift #clouds, pulse #fireflies, fly #bird,
  sway .flower / #hanging-leaves). Living room has #window-sky, #sun,
  #stars, #lamp-glow for the real-clock day/night cycle.
- PLACEMENT: position the cat with feet on scene's petGround.y, moving
  within petGround.xRange (walk = translateX tween + slight bob).
  The draggable snack spawns at the scene's #snack-slot position.

### File arrangement in the app repo
petpomo/
├── src/assets/pet/            ← COPY cat/*.svg here (imported ?raw, inlined)
├── src/assets/scenes/         ← COPY scenes/*.svg here (imported ?raw)
├── src/game/manifest.ts       ← PORT manifest.json to a typed TS object;
│                                  it is the single source of truth for
│                                  state→file, animation specs, parallax,
│                                  ground anchors
└── public/audio/               ← runtime audio (see AUDIO)

Build the SVGs into the JS bundle via `import catIdle from
'../assets/pet/cat-idle.svg?raw'` — they total < 30 KB, cheaper than
network fetches, and guarantee offline play.

## HARD CONSTRAINTS
1. Client-first: all game/timer/animation logic in the browser; fully
   functional offline after first load; no account required.
2. Server = persistence only: Hono Worker, POST /api/save + GET /api/load.
3. Cloudflare free tier: Astro static on Pages; Worker + D1 sync only.
4. Perf: first-load JS < 200 KB gzip. Three.js is OPTIONAL garnish —
   the provided 2D SVG world is the primary renderer. If you add
   Three.js, lazy-load it only for particle/depth effects on the game
   page after first paint, behind a capability check. If the budget is
   at risk, ship without it: GSAP + SVG must carry the MVP alone.

## TECH STACK (exact)
- Astro `output: 'static'`, Tailwind CSS everywhere
- One interactive island `<Game client:load />` (Preact or vanilla TS)
- GSAP for all pet/scene animation (timelines keyed off petMachine state)
- Three.js (lazy, optional): heart/coin particle bursts and subtle scene
  depth only — never required for core play
- Howler.js audio (gesture-gated, muted default); nanostores state;
  localStorage source of truth; Hono + D1 optional sync

## PET STATE MACHINE (drives which SVG is mounted + which GSAP timeline runs)
idle ⇄ sleeping (focus) → waking (focus end, one-shot) → begging (break)
→ eating (snack dropped) → petted (stroke ≥1s) → celebrating (session
complete, one-shot) → sad (abandon, 60s) → idle
- Crossfade between state SVGs (150ms opacity swap, positions preserved)
- Idle one-shots every 30–60s: reuse #tail/#eyes tweens (twitch, blink)
- Hunger 0–100 (+20/focus; feed resets; 2 ignored breaks → sad idles)
- Petting: pointerdown+move over cat bbox ≥1s → mount petted state,
  float #hearts, purr loop, happiness+

## TIMER (bulletproof)
25/5, long 15 after 4 (configurable). Persist absolute end-timestamp in
localStorage; recompute on every tick/load — survives refresh & sleep.
Title-bar countdown. Notification + bell on completion. Abandon has a
confirm ("Mochi will be sad…").

## PAGES & TABS — ALL WORKING IN MVP
1. / (Focus): scene SVG + cat + Tailwind HUD overlay (timer ring, controls,
   session dots, coins). 2. /stats: TODAY|WEEK|ALL toggles, cards, pure-SVG
   7-day bars. 3. /shop: Scenes|Themes|Pets|Snacks tabs, buy/equip persists.
4. /settings: durations, theme, scene, 3 volume sliders, notifications,
   reduced-motion, export/import JSON, reset, sync sign-in. 5. /about.
Shared Layout.astro nav; no route 404s or renders empty.

## THEMES (recolor the provided SVGs — no new art needed)
Theme = CSS-variable set applied on <html>: UI palette + .fur/.fur-dark/
.belly/.line fills + scene hue-rotate/saturation wrapper filter + ambient
audio choice. Ship 4:
- Playful (default): assets as-authored
- Ghibli: soften — pastel vars, slight sepia scene filter, grain overlay
  div (CSS noise), rounded UI, warm lamp light bias
- Anime: saturate vars, crisper contrast filter, sharper UI corners,
  speed-line burst (SVG) on celebrate
- Van Gogh: deep-blue/amber vars, night-biased scenes, swirl overlay
  texture (single tiling SVG pattern you generate), impasto card shadows

## AUDIO
Meow ×3, purr loop, munch, coin, bell, whimper + per-scene ambient.
If no CC0 files are bundled, SYNTHESIZE all SFX with WebAudio (short
envelopes/noise) so the audio layer is fully wired; files swap in later.

## ACCEPTANCE CHECKLIST (verify each before "done")
[ ] build + deploy to Pages succeeds
[ ] full pomodoro incl. mid-session refresh
[ ] all 8 cat states visibly reached, animated per manifest hints
[ ] drag-feed works mouse AND touch; petting spawns hearts
[ ] coins→shop→equip persists across reload
[ ] 4 scenes + 4 themes switch live, parallax + ambient loops running
[ ] living-room day/night follows real clock
[ ] all 5 pages + inner tabs functional; settings apply instantly
[ ] offline after first load (service worker)
[ ] prefers-reduced-motion disables parallax/particles
[ ] zero console errors

## EXECUTION ORDER
1. Scaffold + Layout + 5 pages + nav (real empty states)
2. Timer engine + HUD, fully working
3. Inline scene + cat SVGs, manifest.ts, GSAP idle/sleeping loops
4. Full state machine + feed + pet interactions + WebAudio SFX
5. Economy, shop, stats on real profile data
6. All scenes/themes/ambients + day/night + parallax
7. SW, reduced motion, checklist pass, deploy
8. THEN Worker/D1 sync; THEN optional Three.js particles

Run the checklist, fix failures, show me the deployed URL.
