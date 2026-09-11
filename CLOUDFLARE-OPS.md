# Cloudflare operations log — PetPomo

Everything about the Cloudflare side of PetPomo that is *not* code: which
account, which plan, how to read metrics, what firewall rules exist, and the
changes made on each date. DEPLOY.md covers how to ship; this file covers how
to look after what is shipped.

Nothing in this file is secret. Token **values** live only in a Windows user
environment variable on the owner's machine and are never written here or
anywhere in the repo. **The GitHub repo is public**, so this file also avoids
personal email addresses and anything about the owner's other accounts —
keep it that way when adding to it.

---

## The two Cloudflare accounts (read this first)

The owner uses **two** Cloudflare accounts from the same machine. Only one
holds PetPomo: the account whose id is `ee40c9f799262b5a70891635b53555cd`
(referred to below as *the PetPomo account*). It holds `petpomo`,
`petpomo-preview`, both D1 databases, the `pomodoropet.com` zone, and a few
unrelated Workers that must not be touched. The other account holds nothing
PetPomo-related.

Because both accounts are used from the same machine, logins drift. **Before
any deploy, run:**

```bash
npx wrangler whoami
```

and confirm the account id above appears. If it shows the other account,
`npx wrangler logout` then `npx wrangler login` (browser must be signed in
to the PetPomo account, or use a private window).

Local env-var naming for API tokens: `dt_claude_api_cloudflare_token` is the
PetPomo account's token; a token for the other account would use a different
prefix.

---

## Plan and billing (as of 2026-09-11)

- **Workers Paid**, USD 5/month, account-scoped, active since 2026-08-22,
  renews on the 22nd. It automatically covers every Worker, D1, KV and Workers
  AI binding in the account — there is no per-project assignment. `petpomo`
  runs the `standard` usage model, which is the paid tier.
- **Zone `pomodoropet.com` is on Free Website** (zone id
  `ac7ceff9a6819a02ec9c49871c70c2f0`). Bot scores, referrer, ASN and per-path
  history longer than one day need zone Pro (~USD 20–25/month). Owner declined
  the upgrade on 2026-09-11: traffic is too small to justify it and GA4 gives
  the human count for free.
- Current usage is a rounding error against the paid limits: ~6k Worker
  requests and a few hundred D1 queries per month against 10M and billions
  respectively. The plan is kept for the CPU-time headroom the AI endpoints
  need, not for volume.

---

## Reading metrics

```bash
npm run metrics          # last 30 days, human-readable summary
npm run metrics -- 7     # last 7 days
node scripts/cf-metrics.mjs 30 --json > out.json   # raw data
```

`scripts/cf-metrics.mjs` calls the Cloudflare GraphQL Analytics API directly
with the read-only token in `dt_claude_api_cloudflare_token`. It prints Worker
invocations per day (requests, errors, CPU p50/p99), zone traffic per day
(requests, page views, unique IPs, cache ratio, countries, status codes,
browser families), a last-24h detail block (top paths, 404s, 403s, device
split, user agents, and `/api/auth/get-session` calls by country), and D1
query counts.

**Loading the token in a fresh shell.** It is a Windows *user* environment
variable, so an already-open terminal or a tool-spawned shell may not see it:

```powershell
$env:dt_claude_api_cloudflare_token = [Environment]::GetEnvironmentVariable("dt_claude_api_cloudflare_token", "User")
npm run metrics
```

### The token

Created 2026-09-11 in the PetPomo account's dashboard (My Profile → API Tokens),
named `petpomo-analytics-claude`, **no expiry**. Permissions:

| Scope | Permission | Access | Why |
|---|---|---|---|
| Account | Account Analytics | Read | Worker + D1 metrics via GraphQL |
| Account | Workers Scripts | Read | list Workers, deployments |
| Account | Account Settings | Read | confirm which account the token is on |
| Account | D1 | Read | list databases to label metrics |
| Zone | Zone | Read | resolve the zone id |
| Zone | Analytics | Read | site traffic metrics |
| Zone | Firewall Services | Edit | (added 2026-09-11; turned out to be read-only for the rulesets API) |
| Zone | Zone WAF | Edit | create/update custom WAF rules — **this** is what the rulesets API checks |

Zone resources: `pomodoropet.com` only. To rotate: create a new token with the
same rows, then in PowerShell
`[Environment]::SetEnvironmentVariable("dt_claude_api_cloudflare_token", "<new>", "User")`
and delete the old one in the dashboard.

### How to read the numbers (learned 2026-09-11)

- **Most raw traffic is bots.** On a typical day ~34% of requests are declared
  crawlers (Applebot, Googlebot, Claude-SearchBot, ChatGPT-User, panscient,
  headless Chrome, Semrush, the Facebook link previewer), another ~18% are
  scrapers with stale or spoofed browser strings (Chrome 78/95, iOS 13), and
  the remaining ~42% is plausibly human — but each page load is ~15 requests,
  so that is only 30–40 page loads.
- **The best human signal is `/api/auth/get-session`.** The page's own JS calls
  it on load and simple scrapers never do. ~50 calls/day in September 2026,
  of which a suspicious cluster from Azerbaijan looked like a headless scanner.
  Realistic human page loads: 20–50/day. Cross-check with GA4, which only
  counts JS-executing, non-bot visitors.
- Desktop:mobile of ~8:1 is another bot tell; a consumer focus app would skew
  mobile.
- AI retrieval agents (Claude-SearchBot, ChatGPT-User) are deliberately
  allowed — they fetch pages on behalf of a person asking a question. Training
  crawlers are blocked by the zone's AI-crawl policy (see memory/backlog);
  ClaudeBot hits show up but should be 403.
- `uniques` summed across days overcounts monthly unique visitors. Use it per
  day only.

### Free-plan traps in the GraphQL API

- `httpRequestsAdaptiveGroups` (anything per-path / per-UA) rejects any window
  wider than **1 day** — query the last 24h only.
- Fields `botScoreSrcName`, `clientRefererHost`, `clientASNDescription` return
  an authz error on this zone. One bad field fails the whole query, so keep
  them out.
- `httpRequests1dGroups` (daily rollups) works for any range.

---

## Firewall (WAF) rules

Custom rules live in the zone's `http_request_firewall_custom` ruleset, id
`1a18eddc4dac40048dacd0629f9d649e`. They are managed through the rulesets API
(or dashboard → Security → WAF → Custom rules), **not** through code — a
`wrangler deploy` does not touch them.

| Rule id | Action | Purpose | Created |
|---|---|---|---|
| `f11887b6cc0d4c578b6417dfee70650e` | block | WordPress/PHP scanner probes | 2026-09-11 |

Expression of the block rule:

```
(starts_with(http.request.uri.path, "/wp-")) or
(starts_with(http.request.uri.path, "//wp")) or
(http.request.uri.path eq "/xmlrpc.php") or
(ends_with(http.request.uri.path, ".php")) or
(http.request.uri.path contains "/wp-includes/") or
(http.request.uri.path contains "/wp-admin/")
```

The site ships no PHP, so nothing legitimate can match. Before the rule these
probes were ~70+ requests/day and the largest source of 404s. Verified after
creation: `/wp-admin/install.php` and `/xmlrpc.php` → 403; `/`, `/about/`,
`/api/health` → 200.

To list the current rules:

```powershell
$env:dt_claude_api_cloudflare_token = [Environment]::GetEnvironmentVariable("dt_claude_api_cloudflare_token", "User")
Invoke-RestMethod -Headers @{Authorization="Bearer $env:dt_claude_api_cloudflare_token"} `
  "https://api.cloudflare.com/client/v4/zones/ac7ceff9a6819a02ec9c49871c70c2f0/rulesets/phases/http_request_firewall_custom/entrypoint" |
  Select-Object -ExpandProperty result | Select-Object -ExpandProperty rules
```

To change rules, `PUT` the same URL with `{ "description": ..., "rules": [...] }`
— the full list replaces what is there, and the body must **not** include
`kind` or `phase` (the API rejects them with "unknown field").

The rate-limit rule for `/api/save` suggested in DEPLOY.md § Infrastructure
hardening is now *possible* (the zone exists) but has **not** been created.

---

## Claude Code / agent tooling

- The Cloudflare plugin for Claude Code (`cloudflare@cloudflare`, from the
  `cloudflare/skills` marketplace) is installed at user scope. Its MCP server
  (`https://mcp.cloudflare.com/mcp`) is OAuth-authenticated and, as of
  2026-09-11, is bound to the **other** account — it returns
  `10000 Authentication error` for anything on the PetPomo account. Re-auth via
  `/mcp` → cloudflare → clear authentication → authenticate (browser signed in
  to the PetPomo account) if you want it to work for PetPomo. Not required: the
  token route above covers everything.
- Wrangler's OAuth scopes never include `analytics:read`, so metrics cannot
  come from the wrangler login regardless of account.

---

## Security posture (audited 2026-09-12)

Full audit of client, Cloudflare and GitHub sides. Findings and state:

**Credentials — clean.** No secret value in the working tree, the built
`dist/`, `public/`, or any commit on any branch (patterns: Cloudflare/GitHub/
OpenAI/AWS/Google key shapes, private keys, `*_SECRET=`). Worker secrets
(`BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) exist only
as `secret_text` bindings set via `wrangler secret put`; `wrangler.toml`
`[vars]` hold only public origins and empty placeholders. The only client-side
env vars are `PUBLIC_GOOGLE_LOGIN`, `PUBLIC_API_BASE`, `PUBLIC_TURNSTILE_SITE_KEY`
(all non-sensitive by design). Sessions are httpOnly cookies from better-auth;
nothing session-like is in localStorage (the sync code is, by design — it is
the save's own key, not an account credential).

**Cloudflare zone.** Always Use HTTPS on, TLS 1.3 on, HSTS (preload) sent by
the site, Bot Fight Mode + JS detection on, Browser Integrity Check on, leaked
credential rate-limit rule present, SPF `-all` / DKIM / DMARC (`p=none`) set,
no Access apps. **Open item: minimum TLS version is 1.0** — raise to 1.2 in
the dashboard (SSL/TLS → Edge Certificates → Minimum TLS Version); the token
has no Zone Settings Edit so this is a manual step.

**Live checks.** CSP present on every page (hash-based, no unsafe-inline for
scripts); auth POSTs from a foreign Origin → 403 `INVALID_ORIGIN`; `/api/admin/*`
→ 401 unauthenticated; `/admin` → redirect; `http://` → 301.
**Fixed:** the zone auto-injects the Cloudflare Web Analytics beacon
(`static.cloudflareinsights.com`) but the CSP did not allow it, so browsers
blocked it and Web Analytics recorded nothing. Added to `script-src` and
`connect-src` in `astro.config.mjs`.

**GitHub.** The repo is **public**, with no branch protection on `main`
(any push deploys production) and no Dependabot. **Fixed in repo:** actions
in `deploy.yml` pinned to commit SHAs, unused `deployments: write` dropped,
`.github/dependabot.yml` added (npm + github-actions, weekly), `.gitignore`
now covers `.env.*`, `.dev.vars.*`, `*.local`, test fixture password now
overridable via `PETPOMO_TEST_PASSWORD`, personal emails removed from new docs.
**Manual to-dos:** (1) decide whether the repo should be private; (2) add a
ruleset on `main` requiring a PR and blocking force-push; (3) prune old
`*-backup-*` branches after merges are verified (or use tags).

**Dependencies.** `npm audit` before: 1 critical (astro ≤7.2.7 AVIF RCE +
auth bypass), 6 high (hono ≤4.13.4, wrangler/miniflare→sharp, fast-uri,
js-yaml, svgo), 1 moderate. Upgraded astro → 7.3.2, hono → 4.13.7,
wrangler → 4.131.1 and ran `npm audit fix`: **0 vulnerabilities**.
Dependabot will surface the next ones.

---

## Change log

### 2026-09-12 (security audit)

- Full client / Cloudflare / GitHub security audit — see "Security posture"
  above. Fixed: CSP for the Web Analytics beacon, SHA-pinned actions, least-
  privilege workflow permissions, Dependabot, `.gitignore` coverage,
  env-driven test password, docs redacted for a public repo, astro/hono/
  wrangler upgraded to clear a critical and six high advisories (audit now 0).
- Manual follow-ups for the owner: min TLS 1.2, branch protection on `main`,
  repo visibility decision, backup-branch pruning.

### 2026-09-11 / 2026-09-12

- **Found** that wrangler and the Cloudflare MCP plugin were both logged into
  the other account. PetPomo metrics were unreachable and
  `npm run deploy` would have targeted the wrong account.
- **Created** read-only API token `petpomo-analytics-claude` on the
  PetPomo account (permissions above) and stored it in the Windows user
  env var `dt_claude_api_cloudflare_token`. Later added Zone WAF Edit so it
  can manage custom firewall rules.
- **Switched** wrangler back to the PetPomo account (`wrangler logout` / `login`;
  verified with `whoami` and `wrangler deployments list --env preview`).
- **Confirmed** Workers Paid (USD 5/month) has been active on the PetPomo
  account since 2026-08-22 and already covers every resource — nothing needed
  moving. Zone stays on Free; Pro upgrade declined.
- **Created** the WordPress/PHP probe block rule in the zone WAF and verified
  it (403 on probes, 200 on real pages).
- **Re-ran** Cloudflare's agent-setup steps (`claude plugin marketplace add
  cloudflare/skills`, `claude plugin install cloudflare@cloudflare`,
  `/reload-plugins`); everything was already installed, nothing changed.
- **Added** `scripts/cf-metrics.mjs` and the `npm run metrics` script; wrote
  this document. Added a `wrangler whoami` check to DEPLOY.md § 1 and pointed
  its hardening section here.
- Baseline metrics for 2026-08-12 → 2026-09-11: zone 31,876 requests, 5,495
  page views, 299 MB, 51% cached; `petpomo` 5,905 requests / 0 errors, CPU
  p50 1.6 ms, p99 37 ms; `petpomo-preview` 377 requests / 0 errors; D1
  production 219 reads / 126 writes. Estimated real human page views 50–80/day.
