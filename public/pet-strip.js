/**
 * The roaming pet — a cat that walks along the bottom edge of the window.
 *
 * A separate, unbundled file for the same reason boot.js, sw-register.js and
 * fullscreen.js are: the site ships a strict Content-Security-Policy with no
 * `unsafe-inline`, and a real file under /public is covered by `script-src
 * 'self'` without needing a hash. That also keeps it out of the first-load JS
 * budget entirely (BACKLOG #26), which matters because this runs on every
 * page rather than only the stage.
 *
 * It is additive and self-contained on purpose. It imports nothing, mutates no
 * existing element, and touches no store. If this file is deleted the site is
 * exactly what it was before.
 *
 * WHAT IT DOES
 *   The cat patrols the bottom ~90px of the viewport. Anything with an edge
 *   down there — a footer link, a button, a panel — is furniture: it hops onto
 *   the low ones and sits, and it turns around at the tall ones. Text is not
 *   furniture; paragraphs and headings are scenery it walks straight past.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It never dispatches an event onto anything it touches. A pet that could
 *   press your buttons is a clickjacking bug wearing a cat costume, however
 *   charming it sounds. Pawing at a button is an animation and nothing more.
 *
 *   It is also silent. The mute state lives in the save store, which a plain
 *   script out here cannot read without duplicating it, and a pet that meows
 *   through a mute setting is worse than a pet that says nothing.
 *
 * TURNING IT OFF
 *   `localStorage.setItem('petpomo.strip.v1', 'off')`, or put
 *   `data-pet-strip="off"` on <html>. Reduced-motion users get a cat that
 *   sits still rather than one that paces.
 */
(function () {
  'use strict';

  // --- opt-out, checked before anything is built ---------------------------
  if (document.documentElement.getAttribute('data-pet-strip') === 'off') return;
  try {
    if (localStorage.getItem('petpomo.strip.v1') === 'off') return;
  } catch (e) {
    /* private mode: no stored preference, carry on */
  }

  // --- tuning --------------------------------------------------------------
  var SIZE = 60;        // sprite box, px square
  var BAND = 92;        // how far up from the bottom edge counts as "furniture"
  var SPEED = 32;       // walking, px per second
  var HOP_MAX = 46;     // the tallest thing it will climb onto
  var MIN_LEDGE = 40;   // narrower than this is not worth standing on
  var EDGE = 8;         // keep this far clear of the window edges

  var SPRITES = {
    idle: '/pet/cat-idle.svg',
    sleeping: '/pet/cat-sleeping.svg',
    petted: '/pet/cat-petted.svg',
    celebrating: '/pet/cat-celebrating.svg'
  };

  /**
   * What counts as furniture.
   *
   * Deliberately a list of *controls and containers*, never of text. `p`, `h1`
   * and `li` are absent by design — the landing page is several screens of
   * prose and the cat should walk in front of all of it without noticing.
   */
  var SOLID = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    'img',
    '.pp-panel',
    '.pp-card'
  ].join(',');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // --- the layer -----------------------------------------------------------
  //
  // Full-viewport and pointer-transparent, so every link and button under the
  // cat keeps working exactly as it did. Only the small hit-box below takes
  // input, and only where the cat actually is.
  var layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.position = 'fixed';
  layer.style.left = '0';
  layer.style.top = '0';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.pointerEvents = 'none';
  layer.style.zIndex = '40';
  layer.style.overflow = 'hidden';

  var sprite = document.createElement('img');
  sprite.src = SPRITES.idle;
  sprite.alt = '';
  sprite.decoding = 'async';
  sprite.draggable = false;
  sprite.style.position = 'absolute';
  sprite.style.left = '0';
  sprite.style.top = '0';
  sprite.style.width = SIZE + 'px';
  sprite.style.height = SIZE + 'px';
  sprite.style.willChange = 'transform';
  layer.appendChild(sprite);

  // The one part that accepts a click. It tracks the sprite each frame, so the
  // rest of the page is never covered by an invisible input trap.
  var hit = document.createElement('div');
  hit.style.position = 'absolute';
  hit.style.left = '0';
  hit.style.top = '0';
  hit.style.width = SIZE + 'px';
  hit.style.height = SIZE + 'px';
  hit.style.pointerEvents = 'auto';
  hit.style.cursor = 'pointer';
  hit.style.willChange = 'transform';
  layer.appendChild(hit);

  document.body.appendChild(layer);

  for (var key in SPRITES) {
    if (Object.prototype.hasOwnProperty.call(SPRITES, key)) new Image().src = SPRITES[key];
  }

  // --- state ---------------------------------------------------------------
  var x = 40;               // left edge of the sprite, viewport px
  var dir = 1;              // 1 walking right, -1 walking left
  var ledge = 0;            // how high off the floor the cat currently stands
  var pose = 'idle';
  var mode = 'walk';        // walk | pause | sit | react
  var modeUntil = 0;        // timestamp this mode ends
  var bob = 0;              // walk cycle phase
  var hop = 0;              // 0..1 easing while stepping up or down
  var last = 0;
  var raf = 0;
  var dirty = true;      // something moved; the furniture needs re-measuring
  var measuredAt = 0;    // when it last actually happened

  /** Furniture, in viewport coordinates. Rebuilt on change, never per frame. */
  var solids = [];
  /** The rect of a focused text field, which the cat stays away from. */
  var typing = null;

  function setPose(next) {
    if (pose === next) return;
    pose = next;
    sprite.src = SPRITES[next];
  }

  function enter(next, ms) {
    mode = next;
    modeUntil = performance.now() + ms;
  }

  // --- measuring the world -------------------------------------------------
  //
  // Every getBoundingClientRect() in the file happens here, in one batch, with
  // no style writes in between. Reading rects inside the animation loop is the
  // classic layout thrash and would cost far more frames than the cat does.
  function measure() {
    var vh = window.innerHeight;
    var vw = window.innerWidth;
    var floor = vh - BAND;
    var found = [];

    var candidates = document.querySelectorAll(SOLID);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (layer.contains(el)) continue;

      var r = el.getBoundingClientRect();
      // Only things with an edge inside the strip, and only things on screen.
      if (r.bottom < floor || r.top > vh) continue;
      if (r.width < MIN_LEDGE || r.height < 10) continue;
      if (r.right < 0 || r.left > vw) continue;

      // Skip anything not actually painted — a collapsed menu, a hidden panel.
      if (el.checkVisibility) {
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      } else if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') {
        continue;
      }

      found.push({ left: r.left, right: r.right, top: r.top });
      if (found.length >= 40) break; // more than a cat could ever care about
    }
    solids = found;

    // A cat sitting on the field you are typing in is a bug that feels like an
    // insult. Only text entry counts — fleeing every button press would be
    // worse than staying put.
    var a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) {
      var ar = a.getBoundingClientRect();
      typing = ar.bottom > vh - BAND - 40 ? ar : null;
    } else {
      typing = null;
    }
  }

  /** How high the floor is at a given horizontal span, and what holds it up. */
  function groundAt(left, right) {
    var vh = window.innerHeight;
    var best = 0;
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (right < s.left || left > s.right) continue;
      var height = vh - s.top;
      if (height <= HOP_MAX && height > best) best = height;
    }
    return best;
  }

  /** Something too tall to climb, blocking the way ahead. */
  function blockedAt(left, right) {
    var vh = window.innerHeight;
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (right < s.left || left > s.right) continue;
      if (vh - s.top > HOP_MAX) return true;
    }
    return false;
  }

  // --- the loop ------------------------------------------------------------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000, 0.05); // clamp after a stall
    last = now;

    /**
     * Re-measure here, in the read phase, and on a bounded schedule.
     *
     * This was a debounced MutationObserver and that was a bug: the stage
     * writes style attributes every frame, so each mutation reset the timer
     * and the measurement never ran at all. The cat saw an empty world for the
     * life of the page. A dirty flag drained on a throttle cannot starve, and
     * the periodic sweep catches layout the observer never sees — a CSS
     * transition sliding a panel changes no attribute at all.
     */
    if ((dirty && now - measuredAt > 250) || now - measuredAt > 1000) {
      measure();
      dirty = false;
      measuredAt = now;
    }

    var vh = window.innerHeight;
    var vw = window.innerWidth;
    var still = reduced.matches;

    if (still) {
      // Awake, but not pacing. The cat sits where it is.
      setPose('idle');
      bob = 0;
    } else if (mode === 'walk') {
      var nx = x + dir * SPEED * dt;

      if (nx < EDGE || nx + SIZE > vw - EDGE) {
        dir = -dir;
        enter('pause', 700);
      } else if (blockedAt(nx, nx + SIZE)) {
        // A wall. Have a sniff, then go the other way — unless there is a wall
        // that way too, in which case turning around only makes it jitter in
        // the gap. Probe one step back; if that is blocked as well, it is
        // properly boxed in and settles instead.
        var back = x - dir * SPEED * dt;
        if (blockedAt(back, back + SIZE)) {
          enter('sit', 4000);
        } else {
          dir = -dir;
          enter('pause', 900);
        }
      } else if (typing && nx < typing.right + 40 && nx + SIZE > typing.left - 40) {
        // Walk away from whatever is being typed into.
        dir = nx + SIZE / 2 < (typing.left + typing.right) / 2 ? -1 : 1;
        enter('walk', 0);
      } else {
        x = nx;
        bob += dt * 7;
        var target = groundAt(x, x + SIZE);
        if (target !== ledge) {
          ledge = target;   // stepped up onto, or down off, a ledge
          hop = 1;
        }
        // Every so often, stop and be a cat about it.
        if (now > modeUntil) {
          var roll = Math.random();
          if (roll < 0.55) enter('walk', 2500 + Math.random() * 4000);
          else if (roll < 0.9) enter('sit', 2000 + Math.random() * 3500);
          else enter('pause', 1200);
        }
      }
      setPose('idle');
    } else if (mode === 'sit') {
      setPose(ledge > 0 ? 'sleeping' : 'idle');
      bob = 0;
      if (now > modeUntil) enter('walk', 3000 + Math.random() * 4000);
    } else if (mode === 'pause') {
      setPose('idle');
      bob = 0;
      if (now > modeUntil) enter('walk', 3000 + Math.random() * 4000);
    } else if (mode === 'react') {
      if (now > modeUntil) {
        setPose('idle');
        enter('walk', 2500);
      }
    }

    // Ease the step up or down rather than snapping to the new height.
    if (hop > 0) hop = Math.max(0, hop - dt * 4);

    var lift = still ? 0 : Math.abs(Math.sin(bob)) * 3;      // walk bounce
    var arc = hop > 0 ? Math.sin(hop * Math.PI) * 14 : 0;    // hop arc
    var y = vh - SIZE - ledge - lift - arc;

    sprite.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scaleX(' + dir + ')';
    hit.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }

  function start() {
    if (raf) return;
    last = performance.now();
    measure();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // --- input ---------------------------------------------------------------
  hit.addEventListener('click', function () {
    setPose(Math.random() < 0.5 ? 'petted' : 'celebrating');
    hop = 1;
    enter('react', 1400);
  });

  // --- keeping the measurements honest -------------------------------------
  //
  // These only raise the flag. The frame loop decides when to act on it, so a
  // page that mutates constantly costs one measurement every 250ms rather than
  // one per mutation — or, as it did before, none at all.
  function soil() {
    dirty = true;
  }

  window.addEventListener('scroll', soil, { passive: true });
  window.addEventListener('resize', soil);
  document.addEventListener('focusin', soil);
  document.addEventListener('focusout', soil);

  // Panels opening and closing move the furniture. `style` is deliberately not
  // in the filter: the stage rewrites style attributes every frame and would
  // mark the world dirty forever for no useful reason.
  new MutationObserver(soil).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'hidden']
  });

  // A background tab should not be animating a cat for 25 minutes.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  if (reduced.addEventListener) reduced.addEventListener('change', soil);

  /**
   * A handle for tests, mirroring how the stage hangs its API off its host
   * element so a test can aim at a cat that keeps moving. Read-only apart from
   * `measure`, and nothing in the app reads it.
   */
  window.__petStrip = {
    measure: measure,
    solids: function () { return solids.slice(); },
    state: function () { return { x: x, dir: dir, ledge: ledge, mode: mode, pose: pose }; }
  };

  start();
})();
