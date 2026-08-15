/**
 * Service-worker registration.
 *
 * Split out of the page for the same reason as `boot.js`: no inline script
 * means the Content-Security-Policy can forbid inline script outright.
 *
 * Deferred to the load event so it never competes with first paint — offline
 * support matters on the *second* visit, and buying it by slowing the first
 * one down would be a bad trade.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {
      /* unsupported, blocked by policy, or insecure origin — the game does
         not depend on it, so there is nothing to report or retry. */
    });
  });
}
