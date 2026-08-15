# PROJECT: PetPomo v2 — Virtual-Pet Pomodoro Browser Game
# Astro + Tailwind + GSAP on Cloudflare. ASSETS PROVIDED — DO NOT REDRAW.
# Core idea: starting the pomodoro timer STARTS THE GAME. The pet is a
# Tamagotchi with three needs — AFFECTION (pet it), HUNGER (feed it),
# FUN (play with it) — and the pomodoro phases decide WHEN each need
# can be satisfied. Focus = you work, pet keeps you company, occasional
# quick pets allowed. Break = care time: feed and play.

## PROVIDED ASSETS (in petpomo-assets/ — wire them, never recreate)
- manifest.json  ← source of truth: state→file, GSAP animation hints,
                   scene parallax factors, #snack-slot + petGround anchors
- cat/ 9 pose SVGs (viewBox 0 0 200 200, consistent character):
  cat-idle, cat-sleeping, cat-waking, cat-begging, cat-eating,
  cat-petted, cat-PLAYING (yarn ball — the play interaction),
  cat-celebrating, cat-sad
- scenes/ 4 backgrounds (viewBox 0 0 800 450): livingroom, garden,
  jungle, treehouse — each with #layer-sky/#layer-back/#layer-mid/
  #layer-front parallax groups and a #snack-slot

Asset contract:
- Inline every SVG into the DOM (`import x from '...svg?raw'`) so GSAP
  and theme CSS can reach internal groups. Never use <img>.
- Cat recolors via classes: .fur #F2A65A, .fur-dark #E8894A,
  .belly #FBE8D3, .line #4A3728 → themes override with CSS variables.
- Animate the named groups (#tail #eyes #hearts #yarn #zzz #coin ...)
  exactly per manifest.json hints.

File arrangement in the app repo:
petpomo/src/assets/pet/     ← copy cat/*.svg
petpomo/src/assets/scenes/  ← copy scenes/*.svg
petpomo/src/game/manifest.ts ← port manifest.json to typed TS
petpomo/public/audio/        ← SFX (or WebAudio-synthesized fallbacks)

## THE GAME LOOP (this is the spec — implement exactly)

### Starting the game
Landing page shows the scene, the cat idle, and one big button:
"Start focus". Pressing it = game on: timer starts, cat settles to
sleeping, needs meters begin ticking.

### Three needs (0–100, shown as small icon meters in the HUD)
- AFFECTION: decays slowly always. Refill: petting (stroke pet ≥1s →
  petted state, hearts, +15). Petting ALLOWED during focus but rate-
  limited to once per 10 min ("quick pet") so it comforts, not distracts.
- HUNGER: rises during focus (+20 per session). Refill ONLY in breaks:
  cat wakes → begging state with fish bubble → drag snack from
  #snack-slot onto cat → eating state → hunger reset, +5 affection.
- FUN: decays during focus. During breaks, the cat sometimes WANTS TO
  PLAY: yarn ball appears near #snack-slot, cat looks at it (eyes track).
  Player drags/flicks the yarn → cat enters PLAYING state (pounce loop,
  manifest hints) for a 20–30s mini-play: each flick of the yarn = cat
  chases to it (translateX tween along petGround.xRange) → fun +10 per
  chase, capped per break.
- Need priority on break: if hunger ≥60 the cat begs first; else if
  fun ≤40 it brings the yarn; else it just stretches and idles.

### Mood = f(needs)
mood = weighted avg (hunger inverted). Mood tiers change idle behavior:
happy (≥70): perky idle, frequent tail sway • okay (40–69): normal •
unhappy (<40): sad-tinted idles, slower walk, occasional #cloud sad pose.
Ignoring the pet for 2 consecutive breaks forces unhappy.

### Pomodoro rules
- 25/5 default, long break 15 after 4; configurable in settings
- Timer persists via absolute end-timestamp in localStorage (survives
  refresh/sleep); title-bar countdown; notification + bell on phase end
- Session complete → celebrating one-shot + coins (+10, ×1.5 streak ≥3/day)
- Abandon (confirm dialog: "Mochi will be sad…") → sad state 60s,
  mood −20, no coins
- Coins buy: scenes (100), themes (150), snack skins (30), yarn skins (30),
  dog pet (300, later). Shop equip persists.

## PET STATE MACHINE
idle ⇄ sleeping(focus) → waking(one-shot) → begging | playing | idle
(break, per need priority) → eating(fed) / petted(stroked) /
playing(yarn flicked) → celebrating(session done) → sad(abandon/neglect)
→ idle. Crossfade SVG swaps 150ms; idle one-shots (blink, ear twitch,
stretch) every 30–60s; eyes subtly track cursor in idle/begging.

## THEMES — exactly these four, selectable in settings & shop
All are CSS-variable sets + scene filter + UI treatment over the SAME
provided assets (no new art):
1. CASUAL (default): assets as-authored, soft rounded UI, pastel HUD
2. ANIME: saturated palette vars, higher contrast filter, sharp UI
   corners, SVG speed-line burst overlay on celebrate/pounce, bold
   display font for the timer
3. GHIBLI: warm pastel vars, slight sepia + soft-light scene filter,
   CSS grain overlay, hand-drawn-feel rounded font, lamp/lantern glow
   biased warmer, gentler animation easing (longer, softer tweens)
4. RETRO: pixelate the world — CSS `image-rendering: pixelated` on a
   downscaled canvas snapshot OR an SVG posterize filter + scanline
   overlay div + limited 16-color palette vars + chunky pixel font
   (e.g. self-hosted bitmap font) + square UI, beep-style WebAudio SFX
   variant. Timer digits render as 7-segment style.

## PAGES — all functional in MVP
/ (Game): scene + cat + needs meters + timer ring + start/pause/abandon
+ coins. /stats: TODAY|WEEK|ALL tabs, sessions, focus minutes, streaks,
pet-happiness history (7-day SVG bars). /shop: Scenes|Themes|Snacks|Yarn
tabs, buy/equip works. /settings: durations, theme, scene, volumes,
notifications, reduced motion, export/import/reset, sync. /about.

## TECH + CONSTRAINTS
- Astro static + Tailwind; one Preact/vanilla island for the game
- GSAP timelines keyed off the state machine; Howler or WebAudio-
  synthesized SFX (meow, purr, munch, boing for yarn, coin, bell,
  whimper; retro theme swaps to chiptune beeps)
- Client-first: fully playable offline (service worker); localStorage
  profile; optional Hono Worker + D1 save/load (phase 2)
- Cloudflare Pages free tier; first-load JS < 200 KB gzip; Lighthouse
  mobile perf > 85; prefers-reduced-motion disables parallax/particles

## ACCEPTANCE CHECKLIST
[ ] Start focus → cat sleeps, needs tick, timer survives refresh
[ ] Quick-pet works during focus (rate-limited), hearts spawn
[ ] Break: begging→drag-feed works (mouse+touch); yarn play works —
    flick yarn, cat chases, fun rises; need-priority logic correct
[ ] Mood tiers visibly change idle behavior; neglect path reachable
[ ] Celebrate + coins on completion; sad on abandon; streak multiplier
[ ] Shop buy/equip persists; all 4 scenes live-switch with parallax
[ ] All 4 themes (casual/anime/ghibli/retro) switch live — retro shows
    pixelation + scanlines + pixel font + beep SFX
[ ] All 5 pages + inner tabs work; settings apply instantly; offline OK
[ ] Zero console errors

## EXECUTION ORDER
1. Scaffold + pages + nav  2. Timer engine + HUD  3. Inline assets +
manifest.ts + idle/sleep GSAP  4. Needs system + feed/pet/play
interactions + SFX  5. Mood + economy + shop + stats  6. Scenes,
parallax, day/night, 4 themes (retro last — it's the trickiest)
7. SW + reduced motion + checklist + deploy  8. Worker/D1 sync.
Show me the deployed URL after step 7.
