# Acceptance tests

Two Playwright scripts that drive the real app in Edge with real pointer input.
They assert behaviour, not implementation — the pet's state is read from the
stage's `aria-label`, which is also what a screen reader announces.

## `acceptance.mjs` — 52 checks

```bash
npm run build
npm run preview            # must be on port 4330
npm run test:e2e
```

Covers: all 5 routes; scene + cat SVG inlining; CSS recolouring winning over the
SVG `fill` attribute; all 9 pet states reached through real interaction
(idle → sleeping → waking → celebrating → eating → petted → playing → begging →
sad); a full pomodoro including a mid-session refresh with the absolute end
timestamp preserved; drag-feed; stroke-to-pet with hearts; coins → shop → equip
→ reload; all 4 scenes and 4 themes switching live; the living room following
the real clock; settings applying instantly; reduced motion actually killing
parallax (and parallax actually moving when it's allowed); export; offline load
via the service worker; and a zero-console-error assertion.

Two things worth knowing if you edit it:

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
