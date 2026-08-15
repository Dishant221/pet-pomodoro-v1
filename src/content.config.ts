import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
// Imported directly rather than re-exported from astro:content, which is
// deprecated in Astro 7.
import { z } from 'zod';

/**
 * The blog, as files on disk.
 *
 * Markdown in `src/content/blog/` rather than a CMS: posts are version
 * controlled, reviewable in a diff, and cannot break the build without the
 * build saying so. Adding a post is one file and a push.
 *
 * The schema is strict on purpose. Every field here feeds either search
 * results or the page itself, and a post that quietly ships without a
 * description is a post that shows up in Google as a fragment of its own first
 * paragraph.
 */
const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string().max(70, 'Titles over ~70 characters get truncated in search results'),
    /** The search snippet. Write it for a human deciding whether to click. */
    description: z.string().min(50).max(165),
    publishedAt: z.coerce.date(),
    /** Set when meaningfully revised, so search engines re-crawl. */
    updatedAt: z.coerce.date().optional(),
    /** Drives the tag pages and internal linking. Keep the vocabulary small. */
    tags: z.array(z.string()).default([]),
    /** Hide from the index and the feed without deleting the file. */
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
