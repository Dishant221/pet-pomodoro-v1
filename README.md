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
  world.ts               the player's real local time + real weather
  sync.ts                optional cloud-sync client
src/world/
  palette.ts             six time-of-day palettes + the weather wash
  paint.ts               the painted scenes, generated as layered SVG
src/three/
  daylight.ts            bends a scene's lighting to that time and weather
  painted.ts             the gameplay objects that stay 3D on a painted stage
  stage-types.ts         the World contract the engine renders against
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

**The stage is a painting with a 3D pet standing in it.** The background is
five parallax layers in the DOM; the WebGL canvas is slotted between `ground`
and `front`, so painted grass is drawn *over* the cat's paws. That occlusion is
the single most important detail — it is a far stronger depth cue than any
amount of lighting work, and without it the pet reads as a sticker. Three other
things back it up: a cast shadow plus a soft contact patch for when a low sun
stretches the shadow to nothing, a key light sharing its direction and colour
with the painter, and a camera whose pitch is derived from the painted horizon
so both ground planes vanish to the same line at every window size.

Only the objects the cat physically touches — the bowl and the cushion — stay
as geometry. Everything else is paint. The art is generated in code for now;
`paintScene` returning real paintings instead changes nothing downstream.

**The world runs on the player's clock and the player's weather.** `world.ts`
takes the time of day straight from the browser, so it is already in their
timezone and stays right when they travel. Weather comes from `/api/weather`,
which reads the approximate location Cloudflare already attaches to the request
— no geolocation prompt, no consent banner for a permission we never take.
`daylight.ts` turns those two into a lighting recipe: the sun sets the colour
and direction, then weather attenuates it, so an overcast noon and a clear dusk
are both dim in completely different colours. Indoor scenes get a reduced
`exposure` because a living room has windows, not weather.

It is all optional. No network, a blocked request, or a static deploy with no
Function at all lands on fair weather and a correct clock; a 404 is remembered
so the client stops asking.

**Three.js earns its place now.** An earlier version of this note said it did not — that was true when the world was flat SVG. The pet is 3D so it can be lit by the same sun as the painting, cast a real shadow onto it, and turn to face you. The brief made it optional garnish, and GSAP + SVG already carry
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
