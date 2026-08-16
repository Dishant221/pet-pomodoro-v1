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
npm run budget       # first-load JS budget (run after build)
```

- **[GUIDE.md](./GUIDE.md)** — plain-language walkthrough: run it, test it, ship it,
  and what to do when something breaks. Start there if you are new.
- **[BACKLOG.md](./BACKLOG.md)** — numbered list of what is done and what is not.
- **[DEPLOY.md](./DEPLOY.md)** — infrastructure, environments and the optional
  cloud sync.

This file is the *why*: the decisions and the reasoning behind them.

## How it's put together

```
petpomo-assets/          the provided source art + manifest.json (the contract)
src/assets/pet/          9 cat poses, viewBox 0 0 200 200
src/assets/scenes/       6 backgrounds, viewBox 0 0 800 450
src/game/
  manifest.ts            typed port of manifest.json — the single source of truth
  anim.ts                every GSAP timeline: poses, parallax, ambient, day/night
  audio.ts               all SFX + ambient beds, synthesized in Web Audio
  economy.ts             shop catalog and coin rewards
  mood.ts                how the animal feels, derived from its vitals
  world.ts               the player's real local time + real weather
  sync.ts                optional cloud-sync client
src/world/
  palette.ts             six time-of-day palettes + the weather wash
  paint.ts               the painted scenes, generated as layered SVG
src/three/
  species.ts             what makes one animal a different animal — pure data
  animal.ts              the one quadruped rig every species is built from
  daylight.ts            bends a scene's lighting to that time and weather
  painted.ts             the gameplay objects that stay 3D on a painted stage
  stage-types.ts         the World contract the engine renders against
src/stores/              persist / profile / timer / pet  (nanostores)
src/islands/             Game, Stage, ShopPanel, StatsPanel, SettingsPanel
worker/                  Hono sync API + D1 schema
functions/api/           mounts the API as a same-origin Pages Function
```

A few decisions worth knowing about:

**There are two stages, and the flat one is the fallback.** The painted stage
described below needs WebGL. Where there is none — an old browser, a
blocklisted driver — `Stage.tsx` renders the original flat-SVG world instead,
which is why `src/assets/` and the manifest's `petGround` / `#snack-slot`
coordinates are still here. Those SVGs are inlined into the bundle (`?raw`)
rather than fetched, so CSS can recolour `.fur`/`.belly`/`.line` for themes,
GSAP can animate named groups like `#tail`, and the fallback works offline.

**Mood is derived, not stored.** `PetState` is a pose and changes several times
a minute; mood is slower and decides *how* those poses play, how often the
animal speaks, and what the meter says. It is read from the vitals on every
render — a stored mood is one more thing that can disagree with the numbers it
came from. The reading is worst-first, so an animal that is both ill and hungry
reads as ill: "grumpy" there would bury the one state that needs you to act.

Condition is a third vital behind "not feeling well". It only falls after hunger
has been high for a sustained stretch, only recovers while the animal is both
fed and reasonably content, and recovers slower than it falls — so illness is
something you let happen over a day of neglect and have to actually nurse back,
rather than a bar that flickers with every biscuit.

**One rig, many animals.** A cat and a dog are the same hierarchy — spine, neck,
head, two ears, four legs of three joints, a tail of N segments — and that is
not a simplification, it is what quadrupeds are. It is also why one library of
animations drives all of them: a walk cycle is a pattern of hip, knee and ankle
angles, and that pattern belongs to having four legs rather than to being a cat.

So a species is data (`species.ts`): proportions, a few silhouette choices from
a closed set (ear shape, tail shape, headgear), and a voice recipe the audio
synthesizer plays instead of a sample. Adding an animal is describing one. The
cat's numbers were lifted from the original hand-tuned rig unchanged, so it acts
as the control — anything that looks different on the cat is a bug in the
generalisation rather than a new art direction.

A shop character is a species *and* a coat, not one or the other: Mochi is a
ginger cat, Biscuit is a tan dog. Keeping that on the existing pet item means
ownership, equipping, the shop tab and the save's trust boundary all work for
species with no new machinery.

**The timer moves; the pet panel does not.** They are two separate pieces of
chrome because they are two different jobs. The timer is a tool you set and then
ignore, so it is a card you can drag anywhere — with its own typeface and size,
from system font stacks, since the content policy blocks external fonts and
self-hosting one to restyle four digits would cost more than the first-load
budget has spare. The pet's mood, fullness, happiness, condition, coins, feed
and mute are a readout you glance at, so they are pinned to the top right and
stay there. Putting them together meant dragging the clock out of the way also
moved the only place you could see whether the animal was hungry.

**The clock has two modes and one markup tree.** Docked, it reserves a strip of
the layout along the top or the left edge, so it can never cover the cat.
Floating, it leaves the layout entirely and becomes a card the player drags
anywhere over the stage. All three arrangements are the same HUD with a
`data-layout` attribute on it; the differences live in CSS. Writing them as
three components would mean every new control had to be added three times, and
the two that got forgotten would be the ones nobody is looking at.

The parked position is stored as a *fraction of the travel* rather than a pixel
offset, and rendered as `left: X%` against an equal negative `translate`. The
pair interpolates between flush-left at 0 and flush-right at 1 at any window
size, which is what makes a clock parked at the right edge of a desktop window
still on screen — and still at the right edge — on a phone.

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

**The weather is audible, on its own bus.** This file used to say there was no
ambient layer and that every sound was a cue tied to something the player did.
That was right while the only candidate was generic room tone; rain you can hear
*while it is visibly raining* is a different thing — the same reading as the sky
arriving through the other sense. All four beds are one brown-noise loop bent by
filters, because that is what these sounds are: rain is noise with the low end
rolled off, wind is a narrow band swept slowly through it, snow is wind with
almost everything removed. A filter sweep also does not repeat, and a sampled
loop does.

It has its own slider because it is the only sound that plays continuously while
someone is concentrating, and turning the weather down must not also turn down
the bell that ends their session.

**Lightning does not strobe.** A flashing screen can trigger seizures. Each
strike is one soft bloom over most of a second, minutes apart, nowhere near the
three-per-second ceiling — and `prefers-reduced-motion` removes it from the DOM
rather than slowing it down, because a flash is not decoration you can turn
down. Thunder is scheduled a beat *after* its flash, since light outruns sound
and that gap is the only thing that makes a storm read as being somewhere. It is
a distant roll rather than a near crack: a sharp bang is exactly the noise that
makes someone lose their thread, which is the one thing a focus timer must not
do.

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

**And on the player's season.** Weather is what the sky is doing this hour; a
season is what the year is doing, and they compose — a rainy day in autumn is a
grey wash over rust-coloured trees, not the same grey over the same green. Like
the weather wash, a season is a *transform* of the existing palettes rather than
a new set of them: thirty-six palettes times four seasons is unmaintainable, and
autumn is the same afternoon with the greens pushed towards amber.

Only the living things move. Sky, sun, cloud and rock are the same in April as
in October — tinting those along with the leaves is what makes seasonal filters
look like a colour wash instead of a year passing. Winter is grey-green and
bare, not white: snow is weather, and painting the season white would mean a
snowfield in every mild coastal January.

The hemisphere comes from `/api/weather`, reduced server-side from the latitude
Cloudflare already has to a single bit, because December is midsummer in Sydney
and a world that paints snow on a Sydney Christmas was built by someone who only
checked their own window. A hemisphere is not a location.

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

**The 3D engine loads after the page does.** Three.js and everything built on
it is about 150 KB gzipped — more than the entire rest of the app — so
`Stage3D` imports the engine for its *type* only and pulls the real thing in
with `import()` once mounted. The timer, the HUD and the painted backdrop are
all up and interactive first; the 3D pet arrives a moment later. The capability
check lives in its own module for the same reason: asking whether the browser
can do 3D must not require downloading the 3D engine.

`npm run budget` measures this and fails over 200 KB, and CI runs it before
deploying. It walks the real static-import graph from the scripts the HTML
names, so deferring work actually shows up as deferred — and it counts
re-exports, because a budget that can only be wrong in the optimistic direction
is not a budget.

**Three.js earns its place now.** An earlier version of this file argued
against it, and that was correct when the world was flat SVG. It stopped being
correct once the world became a painting: the pet is 3D precisely so it can be
lit by the same sun the painter used, cast a real shadow onto the painted
ground, and turn to face you. None of those are available to a sprite.

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
