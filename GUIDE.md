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
| `main` | https://www.pomodoropet.com | `petpomo` |

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
| The wall clock and its timezones | `src/islands/WallClock.tsx` + `src/game/zones.ts` |
| Which overlays the stage carries | `showWorld` / `showPet` / `showTimer` / `showClock` in `src/stores/profile.ts` |
| Moods | `src/game/mood.ts` |
| Sounds | `src/game/audio.ts` |
| Timer rules | `src/stores/timer.ts` |
| Blog posts | `src/content/blog/` — add a `.md` file, it appears by itself |
| Deals, coupons, sponsorships | `src/game/gifts.ts` — see §9 below |

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

1. **Is the site up?** Open https://www.pomodoropet.com. If not, check the
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

## 9. Adding a deal, coupon, or sponsorship

The `/gifts` page shows "letters from Mochi" — some are just free in-game
coins, others are real deals, coupons, offers, or paid sponsorships from pet
merchants. All of it lives in one file: `src/game/gifts.ts`. There is no admin
panel — adding one means editing that file directly and shipping a normal
deploy.

**This is also the site's money ledger**, so before you add a real (non-sample)
one, read **AFFILIATES.md** — it has the non-negotiable rules (nothing gets
deleted, every real link needs a tracking id, disclosure ships with the link)
and the account signup order for the affiliate networks themselves. This
section is only about the mechanics of adding an entry; AFFILIATES.md is about
the money and the law around it.

### The four kinds

| Kind | What it is |
|---|---|
| `treat` | Free in-game coins — no merchant, nothing to disclose |
| `deal` | A discount at a merchant (e.g. "35% off your first order") |
| `coupon` | Same, but with a code the visitor copies and pastes |
| `offer` | A non-discount perk (e.g. "3 months free") |
| `sponsorship` | A merchant paying to have their name in a letter, plain and labelled |

### Vendor (merchant) info

Every non-`treat` entry names its vendor twice, for two different reasons:

- **`merchant`** — a plain string, e.g. `'Chewy'`. This is just the display
  name shown to the visitor in the letter. It carries no money information and
  needs nothing beyond the name itself.
- **`network`** — which affiliate account the link's money flows through
  (`'awin'`, `'flexoffers'`, `'direct'`, etc.). This is the account-level
  relationship, tracked in **AFFILIATES.md**'s "Account registry" table —
  one row per broker account, not per vendor, since one network account
  (e.g. FlexOffers) carries links from many different merchants at once.

For a **direct sponsorship** (`network: 'direct'`) there is no broker in the
middle — you invoiced the vendor yourself — so the vendor's own contact info
and deal terms (who you spoke to, the agreed price, the renewal date) live
nowhere in the code. Keep that in whatever you already use for invoicing
(the `campaignId` field is only the invoice number, for matching payments to
entries), and note the renewal date as the entry's `endsAt` so the letter
disappears on its own when the deal ends instead of relying on someone
remembering to remove it.

### Making one show only in certain countries — how location targeting works

Cloudflare already knows roughly where a visitor is (from their IP address) on
every request that reaches the site, the same way the weather feature does. A
tiny endpoint, `GET /api/geo`, hands that country back as a two-letter code
(`US`, `DE`, `IN`, ...) with no signup, no permission prompt, and nothing
stored about the visitor. The Gifts page asks it once per visit and remembers
the answer for that visit only.

To limit a gift to specific countries, add a `regions` list of
[ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) country
codes to its entry:

```ts
regions: ['US', 'CA'],   // only shown to visitors Cloudflare places in the US or Canada
```

Leave `regions` off entirely and the gift shows to everyone, everywhere —
that's the right choice for anything that ships internationally or isn't
merchant-specific (like the in-game coin treats). This also matters for money:
a US-only Chewy link showing to an EU visitor who clicks it earns nothing, so
set `regions` to wherever the merchant actually ships or pays commission —
check the network dashboard, not guesswork.

A visitor whose country can't be determined (a VPN, a corporate proxy, testing
on your own machine) sees **every** gift, region-limited or not. Hiding
everything from someone the system can't place would just look like a broken,
empty page — showing too much is the safer failure than showing nothing.

### Adding one, step by step

1. Open `src/game/gifts.ts` and find the `GIFTS` array.
2. Copy the closest existing entry of the same `kind` as a starting point —
   there's a real `treat` and a `sample` version of each external kind
   already in the file.
3. Fill in a **new, never-used** `id` (short, kebab-case, e.g.
   `black-friday-chewy-2026`), the `title`, and a short first-person letter
   from Mochi in `letter`. Keep it warm and short — read the existing ones for
   the voice.
4. For anything except a `treat`, also fill in: `merchant`, `url` (the real
   tracking link from the network dashboard, not the merchant's plain
   homepage), `code` if it's a coupon, `network` (which affiliate account the
   link is monetized through — see AFFILIATES.md; use `'none'` for an honest
   unmonetized courtesy link), and `campaignId` once you know it.
5. Add `regions` if it should only show in specific countries (see above).
6. Add `endsAt` (an ISO date) if the deal expires. Leave it off for something
   evergreen. **Never delete an old entry** — expired ones just stop showing
   automatically; deleting them destroys the record of what ran and when.
7. **Testing a new idea before it's real?** Add `sample: true`. Sample entries
   only render on preview deploys (`npm run deploy:preview`), never on the
   live production site (`npm run deploy`) or a plain local `npm run build` —
   so you can see and click-test the exact UI before any real merchant link
   goes out. Remove the flag when the entry is real.
8. Run the checks in §3, then ship it the normal way (§4).

That's the whole mechanism — the page, the region filter, the disclosure text,
and the `sponsored nofollow` link attributes are all generic and already
handle whatever you put in the array. You are never writing code to add a
gift, only data.

---

## 10. What is not finished

See **BACKLOG.md**. Every outstanding item is numbered there with what is done,
what is missing, and a suggested order.
