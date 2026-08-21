import type { CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'blog'>;

/** "virtual pet" -> "virtual-pet", for the /blog/topic/ URLs. */
export function tagSlug(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Title-case a tag for display: "adhd" -> "ADHD", "virtual pet" -> "Virtual pet". */
export function tagLabel(tag: string): string {
  if (tag === 'adhd') return 'ADHD';
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

/** Every tag in use, most-used first, so chip order means something. */
export function allTags(posts: Post[]): Array<{ tag: string; slug: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of posts) for (const t of p.data.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, slug: tagSlug(tag), label: tagLabel(tag), count }));
}

/** ~230 wpm, floored at 1. Word count from the raw markdown is close enough. */
export function readingMinutes(post: Post): number {
  const words = (post.body ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/**
 * Related posts, by shared tags with recency as the tie-break. The suggestion
 * block at the end of an article is the single biggest driver of a second
 * pageview, so this is worth being slightly clever about.
 */
export function relatedPosts(post: Post, posts: Post[], limit = 3): Post[] {
  const mine = new Set(post.data.tags);
  return posts
    .filter((p) => p.id !== post.id)
    .map((p) => ({ p, score: p.data.tags.filter((t) => mine.has(t)).length }))
    .sort(
      (a, b) =>
        b.score - a.score || b.p.data.publishedAt.getTime() - a.p.data.publishedAt.getTime(),
    )
    .slice(0, limit)
    .map((x) => x.p);
}

export function sortByDate(posts: Post[]): Post[] {
  return posts.slice().sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

export const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
