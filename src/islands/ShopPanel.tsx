import { useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile, applyAppearance, buy, equip, isOwned, type ShopCategory } from '../stores/profile';
import { PET_ITEMS, SCENE_ITEMS, SNACK_ITEMS, THEME_ITEMS, type ShopItem } from '../game/economy';
import { SCENES, type SceneId } from '../game/manifest';
import catIdleSvg from '../assets/pet/cat-idle.svg?raw';
import * as audio from '../game/audio';

const TABS: { id: ShopCategory; label: string; icon: string }[] = [
  { id: 'scenes', label: 'Scenes', icon: '🏞️' },
  { id: 'themes', label: 'Themes', icon: '🎨' },
  { id: 'pets', label: 'Pets', icon: '🐈' },
  { id: 'snacks', label: 'Snacks', icon: '🍬' },
];

const CATALOG: Record<ShopCategory, ShopItem[]> = {
  scenes: SCENE_ITEMS,
  themes: THEME_ITEMS,
  pets: PET_ITEMS,
  snacks: SNACK_ITEMS,
};

const EQUIP_SLOT: Record<ShopCategory, 'scene' | 'theme' | 'pet' | 'snack'> = {
  scenes: 'scene',
  themes: 'theme',
  pets: 'pet',
  snacks: 'snack',
};

export default function ShopPanel() {
  const profile = useStore($profile);
  const [tab, setTab] = useState<ShopCategory>('scenes');
  const [msg, setMsg] = useState<string | null>(null);

  const say = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 2400);
  };

  const handleBuy = (item: ShopItem) => {
    if (buy(tab, item.id, item.price)) {
      audio.unlock().then(() => audio.playCoin());
      say(`Bought ${item.name}.`);
    } else {
      say(`Not enough coins for ${item.name}.`);
    }
  };

  const handleEquip = (item: ShopItem) => {
    if (equip(tab, item.id)) {
      applyAppearance($profile.get());
      say(`${item.name} equipped.`);
    }
  };

  const items = CATALOG[tab];

  return (
    <section>
      <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">Shop</h1>
          <p class="text-sm" style="color: var(--ink-soft)">
            Earn coins by finishing focus sessions and looking after Mochi.
          </p>
        </div>
        <div class="pp-card flex items-center gap-2 px-3 py-2 text-sm font-bold">
          <span aria-hidden="true">🪙</span>
          <span class="pp-tabular">{profile.coins}</span>
        </div>
      </header>

      <div class="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Shop categories">
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

      {msg && (
        <p class="pp-card mb-4 px-3 py-2 text-sm font-semibold" role="status" aria-live="polite">
          {msg}
        </p>
      )}

      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const owned = isOwned(profile, tab, item.id);
          const equipped = profile.equipped[EQUIP_SLOT[tab]] === item.id;
          const affordable = profile.coins >= item.price;
          return (
            <li key={item.id} class="pp-card flex flex-col overflow-hidden">
              <Preview cat={tab} id={item.id} />
              <div class="flex flex-1 flex-col p-3">
                <div class="mb-1 flex items-baseline justify-between gap-2">
                  <h2 class="font-bold">{item.name}</h2>
                  {!owned && (
                    <span class="pp-tabular shrink-0 text-sm font-bold" style="color: var(--ink-soft)">
                      🪙 {item.price}
                    </span>
                  )}
                </div>
                <p class="mb-3 flex-1 text-xs" style="color: var(--ink-soft)">
                  {item.blurb}
                </p>
                {equipped ? (
                  <span
                    class="rounded-lg px-3 py-2 text-center text-sm font-bold"
                    style="background: var(--accent); color: var(--accent-ink)"
                  >
                    Equipped
                  </span>
                ) : owned ? (
                  <button type="button" onClick={() => handleEquip(item)} class="pp-btn pp-focus-ring px-3 py-2 text-sm">
                    Equip
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuy(item)}
                    disabled={!affordable}
                    class="pp-btn pp-btn-primary pp-focus-ring px-3 py-2 text-sm"
                  >
                    {affordable ? 'Buy' : `Need ${item.price - profile.coins} more`}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Live previews built from the same assets the game renders. */
function Preview({ cat, id }: { cat: ShopCategory; id: string }) {
  if (cat === 'scenes') {
    const scene = SCENES[id as SceneId];
    return (
      <div class="aspect-[16/9] w-full overflow-hidden" style="border-bottom: 1px solid var(--border)">
        <div class="pp-stage h-full w-full" dangerouslySetInnerHTML={{ __html: sized(scene.svg) }} />
      </div>
    );
  }

  if (cat === 'themes') {
    return (
      <div class={`theme-${id} aspect-[16/9] w-full`} style="border-bottom: 1px solid var(--border); background: var(--bg)">
        <div class="flex h-full items-center gap-2 p-4">
          <span class="h-8 w-8 rounded-full" style="background: var(--accent)" />
          <span class="h-8 w-8 rounded-full" style="background: var(--fur)" />
          <span class="h-8 w-8 rounded-full" style="background: var(--fur-dark)" />
          <span class="h-8 flex-1 rounded" style="background: var(--bg-elev); border: 1px solid var(--border)" />
        </div>
      </div>
    );
  }

  if (cat === 'pets') {
    const skin = PET_ITEMS.find((p) => p.id === id);
    const vars = skin?.colors
      ? `--fur:${skin.colors.fur};--fur-dark:${skin.colors.furDark};--belly:${skin.colors.belly};--line:${skin.colors.line};`
      : '';
    return (
      <div
        class="pp-stage grid aspect-[16/9] w-full place-items-center"
        style={`border-bottom: 1px solid var(--border); background: var(--bg); ${vars}`}
      >
        <div class="h-24 w-24" dangerouslySetInnerHTML={{ __html: sized(catIdleSvg) }} />
      </div>
    );
  }

  const snack = SNACK_ITEMS.find((s) => s.id === id);
  return (
    <div
      class="grid aspect-[16/9] w-full place-items-center text-5xl"
      style="border-bottom: 1px solid var(--border); background: var(--bg)"
    >
      <span aria-hidden="true">{snack?.glyph}</span>
    </div>
  );
}

/** Makes an asset fill its container instead of using its intrinsic size. */
function sized(svg: string): string {
  return svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)="[^"]*"/g, '');
    return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`;
  });
}
