/**
 * First-load JavaScript budget.
 *
 * The spec this project was built to sets a ceiling of 200 KB gzipped before
 * first paint, and Three.js alone is three quarters of that. It was over the
 * line for a while without anyone noticing, because nothing measured it — a
 * budget nobody checks is a wish. This checks it.
 *
 * "First load" means the chunks a browser must fetch before the page is
 * interactive: the scripts the HTML references, plus everything they reach
 * through *static* imports. A `import()` call is deliberately not followed —
 * that is the whole point of the split, and counting it would make deferring
 * work look like it changed nothing.
 *
 *   node scripts/budget.mjs          check
 *   node scripts/budget.mjs --list   check and print every chunk
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';

const DIST = 'dist';
const BUDGET = 200 * 1024;
const list = process.argv.includes('--list');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Absolute throughout: the reachability set is built from `resolve`d specifiers,
// and comparing those against `join`ed relative paths silently matches nothing —
// which reported every chunk as deferred and the budget as almost entirely free.
const files = walk(DIST).map((f) => resolve(f));

/**
 * Scripts the HTML asks for by name. Anything else has to be reached from these.
 *
 * Both forms count. A `<script src>` is obvious; an island's bundle is named in
 * an `<astro-island component-url=…>` attribute and pulled in by the hydration
 * runtime, which is a dynamic import at the JS level but is not deferred work
 * in any sense a user would recognise — the page does not do anything until it
 * lands. Counting only `<script src>` found 1.7 KB and declared victory.
 */
const entries = new Set();
for (const html of files.filter((f) => f.endsWith('.html'))) {
  const src = readFileSync(html, 'utf8');
  for (const m of src.matchAll(/["'](\/_astro\/[^"']+\.js)["']/g)) entries.add(resolve(DIST, '.' + m[1]));
  for (const m of src.matchAll(/<script[^>]+src="([^"]+\.js)"/g)) entries.add(resolve(DIST, '.' + m[1]));
}

/**
 * Static import specifiers in a built chunk.
 *
 * Matches `import"./a.js"` and `import{x}from"./a.js"` but not `import("./a.js")`
 * — after `import` a dynamic call has `(`, which neither alternative accepts.
 *
 * Re-exports count too. `export{a}from"./b.js"` pulls b in exactly as hard as
 * an import does, and a bundler emits plenty of them; missing that form makes
 * the budget look better than it is, which is the one direction a budget must
 * never be wrong in.
 */
function staticImports(code) {
  const out = [];
  const imports = /(?:^|[;}\s])import\s*(?:[\w*{},$\s]*?\s*from\s*)?["']([^"']+)["']/g;
  const reExports = /(?:^|[;}\s])export\s*(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(imports)) out.push(m[1]);
  for (const m of code.matchAll(reExports)) out.push(m[1]);
  return out;
}

const seen = new Set();
const queue = [...entries];
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file) || !file.endsWith('.js')) continue;
  let code;
  try {
    code = readFileSync(file, 'utf8');
  } catch {
    continue; // referenced but not emitted — not ours to account for
  }
  seen.add(file);
  for (const spec of staticImports(code)) {
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // bare = external
    queue.push(spec.startsWith('/') ? resolve(DIST, '.' + spec) : resolve(dirname(file), spec));
  }
}

let total = 0;
const rows = [];
for (const f of [...seen].sort()) {
  const gz = gzipSync(readFileSync(f), { level: 9 }).length;
  total += gz;
  rows.push([f.replace(resolve(DIST) + '\\', '').replace(resolve(DIST) + '/', ''), gz]);
}

rows.sort((a, b) => b[1] - a[1]);
if (list) for (const [name, gz] of rows) console.log(`  ${String(gz).padStart(7)}  ${name}`);

const deferred = files.filter((f) => f.endsWith('.js') && !seen.has(f));
const deferredGz = deferred.reduce((n, f) => n + gzipSync(readFileSync(f), { level: 9 }).length, 0);

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log(`first load : ${kb(total)} gzip across ${rows.length} chunks`);
console.log(`deferred   : ${kb(deferredGz)} gzip across ${deferred.length} chunks (loaded after paint)`);
console.log(`budget     : ${kb(BUDGET)}`);

if (total > BUDGET) {
  console.error(`\nFAIL: first-load JS is ${kb(total - BUDGET)} over budget.`);
  console.error('Defer something with import(), or raise BUDGET deliberately and say why.');
  process.exit(1);
}
console.log(`\nOK: ${kb(BUDGET - total)} of headroom.`);
