# Community & moderation — how it works and how to run it

How comments (and, next phase, forum threads) get onto this site, what stands
between a visitor's keyboard and the page, and what the admin's job actually
is. Written 2026-08-22, alongside the code it describes.

## The one rule

**Nothing a visitor writes is ever published without an explicit admin
approval.** No auto-approve for members, no AI auto-publish, no exceptions —
the owner's decision (2026-08-22), traded deliberately against liveliness.
Everything else in this file exists to make that one human's job small.

## The submission pipeline

Every comment passes, in order (`worker/src/community.ts`):

1. **Size gate** — 256 KB request cap, 1000-char comment cap.
2. **Rate limit** — 5 comments / 10 min / IP, counted atomically in D1
   (`bumpLimit`, the same limiter that protects /api/ask). This limit
   protects the *moderator's time*, not the database.
3. **Identity** — signed-in users comment under their account name, with a
   fresh ban check against the user table (sessions cache the user snapshot,
   so a ban must be re-read to bite immediately). Guests give a display name
   and — once the widget exists — pass Turnstile.
4. **The sanitizer** (`worker/src/sanitize.ts`) — plain text only. NFKC
   normalisation and zero-width stripping first (de-cloaks `ｈｔｔｐ`,
   `h​ttp`, `example．com`), then REJECTION of URL schemes, `www.`,
   bare domains, @handles, and any `<` or `>`. Rejection, not stripping:
   stripping mangles honest text, and despammed spam is still spam.
5. **Target allowlist** (`worker/src/blogSlugs.ts`, generated at build) — a
   comment must belong to a real page, or the queue would fill with garbage.
6. **AI pre-screen** (`worker/src/moderate.ts`) — Llama Guard 3 8B on
   Workers AI, ADVISORY ONLY. The verdict is stored on the row so the queue
   can float likely problems to the top. `skipped` (no AI binding — local
   dev) and `error` are normal values, not failures.
7. **INSERT as `pending`** — and nothing more happens until a human acts.

Rendering is the backstop: comment text only ever renders as text nodes
(no `dangerouslySetInnerHTML` for user content anywhere), and the CSP's
`script-src 'self'` would neuter anything that somehow got through.

## The admin's job (dashboard: `/admin`)

Sign in as the admin account → the **Queue** tab. For each item:

- **Approve** — it appears on its page within a minute (readers' browsers
  cache the list for 60 s).
- **Reject** — it never appears; the author is not notified.
- **Delete** — the take-down action; also works on already-approved content.
- **Ban author** (members only) — sets `banned` on the user, bulk-rejects
  their pending posts, blocks future sign-ins (better-auth checks the
  column) and future submissions (community.ts re-reads it per POST).

Rows are never physically deleted: `status` + `reviewed_at` are the
moderation audit trail. The **Users** tab lists every account with its
community footprint and the ban toggle; **Contact** holds messages from the
contact form (`emailed: 0` means it is stored-only until email sending
exists — the dashboard is the source of truth either way).

## Infrastructure map

| Piece | Where | Notes |
|---|---|---|
| Content + queue | D1 `posts` table (migration `0004_community.sql`) | one table for comments/threads/replies = one queue |
| Contact messages | D1 `contact_messages` | stored always; `emailed` records notification outcome |
| Rate limiting | D1 `rate` (atomic upsert) | same table/pattern as /api/ask |
| AI pre-screen | Workers AI binding `AI`, `@cf/meta/llama-guard-3-8b` | free allowance ≈ 1,100 checks/day; over = 'error', never billed on free tier |
| Bot check | Turnstile — server `TURNSTILE_SECRET`, client `PUBLIC_TURNSTILE_SITE_KEY` | both unset today: no check, by design |
| Digest email | cron `17 3 * * *` → `scheduled()` in `worker/src/entry.ts` | "N items awaiting review", never per-item; no-ops until email is configured |
| Email out | `SEND_EMAIL` binding + `MAIL_FROM`/`ADMIN_EMAIL` vars | requires Workers Paid + domain onboarding; everything degrades without it |
| Admin API | `/api/admin/*` (`worker/src/admin.ts`) | router-wide session+role gate; the /admin page itself is public and empty |

## Operating notes

- **Spam flood?** The per-IP limit caps inflow at ~30/hour/address, links are
  rejected at the door (no payoff), and nothing they send is ever visible
  without your click. Worst case is queue noise: sort by the `ip_hash`
  fragment shown on each card to spot one source, reject, ban.
- **A comment I approved needs removing** — Queue shows pending only; use
  Delete via the moderate endpoint from the item's page in a later phase, or
  today: `wrangler d1 execute … "UPDATE posts SET status='deleted',
  reviewed_at=<now> WHERE id=<id>"`.
- **Adding a blog post** — the comment-target allowlist regenerates as part
  of `npm run build` (`scripts/make-slugs.mjs`), so a new post accepts
  comments as soon as it deploys. No manual step.
- **Retention** — rejected/deleted rows are kept as the audit trail. If the
  table ever needs pruning, delete `rejected` older than 90 days, never
  `deleted` (those are take-downs you may need to show).
- **Privacy** — rows carry a truncated hash of the source address
  (`ip_hash`), never the address; guest emails are never collected;
  contact-form messages contain whatever the sender typed and live only in
  D1 and the owner's inbox.
