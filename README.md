# PetPomo

A pomodoro timer with a cat who naps while you focus. Astro (static) + Preact +
Tailwind + GSAP, deployed on Cloudflare Pages.

Start a focus session and Mochi curls up to sleep. When the bell rings she
stretches awake and celebrates, and you earn coins. Every session makes her
hungrier — during breaks you drag a snack onto her, stroke her until she purrs,
or poke her to start a game. Ignore her and she gets sad. Coins buy scenes,
themes, cats and better snacks.

## Running it

```bash
npm install
npm run dev          # http://localhost:4321
npm run check        # typecheck
npm run build        # -> dist/
```

Deploying, including the optional cloud sync: see [DEPLOY.md](./DEPLOY.md).

## How it's put together

```
petpomo-assets/          the provided source art + manifest.json (the contract)
src/assets/pet/          9 cat poses, viewBox 0 0 200 200
src/assets/scenes/       4 backgrounds, viewBox 0 0 800 450
src/game/
  manifest.ts            typed port of manifest.json — the single source of truth
  anim.ts                every GSAP timeline: poses, parallax, ambient, day/night
  audio.ts               all SFX + ambient beds, synthesized in Web Audio
  economy.ts             shop catalog and coin rewards
  sync.ts                optional cloud-sync client
src/stores/              persist / profile / timer / pet  (nanostores)
src/islands/             Game, Stage, ShopPanel, StatsPanel, SettingsPanel
worker/                  Hono sync API + D1 schema
functions/api/           mounts the API as a same-origin Pages Function
```

A few decisions worth knowing about:

**The SVGs are inlined into the JS bundle** (`?raw`), not loaded as `<img>` or
fetched. That's what lets CSS recolour `.fur`/`.belly`/`.line` for themes and
lets GSAP animate named groups like `#tail` and `#zzz`. All 13 files total ~52 KB
raw, which is cheaper than 13 requests and guarantees the game works offline.

**The whole world is one 800×450 SVG.** The scene is inlined into a `<g>`, and
the cat is a nested `<svg>` with its own 200×200 viewBox. That means the
manifest's scene coordinates (`petGround`, `#snack-slot`) are used directly with
no coordinate conversion, and every pose stays pixel-identical wherever the cat
is standing.

**The timer stores an absolute end timestamp**, never a countdown. Every tick,
tab focus and page load recomputes from `Date.now()`, so a refresh, a
backgrounded tab, or a closed laptop lid cannot drift it. If the deadline passed
while you were away, completion fires on the next tick.

**The islands are `client:only`, not `client:load`.** These panels render
entirely from localStorage, so there is no correct server render — and Preact's
`hydrate()` deliberately skips prop diffing, which meant server-rendered
`disabled` attributes (computed with 0 coins) survived hydration and left every
shop button dead. `client:only` removes the mismatch class of bug entirely and
avoids a flash of the wrong theme and scene.

**Audio is synthesized, not sampled.** Meows are a pitch-swept sawtooth through
two bandpass formants; the purr is brown noise under a 26 Hz tremolo; the bell is
five inharmonic partials. Nothing is fetched, nothing 404s, and it works offline.
Swap in CC0 samples later by replacing the `play*` bodies — the mixer and call
sites don't change.

**No Three.js.** The brief made it optional garnish, and GSAP + SVG already carry
the particle bursts. Three.js core is ~170 KB gzip against a 200 KB budget the
whole app currently meets in ~64 KB.

## Accessibility

Reduced motion is honoured from the OS and can be forced in Settings; it disables
parallax, particles and every looping animation while keeping each pose readable.
Audio starts muted. The stage carries a live `aria-label` describing the scene and
what the cat is doing. All controls are keyboard reachable.

## Data

Everything lives in this browser's localStorage. No account, nothing uploaded.
Settings has export/import JSON. Cloud sync is opt-in and keyed by a random
24-character code generated in your browser — the server stores an opaque blob
under it and never learns who you are.
