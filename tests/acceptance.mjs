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

// -------------------- 2b. every control sits above the stage, not over it
const hudBox = await page.locator('.pp-hud').boundingBox();
const stageBox = await page.locator('.pp-stage').boundingBox();
check(
  'HUD sits entirely above the stage',
  hudBox.y + hudBox.height <= stageBox.y + 1,
  `hud ends ${Math.round(hudBox.y + hudBox.height)}, stage starts ${Math.round(stageBox.y)}`,
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
for (const id of ['livingroom', 'garden', 'jungle', 'treehouse']) {
  await seedSave(
    page,
    `s.owned.scenes = ['livingroom','garden','jungle','treehouse']; s.equipped.scene = '${id}';`,
  );
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await stageReady(page);
  const mounted = (await page.getAttribute('.pp-stage', 'data-scene')) === id;
  const visible = (await catPoint(page)) != null;
  check(`scene ${id} builds and frames the cat`, mounted && visible, `mounted=${mounted} catVisible=${visible}`);
}

// -------------------------------------------------------- 14. cat skins
for (const pet of ['mochi', 'shadow', 'cloud', 'inky']) {
  await seedSave(page, `s.owned.pets = ['mochi','shadow','cloud','inky']; s.equipped.pet = '${pet}';`);
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await stageReady(page);
  check(`skin ${pet} equips without tearing down the stage`, (await catPoint(page)) != null);
}

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
