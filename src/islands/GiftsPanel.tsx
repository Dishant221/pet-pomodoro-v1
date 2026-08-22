import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile, addCoins, prefersReducedMotion } from '../stores/profile';
import {
  GIFTS,
  fetchCountry,
  giftState,
  giftStatus,
  inRegion,
  isExternal,
  markClaimed,
  markOpened,
  type Gift,
  type GiftKind,
  type GiftStatus,
} from '../game/gifts';
import * as audio from '../game/audio';
import { track } from '../game/events';

const TABS: { id: GiftKind | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: 'All', icon: '🎁' },
  { id: 'treat', label: 'From Mochi', icon: '🐾' },
  { id: 'deal', label: 'Deals', icon: '💝' },
  { id: 'coupon', label: 'Coupons', icon: '🎟️' },
  { id: 'offer', label: 'Offers', icon: '🌸' },
  { id: 'sponsorship', label: 'Sponsors', icon: '🤝' },
];

const KIND_LABEL: Record<GiftKind, string> = {
  treat: 'From Mochi',
  deal: 'Deal',
  coupon: 'Coupon',
  offer: 'Offer',
  sponsorship: 'Sponsored',
};

/** 'US' → 'United States', falling back to the code when Intl can't. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** The burst of petals when a letter opens. Pure decoration: aria-hidden,
 * removed by the parent after the animation, skipped under reduced motion. */
function Petals() {
  const petals = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        emoji: ['🌸', '🌼', '💮', '🌺', '✨'][i % 5],
        x: (i / 12) * 100,
        dx: Math.random() * 80 - 40,
        delay: Math.random() * 0.25,
        dur: 0.9 + Math.random() * 0.7,
      })),
    []
  );
  return (
    <div class="gift-petals" aria-hidden="true">
      {petals.map((p, i) => (
        <span
          key={i}
          style={`left:${p.x}%; --dx:${p.dx}px; animation-delay:${p.delay}s; animation-duration:${p.dur}s;`}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

export default function GiftsPanel({ showSamples = false }: { showSamples?: boolean }) {
  const profile = useStore($profile);
  const [tab, setTab] = useState<GiftKind | 'all'>('all');
  const [status, setStatus] = useState<GiftStatus>('active');
  const [country, setCountry] = useState<string | null>(null);
  const [everywhere, setEverywhere] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const [claimed, setClaimed] = useState<string[]>([]);
  /** Ids currently mid-animation, so petals mount once and get cleaned up. */
  const [bursting, setBursting] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const s = giftState();
    setOpened(s.opened);
    setClaimed(s.claimed);
    fetchCountry().then(setCountry);
  }, []);

  const say = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2400);
  };

  const calm = prefersReducedMotion(profile);

  const open = (g: Gift) => {
    setOpened(markOpened(g.id).opened);
    // Analytics: which letters get opened at all — AE-only, high volume.
    track({ type: 'letter_open', giftId: g.id });
    if (!calm) {
      setBursting((b) => [...b, g.id]);
      setTimeout(() => setBursting((b) => b.filter((id) => id !== g.id)), 1800);
    }
    audio.unlock().then(() => audio.playCoin());
  };

  const claim = (g: Gift) => {
    if (g.kind !== 'treat' || claimed.includes(g.id)) return;
    if (giftStatus(g) !== 'active') {
      say('That one has wilted — Mochi will send more.');
      return;
    }
    addCoins(g.coins);
    setClaimed(markClaimed(g.id).claimed);
    audio.unlock().then(() => audio.playCoin());
    say(`+${g.coins} coins from Mochi!`);
  };

  const copyCode = (code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => say(`Code ${code} copied.`),
      () => say('Could not copy — long-press the code instead.')
    );
  };

  // Upcoming letters are shown alongside active ones, sealed and unopenable —
  // a wrapped present on the shelf is half the fun.
  const visible = GIFTS.filter((g) => (isExternal(g) && g.sample ? showSamples : true))
    .filter((g) => (everywhere ? true : inRegion(g, country)))
    .filter((g) => (tab === 'all' ? true : g.kind === tab))
    .filter((g) => (status === 'expired' ? giftStatus(g) === 'expired' : giftStatus(g) !== 'expired'));

  const localOnly = country && !everywhere;

  return (
    <section>
      <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">Gifts</h1>
          <p class="text-sm" style="color: var(--ink-soft)">
            Letters from Mochi — coins, deals, coupons and thank-yous, sealed with a paw.
          </p>
        </div>
        <div class="pp-card flex items-center gap-2 px-3 py-2 text-sm font-bold">
          <span aria-hidden="true">🪙</span>
          <span class="pp-tabular">{profile.coins}</span>
        </div>
      </header>

      {/* FTC / ASA affiliate disclosure. Always visible, above the letters,
          plain words — see AFFILIATES.md before changing it. */}
      <p class="pp-card mb-4 px-3 py-2 text-xs" style="color: var(--ink-soft)">
        <span aria-hidden="true">ℹ️ </span>
        Some letters contain affiliate links or sponsored offers. If you buy through one, PetPomo may
        earn a commission at no extra cost to you — it keeps the timer free and Mochi in snacks. Those
        letters are always labelled.
      </p>

      <div class="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Gift categories">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
            style={tab === t.id ? 'background: var(--accent); color: var(--accent-ink); border-color: transparent;' : ''}
          >
            <span aria-hidden="true" class="mr-1">
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      <div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div class="flex gap-1.5" role="group" aria-label="Show active or expired gifts">
          {(['active', 'expired'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              class="pp-btn pp-focus-ring px-3 py-1 text-xs"
              style={status === s ? 'background: var(--accent); color: var(--accent-ink); border-color: transparent;' : ''}
            >
              {s === 'active' ? '🌷 Current' : '🥀 Expired'}
            </button>
          ))}
        </div>
        <p style="color: var(--ink-soft)">
          {localOnly ? (
            <>
              Showing gifts for <strong>{countryName(country!)}</strong> and everywhere ·{' '}
              <button type="button" class="pp-focus-ring rounded underline underline-offset-2" onClick={() => setEverywhere(true)}>
                show all regions
              </button>
            </>
          ) : country ? (
            <>
              Showing all regions ·{' '}
              <button type="button" class="pp-focus-ring rounded underline underline-offset-2" onClick={() => setEverywhere(false)}>
                back to {countryName(country)}
              </button>
            </>
          ) : (
            'Showing gifts from everywhere.'
          )}
        </p>
      </div>

      {msg && (
        <p class="pp-card mb-4 px-3 py-2 text-sm font-semibold" role="status" aria-live="polite">
          {msg}
        </p>
      )}

      {visible.length === 0 ? (
        <div class="pp-card px-5 py-10 text-center">
          <p class="mb-1 text-4xl" aria-hidden="true">
            {status === 'expired' ? '🥀' : '🐾'}
          </p>
          <p class="font-bold">{status === 'expired' ? 'Nothing has wilted yet.' : 'Mochi is out sniffing for deals.'}</p>
          <p class="text-sm" style="color: var(--ink-soft)">
            {status === 'expired'
              ? 'Expired letters are kept here so you can see what you missed.'
              : 'New letters arrive here — coins, coupons and offers, whenever Mochi finds something good.'}
          </p>
        </div>
      ) : (
        <ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((g) => {
            const st = giftStatus(g);
            const isOpen = opened.includes(g.id) && st !== 'upcoming';
            const external = isExternal(g);
            return (
              <li key={g.id} class={`gift-card pp-card relative flex flex-col overflow-hidden ${st === 'expired' ? 'gift-expired' : ''}`}>
                {external && g.sample && <span class="gift-ribbon">Sample</span>}
                {st === 'expired' && (
                  <span class="gift-stamp" aria-hidden="true">
                    EXPIRED
                  </span>
                )}

                {!isOpen ? (
                  /* Sealed: an envelope with a wax paw seal. Upcoming ones tease their date. */
                  <button
                    type="button"
                    class="gift-envelope pp-focus-ring"
                    disabled={st === 'upcoming'}
                    onClick={() => open(g)}
                    aria-label={st === 'upcoming' ? `${g.title} — arrives ${fmtDate(g.startsAt!)}` : `Open letter: ${g.title}`}
                  >
                    <span class="gift-flap" aria-hidden="true"></span>
                    <span class="gift-seal" aria-hidden="true">
                      🐾
                    </span>
                    <span class="gift-env-text">
                      <span class="text-xs font-bold uppercase tracking-wide" style="color: var(--ink-soft)">
                        {KIND_LABEL[g.kind]}
                        {g.regions && ` · ${g.regions.join(', ')}`}
                      </span>
                      <span class="font-bold">{st === 'upcoming' ? `Arrives ${fmtDate(g.startsAt!)}` : 'A letter for you'}</span>
                      <span class="text-xs" style="color: var(--ink-soft)">
                        {st === 'upcoming' ? 'No peeking!' : 'Tap to break the seal'}
                      </span>
                    </span>
                  </button>
                ) : (
                  /* Opened: the letter itself. */
                  <div class="gift-letter flex flex-1 flex-col p-4">
                    {bursting.includes(g.id) && <Petals />}
                    <p class="mb-1 text-xs font-bold uppercase tracking-wide" style="color: var(--ink-soft)">
                      {KIND_LABEL[g.kind]}
                      {external && ` · ${g.merchant}`}
                      {g.regions && ` · ${g.regions.map(countryName).join(', ')}`}
                    </p>
                    <h2 class="mb-2 font-bold">{g.title}</h2>
                    <p class="gift-hand mb-3 flex-1 text-sm">{g.letter}</p>
                    <p class="gift-hand mb-3 text-right text-sm">— {g.from}</p>

                    {external && g.code && (
                      <div class="mb-2 flex items-center gap-2">
                        <code class="pp-tabular flex-1 rounded-lg border border-dashed px-3 py-2 text-center text-sm font-bold" style="border-color: var(--border)">
                          {g.code}
                        </code>
                        <button type="button" class="pp-btn pp-focus-ring px-3 py-2 text-sm" onClick={() => copyCode(g.code!)}>
                          Copy
                        </button>
                      </div>
                    )}

                    {g.kind === 'treat' ? (
                      claimed.includes(g.id) ? (
                        <span class="rounded-lg px-3 py-2 text-center text-sm font-bold" style="background: var(--surface-2, var(--border)); color: var(--ink-soft)">
                          Claimed 🪙 {g.coins}
                        </span>
                      ) : st === 'active' ? (
                        <button
                          type="button"
                          class="pp-btn pp-focus-ring px-3 py-2 text-sm font-bold"
                          style="background: var(--accent); color: var(--accent-ink); border-color: transparent;"
                          onClick={() => claim(g)}
                        >
                          Claim 🪙 {g.coins}
                        </button>
                      ) : (
                        <span class="rounded-lg px-3 py-2 text-center text-sm font-bold" style="color: var(--ink-soft)">
                          Wilted before you got here
                        </span>
                      )
                    ) : (
                      st !== 'expired' && (
                        /* sponsored: paid link, tells search engines the truth.
                           nofollow+noopener for the usual reasons. */
                        <a
                          href={(g as { url: string }).url}
                          target="_blank"
                          rel="sponsored nofollow noopener"
                          class="pp-btn pp-focus-ring px-3 py-2 text-center text-sm font-bold"
                          style="background: var(--accent); color: var(--accent-ink); border-color: transparent;"
                          onClick={() =>
                            // The revenue-attribution beacon (AFFILIATES.md):
                            // sendBeacon survives the navigation this click
                            // starts. gift_clicks in D1 is the permanent record.
                            'network' in g &&
                            track({
                              type: 'gift_click',
                              giftId: g.id,
                              network: (g as { network: string }).network,
                              campaignId: (g as { campaignId?: string }).campaignId,
                            })
                          }
                        >
                          {g.kind === 'sponsorship' ? 'Visit sponsor' : `Open ${'merchant' in g ? g.merchant : 'deal'}`} ↗
                        </a>
                      )
                    )}

                    {g.endsAt && (
                      <p class="mt-2 text-xs" style="color: var(--ink-soft)">
                        {st === 'expired' ? `Ended ${fmtDate(g.endsAt)}` : `Until ${fmtDate(g.endsAt)}`}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
