/**
 * Mounts the sync app as a Pages Function so it answers on the SAME origin as
 * the site. That is why the client's default API base is a bare `/api` with no
 * configuration: no CORS preflight, no PUBLIC_API_BASE rebuild, one deploy.
 *
 * The same Hono app can be deployed as a standalone Worker instead — see
 * DEPLOY.md for that path.
 */
import { handle } from 'hono/cloudflare-pages';
import app from '../../worker/src/index';

export const onRequest = handle(app);
