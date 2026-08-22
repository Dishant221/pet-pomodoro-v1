# Affiliates, deals and sponsorships — the ledger

How the Gifts section (`/gifts`) is monetized, recorded and audited. If a link
earns money, this file says through which account, and the catalog in
`src/game/gifts.ts` says when it ran. Between the two, every dollar is
traceable. Research snapshot: 2026-08-22.

## The rules (non-negotiable)

1. **The catalog is append-only.** `src/game/gifts.ts` entries are never
   deleted and their `id` is never reused. A dead deal gets an `endsAt` and
   stays. Git history + this rule = the complete audit trail of every
   commercial link this site has ever shown.
2. **Every external entry names its `network`** (which account the money flows
   through) **and `campaignId`** (the id the network's transaction report will
   show). Entries with `network: 'none'` are unmonetized courtesy links;
   `'direct'` means a privately invoiced sponsorship (invoice number goes in
   `campaignId`).
3. **Disclosure ships with the links.** The Gifts page shows the affiliate
   disclosure above the letters, every letter is labelled with its kind, and
   sponsor letters are stamped as sponsored. FTC rules (16 CFR 255) require
   disclosure *near the links*, not on a separate page. If Amazon Associates
   is joined, its exact required sentence — "As an Amazon Associate I earn
   from qualifying purchases." — must be added to the disclosure verbatim.
4. **All outbound gift links carry `rel="sponsored nofollow noopener"`.**
   Already enforced in `GiftsPanel.tsx`; keep it that way.
5. **`sample: true` entries never render on production.** Demo UX only.
6. **EU visitors, no tracking JS.** We use plain affiliate redirect links, not
   Sovrn/Skimlinks-style page-injector scripts — injectors set cookies and
   would require a consent banner. If one is ever added, consent comes first.
   Geo filtering uses only Cloudflare's IP-derived country via `/api/geo`;
   nothing is stored — this is noted in the privacy policy when Gifts ships
   to production.

## Account registry

One row per money-touching account, kept current. This plus the network's own
transaction exports is what an accountant gets.

| Network / broker | Account email | Account id | Status | Payout terms | Report source |
| ---------------- | ------------- | ---------- | ------ | ------------ | ------------- |
| _none yet_ | | | | | |

When an account is created: add the row, then set the matching `network` value
on new catalog entries.

## Monthly reconciliation

On the 1st of each month, for each active network: export the prior month's
transaction report (CSV or API), save under `finance/reports/YYYY-MM/` (kept
outside the repo — it contains order data), and check each line's campaign id
against the catalog. A payment for a link the catalog never listed is a
problem to investigate, not income. When more than ~2 networks are active,
Strackr (~€10/mo, strackr.com) consolidates all of them into one ledger API —
use it rather than hand-merging CSVs.

Revenue events worth recording per network: click date (network-side),
transaction date, validation date, payout date. Payouts lag transactions by
30–90 days everywhere; book revenue when the network validates it, not when a
click happens.

## Where the money comes from — signup order (researched 2026-08-22)

The "single broker" you asked for, in practice: **FlexOffers first**. It has
no traffic minimum, approves small new sites in 24–48 h, gives sub-affiliate
access to 10k+ programs (including Chewy US) under one account, and has a
Promotions API whose coupon data arrives already carrying our tracking id —
one account, one report, many merchants. Sign up: https://publisherpro.flexoffers.com/signup
Payouts: net-60, $25 minimum.

Join now (all approve small/new sites):

- **Awin** — https://www.awin.com/us/publishers — $5 refundable deposit,
  strongest for EU/UK merchants (matters because Gifts is geo-filtered:
  US-only links pay nothing on EU clicks). Free transactions API, $20 min.
  ShareASale no longer exists — it merged into Awin in Oct 2025.
- **Rakuten Advertising** — https://rakutenadvertising.com/publishers/ — open
  signup, has a coupon feed for joined advertisers.
- **Impact.com marketplace** — https://impact.com/partners/ — free, ~2-day
  review; then apply per-brand (BarkBox ≈ $20.80/sale, Petco ≈ 2% live
  there). Expect some brand rejections at low traffic; reapply later.
- **Chewy direct via Partnerize** — https://signup.partnerize.com/signup/en_us/chewy —
  $15 flat per new customer, the best pet offer found. Approval at zero
  traffic not guaranteed; costs nothing to try.

Wait until the site has real traffic:

- **Amazon Associates** — free and instant, BUT the account is closed unless
  it produces 3 qualifying sales in 180 days, and API access needs ~10
  sales/month. Pet category pays only 3% with a 24 h cookie. Join when the
  Gifts page has visitors who click, not before.
- **Skimlinks** (auto-monetizes any link, keeps 25%) — rejects new
  low-traffic sites; also its JS injector conflicts with rule 6.
- **Sovrn Commerce** — same category; net-90 payouts; small sites often
  declined.
- **CJ Affiliate** — charges a $10/month dormancy fee after 6 months without
  commissions. Actively harmful at zero traffic; join once converting.

Coupon-data plumbing (to auto-fill the catalog later, all need the network
accounts above to exist first): CouponAPI.org (~$44/mo, 7-day trial) or
Strackr Deals (€10/mo) to start; FMTC ($95/mo) when revenue justifies
human-verified deal data. Honey, RetailMeNot and Wethrift have no public
APIs — don't plan around them.

## Adding a real gift — checklist

1. Deal exists in the network dashboard; copy its tracking link and campaign id.
2. Append an entry to `GIFTS` in `src/game/gifts.ts`: fresh `id`, correct
   `kind`, `network`, `campaignId`, `regions` (which countries the merchant
   actually ships/pays for), `endsAt` from the network's stated end date,
   `addedAt` today. Write Mochi's letter.
3. No `sample` flag. Verify on preview, then ship.
4. When it ends early, set `endsAt` — do not delete.
