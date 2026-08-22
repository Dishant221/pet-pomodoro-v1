// @ts-check
import { copyFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * `site` is not decoration — it is what makes canonical URLs, the sitemap and
 * Open Graph image URLs absolute. Search engines and social scrapers both
 * reject relative ones, so getting this wrong silently costs indexing.
 *
 * Preview deploys override it, otherwise every preview would advertise itself
 * as the production site and invite duplicate-content penalties.
 */
const PRODUCTION_ORIGIN = 'https://www.pomodoropet.com';
const site = process.env.PUBLIC_SITE_URL ?? PRODUCTION_ORIGIN;
const isProduction = site === PRODUCTION_ORIGIN;

/**
 * Posts that opted out of search with `searchIndex: false` frontmatter.
 *
 * The sitemap filter runs here in the config, where astro:content is not
 * available, so the frontmatter is scanned directly. A page in the sitemap
 * that answers noindex is a contradiction Search Console flags — whatever
 * the meta tag says, the sitemap must not advertise it.
 */
const blogDir = fileURLToPath(new URL('./src/content/blog', import.meta.url));
const blogFiles = readdirSync(blogDir).filter((f) => /\.mdx?$/.test(f));
/** @param {string} f */
const frontmatter = (f) => readFileSync(`${blogDir}/${f}`, 'utf8').split(/^---\s*$/m)[1] ?? '';

const unindexedSlugs = blogFiles
  .filter((f) => /^searchIndex:\s*false\s*$/m.test(frontmatter(f)))
  .map((f) => f.replace(/\.mdx?$/, ''));

/**
 * Posts whose publish date has not arrived yet. The blog drips one post a day
 * (see src/blog/util.ts `isLive`), and a not-yet-due post is not built, so it
 * must not be advertised in the sitemap either — the two must agree or Search
 * Console flags a sitemap URL that answers 404. Recomputed every build, which
 * is why the daily rebuild is what moves a post from "future" to "live".
 */
const buildTime = Date.now();
const futureSlugs = blogFiles
  .filter((f) => {
    const m = frontmatter(f).match(/^publishedAt:\s*['"]?(\d{4}-\d{2}-\d{2})/m);
    return m ? new Date(m[1]).getTime() > buildTime : false;
  })
  .map((f) => f.replace(/\.mdx?$/, ''));

/**
 * @astrojs/sitemap only ever writes sitemap-index.xml plus numbered chunks
 * (sitemap-0.xml, one per 45,000 URLs) — it has no option to emit a plain
 * /sitemap.xml, which is where people and some tools look first. This site is
 * a few dozen URLs, a single chunk for the foreseeable future, so the chunk is
 * copied to /sitemap.xml after the build; robots.txt points crawlers there.
 * Registered after sitemap() below because build:done hooks run in
 * registration order — the chunk must exist before it can be copied.
 */
const sitemapAlias = {
  name: 'sitemap-alias',
  hooks: {
    /** @param {{ dir: URL }} options */
    'astro:build:done': ({ dir }) => {
      const chunk = new URL('./sitemap-0.xml', dir);
      // Preview builds filter every page out and emit no sitemap at all.
      if (!existsSync(chunk)) return;
      if (existsSync(new URL('./sitemap-1.xml', dir))) {
        throw new Error('sitemap grew to multiple chunks; /sitemap.xml would be incomplete — serve sitemap-index.xml instead');
      }
      copyFileSync(chunk, new URL('./sitemap.xml', dir));
    },
  },
};

export default defineConfig({
  site,
  output: 'static',

  /**
   * Content-Security-Policy, owned by Astro.
   *
   * Hand-writing `script-src 'self'` in _headers looked right and broke the
   * game: Astro emits a small inline script per client island to hydrate it,
   * and a policy with no hashes blocks exactly those. The choice was between
   * weakening the policy with 'unsafe-inline' — which is most of the reason to
   * have a CSP at all — and letting the framework hash its own output. This is
   * the latter: Astro adds a <meta> CSP per page carrying hashes for every
   * script and style it generated.
   *
   * `frame-ancestors` is deliberately absent. It is ignored when delivered in
   * a <meta> element and browsers log a warning saying so, so clickjacking is
   * handled by the real header in public/_headers instead. The two policies
   * compose: a browser enforces every policy it is given.
   */
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "form-action 'self'",
        // data: for the CSS theme textures (inline SVG noise); the Google
        // Analytics hosts because GA sends some hits as image beacons.
        "img-src 'self' data: blob: https://www.google-analytics.com https://*.google-analytics.com",
        "font-src 'self'",
        // Same-origin, plus Google Analytics (loaded only after consent — see
        // public/analytics.js). The weather Worker talks to Open-Meteo
        // server-side, so that is the only other third-party origin involved.
        "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
        "worker-src 'self'",
        "manifest-src 'self'",
        // Turnstile renders its challenge in an iframe on this origin. The
        // widget script only ever loads when PUBLIC_TURNSTILE_SITE_KEY is
        // set, but the policy is static, so the origin is allowed up front.
        // (Google sign-in needs no CSP change: it is a top-level navigation.)
        "frame-src 'self' https://challenges.cloudflare.com",
        'upgrade-insecure-requests',
      ],
      scriptDirective: {
        // 'self' covers /boot.js, /sw-register.js and /analytics.js, which are
        // real files precisely so they need no hash and cannot drift out of
        // sync. challenges.cloudflare.com is Turnstile's widget script (see
        // frame-src above). googletagmanager.com is gtag.js, injected by
        // /analytics.js only after the visitor consents.
        resources: ["'self'", 'https://challenges.cloudflare.com', 'https://www.googletagmanager.com'],
      },
      styleDirective: {
        resources: [
          "'self'",
          /**
           * Inline `style` attributes, and only attributes.
           *
           * The stage computes colours and transforms per frame and writes
           * them as style attributes; CSP has no way to allow those by hash.
           * Scoped to `style-src-attr` so inline <style> *elements* still
           * require a hash. Style injection cannot execute code, which makes
           * this a far smaller exposure than the script equivalent — but it is
           * a real one, and worth not widening further.
           */
          { resource: "'unsafe-inline'", kind: 'attribute' },
        ],
      },
    },
  },

  integrations: [
    preact(),
    sitemap({
      // The game itself and the compliance pages belong in the index; the
      // app's stateful panels do not — they render nothing without a save.
      // On a preview build nothing does: submitting a sitemap for a deploy
      // that is entirely noindex would only waste crawl budget.
      filter: (page) =>
        isProduction &&
        !/\/(settings|stats|shop)\/?$/.test(page) &&
        // Articles whose frontmatter says searchIndex: false stay live but
        // out of the sitemap (their pages also carry noindex).
        !unindexedSlugs.some((slug) => page.endsWith(`/${slug}/`)) &&
        // Not-yet-due posts in the daily drip are not built, so keep them out.
        !futureSlugs.some((slug) => page.endsWith(`/${slug}/`)),
      changefreq: 'weekly',
      lastmod: new Date(),
    }),
    sitemapAlias,
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
