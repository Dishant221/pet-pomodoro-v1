import { execSync } from 'node:child_process';

/**
 * The moderation pipeline, end to end at the API level — no browser, just
 * fetch against the real Worker (`npm run db:local` once, then
 * `npm run dev:full`). Covers what MODERATION.md promises: the sanitizer's
 * rejections (including unicode cloaking), the pending → approve → visible
 * lifecycle, the admin gate, ban behaviour, the contact honeypot, and the
 * rate limit.
 *
 * Creates its own throwaway accounts; the admin promotion runs through
 * `wrangler d1 execute --local`, same as tests/auth.mjs.
 *
 * Rerun hygiene: valid submissions share a 5-per-10-minutes-per-IP budget
 * (rate table in the local D1). Rerunning this suite inside the same
 * 10-minute window starts with budget already spent and can trip the limiter
 * early — wait out the window, or:
 *   npx wrangler d1 execute petpomo --local --command "DELETE FROM rate"
 */

const BASE = 'http://localhost:4332';
const out = [];
const check = (n, ok, d = '') => {
  out.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `  — ${d}` : ''}`);
};

// `origin` mimics the browser: better-auth's CSRF protection refuses
// state-changing POSTs whose Origin header is missing (MISSING_OR_NULL_ORIGIN).
const json = (method, path, body, cookie) =>
  fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Sign a fresh account in and hand back its session cookie. One retry after
 * better-auth's 10 s rate window — this suite bursts requests no human would. */
async function makeAccount(email, password) {
  for (let attempt = 0; ; attempt++) {
    const res = await json('POST', '/api/auth/sign-up/email', { email, password, name: email.split('@')[0] });
    if (res.ok) {
      return res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');
    }
    const detail = await res.text().catch(() => '');
    if (attempt >= 1) throw new Error(`signup failed: ${res.status} ${detail.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 11_000));
  }
}

const stamp = Date.now();
const adminEmail = `mod-admin-${stamp}@example.com`;
const userEmail = `mod-user-${stamp}@example.com`;
const password = 'horse-correct-battery-9';

// --- sanitizer rejections -----------------------------------------------------
const reject = async (name, body) => {
  const res = await json('POST', '/api/comments', { target: 'home', guestName: 'Guest Tester', body });
  check(name, res.status === 400, `status=${res.status}`);
};
await reject('a plain URL is rejected', 'go to https://spam.example now');
await reject('a www domain is rejected', 'see www.spam-example.com');
await reject('a bare domain is rejected', 'find me at spamsite.com ok');
await reject('an @handle is rejected', 'dm me @spambot today');
await reject('a zero-width-cloaked URL is rejected', 'h\u200Bttp\u200B://spam.example');
await reject('a fullwidth-cloaked domain is rejected', 'ｗｗｗ.spam.example');
await reject('angle brackets are rejected', 'hello <script>alert(1)</script>');

const badTarget = await json('POST', '/api/comments', { target: 'not-a-page', guestName: 'G', body: 'hi' });
check('a comment on a nonexistent page is refused', badTarget.status === 400);

// --- lifecycle: pending -> approve -> visible ----------------------------------
const guestBody = `A lovely idea — my cat naps along with the timer. (${stamp})`;
const posted = await json('POST', '/api/comments', {
  target: 'home',
  guestName: 'Friendly Guest',
  body: guestBody,
});
const postedData = await posted.json();
check('a clean guest comment is accepted as pending', posted.status === 201 && postedData.status === 'pending');

let list = await (await fetch(`${BASE}/api/comments?target=home`)).json();
const visibleBefore = list.items.some((i) => i.body === guestBody);
check('pending comments are NOT publicly visible', !visibleBefore);

// Admin: fresh account, promoted via local D1, then re-signed-in.
await makeAccount(adminEmail, password);
execSync(
  `npx wrangler d1 execute petpomo --local --command "UPDATE \\"user\\" SET role='admin' WHERE email='${adminEmail}'"`,
  { cwd: new URL('..', import.meta.url), stdio: 'ignore' },
);
const signin = await json('POST', '/api/auth/sign-in/email', { email: adminEmail, password });
const adminCookie = signin.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

const anonQueue = await fetch(`${BASE}/api/admin/queue`);
check('the admin queue refuses the signed-out', anonQueue.status === 401);

const queue = await (await fetch(`${BASE}/api/admin/queue`, { headers: { cookie: adminCookie } })).json();
const mine = queue.items.find((i) => i.body === guestBody);
check('the pending comment is in the admin queue', !!mine);

const approved = await json('POST', '/api/admin/moderate', { id: mine?.id, action: 'approve' }, adminCookie);
check('approve succeeds', approved.status === 200);

list = await (await fetch(`${BASE}/api/comments?target=home`)).json();
check('an approved comment becomes publicly visible', list.items.some((i) => i.body === guestBody));

// --- member comments + ban ------------------------------------------------------
const userCookie = await makeAccount(userEmail, password);
const memberPost = await json(
  'POST',
  '/api/comments',
  { target: 'home', body: `Member checking in (${stamp})` },
  userCookie,
);
check('a signed-in member can submit without a guest name', memberPost.status === 201);

const users = await (await fetch(`${BASE}/api/admin/users`, { headers: { cookie: adminCookie } })).json();
const target = users.items.find((u) => u.email === userEmail);
const banned = await json('POST', '/api/admin/ban', { userId: target?.id, reason: 'test ban' }, adminCookie);
check('the admin can ban a member', banned.status === 200);

const bannedPost = await json('POST', '/api/comments', { target: 'home', body: 'still here?' }, userCookie);
check('a banned member is refused immediately (live session)', bannedPost.status === 403, `status=${bannedPost.status}`);

const queueAfterBan = await (await fetch(`${BASE}/api/admin/queue`, { headers: { cookie: adminCookie } })).json();
check('a ban bulk-rejects the member\'s pending posts', !queueAfterBan.items.some((i) => i.author_email === userEmail));

// --- contact form -----------------------------------------------------------------
const honey = await json('POST', '/api/contact', {
  name: 'Bot',
  email: 'bot@example.com',
  subject: 'spam',
  message: 'spam',
  website: 'filled-by-bot',
});
check('the contact honeypot answers success', honey.status === 200);

const contact = await json('POST', '/api/contact', {
  name: 'Vis Itor',
  email: 'visitor@example.com',
  subject: `Hello (${stamp})`,
  message: 'Just saying the cat is lovely.',
  website: '',
});
check('a real contact message is accepted', contact.status === 200);

const inbox = await (await fetch(`${BASE}/api/admin/contact`, { headers: { cookie: adminCookie } })).json();
const honeyStored = inbox.items.some((m) => m.subject === 'spam');
const realStored = inbox.items.some((m) => m.subject === `Hello (${stamp})`);
check('the honeypot message was NOT stored', !honeyStored);
check('the real message reached the admin inbox', realStored);

// --- rate limit --------------------------------------------------------------------
// 5/10min/IP; several were spent above, so a short burst must trip it.
let tripped = false;
for (let i = 0; i < 6 && !tripped; i++) {
  const r = await json('POST', '/api/comments', { target: 'home', guestName: 'Burst', body: `burst ${i} ${stamp}` });
  if (r.status === 429) tripped = true;
}
check('the comment rate limit trips on a burst', tripped);

const passed = out.filter((o) => o.ok).length;
console.log(`\n==== ${passed}/${out.length} passed ====`);
if (passed !== out.length) {
  console.log('FAILURES:');
  for (const o of out.filter((x) => !x.ok)) console.log(` - ${o.n}`);
  process.exit(1);
}
