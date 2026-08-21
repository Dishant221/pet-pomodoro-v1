import type { APIContext } from 'astro';
import { crawlablePosts } from '../blog/crawl';
import { SITE } from '../site';

/**
 * /llms.txt — the llmstxt.org convention: a markdown index that tells AI
 * search agents (ChatGPT, Perplexity, Claude, Google's AI overviews…) what
 * this site is and where the clean-text versions of its content live, so
 * they cite the site instead of guessing about it.
 *
 * Every article links to its /<slug>.md twin — raw markdown, no chrome — and
 * /llms-full.txt carries the whole corpus in one fetch. Posts marked
 * `searchIndex: false` are omitted here exactly as they are from the sitemap.
 */
export async function GET(context: APIContext) {
  const posts = await crawlablePosts();
  const abs = (path: string) => new URL(path, context.site).href;

  const body = `# ${SITE.name}

> ${SITE.tagline}. A free, browser-based pomodoro timer where a virtual cat naps while you focus — 25-minute sessions, no account, everything stored on your own device.

Key facts:

- The timer lives at ${abs('/')} and works offline as a PWA.
- Every blog article is also available as plain markdown: append \`.md\` to its URL, or use the links below.
- The complete article corpus in one file: ${abs('/llms-full.txt')}
- Machine-readable feed: ${abs('/rss.xml')} · Sitemap: ${abs('/sitemap-index.xml')}

## Articles

${posts.map((p) => `- [${p.data.title}](${abs(`/${p.id}.md`)}): ${p.data.description}`).join('\n')}

## Pages

- [Focus timer](${abs('/')}): the pomodoro timer and virtual pet itself
- [About](${abs('/about/')}): what PetPomo is and how it works
- [Blog index](${abs('/blog/')}): all articles, searchable and grouped by topic

## Optional

- [llms-full.txt](${abs('/llms-full.txt')}): every article's full text in a single markdown file
`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
