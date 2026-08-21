import type { APIContext } from 'astro';
import { crawlablePosts, postMarkdown } from '../blog/crawl';
import { SITE } from '../site';

/**
 * /llms-full.txt — the llms.txt convention's companion file: the entire
 * article corpus as one markdown document, for agents that would rather make
 * a single request than crawl thirty pages. Same opt-out rules as the
 * sitemap and /llms.txt.
 */
export async function GET(context: APIContext) {
  const posts = await crawlablePosts();

  const body = [
    `# ${SITE.name} — full article corpus`,
    '',
    `> ${SITE.tagline}. Index of this file: ${new URL('/llms.txt', context.site).href}`,
    '',
    ...posts.map((p) => postMarkdown(p, context.site)),
  ].join('\n\n---\n\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
