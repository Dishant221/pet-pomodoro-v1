# Acceptance tests

Two Playwright scripts that drive the real app in Edge with real pointer input.
They assert behaviour, not implementation — the pet's state is read from the
stage's `aria-label`, which is also what a screen reader announces.

## `acceptance.mjs` — 54 checks

```bash
npm run build
npx astro preview --port 4330
npm run test:e2e
```

**Run it against the real Pages runtime before shipping anything.** `astro
preview` serves static files and nothing else — it applies none of
`public/_headers` and serves no `/api` Functions, so a Content-Security-Policy
that blocks the entire game passes cleanly there:

```bash
npx wrangler pages dev dist --port 8788
PETPOMO_BASE=http://localhost:8788 npm run test:e2e
```

The `zero console errors` check is what catches CSP violations — they surface
as console errors, so a policy that breaks hydration fails the run.

Covers: all 5 routes; scene + cat SVG inlining; CSS recolouring winning over the
SVG `fill` attribute; all 9 pet states reached through real interaction
(idle → sleeping → waking → celebrating → eating → petted → playing → begging →
sad); a full pomodoro including a mid-session refresh with the absolute end
timestamp preserved; drag-feed; stroke-to-pet with hearts; coins → shop → equip
→ reload; all 4 scenes and 4 themes switching live; the living room following
the real clock; settings applying instantly; reduced motion actually killing
parallax (and parallax actually moving when it's allowed); export; offline load
via the service worker; and a zero-console-error assertion.

Three things worth knowing if you edit it:

- **Poll for pet states, don't sleep.** Several are transient — `waking` lasts
  1.6s before handing off to `celebrating`. `waitForPetState()` exists for
  this; sleeping a fixed interval assumes a page-load time that stops holding
  the moment you point the suite at the slower Pages runtime.

- **Seed saves from `/about`.** It's the only page without an island that writes
  to localStorage, so injections can't race the Game island's 200 ms debounced
  write. `seedSave()` does this for you.
- **Don't grind for state changes.** Hunger is 20 by default and +20 per focus
  session against a threshold of 70, so reaching `begging` "naturally" takes
  three sessions. Seed `vitals.hunger` instead.

## `sync.mjs` — 9 checks

Needs the API, which only exists as a Pages Function:

```bash
npm run db:local           # once
npm run dev:full           # serves on 4332
npm run test:sync
```

Covers the full round trip: generate code → upload → wipe the device → download
→ everything restored and the theme reapplied; a second browser context pulling
the same save with the same code; and an unknown code returning a clean miss
rather than leaking anything.
