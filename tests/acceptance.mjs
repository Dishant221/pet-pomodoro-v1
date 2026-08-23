import { chromium } from 'playwright';

/**
 * Defaults to `astro preview`. Point it at `wrangler pages dev` instead to run
 * the same suite against the real Pages runtime, which is the only way to
 * exercise the Content-Security-Policy and the /api Functions:
 *
 *   npx wrangler pages dev dist --port 8788
 *   PETPOMO_BASE=http://localhost:8788 npm run test:e2e
 */
const BASE = process.env.PETPOMO_BASE || 'http://localhost:4330';
const results = [];
const consoleErrors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The stage mirrors its world state onto data attributes — the canvas can't. */
async function petState(page) {
  return page.getAttribute('.pp-stage', 'data-pet-state');
}

/**
 * Wait for the pet to reach a state, rather than sleeping a guessed amount.
 *
 * Several pet states are transient — `waking` lasts 1.6s and then hands off to
 * `celebrating`. Sleeping a fixed interval and then reading the state assumes
 * the page loaded in a predictable time, which stopped being true the moment
 * the suite could also be pointed at the slower Pages runtime. Polling asserts
 * the same thing without the assumption.
 *
 * Returns the state actually observed, so a failure message can say what it
 * saw instead of just "not what we wanted".
 */
async function waitForPetState(page, wanted, timeout = 8000) {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  try {
    await page.waitForFunction(
      (want) => want.includes(document.querySelector('.pp-stage')?.dataset.petState),
      list,
      { timeout, polling: 100 },
    );
  } catch {
    /* fall through — the caller reports whatever state it ended up in */
  }
  return petState(page);
}

/**
 * Coins, read from `data-coins` rather than from the chip's text or tooltip.
 *
 * Both of those are user-facing copy. Keying a test to them means rewording a
 * tooltip breaks the suite somewhere unrelated, which is exactly what happened.
 */
async function coins(page) {
  return Number(await page.getAttribute('[data-coins]', 'data-coins'));
}

/** Waits for the WebGL stage to come up and the first frames to be drawn. */
async function stageReady(page) {
  await page.waitForSelector('.pp-stage[data-webgl="true"] canvas', { timeout: 15000 });
  await sleep(700);
}

/**
 * Client coordinates of the cat. It roams under its own steam, so a fixed
 * point on the canvas is not good enough to aim a stroke or a poke at.
 */
async function catPoint(page) {
  return page.evaluate(() => document.querySelector('.pp-stage')?.__stage?.catScreenPos() ?? null);
}

/**
 * Mutate the save from /about — a page with no island that writes to storage —
 * so the Game island's 200ms debounced write can never race the injection.
 */
async function seedSave(page, mutator) {
  await page.goto(BASE + '/about', { waitUntil: 'networkidle' });
  await page.evaluate((fnBody) => {
    const save = JSON.parse(localStorage.getItem('petpomo.save.v1'));
    const fn = new Function('s', fnBody);
    fn(save);
    localStorage.setItem('petpomo.save.v1', JSON.stringify(save));
  }, mutator);
}

/** Drags the HUD snack chip onto the cat and waits for the walk-and-eat. */
async function dragFeed(page) {
  const snack = await page.locator('.pp-snack').boundingBox();
  const cat = (await catPoint(page)) ?? { x: 640, y: 500 };
  await page.mouse.move(snack.x + snack.width / 2, snack.y + snack.height / 2);
  await page.mouse.down();
  await page.mouse.move(cat.x, cat.y, { steps: 18 });
  await page.mouse.up();
}

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // The /api/* Pages Function is optional by design — the game is a static
  // site that works with no server at all. `astro preview` serves the static
  // build only, so /api/weather legitimately 404s here and the client falls
  // back to fair weather. Matched on the failing URL rather than the message
  // text, so a 404 on anything else still fails the run.
  if (m.location()?.url?.includes('/api/')) return;
  consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

// ---------------------------------------------------------------- 1. pages
for (const [path, needle] of [
  ['/', 'pp-stage'],
  ['/stats', 'Stats'],
  ['/shop', 'Shop'],
  ['/gifts', 'Gifts'],
  ['/settings', 'Settings'],
  ['/about', 'About PetPomo'],
]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  check(`page ${path} renders`, (await page.content()).includes(needle));
}

// ------------------------------------------------ 2. the 3D stage comes up
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check('stage reports a live WebGL context', (await page.getAttribute('.pp-stage', 'data-webgl')) === 'true');

const canvasSized = await page.evaluate(() => {
  const c = document.querySelector('.pp-stage canvas');
  return !!c && c.width > 0 && c.height > 0;
});
check('canvas is sized to its host', canvasSized);
check('cat is reachable on screen', (await catPoint(page)) != null);
// Everything about the animal lives in the pet panel, and nothing about the
// animal lives in the timer card. Asserting both directions, because the split
// only means anything if it holds on both sides.
check('snack handle lives in the pet panel', (await page.locator('.pp-metrics .pp-snack').count()) === 1);
check(
  'the timer card carries no pet readouts',
  (await page.locator('.pp-hud .pp-mood, .pp-hud .pp-snack').count()) === 0,
);
check('starts idle', (await petState(page)) === 'idle', `state=${await petState(page)}`);

// ------------------------- 2b. the page is exactly one screen and does not scroll
//
// The game page owns the whole viewport. It used to size its own stage to
// `100dvh - 3.25rem`, which subtracted the header and forgot the footer, so the
// page scrolled and the pet hung off the bottom of it. Nothing about that looks
// broken in a screenshot of the top of the page, which is why it is asserted.
const pageFits = await page.evaluate(() => {
  const stage = document.querySelector('.pp-stage-screen').getBoundingClientRect();
  return {
    // The stage is exactly one screenful minus the nav, on any device.
    stageH: Math.round(stage.height),
    viewH: window.innerHeight,
    navH: Math.round(document.querySelector('header').getBoundingClientRect().height),
    // And the page continues below it, which is where the readable content is.
    docH: document.documentElement.scrollHeight,
    landing: !!document.querySelector('.pp-landing h1'),
  };
});
check(
  'the stage is exactly one screenful under the nav',
  Math.abs(pageFits.stageH - (pageFits.viewH - pageFits.navH)) <= 2,
  `stage=${pageFits.stageH} view=${pageFits.viewH} nav=${pageFits.navH}`,
);
check(
  'the page continues below the stage with readable content',
  pageFits.landing && pageFits.docH > pageFits.viewH * 1.5,
  `docHeight=${pageFits.docH} viewport=${pageFits.viewH}`,
);

// The advertising slot exists but takes no height until something fills it.
// Reserving it up front cost the stage 90px and the pet its footing, for
// protection against a layout shift that cannot happen while the slot is empty.
// Marking it `data-filled` is what claims the space, and that is asserted here
// so the mechanism does not quietly rot before there is an ad to put in it.
const adEmpty = await page.evaluate(() => document.querySelector('.pp-adslot')?.getBoundingClientRect().height ?? -1);
check('the empty ad slot takes no height', adEmpty === 0, `${adEmpty}px`);

const adFilled = await page.evaluate(() => {
  const el = document.querySelector('.pp-adslot');
  el.setAttribute('data-filled', '');
  const h = el.getBoundingClientRect().height;
  el.removeAttribute('data-filled');
  return h;
});
check('a filled ad slot claims its space', adFilled >= 50, `${Math.round(adFilled)}px`);

// The world drives the painting, the lighting and the sound, and for a while it
// did all of that without appearing anywhere a person could read — announced to
// screen readers through the canvas label and to nobody else. This asserts the
// three readings are on screen as words, and that they agree with the state the
// stage says it is in.
const worldRead = await page.evaluate(() => {
  const s = document.querySelector('.pp-stage');
  const el = document.querySelector('.pp-world');
  return {
    text: (el?.innerText ?? '').toLowerCase(),
    phase: s.dataset.phase,
    season: s.dataset.season,
    weather: s.dataset.weather,
  };
});
check(
  'time of day, weather and season are readable on screen',
  worldRead.text.includes(worldRead.phase) &&
    worldRead.text.includes(worldRead.season) &&
    worldRead.text.includes(worldRead.weather),
  `"${worldRead.text.replace(/\n/g, ' ')}" vs ${worldRead.phase}/${worldRead.weather}/${worldRead.season}`,
);

// One bar, not two. The floating card is the command centre by default.
const hudBox = await page.locator('.pp-hud').boundingBox();
const stageBox = await page.locator('.pp-stage').boundingBox();
check(
  'there is one command bar, floating over the stage',
  (await page.locator('.pp-hud').count()) === 1 &&
    (await page.getAttribute('.pp-hud', 'data-layout')) === 'float' &&
    hudBox.y >= stageBox.y - 1 &&
    hudBox.y + hudBox.height <= stageBox.y + stageBox.height + 1,
  `hud ${Math.round(hudBox.y)}..${Math.round(hudBox.y + hudBox.height)} inside stage ${Math.round(stageBox.y)}..${Math.round(stageBox.y + stageBox.height)}`,
);

// ------------------------------------------------- 3. focus -> sleeping
// The cat answers the start with a short spoken reaction pose first (petted /
// playing, chosen by the talk system) and only then settles into the nap, so
// this polls for the settle instead of reading whichever reaction a fixed
// sleep happens to land on.
await page.getByRole('button', { name: 'Start', exact: true }).click();
const napState = await waitForPetState(page, 'sleeping', 10000);
check('focus start puts cat to sleep', napState === 'sleeping', `state=${napState}`);
check('title bar counts down', /\d\d:\d\d · Focus/.test(await page.title()), await page.title());

// ------------------------------------- 4. mid-session refresh survives
const before = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.timer.v1')));
await sleep(1500);
await page.reload({ waitUntil: 'networkidle' });
await stageReady(page);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.timer.v1')));
check(
  'timer survives mid-session refresh',
  after.status === 'running' && after.endsAt === before.endsAt,
  `endsAt preserved=${after.endsAt === before.endsAt}, status=${after.status}`,
);
check('cat still asleep after refresh', (await petState(page)) === 'sleeping', `state=${await petState(page)}`);

// ------------------------------- 5. completion -> waking -> celebrating
const coinsBefore = await coins(page);
// Far enough ahead that the bell rings *after* the page has finished loading.
// At 800ms the deadline could pass while the reload was still settling, so
// `waking` — which lasts only 1.6s — was already over by the time anything
// could observe it. How long a reload takes is not what this check is about.
await page.evaluate(() => {
  const t = JSON.parse(localStorage.getItem('petpomo.timer.v1'));
  t.endsAt = Date.now() + 4000;
  localStorage.setItem('petpomo.timer.v1', JSON.stringify(t));
});
await page.reload({ waitUntil: 'networkidle' });
await stageReady(page);
// `waking` only lasts 1.6s before handing off to `celebrating`, so catch it by
// polling rather than by sleeping and hoping the page loaded fast enough.
const wokeState = await waitForPetState(page, 'waking', 12000);
check('focus bell -> waking', wokeState === 'waking', `state=${wokeState}`);
// The toast auto-dismisses after 3.2s, so read it before the celebrate wait.
const bellToast = await page.locator('.pp-toast').innerText().catch(() => '');
check('completion toast names the reward', /\+\d+ coins/.test(bellToast), bellToast);
await sleep(1800);
check('waking -> celebrating', (await petState(page)) === 'celebrating', `state=${await petState(page)}`);
check('focus completion pays coins', (await coins(page)) > coinsBefore, `${coinsBefore} -> ${await coins(page)}`);

// ------------------------------------- 5b. the cat fetches you a present
// deliverGift fires 3.4s after the bell, then the cat runs to a stash, picks
// the toy up, carries it to the front of the stage and drops it. The toast is
// transient, so poll for it rather than sleeping a guessed amount.
const gifted = await page
  .waitForFunction(() => document.querySelector('.pp-toast')?.textContent?.includes('brought you a') ?? false, null, {
    timeout: 30000,
  })
  .then(() => true)
  .catch(() => false);
check('completing a session makes the cat bring a gift', gifted);
await sleep(2500);
check('cat settles after the errand', ['idle', 'begging', 'playing'].includes(await petState(page)), `state=${await petState(page)}`);

// ------------------------------------------------------------ 6. drag-feed
await dragFeed(page);
// The cat has to walk to the food before it eats, so this is not instant.
await page.waitForFunction(() => document.querySelector('.pp-stage')?.dataset.petState === 'eating', null, {
  timeout: 12000,
}).catch(() => {});
check('drag-feed reaches eating state', (await petState(page)) === 'eating', `state=${await petState(page)}`);
await sleep(3200);

// --------------------------------------------------------------- 7. petting
const cb = await catPoint(page);
await page.mouse.move(cb.x, cb.y);
await page.mouse.down();
for (let i = 0; i < 14; i++) {
  await page.mouse.move(cb.x + Math.sin(i) * 16, cb.y + (i % 5) * 4, { steps: 2 });
  await sleep(110);
}
await sleep(400);
const pettedState = await petState(page);
await page.mouse.up();
check('stroking >=1s reaches petted', pettedState === 'petted', `state=${pettedState}`);
await sleep(2800);

// ------------------------------------------------------------ 8. play (tap)
const cb2 = await catPoint(page);
await page.mouse.click(cb2.x, cb2.y, { delay: 60 });
await sleep(500);
check('quick tap reaches playing', (await petState(page)) === 'playing', `state=${await petState(page)}`);
await sleep(3200);

// ---------------------------------------------- 9. hunger drives begging
// Threshold is 70 (src/stores/pet.ts). Seed above it rather than grinding sessions.
await seedSave(page, 's.vitals.hunger = 85; s.vitals.happiness = 80; s.vitals.ignoredBreaks = 0;');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check('hunger >= 70 drives begging', (await petState(page)) === 'begging', `state=${await petState(page)}`);

// ------------------------------ 9b. a break makes the cat ask for dinner
// BREAK_BEG_DELAY_MS is 15s into the break, regardless of hunger.
await seedSave(page, 's.vitals.hunger = 10; s.vitals.happiness = 80; s.vitals.ignoredBreaks = 0;');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
await page.getByRole('button', { name: 'Short', exact: true }).click();
await page.getByRole('button', { name: 'Start', exact: true }).click();
await sleep(2000);
check('well-fed cat is not begging early in the break', (await petState(page)) !== 'begging', `state=${await petState(page)}`);
await sleep(16000);
check('cat begs for food mid-break', (await petState(page)) === 'begging', `state=${await petState(page)}`);

// feeding is what stops the asking — petting is not dinner
await dragFeed(page);
await page.waitForFunction(() => document.querySelector('.pp-stage')?.dataset.petState === 'eating', null, {
  timeout: 12000,
}).catch(() => {});
await sleep(3600);
check('feeding ends the begging', (await petState(page)) !== 'begging', `state=${await petState(page)}`);

// --------------------------------------------- 10. abandon a FOCUS -> sad
// The break above is still running, and the mode chips are disabled while the
// clock runs — so clear the timer as well as the vitals.
await seedSave(page, 's.vitals.hunger = 10; s.vitals.happiness = 80;');
await page.evaluate(() => localStorage.removeItem('petpomo.timer.v1'));
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
await page.getByRole('button', { name: 'Focus', exact: true }).click();
await sleep(200);
await page.getByRole('button', { name: 'Start', exact: true }).click();
await sleep(600);
await page.locator('button[title="Give up on this session"]').click();
check('abandon shows a confirm dialog', (await page.getByRole('alertdialog').count()) > 0);
await page.getByRole('button', { name: 'Abandon', exact: true }).click();
// Same shape as the focus-start check: a talk reaction can hold the stage for
// a few seconds before the sad settle, so poll rather than sleep.
const sadState = await waitForPetState(page, 'sad', 10000);
check('abandoning a focus session -> sad', sadState === 'sad', `state=${sadState}`);

// feeding clears the sad hold without waiting out the 60s timer
await dragFeed(page);
await page.waitForFunction(() => document.querySelector('.pp-stage')?.dataset.petState === 'eating', null, {
  timeout: 12000,
}).catch(() => {});
// Eating runs for 2.6s and then returns to idle. Wait for the handoff instead
// of assuming it has happened.
const fedState = await waitForPetState(page, 'idle', 12000);
check('feeding recovers the cat from sad', fedState === 'idle', `state=${fedState}`);

// -------------------------------------------------------- 11. shop economy
await seedSave(page, 's.coins = 5000;');
await page.goto(BASE + '/shop', { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /Scenes/ }).click();
const gardenCard = page.locator('li').filter({ hasText: 'Garden' }).first();
await gardenCard.getByRole('button', { name: 'Buy' }).click();
await sleep(300);
await gardenCard.getByRole('button', { name: 'Equip' }).click();
await sleep(300);
const equippedScene = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).equipped.scene);
check('shop buy + equip persists', equippedScene === 'garden', `equipped=${equippedScene}`);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check('equipped scene survives reload', (await page.getAttribute('.pp-stage', 'data-scene')) === 'garden');

// ------------------------------------------------------------- 12. themes
await page.goto(BASE + '/shop', { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: /Themes/ }).click();
for (const t of ['Ghibli', 'Anime', 'Van Gogh']) {
  await page.locator('li').filter({ hasText: t }).first().getByRole('button', { name: 'Buy' }).click();
  await sleep(200);
}
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
const themeResults = [];
for (const [name, cls] of [
  ['Ghibli', 'theme-ghibli'],
  ['Anime', 'theme-anime'],
  ['Van Gogh', 'theme-vangogh'],
  ['Playful', 'theme-playful'],
]) {
  await page.getByRole('button', { name, exact: true }).click();
  await sleep(250);
  const applied = await page.evaluate(() => document.documentElement.className);
  themeResults.push(`${name}:${applied === cls ? 'ok' : applied}`);
}
check('all 4 themes apply live', themeResults.every((r) => r.endsWith(':ok')), themeResults.join(' '));

await page.getByRole('button', { name: 'Van Gogh', exact: true }).click();
await sleep(200);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
check(
  'theme persists across pages with no flash',
  (await page.evaluate(() => document.documentElement.className)) === 'theme-vangogh',
);

// --------------------------------------------------------- 13. all scenes
for (const id of ['livingroom', 'garden', 'jungle', 'treehouse', 'mountain', 'snow']) {
  await seedSave(
    page,
    `s.owned.scenes = ['livingroom','garden','jungle','treehouse','mountain','snow']; s.equipped.scene = '${id}';`,
  );
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await stageReady(page);
  const mounted = (await page.getAttribute('.pp-stage', 'data-scene')) === id;
  const visible = (await catPoint(page)) != null;
  check(`scene ${id} builds and frames the cat`, mounted && visible, `mounted=${mounted} catVisible=${visible}`);
}

// ------------------------------------------------ 14. characters and species
//
// The four cats are recolours of one rig; the dogs are a different rig. Both
// have to survive being equipped, because a species change tears the animal
// down and rebuilds it while the world and the camera stay put — the one
// operation where "it still renders" is a real question rather than a given.
// Every character, deliberately — each species exercises a different corner of
// the rig (hooves, horns, antlers, fleece, a hanging ear, a long snout), and a
// species that fails to build is a blank stage rather than a subtle glitch.
const ALL_PETS = [
  'mochi',
  'shadow',
  'cloud',
  'inky',
  'biscuit',
  'pepper',
  'pip',
  'clover',
  'juniper',
  'marigold',
  'winter',
  'birch',
  'barley',
];
for (const pet of ALL_PETS) {
  await seedSave(page, `s.owned.pets = ${JSON.stringify(ALL_PETS)}; s.equipped.pet = '${pet}';`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await stageReady(page);
  check(`character ${pet} equips without tearing down the stage`, (await catPoint(page)) != null);
}

// The stage announces what animal it is showing, so that label is also the
// cheapest honest check that a dog is actually a dog and not a recoloured cat.
const lastLabel = await page.getAttribute('.pp-stage canvas', 'aria-label');
check('the stage names the species it is showing', /\bbear is\b/.test(lastLabel ?? ''), lastLabel?.slice(0, 90));

await seedSave(page, `s.owned.pets = ${JSON.stringify(ALL_PETS)}; s.equipped.pet = 'biscuit';`);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const dogLabel = await page.getAttribute('.pp-stage canvas', 'aria-label');
check('equipping a dog builds a dog, not a repainted cat', /\bdog is\b/.test(dogLabel ?? ''), dogLabel?.slice(0, 90));

// Swapping species mid-session must not drop the stage or the WebGL context.
await page.goto(BASE + '/shop', { waitUntil: 'networkidle' });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
await page.evaluate(() => {
  const save = JSON.parse(localStorage.getItem('petpomo.save.v1'));
  save.equipped.pet = 'mochi';
  localStorage.setItem('petpomo.save.v1', JSON.stringify(save));
});
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const backToCat = await page.getAttribute('.pp-stage canvas', 'aria-label');
check(
  'switching back to a cat rebuilds the cat',
  /\bcat is\b/.test(backToCat ?? '') && (await catPoint(page)) != null,
  backToCat?.slice(0, 90),
);

// --------------------------------------------------------- 15. stats page
await page.goto(BASE + '/stats', { waitUntil: 'networkidle' });
check('stats renders 7-day bars', (await page.locator('svg[aria-label*="seven days"]').count()) > 0);
for (const r of ['Today', 'Week', 'All']) {
  await page.getByRole('tab', { name: r, exact: true }).click();
  await sleep(150);
}
const focusCard = await page.locator('.pp-card', { hasText: 'Focus time' }).first().innerText();
check('stats show recorded focus time', /\d/.test(focusCard), focusCard.replace(/\n/g, ' '));

// ------------------------------------------- 16. settings apply instantly
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
const focusInput = page.getByLabel('Focus in min');
await focusInput.fill('42');
await focusInput.dispatchEvent('input');
await sleep(300);
const savedFocus = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).settings.focusMin);
check('settings persist immediately', savedFocus === 42, `focusMin=${savedFocus}`);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await sleep(400);
const clock = (await page.locator('.pp-clock').innerText()).trim();
check('duration change reflected in HUD', clock === '42:00', clock);

// ----------------------------------------------------- 17. reduced motion
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByText('Reduce motion').click();
await sleep(300);
check(
  'reduced motion toggles html attribute',
  (await page.evaluate(() => document.documentElement.dataset.reducedMotion)) === 'true',
);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check('stage honours reduced motion', (await page.getAttribute('.pp-stage', 'data-reduced')) === 'true');

await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByText('Reduce motion').click();
await sleep(200);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check('stage returns to full motion', (await page.getAttribute('.pp-stage', 'data-reduced')) === 'false');

// ------------------------------------------------- 17b. clock placement
//
// Two modes and three arrangements, all sharing one markup tree. What is worth
// asserting is not the CSS but the two things a player would notice: that every
// control still works in each arrangement, and that a clock they dragged
// somewhere is still there when they come back.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check(
  'clock floats by default',
  (await page.getAttribute('.pp-hud', 'data-layout')) === 'float',
  await page.getAttribute('.pp-hud', 'data-layout'),
);

// Docked to the top: a strip of the layout, never over the stage. That
// separation is the whole reason the docked mode still exists.
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Docked', exact: true }).click();
await sleep(250); // the edge picker only exists while docked
await page.getByRole('button', { name: 'Top', exact: true }).click();
await sleep(300);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const topBox = await page.locator('.pp-hud').boundingBox();
const topStageBox = await page.locator('.pp-stage').boundingBox();
check(
  'docked to the top, the bar sits entirely above the stage',
  (await page.getAttribute('.pp-hud', 'data-layout')) === 'top' && topBox.y + topBox.height <= topStageBox.y + 1,
  `bar ends ${Math.round(topBox.y + topBox.height)}, stage starts ${Math.round(topStageBox.y)}`,
);

// The rail: docked, but down the left edge.
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Left', exact: true }).click();
await sleep(300);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const railBox = await page.locator('.pp-hud').boundingBox();
const clockStageBox = await page.locator('.pp-stage').boundingBox();
check(
  'clock docks to the left as a rail beside the stage',
  (await page.getAttribute('.pp-hud', 'data-layout')) === 'left' && railBox.x + railBox.width <= clockStageBox.x + 1,
  `rail ends at ${Math.round(railBox.x + railBox.width)}, stage starts at ${Math.round(clockStageBox.x)}`,
);

// Floating: off the layout, over the world, and movable.
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Floating', exact: true }).click();
await sleep(300);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check(
  'floating clock renders over the stage with a drag handle',
  (await page.getAttribute('.pp-hud', 'data-layout')) === 'float' && (await page.locator('.pp-grip').count()) === 1,
);

// The card starts parked in the bottom-left corner, so the room to move is up
// and to the right — dragging toward the old top-centre default would only
// press it into the clamp.
const clockBefore = await page.locator('.pp-hud').boundingBox();
const grip = await page.locator('.pp-grip').boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
await page.mouse.move(grip.x + grip.width / 2 + 260, grip.y + grip.height / 2 - 190, { steps: 20 });
await page.mouse.up();
await sleep(300);
const clockAfter = await page.locator('.pp-hud').boundingBox();
check(
  'dragging the handle moves the clock',
  clockAfter.x > clockBefore.x + 200 && clockAfter.y < clockBefore.y - 150,
  `moved ${Math.round(clockAfter.x - clockBefore.x)},${Math.round(clockAfter.y - clockBefore.y)}`,
);

const parked = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).settings);
check(
  'the parked position is stored as a fraction of the travel',
  parked.clockX > 0.05 && parked.clockX <= 1 && parked.clockY >= 0 && parked.clockY < 0.95,
  `x=${parked.clockX.toFixed(3)} y=${parked.clockY.toFixed(3)}`,
);

// A fraction, not a pixel count: the same save opened in a narrower window puts
// the card in the same *place*, still fully on screen, rather than off the edge.
await page.setViewportSize({ width: 900, height: 700 });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const narrow = await page.locator('.pp-hud').boundingBox();
const field = await page.locator('.pp-stage').boundingBox();
check(
  'the parked clock survives a reload and a resize, fully on screen',
  narrow.x >= field.x - 1 && narrow.x + narrow.width <= field.x + field.width + 1,
  `card ${Math.round(narrow.x)}..${Math.round(narrow.x + narrow.width)} in ${Math.round(field.x)}..${Math.round(field.x + field.width)}`,
);
await page.setViewportSize({ width: 1280, height: 860 });

// The point of the floating card is that it is still the command bar.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
await page.getByRole('button', { name: /^(Start|Resume)$/ }).click();
await sleep(400);
check(
  'the floating clock still drives the timer',
  (await page.getByRole('button', { name: 'Pause' }).count()) === 1,
);
await page.getByRole('button', { name: 'Pause' }).click();
await page.locator('.pp-btn[title="Reset"]').click();
await sleep(200);

// Already floating, which is the default — nothing to restore.

// --------------------------------------------------------- 17d. mood
//
// Mood is derived from the vitals, never stored, and the ordering is the part
// worth asserting: it returns worst-first, so an animal that is both ill and
// hungry reads as ill. Telling the player "grumpy" there would bury the one
// state that actually needs them to do something.
async function moodOf(page) {
  return page.getAttribute('.pp-mood', 'title');
}

for (const [name, vitals, want] of [
  ['illness outranks hunger', { health: 18, hunger: 95, happiness: 40 }, 'Unwell'],
  ['hungry and unimpressed', { health: 100, hunger: 88, happiness: 45 }, 'Grumpy'],
  ['neglected', { health: 100, hunger: 20, happiness: 10 }, 'Sad'],
  ['well looked after', { health: 100, hunger: 15, happiness: 90, lastInteractAt: 0 }, 'Happy'],
]) {
  await seedSave(page, `Object.assign(s.vitals, ${JSON.stringify(vitals)}); s.vitals.ignoredBreaks = 0;`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await stageReady(page);
  const title = await moodOf(page);
  check(`mood: ${name}`, (title ?? '').startsWith(want), title);
}

// Recent contact reads as affection — the one mood driven by *when* rather than
// by a level, so it is the one a purely threshold-based reading would miss.
await seedSave(
  page,
  `Object.assign(s.vitals, { health: 100, hunger: 20, happiness: 70, ignoredBreaks: 0 }); s.vitals.lastInteractAt = Date.now();`,
);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const affection = await moodOf(page);
check('mood: recently stroked reads as affection', (affection ?? '').startsWith('Affectionate'), affection);

// The pet panel is pinned to the top right of the stage and stays there — it is
// the readout you glance at, so it must be where it was last time you looked.
const panelAt = await page.evaluate(() => {
  const p = document.querySelector('.pp-metrics')?.getBoundingClientRect();
  const s = document.querySelector('.pp-stage')?.getBoundingClientRect();
  return p && s ? { right: Math.round(s.right - p.right), top: Math.round(p.top - s.top) } : null;
});
check(
  'the pet panel is pinned to the top right of the stage',
  !!panelAt && panelAt.right >= 0 && panelAt.right < 40 && panelAt.top >= 0 && panelAt.top < 40,
  JSON.stringify(panelAt),
);

// The countdown font and size are settings, and both have to survive the trip
// through the save — a typeface that resets on reload is worse than none.
await seedSave(page, `Object.assign(s.settings, { clockFont: 'mono', clockSize: 'lg' });`);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const typeSet = await page.evaluate(() => {
  const c = document.querySelector('.pp-clock');
  return { font: getComputedStyle(c).fontFamily.split(',')[0].trim(), px: parseFloat(getComputedStyle(c).fontSize) };
});
check(
  // The floor is calibrated to the compact square card: `lg` is 1.38× a base
  // that lands around 33px at this viewport, so anything past 40px proves the
  // size setting was applied — the old 60px floor belonged to the wide strip's
  // read-across-the-room clock.
  'the countdown typeface and size are applied from the save',
  /mono/i.test(typeSet.font) && typeSet.px > 40,
  `${typeSet.font} at ${Math.round(typeSet.px)}px`,
);

// ------------------------------------------------------- 17e. seasons
//
// The season is derived from the date and the hemisphere, and the hemisphere is
// the half worth testing: December is midsummer in Sydney, and getting it
// backwards is the kind of bug that is invisible to everyone who built it.
await page.clock.setFixedTime(new Date('2026-12-15T12:00:00'));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
check(
  'December reads as winter in the north',
  (await page.getAttribute('.pp-stage', 'data-season')) === 'winter',
  await page.getAttribute('.pp-stage', 'data-season'),
);

// Same date, southern hemisphere: the server sends the one bit that decides it.
//
// Seeded into the weather cache rather than served through a mocked route. The
// clock is frozen for this section, and a frozen clock does not run the idle
// callback the live fetch is scheduled behind — so routing the request means
// waiting for a fetch that never happens. The cache is also the path a returning
// visitor actually takes, and it is read synchronously at first paint.
await page.evaluate(() => {
  localStorage.setItem(
    'petpomo.weather.v1',
    JSON.stringify({
      at: Date.now(),
      weather: {
        ok: true,
        condition: 'clear',
        temperature: 28,
        windKph: 8,
        isDay: true,
        timezone: 'Australia/Sydney',
        hemisphere: 'south',
      },
    }),
  );
});
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
check(
  'the same December is midsummer in the south',
  (await page.getAttribute('.pp-stage', 'data-season')) === 'summer',
  await page.getAttribute('.pp-stage', 'data-season'),
);
await page.evaluate(() => localStorage.removeItem('petpomo.weather.v1'));
await page.clock.setFixedTime(new Date());

// -------------------------------------------- 17f. storms, and who they spare
//
// Lightning is the one effect here that can do harm: a strobing screen can
// trigger seizures. It is a single slow bloom minutes apart rather than a
// strobe, and reduced motion must remove it from the DOM entirely — a flash is
// not decoration that can be turned down.
const stormBody = JSON.stringify({
  ok: true,
  condition: 'storm',
  temperature: 14,
  windKph: 40,
  isDay: true,
  timezone: 'Europe/London',
  hemisphere: 'north',
});
await page.route('**/api/weather', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: stormBody }),
);
await page.evaluate(() => {
  localStorage.removeItem('petpomo.weather.v1');
  localStorage.removeItem('petpomo.weather.absent.v1');
});

await seedSave(page, `s.settings.reducedMotion = false;`);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
check(
  'a storm reaches the stage',
  (await page.getAttribute('.pp-stage', 'data-weather')) === 'storm',
  await page.getAttribute('.pp-stage', 'data-weather'),
);
// The first strike is scheduled 9-23s out, so this waits rather than guesses.
await page
  .waitForSelector('.pp-lightning', { timeout: 30_000 })
  .catch(() => {});
check('lightning strikes during a storm', (await page.locator('.pp-lightning').count()) === 1);

await seedSave(page, `s.settings.reducedMotion = true;`);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
await sleep(26_000);
check(
  'reduced motion removes the lightning entirely, not just its speed',
  (await page.locator('.pp-lightning').count()) === 0,
);
await seedSave(page, `s.settings.reducedMotion = false;`);
await page.unroute('**/api/weather');

// -------------------------------------------------- 17g. the clock resizes
//
// A window you can move but not size is half a window. The width is stored in
// pixels while the position is stored as a fraction, and that asymmetry is
// deliberate: a size is a judgement that should survive a change of screen,
// where a position has to scale or it ends up off the edge.
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
// The natural width of the square card sits at (or near) the minimum, so the
// direction with room in it is outward — shrinking would only press the
// handle into the floor and prove nothing.
const widthBefore = (await page.locator('.pp-hud').boundingBox()).width;
const handle = await page.locator('.pp-resize').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(handle.x + handle.width / 2 + 200, handle.y + handle.height / 2, { steps: 14 });
await page.mouse.up();
await sleep(400);
const widthAfter = (await page.locator('.pp-hud').boundingBox()).width;
const storedW = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).settings.clockW);
check(
  'dragging the corner resizes the clock and the size is kept',
  widthAfter > widthBefore + 100 && Math.abs(storedW - widthAfter) < 4,
  `${Math.round(widthBefore)} -> ${Math.round(widthAfter)}, stored ${storedW}`,
);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);
const widthReloaded = (await page.locator('.pp-hud').boundingBox()).width;
check(
  'the resized clock comes back the same size',
  Math.abs(widthReloaded - widthAfter) < 4,
  `${Math.round(widthReloaded)} vs ${Math.round(widthAfter)}`,
);
await seedSave(page, `s.settings.clockW = 0;`);

// ------------------------------------------------- 17h. a pinned world
//
// The three world switches are the one place a setting overrules reality, so
// the test has to prove both halves: that a pin is obeyed, and that clearing it
// hands the world back. Asserted on the stage's data attributes rather than the
// chips, because the chips are copy and the stage is what the engine draws.
//
// The clock is frozen at a July midday in the north — a time that is emphatically
// not night and a date that is emphatically not winter — so a pin that silently
// did nothing could not pass by coincidence.
await page.clock.setFixedTime(new Date('2026-07-15T12:00:00'));
await seedSave(
  page,
  `Object.assign(s.settings, { phaseMode: 'night', weatherMode: 'snow', seasonMode: 'winter' });`,
);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
const pinned = await page.evaluate(() => ({
  phase: document.querySelector('.pp-stage').dataset.phase,
  weather: document.querySelector('.pp-stage').dataset.weather,
  season: document.querySelector('.pp-stage').dataset.season,
}));
check(
  'a pinned world overrules the real one',
  pinned.phase === 'night' && pinned.weather === 'snow' && pinned.season === 'winter',
  JSON.stringify(pinned),
);

// Back to auto: the July midday has to come back, which is what proves the
// override is a view over reality and not a write into it.
await seedSave(
  page,
  `Object.assign(s.settings, { phaseMode: 'auto', weatherMode: 'auto', seasonMode: 'auto' });`,
);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
const released = await page.evaluate(() => ({
  phase: document.querySelector('.pp-stage').dataset.phase,
  season: document.querySelector('.pp-stage').dataset.season,
}));
check(
  'clearing the pins gives reality back',
  released.phase === 'noon' && released.season === 'summer',
  JSON.stringify(released),
);
await page.clock.setFixedTime(new Date());

// --------------------------------------------- 17i. the wall clock
//
// Four faces: the player's own zone, which comes from the browser and is never
// in the save, plus the three they picked. Asserted on `data-time`, which each
// dial carries precisely so a test does not have to read hand angles off an SVG.
await seedSave(
  page,
  `Object.assign(s.settings, { showClock: true, clockZones: ['UTC', 'Asia/Tokyo', 'America/New_York'] });`,
);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
const dials = await page.$$eval('.pp-dial', (els) =>
  els.map((e) => ({ zone: e.dataset.zone, time: e.dataset.time, label: e.querySelector('.pp-dial-label')?.textContent })),
);
check(
  'the wall clock draws the local zone plus every chosen one',
  dials.length === 4 && ['UTC', 'Asia/Tokyo', 'America/New_York'].every((z) => dials.some((d) => d.zone === z)),
  JSON.stringify(dials.map((d) => d.zone)),
);
// The times have to actually differ by the right amount, or four identical
// dials would pass the check above. UTC and Tokyo are nine hours apart and
// neither observes daylight saving, so this holds on every date.
const gap = (a, b) => {
  const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return ((mins(b) - mins(a) + 1440) % 1440) / 60;
};
const utc = dials.find((d) => d.zone === 'UTC')?.time ?? '';
const tokyo = dials.find((d) => d.zone === 'Asia/Tokyo')?.time ?? '';
check('each dial shows its own zone, nine hours apart', gap(utc, tokyo) === 9, `UTC ${utc} vs Tokyo ${tokyo}`);
check(
  'every dial is labelled and named for a screen reader',
  dials.every((d) => (d.label ?? '').length > 0) &&
    (await page.locator('.pp-dial svg[aria-label]').count()) === 4,
  JSON.stringify(dials.map((d) => d.label)),
);
// A widget that overruns the corner is not the small widget that was asked for.
const clockBox = await page.locator('.pp-wallclock').boundingBox();
check(
  'the wall clock stays small',
  clockBox.width <= 260 && clockBox.height <= 70,
  `${Math.round(clockBox.width)}x${Math.round(clockBox.height)}`,
);

// A save is not always something this player wrote, and a zone id is a string
// from a file. `Intl` throws on a bad one, and an exception thrown while
// painting the corner would take the island down with it.
await seedSave(
  page,
  `Object.assign(s.settings, { showClock: true, clockZones: ['Mars/Olympus', 'UTC', 42, 'UTC', 'Asia/Tokyo', 'Europe/Paris', 'Europe/Berlin'] });`,
);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
const hostileZones = await page.$$eval('.pp-dial', (els) => els.map((e) => e.dataset.zone));
const storedZones = await page.evaluate(
  () => JSON.parse(localStorage.getItem('petpomo.save.v1')).settings.clockZones,
);
check(
  'invalid, duplicate and excess zones are dropped, not defaulted',
  storedZones.length === 3 &&
    !storedZones.includes('Mars/Olympus') &&
    new Set(storedZones).size === storedZones.length &&
    hostileZones.length === 4,
  `stored=${JSON.stringify(storedZones)} drawn=${hostileZones.length}`,
);

// ------------------------------------------------- 17j. widget switches
//
// Each of the four overlays comes off independently, and the stage survives all
// four being gone — the painting and the animal are the app, the rest is furniture.
for (const [key, selector, name] of [
  ['showWorld', '.pp-world', 'world readout'],
  ['showPet', '.pp-metrics', 'pet panel'],
  ['showClock', '.pp-wallclock', 'wall clock'],
  ['showTimer', '.pp-hud', 'timer card'],
]) {
  await seedSave(page, `s.settings.${key} = false;`);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await stageReady(page);
  check(`${name} switches off`, (await page.locator(selector).count()) === 0);
  await seedSave(page, `s.settings.${key} = true;`);
}

// All four off at once: no overlay left, and the pet still renders and still
// takes a click. This is the combination most likely to throw on a null node.
await seedSave(
  page,
  `Object.assign(s.settings, { showWorld: false, showPet: false, showTimer: false, showClock: false });`,
);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await stageReady(page);
const bare = await page.evaluate(() => ({
  overlays: document.querySelectorAll('.pp-world, .pp-metrics, .pp-hud, .pp-wallclock').length,
  stage: !!document.querySelector('.pp-stage canvas'),
}));
check('a bare stage keeps the painting and the pet', bare.overlays === 0 && bare.stage, JSON.stringify(bare));

// With no timer card there is no start button, so the space bar has to work —
// otherwise hiding a widget makes the app unusable.
const beforeSpace = await page.evaluate(() => document.querySelector('.pp-stage').dataset.petState);
await page.locator('.pp-stage').click({ position: { x: 8, y: 8 } });
await page.keyboard.press('Space');
const afterSpace = await waitForPetState(page, 'sleeping', 4000);
check(
  'with the timer hidden, space starts a session',
  afterSpace === 'sleeping',
  `${beforeSpace} -> ${afterSpace}`,
);
await page.keyboard.press('Space');
await sleep(400);
await seedSave(
  page,
  `Object.assign(s.settings, { showWorld: true, showPet: true, showTimer: true, showClock: false, clockZones: [] });`,
);
// The timer is persisted separately from the save, so restoring the settings
// would otherwise leave a paused focus session for the next section to inherit.
await page.evaluate(() => localStorage.removeItem('petpomo.timer.v1'));

// ------------------------------------ 17c. a hostile save cannot break the app
//
// A save is not always something this player wrote. It arrives from /api/load
// under a sync code that can be shared, and an imported file is one a stranger
// can hand you. `hydrate` is the boundary, so this feeds it the shapes an
// attacker would actually try — unknown ids, wrong types, prototype pollution,
// values engineered to make later arithmetic produce NaN — and asserts the app
// comes up normalised rather than broken.
await page.goto(BASE + '/about', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => {
  localStorage.setItem(
    'petpomo.save.v1',
    JSON.stringify({
      coins: '999999999',
      owned: {
        scenes: ['livingroom', 'not-a-scene', { toString: 'nope' }, 42],
        themes: 'vangogh',
        pets: null,
        snacks: ['__proto__', 'constructor'],
      },
      equipped: { scene: 'not-a-scene', theme: '"><img src=x>', pet: '__proto__', snack: 7 },
      settings: {
        focusMin: 'abc',
        volMaster: 9e99,
        muted: 'yes',
        reducedMotion: 1,
        clockMode: 'off-screen',
        clockDock: '"><img src=x>',
        clockX: 99,
        clockY: -3,
      },
      vitals: { hunger: NaN, happiness: -500, health: 'sick', ignoredBreaks: 'lots', lastInteractAt: -1 },
      sessions: [{ at: 'now', ms: {}, mode: 'evil' }, null, 5],
      __proto__: { polluted: true },
    }),
  );
});
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await stageReady(page);

const hostile = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('petpomo.save.v1'));
  return {
    scene: document.querySelector('.pp-stage')?.dataset.scene,
    theme: document.documentElement.className,
    equipped: s.equipped,
    owned: s.owned,
    coins: s.coins,
    focusMin: s.settings.focusMin,
    clock: {
      mode: s.settings.clockMode,
      dock: s.settings.clockDock,
      x: s.settings.clockX,
      y: s.settings.clockY,
    },
    layout: document.querySelector('.pp-hud')?.dataset.layout,
    sessions: s.sessions.length,
    polluted: {}.polluted === true,
  };
});

check(
  'hostile save falls back to valid ids',
  hostile.equipped.scene === 'livingroom' &&
    hostile.equipped.theme === 'playful' &&
    hostile.equipped.pet === 'mochi' &&
    hostile.equipped.snack === 'fish',
  JSON.stringify(hostile.equipped),
);
check(
  'hostile save cannot invent owned items',
  hostile.owned.scenes.every((s) => ['livingroom', 'garden', 'jungle', 'treehouse', 'mountain', 'snow'].includes(s)) &&
    hostile.owned.snacks.every((s) => ['fish', 'cookie', 'milk', 'sushi'].includes(s)),
  JSON.stringify(hostile.owned),
);
check(
  'hostile save numbers are coerced, not trusted',
  hostile.coins === 0 && hostile.focusMin === 25 && hostile.sessions === 0,
  `coins=${hostile.coins} focusMin=${hostile.focusMin} sessions=${hostile.sessions}`,
);
check('hostile save does not pollute Object.prototype', hostile.polluted === false);
// A clock placement is as untrusted as anything else in the save, and the
// failure it would cause is particular: a card parked at x=99 is a command bar
// the player cannot see, reach, or drag back.
check(
  'hostile clock placement falls back to a visible default',
  hostile.clock.mode === 'float' &&
    hostile.clock.dock === 'top' &&
    hostile.clock.x >= 0 &&
    hostile.clock.x <= 1 &&
    hostile.clock.y >= 0 &&
    hostile.clock.y <= 1 &&
    hostile.layout === 'float',
  `${JSON.stringify(hostile.clock)} layout=${hostile.layout}`,
);
// The root class matters on its own: boot.js runs before hydrate can sanitise
// anything, so it has to validate the theme itself or a hostile save gets to
// staple arbitrary classes onto <html>.
check(
  'stage renders with a hostile save, and the root class is clean',
  hostile.scene === 'livingroom' && hostile.theme.trim() === 'theme-playful',
  `scene=${hostile.scene} html="${hostile.theme}"`,
);

// Put a clean save back so the sections below are not reading wreckage.
await seedSave(page, 's.coins = 5000;');

// ------------------------------------------------- 18. export / import
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'Export JSON' }).click();
const download = await dl;
check('export produces a save file', (await download.path()) != null, download.suggestedFilename());

// ----------------------------------------------------------- 19. offline
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);
const swReady = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
check('service worker active', swReady);
if (swReady) {
  await ctx.setOffline(true);
  const resp = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }).catch((e) => e);
  const okOffline = !(resp instanceof Error);
  let catOffline = false;
  if (okOffline) {
    catOffline = await page
      .waitForSelector('.pp-stage[data-webgl="true"] canvas', { timeout: 12000 })
      .then(() => true)
      .catch(() => false);
  }
  check('game loads and renders offline', okOffline && catOffline, `nav=${okOffline} stage=${catOffline}`);
  await ctx.setOffline(false);
}

// ------------------------------------------------------------ 19b. gifts
await page.goto(BASE + '/gifts', { waitUntil: 'networkidle' });
await page.waitForSelector('.gift-envelope', { timeout: 8000 });
const sealed = await page.locator('.gift-envelope').count();
check('gift letters render sealed', sealed >= 1, `${sealed} envelopes`);

// The welcome treat: open the envelope, claim it, and the coins land in the
// same profile save the shop spends from.
const coinsBeforeGift = await page.evaluate(
  () => JSON.parse(localStorage.getItem('petpomo.save.v1') || '{}').coins ?? 0,
);
await page.getByRole('button', { name: /A little welcome pouch/ }).click();
await page.waitForSelector('.gift-letter', { timeout: 4000 });
await page.getByRole('button', { name: /^Claim/ }).first().click();
await sleep(800); // profile writes are debounced
const coinsAfterGift = await page.evaluate(
  () => JSON.parse(localStorage.getItem('petpomo.save.v1') || '{}').coins ?? 0,
);
check(
  'claiming a treat letter pays its coins',
  coinsAfterGift === coinsBeforeGift + 30,
  `${coinsBeforeGift} -> ${coinsAfterGift}`,
);

// Claiming is once per device: after a reload the letter stays open and the
// claim button is a "Claimed" label instead.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.gift-letter', { timeout: 8000 });
const claimedLabel = await page.getByText('Claimed 🪙 30').count();
check('claimed treat stays claimed after reload', claimedLabel === 1, `${claimedLabel} labels`);

// Expired letters are never deleted — they live behind the Expired chip,
// faded and stamped.
await page.getByRole('button', { name: '🥀 Expired' }).click();
const expiredEnvelope = await page.getByRole('button', { name: /Sunflower week/ }).count();
const stamped = await page.locator('.gift-stamp').count();
check('expired filter shows the wilted letter, stamped', expiredEnvelope >= 1 && stamped >= 1, `env=${expiredEnvelope} stamps=${stamped}`);

// ------------------------------------------------------------ 20. errors
check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 6).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) {
  console.log('FAILURES:');
  failed.forEach((f) => console.log(` - ${f.name}: ${f.detail}`));
  process.exit(1);
}
