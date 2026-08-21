import type { APIContext } from 'astro';
import { crawlablePosts, postMarkdown } from '../blog/crawl';
import type { Post } from '../blog/util';

/**
 * /<slug>.md — every crawlable article as plain markdown, sitting right next
 * to its HTML page (/<slug>/). This is what /llms.txt points AI agents at:
 * the article body with none of the page chrome, which is both cheaper for
 * them to fetch and far likelier to be quoted accurately.
 */
export async function getStaticPaths() {
  const posts = await crawlablePosts();
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }));
}

export function GET(context: APIContext) {
  const { post } = context.props as { post: Post };
  return new Response(postMarkdown(post, context.site), {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
}
