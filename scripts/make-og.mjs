/**
 * Renders public/og.png — the card shown when the site is shared.
 *
 * A build step rather than a committed binary, so the card cannot drift out of
 * date relative to the palette it is drawn from. It is committed anyway,
 * because Cloudflare Pages builds must not need a browser download.
 *
 *   node scripts/make-og.mjs
 *
 * 1200×630 is the size every major scraper crops to. Anything important has to
 * survive being centre-cropped to roughly 1.91:1 on a phone.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'og.png');

// Dusk, because it is the phase the world looks best in and the one the
// reference art was chosen for.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden; position: relative;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: linear-gradient(180deg, #2b4a72 0%, #7a6b96 52%, #ff8f66 100%);
  }
  .hills {
    position: absolute; left: -5%; right: -5%; bottom: 30%; height: 26%;
    background: #43536f; border-radius: 50% 50% 0 0 / 100% 100% 0 0;
    filter: blur(0.4px);
  }
  .hills.far { bottom: 34%; height: 22%; background: #5f6d92; left: -18%; right: 8%; }
  .ground {
    position: absolute; left: 0; right: 0; bottom: 0; height: 32%;
    background: linear-gradient(180deg, #4e6645 0%, #354833 60%, #293a26 100%);
  }
  .sun {
    position: absolute; right: 16%; bottom: 30%; width: 90px; height: 90px;
    border-radius: 50%; background: #ffd28a;
    box-shadow: 0 0 120px 60px rgba(255,122,82,0.55);
  }
  .cloud {
    position: absolute; border-radius: 999px; background: #ffb389; opacity: 0.9;
  }
  .blades { position: absolute; left: 0; right: 0; bottom: 0; height: 34%; }
  .blade { position: absolute; bottom: -10px; width: 6px; background: #293a26; border-radius: 4px; transform-origin: bottom center; }
  .wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; padding: 0 88px; }
  h1 { font-size: 96px; font-weight: 800; letter-spacing: -0.035em; color: #fff6ea; text-shadow: 0 4px 30px rgba(0,0,0,0.35); }
  p { margin-top: 18px; font-size: 38px; font-weight: 500; color: #ffe4cf; text-shadow: 0 2px 16px rgba(0,0,0,0.4); max-width: 760px; line-height: 1.25; }
  .badge { margin-top: 34px; display: inline-flex; align-items: center; gap: 12px; align-self: flex-start;
    background: rgba(255,246,234,0.16); border: 1px solid rgba(255,246,234,0.32);
    padding: 12px 22px; border-radius: 999px; color: #fff6ea; font-size: 24px; font-weight: 600; }
  .vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 55%, transparent 40%, rgba(10,14,20,0.45) 100%); }
</style></head><body>
  <div class="hills far"></div>
  <div class="hills"></div>
  <div class="sun"></div>
  <div class="ground"></div>
  <div class="blades" id="blades"></div>
  <div class="vig"></div>
  <div class="wrap">
    <h1>PetPomo</h1>
    <p>A free pomodoro timer with a cat who naps while you focus.</p>
    <div class="badge">🐾 No account · Works offline</div>
  </div>
  <script>
    const b = document.getElementById('blades');
    // Deterministic, so re-running the script does not produce a new image.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 90; i++) {
      const el = document.createElement('div');
      el.className = 'blade';
      el.style.left = (rnd() * 100).toFixed(2) + '%';
      el.style.height = (40 + rnd() * 150).toFixed(0) + 'px';
      el.style.opacity = (0.45 + rnd() * 0.5).toFixed(2);
      el.style.transform = 'rotate(' + ((rnd() - 0.5) * 28).toFixed(1) + 'deg)';
      b.appendChild(el);
    }
  </script>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: out });
await browser.close();

console.log(`wrote ${out}`);
