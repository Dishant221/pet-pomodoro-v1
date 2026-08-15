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
