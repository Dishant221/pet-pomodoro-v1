# Deploying PetPomo

The game is a static Astro site. Cloud sync is an optional Pages Function backed
by D1. **You can deploy step 1 alone and have a fully working game** — sync just
reports "API not reachable" until step 2 is done.

Everything below has been verified locally against `wrangler pages dev` with a
real local D1; only the `wrangler login` step could not be run here.

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
