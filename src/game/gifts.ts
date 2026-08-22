/**
 * Gifts — letters the pet writes to the player.
 *
 * Two species of gift live in one catalog. *Treats* are in-game: the letter
 * contains coins and claiming it calls addCoins, nothing leaves the browser.
 * *External* gifts are deals, coupons, offers and sponsorships from real
 * merchants, and those entries are also our accounting record — see
 * AFFILIATES.md for the rules. The short version:
 *
 *  - Entries are APPEND-ONLY. A dead deal gets an `endsAt`, never deleted;
 *    the catalog is the audit trail of every link this site has ever shown.
 *  - Every external entry names its `network` and, once affiliate accounts
 *    exist, the `campaignId` the network's revenue reports will use. Revenue
 *    is reconciled against network dashboards by those two fields.
 *  - `sample: true` entries demonstrate the UX and are shown only on
 *    non-production builds. Production never shows a link we don't mean.
 *
 * Region filtering is by ISO 3166-1 alpha-2 country code, matched against
 * whatever /api/geo says the visitor's country is. No `regions` means the
 * gift is for everyone.
 */

import { isBrowser, readJSON, writeJSON } from '../stores/persist';

export type GiftKind = 'treat' | 'deal' | 'coupon' | 'offer' | 'sponsorship';

/** Affiliate network an external gift is monetized through. 'none' = a plain
 * unmonetized link — honest filler until the accounts in AFFILIATES.md exist. */
export type GiftNetwork = 'none' | 'amazon' | 'awin' | 'cj' | 'impact' | 'rakuten' | 'sovrn' | 'flexoffers' | 'direct';

interface GiftBase {
  /** Stable and never reused, even after the gift expires — audit key. */
  id: string;
  kind: GiftKind;
  title: string;
  /** What Mochi wrote inside the envelope. First person, short, warm. */
  letter: string;
  /** Signature line, e.g. 'Mochi 🐾'. */
  from: string;
  /** ISO dates. No startsAt = always was; no endsAt = evergreen. */
  startsAt?: string;
  endsAt?: string;
  /** ISO 3166-1 alpha-2 country codes. Absent = worldwide. */
  regions?: string[];
  /** When the entry was added to this file — audit field, never edited. */
  addedAt: string;
}

export interface TreatGift extends GiftBase {
  kind: 'treat';
  coins: number;
}

export interface ExternalGift extends GiftBase {
  kind: Exclude<GiftKind, 'treat'>;
  merchant: string;
  /** The outbound link. Rendered rel="sponsored nofollow noopener" always. */
  url: string;
  /** Coupon code to copy, when the gift is one. */
  code?: string;
  network: GiftNetwork;
  /** The id the network's transaction reports will show — fill in when known. */
  campaignId?: string;
  /** Demo entry: visible on preview builds only, with a Sample ribbon. */
  sample?: boolean;
}

export type Gift = TreatGift | ExternalGift;

export type GiftStatus = 'upcoming' | 'active' | 'expired';

export function giftStatus(g: Gift, now = new Date()): GiftStatus {
  if (g.startsAt && now < new Date(g.startsAt)) return 'upcoming';
  if (g.endsAt && now > new Date(g.endsAt)) return 'expired';
  return 'active';
}

/** Worldwide gifts always pass. Unknown country (VPN, local dev) passes too —
 * hiding everything from someone we can't place would just look broken. */
export function inRegion(g: Gift, country: string | null): boolean {
  if (!g.regions || g.regions.length === 0) return true;
  if (!country) return true;
  return g.regions.includes(country);
}

export function isExternal(g: Gift): g is ExternalGift {
  return g.kind !== 'treat';
}

// --- the catalog -------------------------------------------------------------

export const GIFTS: Gift[] = [
  // In-game treats: real gifts on day one, no merchant required.
  {
    id: 'welcome-coins-2026',
    kind: 'treat',
    title: 'A little welcome pouch',
    letter:
      'I found these under the sofa cushion and I want you to have them. Buy yourself something nice in the shop — or a snack for me, I would also accept that.',
    from: 'Mochi 🐾',
    coins: 30,
    addedAt: '2026-08-22',
  },
  {
    id: 'late-summer-bouquet-2026',
    kind: 'treat',
    title: 'Late-summer bouquet',
    letter:
      'The garden smells like warm grass and the bees are getting sleepy. I pressed some flowers for you and tucked coins between the petals. Summer is almost over — spend them before the leaves turn!',
    from: 'Mochi 🌻',
    coins: 25,
    endsAt: '2026-09-30',
    addedAt: '2026-08-22',
  },
  {
    id: 'sunflower-week-2026',
    kind: 'treat',
    title: 'Sunflower week',
    letter:
      'One week only: I sat in the sunflower patch every afternoon and saved you a coin for each nap. Seven naps, and a few bonus ones because the sun was very good that week.',
    from: 'Mochi 🌻',
    coins: 20,
    startsAt: '2026-08-03',
    endsAt: '2026-08-10',
    addedAt: '2026-08-03',
  },

  // Sample external gifts — preview builds only (`sample: true`). They exist
  // so the deal/coupon/sponsorship UX can be seen and tested before any
  // affiliate account is approved. Replace with real entries per AFFILIATES.md.
  {
    id: 'sample-deal-chewy',
    kind: 'deal',
    title: '35% off your first autoship',
    merchant: 'Chewy',
    letter:
      'A human I trust told me new Chewy customers get a big chunk off their first autoship order. I do not know what autoship is but it sounds like food that arrives forever, which is my dream.',
    from: 'Mochi 🐾',
    url: 'https://www.chewy.com/',
    network: 'none',
    regions: ['US'],
    sample: true,
    addedAt: '2026-08-22',
  },
  {
    id: 'sample-coupon-petstore',
    kind: 'coupon',
    title: '15% off cat trees',
    merchant: 'Example Pet Store',
    letter:
      'I have inspected many cat trees and I am prepared to consult on yours. This code fell out of a catalogue I was sleeping on.',
    from: 'Mochi 🎁',
    url: 'https://example.com/cat-trees',
    code: 'MOCHI15',
    network: 'none',
    endsAt: '2026-12-31',
    sample: true,
    addedAt: '2026-08-22',
  },
  {
    id: 'sample-offer-focusapp',
    kind: 'offer',
    title: '3 months free — a friend of the house',
    merchant: 'Example Focus Tools',
    letter:
      'Some nice makers of desk things offered PetPomo friends three months of their premium plan. I negotiated by purring at their email.',
    from: 'Mochi 💌',
    url: 'https://example.com/petpomo-offer',
    network: 'none',
    sample: true,
    addedAt: '2026-08-22',
  },
  {
    id: 'sample-sponsorship-acme',
    kind: 'sponsorship',
    title: 'This month’s catnip is sponsored',
    merchant: 'Example Treats Co.',
    letter:
      'Example Treats Co. keeps my bowl full this month so the timer stays free for you. Sponsors get one letter, clearly stamped, and never a say in what I write.',
    from: 'Mochi 🤝',
    url: 'https://example.com/',
    network: 'direct',
    endsAt: '2026-08-31',
    sample: true,
    addedAt: '2026-08-22',
  },
];

// --- what the player has opened and claimed ----------------------------------

/** Separate from the profile save on purpose: opening a letter is device-local
 * flavour, not game progress, and keeping it out of Profile means no schema
 * bump and nothing extra in cloud sync. Coins from treats DO land in the
 * profile via addCoins, which sync already covers. */
const GIFTS_KEY = 'petpomo.gifts.v1';

interface GiftState {
  opened: string[];
  claimed: string[];
}

export function giftState(): GiftState {
  return readJSON<GiftState>(GIFTS_KEY, { opened: [], claimed: [] });
}

export function markOpened(id: string): GiftState {
  const s = giftState();
  if (!s.opened.includes(id)) s.opened = [...s.opened, id];
  writeJSON(GIFTS_KEY, s);
  return s;
}

export function markClaimed(id: string): GiftState {
  const s = giftState();
  if (!s.claimed.includes(id)) s.claimed = [...s.claimed, id];
  writeJSON(GIFTS_KEY, s);
  return s;
}

// --- where the visitor is -----------------------------------------------------

const GEO_KEY = 'petpomo.geo.v1';

/**
 * Ask the edge which country this visitor is in. Cloudflare already knows from
 * the IP; nothing is asked of the browser and nothing is stored server-side.
 * Cached in sessionStorage so the question is asked once per visit, and a
 * failure just means "no country", which shows worldwide gifts only.
 */
export async function fetchCountry(): Promise<string | null> {
  if (!isBrowser) return null;
  try {
    const cached = sessionStorage.getItem(GEO_KEY);
    if (cached !== null) return cached || null;
  } catch {
    /* sessionStorage unavailable — just fetch */
  }
  try {
    const res = await fetch('/api/geo');
    if (!res.ok) return null;
    const data = (await res.json()) as { country?: string | null };
    const country = typeof data.country === 'string' ? data.country : null;
    try {
      sessionStorage.setItem(GEO_KEY, country ?? '');
    } catch {
      /* fine */
    }
    return country;
  } catch {
    return null;
  }
}
