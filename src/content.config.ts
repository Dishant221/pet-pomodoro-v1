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
  schema: ({ image }) =>
    z.object({
    /**
     * Cover photo, self-hosted under src/assets/blog/. The CSP only allows
     * same-origin images, so hotlinking a stock site would render nothing —
     * every image is downloaded, committed, and optimised by Astro at build.
     */
    image: image().optional(),
    /** Describes the actual photo, not the article. Required whenever image is set. */
    imageAlt: z.string().optional(),
    /** Attribution for openly-licensed photos: "Title" by Creator (CC BY 2.0). */
    imageCredit: z.string().optional(),
    /** Link to the photo's source page, shown with the credit. */
    imageCreditUrl: z.string().url().optional(),
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
    /**
     * Should Google (and every other search/AI crawler) see this article?
     * `false` keeps the page live on the site but marks it noindex, drops it
     * from the sitemap, and leaves it out of llms.txt and the /<slug>.md
     * crawler copies. Unlike `draft`, readers can still open it.
     */
    searchIndex: z.boolean().default(true),
  }),
});

export const collections = { blog };
