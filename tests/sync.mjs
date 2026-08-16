import { chromium } from 'playwright';

const BASE = 'http://localhost:4332';
const out = [];
const errs = [];
const check = (n, ok, d = '') => {
  out.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One test deliberately provokes a 429, and the browser logs every failed
 * response to the console whether or not the page handled it. That one line is
 * expected; suppressing it is only safe because it is matched narrowly and
 * only while the test that causes it is running — a blanket filter on "429" or
 * on resource errors would hide the next real one.
 */
let expect429 = false;
const isExpected = (text) => expect429 && /Failed to load resource/.test(text) && /429/.test(text);

/**
 * Wait for the settings status line to say something matching `re`, and return
 * whatever it ended up saying.
 *
 * The element is long-lived — it holds the last thing the panel said, for a few
 * seconds after it said it — so waiting for it to *exist* proves nothing beyond
 * the first message, and a fixed sleep either reads the previous message or
 * waits longer than the thing being timed. Polling the text is what actually
 * ties an assertion to the click that caused it.
 */
async function waitForStatus(page, re, timeout = 4000) {
  await page
    .waitForFunction(
      (src) => new RegExp(src).test(document.querySelector('[role="status"]')?.innerText ?? ''),
      re.source,
      { timeout, polling: 50 },
    )
    .catch(() => {
      /* fall through — the caller reports whatever it actually said */
    });
  return page.locator('[role="status"]').innerText();
}

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && !isExpected(m.text()) && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

// Seed a distinctive save on device A.
await page.goto(BASE + '/about', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('petpomo.save.v1') || '{}');
  s.coins = 4242;
  s.equipped = { scene: 'treehouse', theme: 'vangogh', pet: 'inky', snack: 'sushi' };
  s.owned = {
    scenes: ['livingroom', 'garden', 'jungle', 'treehouse'],
    themes: ['playful', 'ghibli', 'anime', 'vangogh'],
    pets: ['mochi', 'shadow', 'cloud', 'inky'],
    snacks: ['fish', 'cookie', 'milk', 'sushi'],
  };
  localStorage.setItem('petpomo.save.v1', JSON.stringify(s));
});

await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Generate' }).click();
await sleep(300);
const code = await page.evaluate(() => localStorage.getItem('petpomo.syncCode.v1'));
check('generate produces a sync code', !!code && code.length >= 16, code);

await page.getByRole('button', { name: 'Upload' }).click();
const upMsg = await waitForStatus(page, /Uploaded|Upload failed/, 10000);
check('upload succeeds', upMsg.includes('Uploaded'), upMsg);

// A refusal has to arrive as a reason, not a number.
//
// The API rate-limits writes, so 429 is a state a real player can reach —
// notably on a shared office or carrier-grade-NAT address, having done nothing
// wrong. The server answers those with a sentence explaining what happened;
// this asserts the sentence survives the trip to the screen instead of being
// flattened into "server said 429", which tells the player nothing they can
// act on. Clicking Upload straight after the last one trips the per-code write
// interval, which is the cheapest refusal to provoke.
//
// Both waits here are polls rather than sleeps, and that is the whole trick.
// The refusal only happens if the second click lands inside the server's
// one-second window, so any fixed sleep has to be long enough for the response
// to arrive and short enough to stay inside that window — a gap that closes on
// a slow machine and takes the test with it.
expect429 = true;
await page.getByRole('button', { name: 'Upload' }).click();
const rateMsg = await waitForStatus(page, /too many/);
check(
  'a rate-limited upload explains itself',
  rateMsg.includes('too many writes') && !rateMsg.includes('429'),
  rateMsg,
);

await sleep(1200); // let the write window clear before the next real upload
expect429 = false;

// Wipe device A completely, then restore from the code.
await page.getByRole('button', { name: 'Reset all progress' }).click();
await page.getByRole('button', { name: 'Yes, erase everything' }).click();
await sleep(500);
const wiped = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).coins);
check('reset clears progress', wiped === 0, `coins=${wiped}`);

await sleep(1200); // clear the server-side write window
await page.getByRole('button', { name: 'Download' }).click();
await sleep(1200);
const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')));
check('download restores coins', restored.coins === 4242, `coins=${restored.coins}`);
check('download restores equipped items', restored.equipped.scene === 'treehouse' && restored.equipped.theme === 'vangogh', JSON.stringify(restored.equipped));
const themeApplied = await page.evaluate(() => document.documentElement.className);
check('downloaded theme applies immediately', themeApplied === 'theme-vangogh', themeApplied);

// A second "device" with the same code pulls the same save.
const page2 = await ctx.browser().newContext().then((c) => c.newPage());
await page2.goto(BASE + '/about', { waitUntil: 'networkidle' });
await page2.evaluate((c) => localStorage.setItem('petpomo.syncCode.v1', c), code);
await page2.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page2.getByRole('button', { name: 'Download' }).click();
await sleep(1500);
const onB = await page2.evaluate(() => JSON.parse(localStorage.getItem('petpomo.save.v1')).coins);
check('second device pulls the same save', onB === 4242, `coins=${onB}`);

// A wrong code must not leak anything.
await page2.evaluate(() => localStorage.setItem('petpomo.syncCode.v1', 'wrongcodewrongcodewrong1'));
await page2.reload({ waitUntil: 'networkidle' });
await page2.getByRole('button', { name: 'Download' }).click();
const msg2 = await waitForStatus(page2, /Download/);
check('unknown code returns a clean miss', msg2.includes('nothing saved'), msg2);

check('zero console errors', errs.length === 0, errs.slice(0, 4).join(' | '));

await browser.close();
const failed = out.filter((r) => !r.ok);
console.log(`\n==== ${out.length - failed.length}/${out.length} passed ====`);
if (failed.length) process.exit(1);
