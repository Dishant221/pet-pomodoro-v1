---
title: "Why PetPomo has no login and no subscription"
description: No account, no paywall, no upsell — what that actually means technically, and why it's a real design decision, not a missing feature.
publishedAt: 2026-08-29
tags: ['focus', 'habits', 'virtual pet']
image: ../../assets/blog/why-no-login-no-subscription.jpg
imageAlt: "A brass padlock resting closed against a metal surface"
imageCredit: "Photo: 'Security Lock' by shock264, CC BY 2.0"
imageCreditUrl: "https://www.flickr.com/photos/77890596@N04/33885005763"
---

"What's the catch?" is a completely reasonable question to ask about a free
app with no ads currently running and no account wall. The honest answer is
technical, not marketing copy: there isn't one, and the architecture makes
that the easy path rather than a promise that has to be kept by hand.

## Where your progress actually lives

There's no database row anywhere with your name on it, because there's no
sign-up step that would create one. Your save — coins, equipped pet, stats,
settings — lives in your own browser's local storage, on your own device.
Nobody on the other end of this ever sees it unless you choose to move it.

Optional cloud sync exists for people who use PetPomo across more than one
device, and it works without creating an account either: your browser
generates a random code, and that code — not your identity — is what the
sync save is stored under. The server holds an anonymous blob keyed to a
string of random characters. There's genuinely no way to connect that blob
back to a person from the server side, because nothing identifying was ever
collected to connect it to.

## Why this is a real constraint, not a slogan

This shapes what the app can and can't do, which is the actual proof it's
architectural rather than promotional. There's no "forgot password" flow,
because there's no password. There's no way to recover a save if local
storage gets cleared and you never set up sync, because there's genuinely
nothing to recover from on this end. A feature like leaderboards or
friends-lists is much harder to build cleanly under this model — and hasn't
been, which is itself the trade-off being described, not a feature request
being politely ignored.

| What an account-based app can do | What that requires |
| --- | --- |
| Recover your save if you lose your device | A server-side record tied to your identity |
| Show a leaderboard or friends list | Knowing who everyone is, relative to each other |
| Email you a re-engagement nudge | Your email address, stored, indefinitely |
| Sell a subscription tier | A billing relationship, which requires an account to attach it to |

None of those are evil on their own — plenty of apps do them responsibly.
The point is narrower: PetPomo doesn't do any of them, and the no-account
design is *why*, not a coincidence sitting next to it.

## What this costs you, honestly

The actual trade-off, stated plainly: if you clear your browser data and
never turned on cloud sync, your progress is gone, permanently, and nobody
can get it back for you — there's no support ticket that ends in "we
restored your account" because there was never an account to restore. That's
a real cost. For a lot of people it's a fair trade against never being asked
for an email address in the first place.

If you want the safety net, turn on cloud sync in Settings — it costs you
one code to remember, not an account.
