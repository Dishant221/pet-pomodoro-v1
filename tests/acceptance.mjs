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

async function coins(page) {
  const t = await page.locator('.pp-chip[title="Coins"] span').last().innerText();
  return Number(t.trim());
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
check('snack handle lives in the top bar', (await page.locator('.pp-hud .pp-snack').count()) === 1);
check('starts idle', (await petState(page)) === 'idle', `state=${await petState(page)}`);

// ------------------------- 2b. the page is exactly one screen and does not scroll
//
// The game page owns the whole viewport. It used to size its own stage to
// `100dvh - 3.25rem`, which subtracted the header and forgot the footer, so the
// page scrolled and the pet hung off the bottom of it. Nothing about that looks
// broken in a screenshot of the top of the page, which is why it is asserted.
const pageFits = await page.evaluate(() => ({
  scrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  scrollH: document.documentElement.scrollHeight,
  clientH: document.documentElement.clientHeight,
}));
check(
  'the game page fits one viewport and does not scroll',
  !pageFits.scrolls,
  `scrollHeight=${pageFits.scrollH} clientHeight=${pageFits.clientH}`,
);

// The advertising slot is reserved before there is anything in it, so that
// filling it later shifts nothing.
const adH = await page.evaluate(() => document.querySelector('.pp-adslot')?.getBoundingClientRect().height ?? 0);
check('the ad slot reserves its space up front', adH >= 50, `${Math.round(adH)}px`);

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
await page.getByRole('button', { name: 'Start', exact: true }).click();
await sleep(600);
check('focus start puts cat to sleep', (await petState(page)) === 'sleeping', `state=${await petState(page)}`);
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
await sleep(700);
check('abandoning a focus session -> sad', (await petState(page)) === 'sad', `state=${await petState(page)}`);

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

const clockBefore = await page.locator('.pp-hud').boundingBox();
const grip = await page.locator('.pp-grip').boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
await page.mouse.move(grip.x + grip.width / 2 + 260, grip.y + grip.height / 2 + 190, { steps: 20 });
await page.mouse.up();
await sleep(300);
const clockAfter = await page.locator('.pp-hud').boundingBox();
check(
  'dragging the handle moves the clock',
  clockAfter.x > clockBefore.x + 200 && clockAfter.y > clockBefore.y + 150,
  `moved ${Math.round(clockAfter.x - clockBefore.x)},${Math.round(clockAfter.y - clockBefore.y)}`,
);

const parked = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).settings);
check(
  'the parked position is stored as a fraction of the travel',
  parked.clockX > 0.5 && parked.clockX <= 1 && parked.clockY > 0.04 && parked.clockY <= 1,
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
      vitals: { hunger: NaN, happiness: -500, ignoredBreaks: 'lots', lastInteractAt: -1 },
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
