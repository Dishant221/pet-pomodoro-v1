/**
 * Build-time-only better-auth config, used EXCLUSIVELY by
 * `@better-auth/cli generate` to emit the SQL schema (worker/migrations).
 *
 * The runtime config in worker/src/auth.ts needs live Workers bindings the
 * CLI cannot construct, so this stub mirrors its schema-relevant options
 * against a throwaway in-memory SQLite database instead. KEEP THE PLUGIN
 * LIST IN LOCKSTEP with worker/src/auth.ts — a plugin added there and not
 * here means the generated schema silently misses that plugin's columns.
 * (The captcha plugin adds no schema and is deliberately absent here.)
 *
 * Never imported by application code and never bundled.
 */
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';

export const auth = betterAuth({
  database: new Database(':memory:'),
  emailAndPassword: { enabled: true },
  socialProviders: { google: { clientId: 'stub', clientSecret: 'stub' } },
  plugins: [admin()],
});
