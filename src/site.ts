/**
 * Site-wide facts that are not code.
 *
 * Anything a human might need to change without reading TypeScript lives here:
 * the public name, the contact address, the legal entity. Scattering these
 * through templates is how a site ends up with three different support
 * addresses, two of which bounce.
 */

export const SITE = {
  name: 'PetPomo',
  tagline: 'A pomodoro timer with a virtual pet',
  /** Production origin. Overridden per-deploy by PUBLIC_SITE_URL. */
  url: 'https://petpomo.pages.dev',

  /**
   * Public contact address.
   *
   * NOT YET SET. Ad networks, payment processors and several privacy laws all
   * expect a reachable contact address, so this has to be a real inbox before
   * the site is monetised or submitted anywhere. Until it is, the contact page
   * says so plainly rather than printing an address that bounces.
   */
  contactEmail: '',

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
