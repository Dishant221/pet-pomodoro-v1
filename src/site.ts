/**
 * Site-wide facts that are not code.
 *
 * Anything a human might need to change without reading TypeScript lives here:
 * the public name, the contact address, the legal entity. Scattering these
 * through templates is how a site ends up with three different support
 * addresses, two of which bounce.
 */

/**
 * The one origin that is allowed to be indexed.
 *
 * Every other deploy — preview, a branch build, someone's fork — is marked
 * noindex and serves a disallow-all robots.txt. Preview is publicly reachable
 * on a *.pages.dev subdomain, and an indexed preview does not just leak: it
 * competes with production for production's own keywords, which is worse than
 * not ranking at all.
 */
/**
 * The custom domain. petpomo.pages.dev still serves the same content —
 * Cloudflare never turns a project's *.pages.dev address off — and that is
 * fine: every page it serves declares this origin as canonical, which tells
 * search engines the two are one site and this one is the real address.
 *
 * DO NOT merge this to main before the domain is attached to the Pages
 * project (Cloudflare dashboard -> Pages -> petpomo -> Custom domains) and
 * resolving. A canonical pointing at a dead domain de-indexes the site.
 */
export const PRODUCTION_ORIGIN = 'https://www.pomodoropet.com';

export const SITE = {
  name: 'PetPomo',
  tagline: 'A pomodoro timer with a virtual pet',
  /** Production origin. Overridden per-deploy by PUBLIC_SITE_URL. */
  url: PRODUCTION_ORIGIN,

  /**
   * Public contact address for general enquiries, shown on the contact page.
   *
   * Both addresses are on the custom domain, so they only receive mail once
   * Email Routing (or an equivalent forward) is configured on pomodoropet.com.
   * Do not ship a build with these set while the domain's mail is unrouted —
   * a printed address that bounces is worse than none.
   */
  contactEmail: 'enquire@pomodoropet.com',

  /**
   * Support address, used by the in-app support widget (the 💬 above the
   * talk-to-your-pet control) for bug reports, issues and help requests.
   */
  supportEmail: 'support@pomodoropet.com',

  /**
   * Legal entity or trading name shown on the policy pages.
   *
   * Also not yet set — fill this in when the business registration is done.
   * An empty value falls back to the site name, which is honest for a personal
   * project and wrong for a registered business.
   */
  legalEntity: '',
} as const;

/** True once the site has a real inbox behind it. */
export const hasContact = SITE.contactEmail.length > 0;

export const legalName = SITE.legalEntity || SITE.name;

/**
 * Whether this build is the one that should appear in search results.
 *
 * Compared against the origin Astro was configured with, so it is decided at
 * build time by PUBLIC_SITE_URL and cannot be got wrong at runtime.
 */
export function isProductionBuild(site: URL | undefined): boolean {
  return site?.origin === new URL(PRODUCTION_ORIGIN).origin;
}
