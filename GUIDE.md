# PetPomo — the plain-language guide

Written for a person, not a programmer. If you have never touched this code,
start here. The README explains *why* things are built the way they are;
DEPLOY.md explains the servers; this file explains **what to do**.

---

## 1. What this thing is

A website. You open it, press Start, and work for 25 minutes while a cartoon
animal sleeps next to you. When the time is up a bell rings, the animal wakes
up, and you get five minutes off. You earn coins for the minutes you focus and
spend them on new animals and new places for them to live.

It runs entirely in the visitor's browser. There is no login. Their progress is
saved on their own device.

---

## 2. Running it on your own computer

You need [Node.js](https://nodejs.org) version 22 or newer. Then, in a terminal,
inside the `pet-pomodoro` folder:

```bash
npm install     # once, downloads everything the project needs
npm run dev     # starts it — then open http://localhost:4321
```

Press `Ctrl+C` in the terminal to stop it.

That is enough for changing text, colours and layout. It is **not** enough for
anything involving `/api/...` — weather and cloud sync — because those need the
Cloudflare runtime:

```bash
npm run build                        # make the real files
npx wrangler pages dev dist --port 4332   # serve them like the real server does
```

Then open http://localhost:4332.

> **If pages hang and never load:** a previous server was probably left running
> and got stuck. On Windows, close all of them and try again:
> ```powershell
> Get-Process workerd | Stop-Process -Force
> ```
> This happened during development and cost half an hour of confusion, so it is
> written down.

---

## 3. Checking your work before you ship it

Four commands. Run all four; they are quick and they have caught real bugs.

```bash
npm run check     # finds typing mistakes in the code
npm run build     # makes sure it actually builds
npm run budget    # makes sure the site did not get too heavy to load
npm run test:e2e  # drives the real app in a real browser: 101 checks
```

For the last one, the server from step 2 must be running, and you tell the test
where it is:

```powershell
$env:PETPOMO_BASE = 'http://localhost:4332'
npm run test:e2e
npm run test:sync
```

**If any of these fail, do not deploy.** They are the only thing standing
between a mistake and every visitor seeing it.

---

## 4. Publishing

There are two live sites, and which one you get is decided entirely by the
branch you push to.

| Push to | Goes to | Database |
|---------|---------|----------|
| `testing` | https://preview.petpomo.pages.dev | `petpomo-preview` |
| `main` | https://petpomo.pages.dev | `petpomo` |

```bash
git add -A
git commit -m "a short sentence about what changed"
git push origin testing        # try it on preview first
```

GitHub does the rest — it builds the site and uploads it, and takes two or three
minutes. Watch it on the repository's **Actions** tab.

When preview looks right, put it live:

```bash
git checkout main
git merge testing
git push origin main
git checkout testing
```

**Always go through preview first.** Preview is deliberately kept out of Google's
index and uses a separate database, so nothing you try there can affect a real
visitor's saved progress.

---

## 5. Where things live

| I want to change... | Look in |
|---|---|
| Words on the front page | `src/components/FocusLanding.astro` |
| Menus, footer, page titles | `src/layouts/Layout.astro` |
| Prices, animals, snacks | `src/game/economy.ts` |
| What an animal looks like | `src/three/species.ts` (numbers only — no modelling) |
| How the scenery is painted | `src/world/paint.ts` |
| Colours by time of day | `src/world/palette.ts` |
| Seasons | `src/world/season.ts` |
| Letting a player pin the sky | `src/game/view.ts` (reality itself stays in `world.ts`) |
| Moods | `src/game/mood.ts` |
| Sounds | `src/game/audio.ts` |
| Timer rules | `src/stores/timer.ts` |
| Blog posts | `src/content/blog/` — add a `.md` file, it appears by itself |

---

## 6. Two rules that matter more than they look

**Never trust a saved game.** A visitor's save can be edited by hand, imported
from a file, or downloaded with a sync code somebody else shared. Everything
loaded from one goes through `hydrate()` in `src/stores/profile.ts`, which
checks every value against what actually exists and throws away the rest. If you
add a new setting, add it there too — there is a test that feeds the app a
deliberately hostile save and it will tell you if you forgot.

**Never let anything flash.** A rapidly flashing screen can trigger seizures.
The lightning is a single slow bloom, minutes apart, and it is removed entirely
when the visitor has asked for reduced motion. If you add any flashing effect,
it must follow the same rule, and there is a test asserting it.

---

## 7. Privacy, in one paragraph

Nothing about a visitor is stored on our servers. Progress lives in their
browser. Cloud sync, if they turn it on, stores an anonymous blob under a random
code their own browser generated — we never learn who they are. The weather uses
the rough location Cloudflare already attaches to every web request, rounded to
about eleven kilometres and used only as a cache key, so no permission prompt
appears and no per-visitor record is created. The `/privacy` page says all of
this in public, and it must stay true.

---

## 8. When something breaks in production

1. **Is the site up?** Open https://petpomo.pages.dev. If not, check the
   Cloudflare dashboard → Workers & Pages → petpomo → Deployments.
2. **Did a deploy break it?** The Actions tab shows every deploy. Cloudflare
   keeps the previous ones — you can roll back from the Deployments list in one
   click, and that is almost always the fastest fix.
3. **Is it just the weather or sync?** Those are the only parts needing a
   server. The game itself is static files and works offline; if the pet still
   moves, the problem is the `/api` Function, not the site.
4. **Is someone abusing the save API?** DEPLOY.md has the WAF rate-limit rule to
   apply, and the reasoning behind the numbers.

---

## 9. What is not finished

See **BACKLOG.md**. Every outstanding item is numbered there with what is done,
what is missing, and a suggested order.
