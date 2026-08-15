/**
 * Pre-paint bootstrap: theme, pet skin and motion preference.
 *
 * Lives in `public/` and is loaded as a plain blocking script rather than
 * inlined, for two reasons. It has to run before first paint or the page
 * flashes the default theme — which rules out Astro's bundled `<script>`,
 * since those are deferred modules. And keeping it out of the HTML is what
 * lets the Content-Security-Policy forbid inline script entirely instead of
 * carrying a hash that silently breaks the moment this file is edited.
 *
 * Deliberately dependency-free, un-bundled ES5, and wrapped in try/catch:
 * storage can be blocked, and a throw here would leave the page unstyled.
 */
(function () {
  try {
    var raw = localStorage.getItem('petpomo.save.v1');
    var save = raw ? JSON.parse(raw) : null;
    var theme = (save && save.equipped && save.equipped.theme) || 'playful';
    var reduced = !!(save && save.settings && save.settings.reducedMotion);
    var root = document.documentElement;
    root.className = 'theme-' + theme;
    root.dataset.reducedMotion = String(reduced);

    var pet = (save && save.equipped && save.equipped.pet) || 'mochi';
    var SKINS = {
      shadow: { fur: '#5c5f6e', furDark: '#43465a', belly: '#c9cddb', line: '#23252f' },
      cloud: { fur: '#f0f1f5', furDark: '#d3d7e2', belly: '#ffffff', line: '#5b5f70' },
      inky: { fur: '#3f8a86', furDark: '#2d6a67', belly: '#d6f0ec', line: '#1d3b3a' },
    };
    var s = SKINS[pet];
    if (s) {
      root.style.setProperty('--fur', s.fur);
      root.style.setProperty('--fur-dark', s.furDark);
      root.style.setProperty('--belly', s.belly);
      root.style.setProperty('--line', s.line);
    }
  } catch (e) {
    /* first run, or storage blocked — the defaults on <html> already apply */
  }
})();
