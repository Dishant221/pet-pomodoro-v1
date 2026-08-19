# Deploying PetPomo

The game is a static Astro site. Cloud sync is a Pages Function backed by D1.

**The D1 database is not optional.** An earlier version of this file said the
site could ship without it; that is wrong. `wrangler pages deploy` bundles the
Function on every deploy and the API rejects a placeholder id outright —

```
Error 8000022: Invalid database UUID (REPLACE_WITH_YOUR_DATABASE_ID)
```

— which fails the whole deploy, static assets included. Create the database
first.

---

## 1. The game (required)

```bash
cd pet-pomodoro
npx wrangler login                 # interactive browser flow
npm run build
npx wrangler pages deploy dist --project-name petpomo
```

That prints your live URL (`https://petpomo.pages.dev`). Done — the game is
fully playable: timer, all 9 pet states, shop, stats, themes, offline.

## 2. Cloud sync (optional)

```bash
npx wrangler d1 create petpomo
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_DATABASE_ID`. Then create the table and redeploy:

```bash
npm run db:remote                  # applies worker/schema.sql to the live D1
npx wrangler pages deploy dist --project-name petpomo
```

Finally, bind the database to the Pages project so the Function can see it:

**Cloudflare dashboard → Workers & Pages → petpomo → Settings → Bindings →
Add → D1 database.** Variable name `DB`, database `petpomo`. Redeploy once more.

Verify:

```bash
curl https://petpomo.pages.dev/api/health
# {"ok":true}
```

## 3. Talking to the pet (no setup)

`POST /api/ask` decides how the animal reacts to what you said. It uses Workers
AI, which is bound in `wrangler.toml` per environment — `[env.preview.ai]` and
`[env.production.ai]`, both named `AI`.

**Do not move that binding to the top level and do not add it in the dashboard.**
Top level is also what `wrangler pages dev` loads, and Workers AI has no local
emulation, so wrangler opens a remote connection at startup and hangs every
local request. Adding it in the dashboard instead looks like it works and then
silently stops: `wrangler pages deploy` replaces the target environment's entire
config with this file, so a hand-added binding disappears on the next deploy and
`/api/ask` quietly starts answering `"model": false`.

Verify which one you are getting — the flag is in the response:

```bash
curl -s https://petpomo.pages.dev/api/ask \
  -H 'content-type: application/json' -d '{"text":"good girl"}'
# {"ok":true,"model":true,...}   <- inference ran
# {"ok":true,"model":false,...}  <- fell back to the local reaction table
```

`"model": false` is a working deploy, not a broken one: the endpoint has its own
reaction table and uses it whenever AI is absent, capped, or slow.

## 4. Weather (no setup)

`GET /api/weather` needs nothing configured — no key, no account, no binding.
It reads the approximate location Cloudflare puts on `request.cf`, rounds it to
one decimal (~11 km), and asks [Open-Meteo](https://open-meteo.com), which is
free and unauthenticated.

The rounded coordinate pair is also the cache key, so a whole town shares one
upstream call and no per-visitor record is ever created. Nothing is written to
D1 and nothing is logged.

```bash
curl https://petpomo.pages.dev/api/weather
# {"ok":true,"condition":"rain","temperature":14,...}
```

`"ok": false` means it fell back to fair weather — no geolocation on the
request (a VPN, a datacentre IP, or `wrangler pages dev` locally), or the
upstream was slow. The game is unaffected either way; it is decoration on a
world that is already correct.

### Why a Pages Function and not a standalone Worker

The client calls a bare `/api/*` with no configured base URL. Running the API as
a Pages Function puts it on the same origin as the site, so there is no CORS
preflight and no build-time URL to keep in sync — one deploy covers both.

If you'd rather run it as its own Worker, the same Hono app in
`worker/src/index.ts` exports a default fetch handler. Deploy it separately,
set `ALLOWED_ORIGINS` to your Pages origin in `wrangler.toml`, then rebuild the
site with `PUBLIC_API_BASE=https://your-worker.workers.dev` so the client points
at it.

---

## Environments

Two, both on the one `petpomo` Pages project. Which one a deploy lands in is
decided solely by `--branch`:

| | Git branch | URL | Database |
|---|---|---|---|
| **Production** | `main` | `petpomo.pages.dev` | `petpomo` |
| **Testing** | `testing` | `preview.petpomo.pages.dev` | `petpomo-preview` |

**Pushing deploys.** `.github/workflows/deploy.yml` typechecks, builds and
deploys on every push to those two branches, so the normal workflow is just:

```bash
git push origin testing    # -> preview.petpomo.pages.dev
git push origin main       # -> petpomo.pages.dev
```

It needs two repository secrets, both under **Settings → Secrets and variables
→ Actions**: `CLOUDFLARE_API_TOKEN` (a token with the *Cloudflare Pages: Edit*
permission) and `CLOUDFLARE_ACCOUNT_ID`.

Cloudflare's built-in Git integration is deliberately not used. This project was
created as a Direct Upload project and Cloudflare does not allow one to be
connected to a repository afterwards — taking that route would mean deleting and
recreating the project, losing both URLs and the deployment history.

The manual path still works and is the fallback if Actions is ever down:

```bash
npm run deploy            # -> production
npm run deploy:preview    # -> testing
```

Any *other* branch also deploys as a preview, at `<branch>.petpomo.pages.dev`
with the same preview database. `preview` is just the fixed branch name the
script uses so the testing URL never moves.

Both scripts pass `--branch` explicitly. Do not drop it: with no `--branch`,
wrangler infers the environment from whatever git branch is checked out, so a
deploy from a feature branch would quietly go somewhere you did not intend.

The split is enforced by `[env.preview]` in `wrangler.toml`, which points the
same `DB` binding at a different database. Verified by writing a save through
the preview URL and confirming production returned 404 for that same code.

A custom domain, if one is ever added, attaches to production only — preview
deploys stay on `*.pages.dev` and are never served from the real domain.

To reset the test data at any point, without touching production:

```bash
npx wrangler d1 execute petpomo-preview --remote --command "DELETE FROM saves"
```

---

## Infrastructure hardening (dashboard, not code)

**1. Rate-limit `/api/save` at the edge — once there is a zone to do it on.**
The Worker limits writes per IP using the edge cache, which is per-colo and not
atomic: enough to stop casual abuse, not enough to stop someone who means it.
The usual answer is a Cloudflare rate-limiting rule, which runs before the
Worker is invoked and costs nothing when it fires:

> **Security → WAF → Rate limiting rules → Create**
> Expression: `http.request.uri.path eq "/api/save"`
> Rate: 60 requests per 1 minute, per IP · Action: Block, 1 minute

**That is not available to this project today, and it is worth knowing why
before you go looking for it.** WAF rules are configured per *zone*, and this
account has none: the site is served from `*.pages.dev`, which is Cloudflare's
domain, not ours. There is nothing to attach a rule to. It becomes possible the
day a custom domain is added, and until then the Worker's own limits are the
only ones there are.

That is also why `/api/ask` — the one endpoint that spends money per call —
does not rely on the edge-cache counter. Its burst and daily limits are atomic
upserts into the `rate` table in D1 (`bumpLimit` in `worker/src/index.ts`),
because a per-colo cap is really that cap once per datacentre the caller can
reach. Rows are keyed by a truncated hash of the address, never the address
itself, and are swept once their window passes.

**If you add the `rate` table late**, re-run the schema against both databases
or every call falls open — the limiter is deliberately fail-open, so a missing
table shows up as no limiting rather than as an error:

```bash
npm run db:remote     # production
npm run db:preview    # preview
```

The attack this exists for is not reading saves — a sync code is 24 random
characters and cannot be guessed. It is a script inventing a new code per
request, each one a fresh D1 row of up to 256 KB, billed to you.

The Worker's own limits are set well above what a player can reach on purpose
(30 writes a minute, 60 new codes an hour, per IP) because they are shared: a
mobile carrier can put hundreds of subscribers behind one address, and refusing
a first-time player their own save is a worse outcome than the abuse a tighter
number would have caught. Tightening belongs here, in the WAF rule, where it
can be adjusted without a deploy.

**2. Set a D1 spend alert.** Free tier is 5 GB and 5M reads/day, and normal
play stays far inside it. An alert is how you find out that has stopped being
true before the bill does.

> **Manage Account → Billing → Notifications**

**3. Scope the deploy token.** `CLOUDFLARE_API_TOKEN` in GitHub Actions needs
exactly *Cloudflare Pages: Edit* on this one account. If it currently has more,
replace it — that token is one leaked workflow log away from being someone
else's.

## Security headers

`public/_headers` carries HSTS, `nosniff`, `X-Frame-Options`, a
`Referrer-Policy`, a `Permissions-Policy` that denies every powerful feature
including geolocation, and cache rules.

The Content-Security-Policy is split across two places, deliberately:

- **`security.csp` in `astro.config.mjs`** produces the real policy, emitted as
  a `<meta>` element per page. It has to live there because Astro generates a
  small inline script per client island and the policy needs their hashes. A
  hand-written `script-src 'self'` in `_headers` blocked exactly those and left
  the game a blank canvas — it looked correct and shipped nothing.
- **`_headers`** carries only `frame-ancestors 'none'`, which is ignored inside
  a `<meta>` element.

Browsers enforce every policy they are given, so the two compose.

**None of this is active under `astro preview`**, which serves static files and
applies no headers. Verify against the real runtime:

```bash
npm run build
npx wrangler pages dev dist --port 8788
PETPOMO_BASE=http://localhost:8788 npm run test:e2e
```

Adding a third-party script, font, or analytics tag will be blocked until its
origin is added to `security.csp.directives`. That is the intended behaviour —
when it happens, it is worth asking whether the third party is worth it before
widening the policy.

## Local development

```bash
npm run dev            # Astro dev server, no API
npm run db:local       # one-time: create the local D1 table
npm run dev:full       # build + wrangler pages dev — serves the API too
```

`npm run dev:full` is the only way to exercise sync locally, since the API only
exists as a Pages Function.

---

## Notes

- **`wrangler.toml` is committed with a placeholder `database_id`.** That is
  deliberate — it is not a secret, but it is account-specific, so the repo
  shouldn't pretend to know it.
- **There are no secrets to configure.** No API keys, no account. A sync code is
  generated in the browser and is the only credential; the server never sees a
  user identity.
- **D1 free tier** is 5 GB and 5M reads/day. A save is ~10-120 KB and syncs only
  when the player presses Upload/Download, so this stays comfortably free.
- **Cache busting**: `public/sw.js` uses network-first for navigations, so a new
  deploy is picked up on the next load. If you change the SW's caching strategy,
  bump `VERSION` in that file or clients will keep the old rules.
