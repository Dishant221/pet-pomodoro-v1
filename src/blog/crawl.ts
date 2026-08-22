import { getCollection } from 'astro:content';
import { SITE } from '../site';
import { isLive, sortByDate, tagLabel, type Post } from './util';

/**
 * The article set exposed to crawlers — search engines and AI agents alike.
 *
 * One filter, used by llms.txt, llms-full.txt and the /<slug>.md copies, so
 * a post that opts out with `searchIndex: false` disappears from every
 * machine-facing surface at once instead of lingering in whichever file
 * someone forgot.
 */
export async function crawlablePosts(): Promise<Post[]> {
  return sortByDate(await getCollection('blog', ({ data }) => isLive(data) && data.searchIndex));
}

/**
 * An article as plain markdown: the frontmatter facts a crawler needs (dates,
 * topics, the canonical HTML page) followed by the raw body it was written as.
 */
export function postMarkdown(post: Post, site: URL | undefined): string {
  const origin = site ?? new URL(SITE.url);
  const canonical = new URL(`/${post.id}/`, origin).href;
  const meta = [
    `- Published: ${post.data.publishedAt.toISOString().slice(0, 10)}`,
    ...(post.data.updatedAt ? [`- Updated: ${post.data.updatedAt.toISOString().slice(0, 10)}`] : []),
    ...(post.data.tags.length ? [`- Topics: ${post.data.tags.map(tagLabel).join(', ')}`] : []),
    `- Canonical: ${canonical}`,
  ];
  return [`# ${post.data.title}`, '', `> ${post.data.description}`, '', ...meta, '', (post.body ?? '').trim(), ''].join(
    '\n',
  );
}
