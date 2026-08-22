/**
 * Workers Static Assets entry point.
 *
 * The Hono app in ./index is unchanged from its Pages Functions days; this
 * file only adapts it to the module-Worker shape. With
 * `run_worker_first = ["/api/*"]` in wrangler.toml, every other URL is served
 * straight from the asset store — where public/_headers and public/_redirects
 * still apply — so this code only ever sees API traffic.
 */
import app from './index';

export default {
  fetch: app.fetch,
  /** Stub. Analytics rollups and the moderation digest land here in later phases. */
  async scheduled(): Promise<void> {},
};
