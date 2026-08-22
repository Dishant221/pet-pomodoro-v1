# Acceptance tests

Two Playwright scripts that drive the real app in Edge with real pointer input.
They assert behaviour, not implementation — the pet's state is read from the
stage's `aria-label`, which is also what a screen reader announces.

## `acceptance.mjs` — 102 checks

Two of these deliberately wait tens of seconds: lightning is scheduled minutes
apart, so proving it strikes — and proving reduced motion means it never does —
costs real time. Both are worth it. A flash is the one effect here that can
harm someone, and "we think it's disabled" is not the same as knowing.

```bash
npm run build
npx astro preview --port 4330
npm run test:e2e
```

**Run it against the real Workers runtime before shipping anything.** `astro
preview` serves static files and nothing else — it applies none of
`public/_headers` and serves no `/api`, so a Content-Security-Policy
that blocks the entire game passes cleanly there:

```bash
npx wrangler dev --port 8788
PETPOMO_BASE=http://localhost:8788 npm run test:e2e
```

The `zero console errors` check is what catches CSP violations — they surface
as console errors, so a policy that breaks hydration fails the run.

Covers: all 5 routes; scene + cat SVG inlining; CSS recolouring winning over the
SVG `fill` attribute; all 9 pet states reached through real interaction
(idle → sleeping → waking → celebrating → eating → petted → playing → begging →
sad); a full pomodoro including a mid-session refresh with the absolute end
timestamp preserved; drag-feed; stroke-to-pet with hearts; coins → shop → equip
→ reload; all 6 scenes and 4 themes switching live; the living room following
the real clock; settings applying instantly; reduced motion actually killing
parallax (and parallax actually moving when it's allowed); all three clock
placements including dragging the floating one and finding it in the same place
after a reload *and* a resize; a hostile save being normalised rather than
obeyed; export; offline load via the service worker; and a zero-console-error
assertion.

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

## `auth.mjs` — 13 checks

Accounts end to end, against the same server as sync (`npm run db:local`
once, then `npm run dev:full`):

```bash
npm run test:auth
```

Covers: the login page and its painted wallpaper; create-account landing
signed-in on /profile; the local save being adopted as the account save
(coins survive); the nav avatar and sign-out; a wrong password refused in
words; a second browser context signing in and pulling the account save; the
admin role gate refusing a normal user and answering after promotion + a
fresh sign-in (sessions cache the user snapshot in KV, so a role change
applies at the next sign-in); zero console errors.

Two suite-specific rules: better-auth allows 3 sign-ins per 10 s per address,
so sign-ins go through a helper that retries once after the window; and the
deliberate 401/403/404/429 responses are filtered narrowly, only while the
step that causes them runs — same policy as sync.mjs's expected 429.

**Run sync and auth suites separately from acceptance** (not back-to-back in
one command) — they share the server's per-IP write buckets and interleave
into rate-limit flakes otherwise.

## `community.mjs` — 23 checks

The moderation pipeline at the API level (same server as sync/auth):

```bash
npm run test:community
```

Covers what MODERATION.md promises: seven sanitizer rejection classes
(plain/`www.`/bare-domain URLs, @handles, zero-width- and fullwidth-cloaked
URLs, angle brackets), the target allowlist, pending → approve → visible,
the admin gate refusing the signed-out, live-session bans (a fresh ban
refuses an already-signed-in member immediately and bulk-rejects their
pending posts), the contact honeypot storing nothing while answering
success, and the comment rate limit tripping on a burst.

Rerun hygiene: valid submissions share a 5-per-10-min-per-IP budget in the
local D1's `rate` table, so a rerun inside the window starts pre-spent —
`npx wrangler d1 execute petpomo --local --command "DELETE FROM rate"` resets
it. POSTs to /api/auth/* need an `Origin` header (better-auth's CSRF check);
the suite's helper sends one, mimicking a browser.

## `sync.mjs` — 10 checks

Needs the API, which only exists inside the Worker:

```bash
npm run db:local           # once
npm run dev:full           # build + wrangler dev on :4332
npm run test:sync
```

Covers the full round trip: generate code → upload → wipe the device → download
→ everything restored and the theme reapplied; a second browser context pulling
the same save with the same code; a refusal arriving as a sentence rather than
a status code; and an unknown code returning a clean miss rather than leaking
anything.

**Wait on the status text, never on a sleep.** `[role="status"]` is long-lived —
it holds the last thing the panel said — so waiting for the element to exist
proves nothing after the first message, and a fixed sleep either reads the
previous one or outlasts the thing being timed. The rate-limit check is the
sharp case: it only gets its refusal if the second upload lands inside the
server's one-second write window, so `waitForStatus()` polls the text instead.
