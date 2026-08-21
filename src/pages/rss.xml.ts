import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { SITE } from '../site';

/**
 * The feed.
 *
 * Worth having even with two posts: it is how a handful of readers will
 * actually keep up, and several aggregators discover a site by looking for one.
 * Drafts are excluded here as well as from the index — a feed is push, so a
 * mistake here reaches people who cannot un-read it.
 */
export async function GET(context: APIContext) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime(),
  );

  return rss({
    title: `${SITE.name} — ${SITE.tagline}`,
    description: 'Focus, the pomodoro technique, virtual pets, and notes from building PetPomo.',
    site: context.site ?? SITE.url,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      // Posts live at the root — /the-slug/ — not under /blog/.
      link: `/${post.id}/`,
      categories: post.data.tags,
    })),
    customData: '<language>en</language>',
  });
}
