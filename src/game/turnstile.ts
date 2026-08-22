/**
 * The one Turnstile loader — used by the auth panel and the guest comment
 * form. Loads Cloudflare's widget script lazily and only when a site key is
 * configured at build time (PUBLIC_TURNSTILE_SITE_KEY), mirroring the server
 * side, which only verifies tokens when TURNSTILE_SECRET is set: neither key
 * present (local dev) means no widget, no check, and everything still works.
 *
 * Infrastructure notes: the script origin and its challenge iframes are
 * allowed in astro.config.mjs's CSP (script-src / frame-src
 * challenges.cloudflare.com). Tokens are single-use and expire after 5
 * minutes; the expired-callback clears ours so a stale one is never sent.
 */

export const TURNSTILE_SITE_KEY = (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined) ?? '';

declare global {
  interface Window {
    turnstile?: {
      render(
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; 'expired-callback'?: () => void },
      ): string;
    };
  }
}

let scriptRequested = false;

/**
 * Renders the widget into `el` once the script is up; `onToken('')` signals
 * expiry. No-op without a configured site key — callers can mount the host
 * element unconditionally and let this decide.
 */
export function mountTurnstile(el: HTMLElement, onToken: (token: string) => void): void {
  if (!TURNSTILE_SITE_KEY) return;
  const render = () => {
    window.turnstile?.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: onToken,
      'expired-callback': () => onToken(''),
    });
  };
  if (window.turnstile) {
    render();
    return;
  }
  if (!scriptRequested) {
    scriptRequested = true;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.addEventListener('load', render);
    document.head.appendChild(s);
  } else {
    // Script already requested by another island on the page — poll briefly.
    const poll = setInterval(() => {
      if (window.turnstile) {
        clearInterval(poll);
        render();
      }
    }, 200);
    setTimeout(() => clearInterval(poll), 10_000);
  }
}
