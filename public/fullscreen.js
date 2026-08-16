/**
 * The fullscreen toggle in the nav.
 *
 * A separate file rather than an inline script because the site ships a strict
 * Content-Security-Policy with no `unsafe-inline` — the same reason boot.js and
 * sw-register.js live out here.
 *
 * Deliberately small and defensive. Fullscreen is a nicety; on a device or a
 * browser that refuses it (iPhone Safari does not support it on arbitrary
 * elements, and any browser refuses it outside a user gesture) the button
 * simply hides itself rather than sitting there doing nothing.
 */
(function () {
  var btn = document.querySelector('[data-fullscreen]');
  if (!btn) return;

  var root = document.documentElement;
  var supported =
    !!(root.requestFullscreen || root.webkitRequestFullscreen) &&
    (document.fullscreenEnabled !== false);

  if (!supported) {
    btn.hidden = true;
    return;
  }

  function isFull() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function paint() {
    var full = isFull();
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
    btn.title = full ? 'Leave fullscreen' : 'Go fullscreen';
    // Two glyphs, swapped by CSS on aria-pressed, so this file owns no styling.
    var label = btn.querySelector('.sr-only');
    if (label) label.textContent = full ? 'Leave fullscreen' : 'Go fullscreen';
  }

  btn.addEventListener('click', function () {
    try {
      if (isFull()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
      }
    } catch (e) {
      /* A refusal is not an error worth showing anyone. */
    }
  });

  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  paint();
})();
