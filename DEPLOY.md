# Deploying PetPomo

The game is a static Astro site served by a **Cloudflare Worker with Static
Assets** (migrated from Cloudflare Pages on 2026-08-22). The same Worker
answers `/api/*` — the Hono app in `worker/src/index.ts`, entered through
`worker/src/entry.ts` — backed by D1. `run_worker_first = ["/api/*"]` in
`wrangler.toml` means every non-API URL is served straight from the asset
store without invoking the Worker.

**The D1 database is not optional.** The Worker binds it at deploy time and
wrangler rejects a placeholder id outright, which fails the whole deploy,
static assets included. Create the database first.

> **The old Pages project `petpomo` still exists and must not be deleted.**
> It is the rollback path: `petpomo.pages.dev` and `preview.petpomo.pages.dev`
> keep serving the last Pages deploy against the same D1 databases. Keep it
> until well after the domain cutover (§ below) has been stable for weeks.

---

## 1. The game (required)

```bash
cd pet-pomodoro
npx wrangler login                 # interactive browser flow
npm run deploy:preview             # build + deploy the preview Worker
npm run deploy                     # build + deploy the production Worker
```

Production serves at `https://petpomo.totadedishant.workers.dev` (and at
`https://www.pomodoropet.com` once the custom domain is attached to the
Worker). The game is fully playable: timer, all 9 pet states, shop, stats,
themes, offline.

## 2. Cloud sync (optional)

```bash
npx wrangler d1 create petpomo
```

Copy the `database_id` it prints into `wrangler.toml` (it appears once per
environment — top level, `[env.preview]`, `[env.production]`; production and
local dev share the `petpomo` id). Then create the tables and redeploy:

```bash
npm run db:remote                  # applies worker/schema.sql to the live D1
npm run deploy
```

There is no dashboard binding step: bindings live in `wrangler.toml` only,
and every deploy applies exactly what the file says.

Verify:

```bash
curl https://www.pomodoropet.com/api/health
# {"ok":true}
```

## 3. Talking to the pet (no setup)

`POST /api/ask` decides how the animal reacts to what you said. It uses Workers
AI, which is bound in `wrangler.toml` per environment — `[env.preview.ai]` and
`[env.production.ai]`, both named `AI`.

**Do not move that binding to the top level and do not add it in the dashboard.**
Top level is what `wrangler dev` loads locally, and Workers AI has no local
emulation, so wrangler opens a remote connection at startup and hangs every
local request. Adding it in the dashboard instead looks like it works and then
silently stops: `wrangler deploy` replaces the target Worker's entire config
with this file, so a hand-added binding disappears on the next deploy and
`/api/ask` quietly starts answering `"model": false`.

Verify which one you are getting — the flag is in the response:

```bash
curl -s https://www.pomodoropet.com/api/ask \
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
curl https://www.pomodoropet.com/api/weather
# {"ok":true,"condition":"rain","temperature":14,...}
```

`"ok": false` means it fell back to fair weather — no geolocation on the
request (a VPN, a datacentre IP, or `wrangler dev` locally), or the
upstream was slow. The game is unaffected either way; it is decoration on a
world that is already correct.

### Why one Worker serves both the site and the API

The client calls a bare `/api/*` with no configured base URL. Serving the
static assets and the API from the same Worker keeps them on one origin, so
there is no CORS preflight and no build-time URL to keep in sync — one deploy
covers both. (Before the 2026-08-22 migration the same effect came from a
Pages Function; the Hono app is unchanged, only the mounting differs.)

If you ever split the API onto its own origin, set `ALLOWED_ORIGINS` in
`wrangler.toml` and rebuild the site with `PUBLIC_API_BASE` pointing at it.

---

## 5. Accounts (better-auth)

Sign-in lives at `/login`; the server half is better-auth mounted at
`/api/auth/*` (worker/src/auth.ts). Users/accounts in D1, sessions in the
`KV_SESSIONS` namespace. Schema is managed by **migrations** now:

```bash
npm run db:local      # wrangler d1 migrations apply petpomo --local
npm run db:preview    # …petpomo-preview --remote --env preview
npm run db:remote     # …petpomo --remote --env production
```

Secrets (per environment, never in wrangler.toml):

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env preview   # 32+ random chars
npx wrangler secret put GOOGLE_CLIENT_ID --env preview     # when the OAuth app exists
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
npx wrangler secret put TURNSTILE_SECRET --env preview     # when the widget exists
```

Everything degrades by configuration: no GOOGLE_* = no Google button
(client-side it is gated by the `PUBLIC_GOOGLE_LOGIN=1` build env), no
TURNSTILE_SECRET = no captcha (pair with `PUBLIC_TURNSTILE_SITE_KEY` at build
time), no SEND_EMAIL binding = no verification/reset emails (accounts still
work; `requireEmailVerification` stays false until the sending domain is
onboarded).

### Turning on "Continue with Google" (owner setup, ~10 minutes)

1. https://console.cloud.google.com → create a project (e.g. "PetPomo").
2. **APIs & Services → OAuth consent screen**: External; app name "PetPomo";
   your gmail as support + developer contact. Scopes: only the defaults
   (openid, email, profile) — these are non-sensitive, so Google requires no
   app verification. Publish the app (in "Testing" mode refresh tokens are
   short-lived and users are capped at 100).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type "Web application", name "PetPomo Web". Authorized redirect URIs —
   one per origin that serves auth:
   - `https://petpomo-preview.totadedishant.workers.dev/api/auth/callback/google`
   - `https://www.pomodoropet.com/api/auth/callback/google` (for the cutover)
4. Copy the Client ID and Client secret it shows, then per environment:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID --env preview
   npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
   ```
5. Show the button: set `PUBLIC_GOOGLE_LOGIN: '1'` in the build env — in
   `.github/workflows/deploy.yml`'s build step and in the `deploy*` scripts
   in package.json — and deploy. The button follows Google's branding rules
   (official G, "Continue with Google") and hides itself wherever the env
   var is unset.
6. Later, for the branded consent screen (name + logo instead of the raw
   client id): verify the domain in Google Search Console and link the
   privacy policy at `https://www.pomodoropet.com/privacy/` — needs the
   custom domain live first.

**Admin promotion** (one-time, per environment; sessions cache the user, so
the role applies at the account's next sign-in):

```bash
npx wrangler d1 execute petpomo-preview --remote --env preview \
  --command "UPDATE \"user\" SET role='admin' WHERE email='<your email>'"
```

better-auth upgrades: the schema in worker/migrations/0002 was verified
against `@better-auth/core/dist/db/get-tables.mjs` — the standalone
`@better-auth/cli` is deprecated and emits an OLD schema (missing
`account.issuer`), which fails at runtime. On upgrade, diff get-tables.mjs
and write a new migration by hand.

---

## 6. Community & moderation

Comments (blog + homepage), the approval queue and the admin dashboard at
`/admin`. **The full runbook is MODERATION.md** — pipeline, admin workflow,
infrastructure map, operating notes. Infrastructure summary: content and the
queue live in D1 (`posts`, migration 0004); Llama Guard pre-screens via the
existing `AI` binding (advisory only); the moderation digest rides the
`[triggers]` cron in wrangler.toml; email notifications and Turnstile are
config-gated and currently off. The comment-target allowlist regenerates as
part of `npm run build` (scripts/make-slugs.mjs).

---

## ⚠️ Going live on www.pomodoropet.com — read before merging to `main`

**As of 22 Aug 2026, do not merge `testing` into `main`.** Everything on
`testing` — including the full blog overhaul of that date (root post URLs,
covers, search, games) — is written for the new domain, and the domain is not
live yet.

### The problem, in one paragraph

Every page this code builds declares `https://www.pomodoropet.com` as its
*canonical URL* — a tag in the page's `<head>` that tells Google "whatever
address you found me at, THIS is my real one". The sitemap, RSS feed, Open
Graph images and structured data all point there too. That is correct once the
domain works. But if this code is deployed to production while
`www.pomodoropet.com` does not resolve, every page on `petpomo.pages.dev` will
be telling Google "my real address is over there" — and "over there" is a dead
host. Google follows the pointer, finds nothing, and drops the pages from its
index. The site would de-index itself. Nothing looks broken to a visitor; the
damage is invisible until search traffic is gone and slow to recover.

Preview is safe from all of this: preview builds are `noindex` and serve a
disallow-all robots.txt, so nothing there can leak into search.

### The cutover checklist, in order

1. **Register the domain** (if not already done) — `pomodoropet.com`, any
   registrar, ideally Cloudflare Registrar since the account is already there.
2. **Attach it to the production Worker** (NOT the old Pages project):
   Cloudflare dashboard → Workers & Pages → **`petpomo` (the Worker)** →
   Settings → **Domains & Routes** → *Add* → Custom domain →
   `www.pomodoropet.com`. Cloudflare creates the DNS record itself if the
   domain's DNS is on Cloudflare. Add the apex `pomodoropet.com` as a second
   custom domain (or a redirect rule) so the bare name works too.
   Rollback, if ever needed, is re-pointing the domain at the Pages project.
3. **Verify it resolves** before touching git. From any machine:
   ```bash
   curl -sI https://www.pomodoropet.com/ | head -3
   ```
   You want `HTTP/2 200` (it will serve whatever `main` last deployed — the
   old content, which is fine). If this does not return 200, stop here.
4. **Back up both branches** (house rule — see BACKLOG/memory: copy branches
   before any merge, and push the copies):
   ```bash
   git branch main-pre-domain-cutover main
   git branch testing-copy-domain-cutover testing
   git push origin main-pre-domain-cutover testing-copy-domain-cutover
   ```
5. **Merge and push**:
   ```bash
   git checkout main && git merge testing && git push origin main
   ```
   The Actions workflow deploys production automatically.
6. **Verify the cutover**: `https://www.pomodoropet.com/blog/` returns 200;
   an old blog URL such as `/blog/what-is-the-pomodoro-technique/` 301s to
   `/what-is-the-pomodoro-technique/`; `view-source:` on any page shows
   `<link rel="canonical" href="https://www.pomodoropet.com/...">`.
7. **Tell Google**: Search Console → add the `www.pomodoropet.com` property
   and submit `https://www.pomodoropet.com/sitemap-index.xml`. If
   `petpomo.pages.dev` was ever verified as a property, request indexing of a
   few key pages so the canonical transfer is picked up sooner.

Until step 3 passes, keep shipping to `testing` only. The old `pages.dev`
URLs keep working the whole time — Cloudflare never turns a project's
`*.pages.dev` address off — and the Workers URLs
(`petpomo.totadedishant.workers.dev`) serve the current code with canonicals
pointing at the custom domain.

**One more cutover consequence:** localStorage is per-origin. A player who has
been playing on a `pages.dev` or `workers.dev` URL will not see their save on
`www.pomodoropet.com` — the sync code (Settings → Cloud sync), or an account
once accounts exist, is how a save moves between origins.

---

## Environments

Two separate Workers, chosen solely by `--env`:

| | Git branch | Worker | URL | Database |
|---|---|---|---|---|
| **Production** | `main` | `petpomo` | `petpomo.totadedishant.workers.dev` (→ `www.pomodoropet.com` when live) | `petpomo` |
| **Testing** | `testing` | `petpomo-preview` | `petpomo-preview.totadedishant.workers.dev` | `petpomo-preview` |

**Pushing deploys.** `.github/workflows/deploy.yml` typechecks, builds and
deploys on every push to those two branches, so the normal workflow is just:

```bash
git push origin testing    # -> petpomo-preview.totadedishant.workers.dev
git push origin main       # -> production Worker
```

It needs two repository secrets, both under **Settings → Secrets and variables
→ Actions**: `CLOUDFLARE_API_TOKEN` (a token with the **Workers Scripts: Edit**
permission — the old Pages-scoped token will fail) and `CLOUDFLARE_ACCOUNT_ID`.

The manual path still works and is the fallback if Actions is ever down:

```bash
npm run deploy            # -> production Worker
npm run deploy:preview    # -> preview Worker
```

Both scripts pass `--env` explicitly. Do not drop it: a bare `wrangler deploy`
deploys the top-level config, which is the local-dev shape — it is named
`petpomo-dev` on purpose so that mistake creates an obviously-wrong third
Worker instead of overwriting production.

The split is enforced by `[env.preview]` / `[env.production]` in
`wrangler.toml`, which point the same `DB` binding at different databases.

A custom domain, when added, attaches to the production Worker only — preview
stays on `*.workers.dev` and is never served from the real domain.

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
npx wrangler dev --port 8788
PETPOMO_BASE=http://localhost:8788 npm run test:e2e
```

Adding a third-party script, font, or analytics tag will be blocked until its
origin is added to `security.csp.directives`. That is the intended behaviour —
when it happens, it is worth asking whether the third party is worth it before
widening the policy.

## Local development

```bash
npm run dev            # Astro dev server, no API
npm run db:local       # one-time: create the local D1 tables
npm run dev:full       # build + wrangler dev on :4332 — serves the API too
```

`npm run dev:full` is the only way to exercise sync locally, since the API only
exists inside the Worker. Port 4332 is what `tests/sync.mjs` expects.

---

## Notes

- **`wrangler.toml` carries the real `database_id`s.** They are not secrets —
  a database id is useless without an API token for the account.
- **There are no secrets to configure.** No API keys, no account. A sync code is
  generated in the browser and is the only credential; the server never sees a
  user identity.
- **D1 free tier** is 5 GB and 5M reads/day. A save is ~10-120 KB and syncs only
  when the player presses Upload/Download, so this stays comfortably free.
- **Cache busting**: `public/sw.js` uses network-first for navigations, so a new
  deploy is picked up on the next load. If you change the SW's caching strategy,
  bump `VERSION` in that file or clients will keep the old rules.
