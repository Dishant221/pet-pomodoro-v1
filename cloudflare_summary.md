# PetPomo Cloudflare traffic summary and action list

Generated 2026-10-16 from `npm run metrics` (last 30 days, 2026-09-16 to 2026-10-16)
plus direct GraphQL / REST reads with the read-only token. Zone `pomodoropet.com`
(Free plan), Workers `petpomo` / `petpomo-preview` (Workers Paid).
Companion to `CLOUDFLARE-OPS.md` (the ops log); this file is a point-in-time review.

## 1. Short answer

The "lots of requests" number is the **zone**, not the production Worker, and
most of it is not people.

| | 30 days | Per day |
|---|---|---|
| Zone requests (everything hitting pomodoropet.com) | 36,006 | about 1,160 |
| of which page views | 6,835 | about 220 |
| `petpomo` Worker invocations (only `/api/*` and `/forum/thread/*`) | 3,707 | about 124 |
| `petpomo-preview` invocations | 51 | about 2 |
| Worker errors | 0 | |
| Unique IPs | | 130-340 |
| Cached at edge | 18,081 (50%) | |
| WAF blocks (403) | 943 | about 31 |
| Cloudflare "threats" counter | 714 | |

Static files (JS, CSS, fonts, images, HTML) are served from the asset store
and never invoke the Worker, so the Worker count is always far below the zone
count. That gap is expected.

Realistic human visitors: **roughly 30-60 page loads per day**, consistent
with the September baseline in CLOUDFLARE-OPS.md. Best signal is
`/api/auth/get-session` (the page's own JS calls it; scrapers do not): about
45 calls in the last 24 h from EG, JO, TH, PT, VN, NZ, DE, US, with normal
browser user agents and a sane desktop/mobile mix.

## 2. Who is making the requests (last 24 h, the only window the Free plan allows per-UA)

| Group | Approx. share of requests | Examples |
|---|---|---|
| Humans in normal browsers | about 40% | Edge 155 (173 req), Safari 26, Chrome 152-155, iPhone 18, Samsung Browser |
| Search / social / AI retrieval bots (wanted) | about 15% | Applebot 49, bingbot 19, Googlebot 16, Twitterbot 6, ChatGPT-User 11 |
| SEO and AI training crawlers (not wanted) | about 5% | SemrushBot 26, **ClaudeBot 26** |
| Headless Chrome / scripts | about 10% | HeadlessChrome 146/155 (77 req), `Go-http-client/1.1` 12, bare `Mozilla/5.0` 12 |
| Stale or spoofed browser strings (scrapers) | about 10% | Chrome 122/129, iOS 13, Chrome 103 |
| Vulnerability scanners (blocked by WAF) | about 3% | `/wp-admin/install.php`, `/xmlrpc.php`, `/wp-login.php`, `/.vscode/sftp.json`, `/sftp-config.json` |
| The Worker's own internal fetches | about 12% | host `petpomo.internal` 110, `api.open-meteo.com` 31 (weather upstream) |

Over 30 days by browser family (page views): Chrome 2,013, Mobile Safari 1,162,
Edge 172, Firefox 90 (plausibly human, about 56%); **Unknown 2,242 (33%)**;
BingBot 293, GoogleBot 194, AppleBot 21 (7%); ChromeHeadless 280 (4%).

Country mix by requests: US 11,854, BE 1,906, NL 1,702, IN 1,695, JP 1,412,
CN 1,362, DE 1,297, AU 1,221, IE 1,068, GB 792. Belgium, Netherlands and
Ireland are cloud regions, not a consumer audience; US dominates raw requests
but produced 1 session call in 24 h. That is the datacenter signature.

## 3. Abnormal or unexpected things found

1. **ClaudeBot gets HTTP 200, not 403.** 26 requests in 24 h, all 200
   (11 of them for `/robots.txt`). CLOUDFLARE-OPS.md says training crawlers
   "should be 403", but the zone's bot settings show `ai_bots_protection:
   disabled` and `is_robots_txt_managed: true`. In other words only the
   advisory robots.txt block is on; nothing is enforced at the edge. Each
   crawler decides whether to honour robots.txt.
2. **Every main navigation click costs a redirect (307).** `/shop`, `/stats`,
   `/settings`, `/about`, `/gifts`, `/blog`, `/contact`, `/disclosure` all
   return 307 to the trailing-slash form; 50 such redirects in 24 h, 2,041 in
   30 days. Cause: the source links are written without the slash
   (`href="/contact"` 12 times, `/privacy` 9, `/gifts` 5, `/settings` 3,
   `/disclosure` 3, `/shop` 2, `/blog` 2, `/about` 1, in `FocusLanding.astro`,
   `about.astro`, `cookies.astro`, `disclosure.astro`, `privacy.astro` and
   others) while Astro emits `/shop/index.html`. Static Assets redirects to
   canonical form. Harmless for security, but it is a wasted round trip on
   every click, slightly worse Core Web Vitals, and a redirect chain for
   crawlers.
3. **Apex-to-www 301s are 17% of all traffic** (6,183 of 36,006). About 60
   per day are `https://pomodoropet.com/` → `www`. This is the configured
   redirect rule working; the volume comes from bots and old links hitting
   the bare domain. Not abnormal, but it means the real "www" traffic is
   smaller than the headline.
4. **One-day burst on 2026-10-04:** 3,046 requests, 785 page views, 2,315
   cached, only 236 unique IPs, Worker invocations 205. Pattern of a crawler
   sweeping every static page (high cache ratio, few IPs). Cannot be
   confirmed: per-path data older than 24 h is not available on Free.
5. **Minimum TLS is still 1.0** (`min_tls_version: 1.0`). Flagged as an open
   item on 2026-09-12 and still open. 51 requests in 24 h arrived over plain
   HTTP and 5 over TLS 1.2; none below that, so raising to 1.2 breaks nobody.
6. **Headless Chrome is walking the nav.** 8 of the 307s in 24 h came from
   `HeadlessChrome/146`. Combined with `/.well-known/assetlinks.json` probes
   (4 x 404) and `/favicon.ico` (3 x 404), this looks like link-preview /
   screenshot services and generic scanners, not an attack.
7. **`/favicon.ico` 404s.** The site ships only `favicon.svg`. Browsers,
   bots and bookmark tools still request `/favicon.ico` by convention; each
   is a 404 served by the asset layer. Cosmetic.
8. **WAF rule is doing its job.** 943 blocks in 30 days, all on WordPress/PHP
   paths; nothing legitimate matched. Scanner probes for editor configs
   (`/.vscode/sftp.json`, `/sftp-config.json`) are 404 rather than 403 since
   the rule only covers PHP/WordPress.
9. **Rate limiting on the API does not exist.** The zone's single Free-plan
   rate-limit slot holds the "Leaked credential check" rule. `/api/*` has no
   edge rate limit; protection relies on the Worker's own D1/KV limiters
   (comments, threads, contact, auth). Those exist and are tested, so this
   is a gap, not an incident.
10. **Cache status "none" is 36% of requests** (444 of 1,242 in 24 h). That
    is the dynamic `/api/*` traffic plus redirects, which is expected. Hit
    rate on cacheable assets is healthy (569 hit vs 188 miss).

Nothing here looks like an attack in progress or a cost problem. Worker CPU
p50 about 3.9 ms, p99 about 54 ms, 0 errors. D1: 336 reads / 246 writes in a
month. Usage is far inside the paid plan limits.

## 4. What to change: Cloudflare side (dashboard, no deploy)

Ordered by value. Items marked (manual) need Zone Settings Edit, which the
analytics token does not have.

| # | Change | Where | Why | Effort |
|---|---|---|---|---|
| C1 | **Turn on "Block AI training bots"** (and leave AI *search/retrieval* allowed) | Security → Bots → AI Crawl Control | Enforces the policy robots.txt already states. Stops ClaudeBot/GPTBot/CCBot/Bytespider at the edge. Free. | 2 min (manual) |
| C2 | **Minimum TLS 1.2** | SSL/TLS → Edge Certificates → Minimum TLS Version | No TLS 1.0/1.1 clients observed; removes a known-weak protocol from the attack surface | 1 min (manual) |
| C3 | **Enable Early Hints** | Speed → Optimization | Browser starts fetching `_astro/*.css/js` while the HTML is still coming; free, no code change | 1 min (manual) |
| C4 | **Add a WAF rule for config-file probes** | Security → WAF → Custom rules, same ruleset `1a18eddc4dac40048dacd0629f9d649e` | Turn the remaining scanner 404s into 403s and keep them out of logs: `/.vscode/`, `/.git/`, `/.env`, `sftp-config.json`, `/.aws/`, `/.ssh/`, `/phpmyadmin`, `/cgi-bin/` | 5 min (token can do it) |
| C5 | **Challenge headless and empty user agents on `/api/*`** | Same ruleset, action "Managed Challenge" | `HeadlessChrome`, `Go-http-client`, bare `Mozilla/5.0`, `python-requests`, `curl` on API paths are never a real player. Managed Challenge, not Block, so a mistake only costs a click. Exclude `/api/health`. | 5 min |
| C6 | **Decide what the one rate-limit slot is for** | Security → WAF → Rate limiting rules | Free plan = 1 rule. Current: leaked-credential check on auth. Alternative: `/api/*` POST, 60 req / 10 s per IP. Keep the current one unless API abuse appears; the Worker already limits writes. Pro plan would allow both. | decision |
| C7 | **DMARC `p=none` → `p=reject`** | DNS → `_dmarc` TXT | SPF is already `-all` (the domain sends no mail), so there is no legitimate mail to lose; `reject` stops anyone spoofing `@pomodoropet.com` to users. | 1 min |
| C8 | **Check Security → Analytics with the bot filter once** | Dashboard | Dashboard shows ASN and verified-bot flags on Free even though the API does not; one look confirms the datacenter share estimated above | 5 min |
| C9 | Leave Bot Fight Mode, Browser Integrity Check, Security Level medium as they are | | Already on; raising security level would start challenging the AI retrieval bots the site wants | none |

## 5. What to change: code side (ships via normal deploy)

| # | Change | Files | Why | Effort |
|---|---|---|---|---|
| S1 | **Write internal links with the trailing slash** (`/shop/`, `/stats/`, `/settings/`, `/about/`, `/gifts/`, `/blog/`, `/contact/`, `/disclosure/`, `/privacy/`, `/cookies/`, `/forum/`) | `src/components/FocusLanding.astro`, `src/pages/about.astro`, `cookies.astro`, `disclosure.astro`, `privacy.astro`, plus nav/footer components (grep `href="/[a-z]+"`) | Removes about 2,000 redirects a month, one round trip per click, cleaner crawl graph. Alternatively set `build.format: 'file'` in `astro.config.mjs`, but that changes every URL; fixing links is the smaller change. | 20 min |
| S2 | **Add `public/favicon.ico`** (a 32 px ICO from the existing SVG) and keep `favicon.svg` | `public/` | Ends the daily `/favicon.ico` 404s from browsers, bots, bookmark and RSS tools | 10 min |
| S3 | **Add `public/.well-known/assetlinks.json`** returning `[]`, or ignore | `public/.well-known/` | Only if the 404 noise bothers you; no functional effect without an Android app | 2 min |
| S4 | ~~Edge-cache `/api/weather`~~ — checked: already done (`caches.default` + `cf.cacheTtl`, 900 s) | `worker/src/index.ts` | no change needed | 0 |
| S5 | **Metrics script: add the `clientRequestHTTPHost` split and the 307 top paths** to the LAST 24H block | `scripts/cf-metrics.mjs` | So the next review can see internal (`petpomo.internal`) vs visitor traffic and the redirect sources without ad-hoc queries | 15 min |
| S6 | **Metrics script: write a dated snapshot** (`metrics/YYYY-MM-DD.json`) when run with `--save` | `scripts/cf-metrics.mjs` | Free plan forgets per-path data after 24 h; a daily snapshot (manual or via the existing cron Worker) builds the history the plan does not give you | 30 min |
| S7 | Consider the `[[ratelimits]]` binding for `/api/ask` already anticipated in `wrangler.toml` | `wrangler.toml`, `worker/src/index.ts` | Cheaper than D1 for the counter; the code already prefers `ASK_LIMIT` when bound | 20 min + test |

## 6. Suggested order

1. C1 (AI training bots), C2 (TLS 1.2), C3 (Early Hints), C7 (DMARC): four
   dashboard toggles, no risk, 10 minutes total.
2. S1 (trailing slashes) and S2 (favicon.ico): one small PR, measurable drop
   in 307/404 noise the next day.
3. C4 and C5 (WAF rules via the token), then record them in CLOUDFLARE-OPS.md
   § Firewall and its change log.
4. S4, S5, S6 when convenient.
5. Re-run `npm run metrics -- 7` a week after the changes and compare against
   the numbers in section 1.

## 7. Limits of this data

- Free plan: no bot score, no ASN, no referrer in the API; per-path / per-UA
  detail only for a 1-day window; daily rollups only beyond that.
- Summing unique IPs across days overcounts monthly uniques.
- "Human" vs "bot" above is inferred from user agents, paths and session
  calls, not from Cloudflare's bot classifier. Treat the shares as estimates.
- GA4 / Cloudflare Web Analytics (JS-executing visitors only) is the right
  cross-check for the human number.

---

## 8. Master checklist (everything, one list, who does it)

**Who** column: *Claude* = can be done from this repo/token without you;
*You* = needs dashboard login, Zone Settings Edit, GitHub admin, or a
decision; *Both* = Claude prepares, you approve/click.

### P1 — do this week (security, correctness, 30 min total)

| # | Item | Type | Who | Status |
|---|---|---|---|---|
| 1 | Minimum TLS 1.0 → 1.2 (SSL/TLS → Edge Certificates) | Cloudflare | You | open since 2026-09-12 |
| 2 | Block AI training bots at the edge (Security → Bots → AI Crawl Control; keep AI search/retrieval allowed) | Cloudflare | You | open |
| 3 | DMARC `p=none` → `p=reject` on `_dmarc.pomodoropet.com` | Cloudflare DNS | You | open |
| 4 | Branch protection on `main` (require PR, block force-push) — any push currently deploys production | GitHub | You | open since 2026-09-12 |
| 5 | WAF rule: block config/secret-file probes (`/.git/`, `/.env`, `/.vscode/`, `/.aws/`, `/.ssh/`, `sftp-config.json`, `/phpmyadmin`, `/cgi-bin/`) | Cloudflare WAF | **You** — the agent's automated PUT was blocked by its permission policy; exact expression ready in `CLOUDFLARE-OPS.md` § Proposed rules | drafted 2026-10-19 |
| 6 | WAF rule: Managed Challenge for headless / empty / tool user agents on `/api/*` (exclude `/api/health`) | Cloudflare WAF | **You** (same; expression in CLOUDFLARE-OPS.md) | drafted 2026-10-19 |
| 7 | Record 5 and 6 in `CLOUDFLARE-OPS.md` § Firewall table + change log once created | Docs | You, or ask Claude afterwards | proposed section written |

### P2 — performance and noise (one small PR + two toggles)

| # | Item | Type | Who | Status |
|---|---|---|---|---|
| 8 | Internal links with trailing slash (`/shop/` not `/shop`) across `src/` — removes about 2,000 307s/month | Code | Claude | **done 2026-10-19** (nav/footer arrays, blog pagination, 44 inline links; `isActive` normalised) |
| 9 | Add `public/favicon.ico` (from `favicon.svg`) | Code | Claude | **done 2026-10-19** (`scripts/make-favicon-ico.mjs`, linked in Layout, cached 1 day) |
| 10 | Enable Early Hints (Speed → Optimization) | Cloudflare | You | open |
| 11 | Edge-cache `/api/weather` success path | Code | — | **already done** in code: `caches.default` + `cf.cacheTtl`, 900 s; no change needed |
| 12 | `public/.well-known/assetlinks.json` = `[]` to silence probes | Code | Claude | **done 2026-10-19** |
| 13 | Run `npm audit` / check Dependabot PRs since 2026-09-12 upgrade | Deps | Claude | **done 2026-10-19**: 9 undici advisories (miniflare dev dep) fixed via `npm audit fix`, lock-file only, 0 remaining. 6 Dependabot PRs are open on GitHub for you to review/merge |

### P3 — measurement (so the next review is facts, not estimates)

| # | Item | Type | Who | Status |
|---|---|---|---|---|
| 14 | Confirm Cloudflare Web Analytics is recording (Analytics → Web Analytics). The beacon is zone-injected and CSP was fixed 2026-09-12; verify numbers appear | Cloudflare | You | verify |
| 15 | `cf-metrics.mjs`: add host split (`www` / apex / `petpomo.internal` / upstream), 307 top paths, cache-status split, and a **human-signal block** (section 9) | Code | Claude | **done 2026-10-19** |
| 16 | `cf-metrics.mjs --save`: write `metrics/YYYY-MM-DD.json` so per-path history survives the 24 h Free-plan window | Code | Claude | **done 2026-10-19** |
| 17 | Optional: have the existing cron Worker (`17 3 * * *`) write a daily rollup of session-calls-per-country and events into D1 `user_stats_daily` — history without any plan upgrade | Code | Claude | design first |
| 18 | One-time look at Security → Analytics with "Bot" and "ASN" filters to confirm the datacenter share | Cloudflare | You | 5 min |

### P4 — decisions (no work until decided)

| # | Item | Who | Notes |
|---|---|---|---|
| 19 | Rate-limit slot: keep leaked-credential rule, or swap for `/api/*` POST 60 req/10 s per IP | You | Free plan has exactly one slot. Worker already limits writes, so current choice is defensible |
| 20 | `[[ratelimits]]` binding for `/api/ask` (replaces D1 counter) | You decide, Claude implements | `wrangler.toml` comment already anticipates it |
| 21 | Zone Pro (about USD 20-25/month) for bot score, ASN, 30-day per-path data | You | Declined 2026-09-11; traffic still does not justify it. Section 9 gets most of the value for free |
| 22 | Repo public vs private | You | open since 2026-09-12 |
| 23 | Prune `*-backup-*` branches after merges are verified | You | open since 2026-09-12 |

---

## 9. Measuring real users vs bots on the Free plan

Cloudflare's own bot score needs Pro. These four signals together give a
reliable human count for free; the plan is to make `npm run metrics` print
them side by side.

| Signal | What it counts | Why bots do not inflate it | Where it comes from |
|---|---|---|---|
| **Cloudflare Web Analytics** | Visits and page views by JS-executing browsers; Cloudflare drops known bots | Needs the beacon to run; scrapers, curl, Go clients and most headless tools do not execute it | Dashboard → Analytics & Logs → Web Analytics (zone-injected beacon, free) |
| **`/api/auth/get-session` calls** | App loads: the page's own JS calls it once per load | Only the real bundle calls it; a crawler fetching HTML never does | GraphQL `httpRequestsAdaptiveGroups`, already in the metrics script; group by country + UA, exclude `HeadlessChrome` |
| **`/api/events` (Analytics Engine)** | Actual play: sessions started, gifts opened/clicked, per `user.id` or `anon` | Fired by game code during play, via `sendBeacon` | `petpomo_events` dataset; D1 `user_stats_daily` holds the durable aggregates |
| **Signed-in users** | Accounts that saved today (`/api/me/save`) | Requires a session cookie | D1 `user_stats_daily` / save table |

Rule of thumb from this month: zone requests about 1,160/day → page views
about 220/day → session calls about 45/day → saves about 10/day. The two
right-hand numbers are the players.

**Tells that a request is not a person** (used in section 2):
browser family "Unknown" or `HeadlessChrome`; user agents `Go-http-client`,
bare `Mozilla/5.0`, `python-requests`, `curl`; browser versions years out of
date (Chrome 103/122/129, iOS 13); desktop:mobile above 5:1; requests for
`/robots.txt`, `/sitemap.xml`, `/llms.txt` only; hits on `/wp-*`, `.php`,
`/.git`, `/.env`; countries that are cloud regions (BE, NL, IE) producing
requests but no session calls; many requests from one IP with no `/api/*`.

## 10. Reducing the unnecessary requests

What the 36k/month is made of, and the lever for each slice:

| Slice (30 d, approx.) | Count | Lever | Expected effect |
|---|---|---|---|
| Apex → www 301 | about 6,200 | None needed; this is the redirect rule doing its job. Make sure every link you publish uses `https://www.pomodoropet.com/` | stays, but it is cheap (edge-only) |
| Trailing-slash 307 | about 2,000 | **Item 8** (fix link hrefs) | → near 0 |
| WordPress/PHP probes 403 | about 940 | Already blocked by WAF; **item 5** extends it to other probe families | 404 probes become 403, same count, less origin work |
| 404s (favicon, assetlinks, probes) | about 1,800 | **Items 9, 12, 5** | → a few hundred |
| AI training crawlers (ClaudeBot, GPTBot, CCBot, Bytespider…) 200 | about 800 (est.) | **Item 2** | → 403 at the edge, and compliant crawlers stop retrying |
| SEO crawlers (Semrush, Ahrefs, MJ12) | about 800 (est.) | Optional WAF rule: block `SemrushBot|AhrefsBot|MJ12bot|DotBot` unless you use those tools | → 0 |
| Headless / scripted scrapers | about 3,000 (est.) | **Item 6** (challenge on `/api/*`); for HTML pages leave Bot Fight Mode to it | fewer API hits; HTML scraping continues but costs nothing (cached assets) |
| Worker internal fetches (`petpomo.internal`, open-meteo) | about 4,000 | **Item 11** (weather cache); the rest is the asset layer and is not billable traffic | small drop |
| Search / social / AI-retrieval bots (Google, Bing, Apple, Twitter, ChatGPT-User, Claude-SearchBot) | about 5,000 | **Keep.** This is how people find the site | unchanged |
| Humans | about 8,000-10,000 | Keep | unchanged |

Realistic outcome after P1 + P2: zone requests drop by roughly a quarter to a
third, 3xx/4xx noise falls sharply, Worker load unchanged (it was never the
problem). The headline number will still be dominated by crawlers; that is
normal for any public site, and the point of section 9 is to stop reading
the headline and read the human signals instead.
