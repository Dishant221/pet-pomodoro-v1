/**
 * Talking to the pet, end to end, against a real deploy.
 *
 * Separate from `acceptance.mjs` and deliberately not in CI: this drives
 * /api/ask, which is the one endpoint that spends money per call and is rate
 * limited to 6 a minute. Run it by hand after touching the companion, the stage
 * or the talk store.
 *
 *   PETPOMO_BASE=https://preview.petpomo.pages.dev npm run test:talk
 *
 * It exists because every fault it checks for shipped silently. The reply was
 * being clipped away by `contain: paint`, the microphone was welded to a moving
 * element, the text field never rendered in Chrome, and the worker was reading
 * the wrong field off the model's response — four separate breakages, none of
 * which any existing test could see, because nothing asserted that talking to
 * the pet produced anything a player could actually perceive.
 *
 * The microphone itself is not covered: driving real speech recognition needs
 * audio input this cannot fake. The typed path shares everything downstream of
 * the transcript, which is where all four faults were.
 */
import { chromium } from 'playwright';

const BASE = process.env.PETPOMO_BASE;
if (!BASE) {
  console.error('PETPOMO_BASE is required, e.g. https://preview.petpomo.pages.dev');
  process.exit(2);
}

const b = await chromium.launch({ channel: 'msedge' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Cloudflare injects its Web Analytics beacon into preview deployments, and
  // the page's own CSP blocks it — correctly, since the privacy page promises no
  // analytics trackers. That refusal is the policy working, not a fault, so it
  // is not counted here. Anything else still fails the run.
  if (m.text().includes('cloudflareinsights.com')) return;
  errs.push(m.text());
});

let failed = 0;
const ok = (n, c, d = '') => {
  if (!c) failed++;
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);

// --- stage mode (the default) ---
ok('control exists in stage mode', await p.locator('.pp-talk').count() > 0);
const before = await p.evaluate(() => document.querySelector('.pp-stage')?.dataset.petState);

await p.locator('.pp-talk-open').click();
await p.locator('.pp-talk-form input').fill('you are such a good girl');
await p.locator('.pp-talk-send').click();

// A real reply, not the thinking ellipsis.
const reply = await p.waitForFunction(() => {
  const t = document.querySelector('.pp-talk-bubble')?.textContent?.trim();
  return t && t !== '…' && t !== 'listening…' ? t : false;
}, null, { timeout: 25000 }).then((h) => h.jsonValue()).catch(() => null);

ok('a typed question gets a visible reply', !!reply, reply || 'no bubble text appeared');

// Poll rather than sample once: the reaction is held for a few seconds and then
// hands control back, so a single read can land either side of it.
const after = await p
  .waitForFunction(
    (was) => {
      const s = document.querySelector('.pp-stage')?.dataset.petState;
      return s && s !== was ? s : false;
    },
    before,
    { timeout: 6000 },
  )
  .then((h) => h.jsonValue())
  .catch(() => null);

ok('the stage pet acts on the reply', !!after, after ? `${before} -> ${after}` : `${before}, unchanged`);

// --- screen mode ---
await p.goto(BASE + '/about', { waitUntil: 'networkidle' });
await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('petpomo.save.v1'));
  s.settings.petMode = 'screen';
  localStorage.setItem('petpomo.save.v1', JSON.stringify(s));
});
await p.goto(BASE + '/', { waitUntil: 'networkidle' });
await p.waitForTimeout(4500);

ok('control exists in screen mode', await p.locator('.pp-talk').count() > 0);
ok('on-screen pet is mounted', await p.locator('.pp-companion').count() > 0);

// Does it stay put? Sample the transform over several seconds.
const xs = [];
for (let i = 0; i < 8; i++) {
  xs.push(await p.evaluate(() => {
    const el = document.querySelector('.pp-companion');
    const m = el && getComputedStyle(el).transform.match(/matrix.*?\(([^)]+)\)/);
    return m ? Math.round(parseFloat(m[1].split(',')[4] ?? '0')) : null;
  }));
  await p.waitForTimeout(900);
}
const spread = Math.max(...xs) - Math.min(...xs);
ok('the pet stays where it was put', spread <= 4, `x drift over ~7s = ${spread}px  ${JSON.stringify(xs)}`);

ok('no console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await b.close();

console.log(failed === 0 ? '\n==== all checks passed ====' : `\n==== ${failed} check(s) failed ====`);
process.exit(failed === 0 ? 0 : 1);
