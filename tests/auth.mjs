import { execSync } from 'node:child_process';
import { chromium } from 'playwright';

/**
 * Accounts end to end, against the real Worker (`npm run dev:full`, port
 * 4332, after `npm run db:local`): create account, save adoption, sign-out/
 * sign-in, a second device pulling the account save, and the admin role
 * gate. Follows the sync.mjs house rules: poll status text, never sleep at
 * a fixed length; expected 4xx console lines are matched narrowly and only
 * while the step that causes them runs.
 */

const BASE = 'http://localhost:4332';
const out = [];
const errs = [];
const check = (n, ok, d = '') => {
  out.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`);
};

/** 401 (wrong password), 404 (no account save yet) and 403 (admin gate) are
 * each provoked deliberately by exactly one step below. */
let expected = null; // e.g. /40[14]/
const isExpected = (text) =>
  expected && /Failed to load resource/.test(text) && expected.test(text);

const email = `t${Date.now()}@example.com`;
const password = process.env.PETPOMO_TEST_PASSWORD || 'horse-correct-battery-9'; // fixture only; override to avoid a public password on preview accounts

/**
 * Sign in on `p`, tolerating better-auth's own limiter: /sign-in/email allows
 * 3 requests per 10 s per address, and this suite legitimately signs in more
 * often than a human. One retry after the window is the whole strategy.
 */
async function signInExpectingProfile(p) {
  for (let attempt = 0; attempt < 2; attempt++) {
    expected = /429/;
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    const landed = await p
      .waitForURL('**/profile/', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    expected = null;
    if (landed) return true;
    await new Promise((r) => setTimeout(r, 11_000)); // the limiter's window
  }
  return false;
}

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && !isExpected(m.text()) && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));

// --- 1. the login page renders both modes -----------------------------------
await page.goto(BASE + '/login/', { waitUntil: 'networkidle' });
check('login page shows sign-in and create-account tabs',
  (await page.locator('[role="tab"]').count()) === 2);
check('painted wallpaper is on the login page',
  (await page.locator('.pp-wall svg').count()) >= 3);

// --- 2. a distinctive local save, then a new account adopts it ---------------
await page.goto(BASE + '/about/', { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('petpomo.save.v1') || '{}');
  s.coins = 4242;
  localStorage.setItem('petpomo.save.v1', JSON.stringify(s));
  localStorage.setItem('petpomo.savedAt.v1', String(Date.now()));
});

await page.goto(BASE + '/login/', { waitUntil: 'networkidle' });
await page.getByRole('tab', { name: 'Create account' }).click();
await page.getByLabel('Name').fill('Test Player');
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
expected = /40[14]/; // adoption GETs /api/me/save before the row exists
await page.getByRole('button', { name: 'Create account', exact: true }).click();
await page.waitForURL('**/profile/', { timeout: 15000 });
expected = null;
check('signup lands on the profile page', page.url().includes('/profile'));
// The profile card asks the server who we are on mount — wait for the answer,
// not for the page load.
await page.locator(`text=${email}`).first().waitFor({ timeout: 8000 }).catch(() => {});
check('profile shows the signed-in email',
  await page.locator(`text=${email}`).first().isVisible().catch(() => false), email);

// --- 3. the local save became the account save -------------------------------
const saved = await page.request.get(BASE + '/api/me/save');
const savedBody = saved.ok() ? await saved.json() : null;
check('the local save was adopted into the account',
  savedBody?.profile?.coins === 4242, `coins=${savedBody?.profile?.coins}`);

// --- 4. nav shows the avatar; sign out returns it to a link ------------------
await page.goto(BASE + '/about/', { waitUntil: 'networkidle' });
const avatar = page.getByRole('button', { name: 'Account menu' });
await avatar.waitFor({ timeout: 5000 }).catch(() => {});
check('nav shows the account avatar while signed in', await avatar.isVisible().catch(() => false));
await avatar.click();
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.getByText('Sign in', { exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
check('sign out returns the nav to a sign-in link',
  await page.getByText('Sign in', { exact: true }).isVisible().catch(() => false));

// --- 5. wrong password refuses in words, right one signs in ------------------
await page.goto(BASE + '/login/', { waitUntil: 'networkidle' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill('not-the-password-1');
expected = /401/;
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await page
  .waitForFunction(() => /failed/i.test(document.querySelector('[role="status"]')?.textContent ?? ''), {
    timeout: 8000,
  })
  .catch(() => {});
expected = null;
const refusal = await page.locator('[role="status"]').innerText();
check('a wrong password is refused with a sentence', /failed/i.test(refusal), refusal.trim());

await page.getByLabel('Password').fill(password);
check('the right password signs in', await signInExpectingProfile(page));

// --- 6. a second device pulls the account save --------------------------------
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage();
page2.on('console', (m) => m.type() === 'error' && !isExpected(m.text()) && errs.push(m.text()));
await page2.goto(BASE + '/login/', { waitUntil: 'networkidle' });
await page2.getByLabel('Email').fill(email);
await page2.getByLabel('Password').fill(password);
await signInExpectingProfile(page2);
const coins2 = await page2.evaluate(
  () => JSON.parse(localStorage.getItem('petpomo.save.v1') || '{}')?.coins,
);
check('a fresh device pulls the account save on sign-in', coins2 === 4242, `coins=${coins2}`);
await ctx2.close();

// --- 7. the admin gate ---------------------------------------------------------
expected = /403/;
const asUser = await page.request.get(BASE + '/api/admin/ping');
check('admin ping refuses a normal user', asUser.status() === 403, `status=${asUser.status()}`);
expected = null;

execSync(
  `npx wrangler d1 execute petpomo --local --command "UPDATE \\"user\\" SET role='admin' WHERE email='${email}'"`,
  { cwd: new URL('..', import.meta.url), stdio: 'ignore' },
);
// Sessions cache the user snapshot; promotion applies at the next sign-in.
await page.goto(BASE + '/about/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Account menu' }).click();
await page.getByRole('menuitem', { name: 'Sign out' }).click();
await page.getByText('Sign in', { exact: true }).waitFor({ timeout: 8000 }).catch(() => {});
await page.goto(BASE + '/login/', { waitUntil: 'networkidle' });
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password').fill(password);
await signInExpectingProfile(page);
const asAdmin = await page.request.get(BASE + '/api/admin/ping');
check('admin ping answers the promoted account after a fresh sign-in',
  asAdmin.status() === 200, `status=${asAdmin.status()}`);

// --- 8. console stayed clean ---------------------------------------------------
check('zero console errors', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close();
const passed = out.filter((o) => o.ok).length;
console.log(`\n==== ${passed}/${out.length} passed ====`);
if (passed !== out.length) {
  console.log('FAILURES:');
  for (const o of out.filter((x) => !x.ok)) console.log(` - ${o.n}`);
  process.exit(1);
}
