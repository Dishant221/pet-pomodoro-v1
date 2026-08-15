import type { APIContext } from 'astro';
import { isProductionBuild } from '../site';

/**
 * robots.txt, generated rather than static.
 *
 * It has to differ between production and preview. A static file would carry
 * production's sitemap URL onto the preview deploy and invite crawlers to
 * index it — and an indexed preview is worse than an unindexed one, because it
 * competes with production for production's own keywords.
 *
 * Note this is a courtesy, not a control: robots.txt asks politely and
 * well-behaved crawlers comply. The enforceable half is the `noindex` meta tag
 * the layout emits on every non-production build.
 */
export function GET(context: APIContext) {
  const site = context.site;
  const production = isProductionBuild(site);

  const body = production
    ? `# PetPomo — ${site?.origin}
#
# Everything is open to every crawler. The three app panels below are
# disallowed not to hide them but because they are empty without a save file
# in local storage: a crawler sees a bare shell, indexes it as thin content,
# and that drags the whole site's quality signals down.

User-agent: *
Allow: /
Disallow: /settings
Disallow: /stats
Disallow: /shop

# JSON with nothing to index. Crawling it would also burn the weather cache
# for no benefit.
Disallow: /api/

Sitemap: ${new URL('/sitemap-index.xml', site).href}
`
    : `# Non-production deploy — preview, or a branch build.
#
# Nothing here should be indexed: it is the same content as production and
# would compete with it. Every page also carries a noindex meta tag, which is
# the half that crawlers cannot decline.

User-agent: *
Disallow: /
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
