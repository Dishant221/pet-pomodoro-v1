// @ts-check
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
const site = process.env.PUBLIC_SITE_URL ?? 'https://petpomo.pages.dev';

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
        // data: for the CSS theme textures, which are inline SVG noise.
        "img-src 'self' data: blob:",
        "font-src 'self'",
        // Same-origin only. The weather Worker talks to Open-Meteo server-side,
        // so no third-party origin is ever contacted from the page.
        "connect-src 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
        'upgrade-insecure-requests',
      ],
      scriptDirective: {
        // 'self' covers /boot.js and /sw-register.js, which are real files
        // precisely so they need no hash and cannot drift out of sync.
        resources: ["'self'"],
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
      filter: (page) => !/\/(settings|stats|shop)\/?$/.test(page),
      changefreq: 'weekly',
      lastmod: new Date(),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
