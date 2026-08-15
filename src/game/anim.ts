/**
 * Every GSAP timeline in the game. Each builder takes the mounted (inlined) SVG
 * root and returns a teardown function, so the caller can swap poses without
 * leaking tweens.
 *
 * The animation specs mirror the `loop` / `oneShot` / `ambient` hints in
 * manifest.json — that file stays the source of truth for what should move.
 */
import { gsap } from 'gsap';
import { SCENES, type PetState, type SceneId } from './manifest';

export type Teardown = () => void;

const NOOP: Teardown = () => {};

function q(root: Element, id: string): SVGElement | null {
  return root.querySelector<SVGElement>(`#${CSS.escape(id)}`);
}

function children(el: Element | null): Element[] {
  return el ? Array.from(el.children) : [];
}

/** Builds the looping / one-shot timeline for a pose. */
export function animatePet(root: SVGSVGElement, state: PetState, reduced: boolean): Teardown {
  if (reduced) return animatePetReduced(root, state);

  const tl = gsap.timeline();
  const extra: gsap.core.Tween[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];

  const cat = q(root, 'cat');
  const tail = q(root, 'tail');
  const eyes = q(root, 'eyes');
  const head = q(root, 'head');

  // Blinking is shared by every awake pose.
  const canBlink = state !== 'sleeping' && eyes;
  if (canBlink) {
    const blink = () => {
      gsap.fromTo(
        eyes!,
        { scaleY: 1 },
        { scaleY: 0.08, duration: 0.09, yoyo: true, repeat: 1, transformOrigin: '50% 50%', ease: 'power1.inOut' },
      );
    };
    const schedule = () => {
      const wait = 4000 + Math.random() * 3000;
      const id = setTimeout(() => {
        blink();
        schedule();
      }, wait);
      timers.push(id as unknown as ReturnType<typeof setInterval>);
    };
    schedule();
  }

  switch (state) {
    case 'idle': {
      if (tail) {
        tl.fromTo(
          tail,
          { rotation: -6 },
          { rotation: 6, duration: 1.5, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '20% 90%' },
        );
      }
      // Occasional one-shot: a small ear/head tilt every 30-60s.
      if (head) {
        const id = setInterval(
          () => {
            gsap.fromTo(
              head,
              { rotation: 0 },
              { rotation: 4, duration: 0.5, yoyo: true, repeat: 1, ease: 'sine.inOut', transformOrigin: '50% 90%' },
            );
          },
          30_000 + Math.random() * 30_000,
        );
        timers.push(id);
      }
      break;
    }

    case 'sleeping': {
      const breath = q(root, 'breath');
      if (breath) {
        tl.fromTo(
          breath,
          { scale: 1 },
          { scale: 1.03, duration: 1.2, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 80%' },
        );
      }
      const zzz = children(q(root, 'zzz'));
      if (zzz.length) {
        extra.push(
          gsap.fromTo(
            zzz,
            { opacity: 0, y: 6 },
            {
              opacity: 1,
              y: -10,
              duration: 1.6,
              stagger: 0.45,
              repeat: -1,
              repeatDelay: 0.4,
              ease: 'sine.out',
            },
          ),
        );
      }
      break;
    }

    case 'waking': {
      if (cat) {
        tl.fromTo(
          cat,
          { scaleX: 1, scaleY: 1 },
          { scaleX: 1.06, scaleY: 0.96, duration: 0.8, yoyo: true, repeat: 1, ease: 'power2.inOut', transformOrigin: '50% 100%' },
        );
      }
      break;
    }

    case 'begging': {
      if (cat) {
        tl.fromTo(cat, { y: 0 }, { y: -8, duration: 0.3, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      }
      const pl = q(root, 'paw-left');
      const pr = q(root, 'paw-right');
      if (pl) {
        extra.push(
          gsap.fromTo(
            pl,
            { rotation: -10 },
            { rotation: 12, duration: 0.42, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '80% 80%' },
          ),
        );
      }
      if (pr) {
        extra.push(
          gsap.fromTo(
            pr,
            { rotation: 12 },
            { rotation: -10, duration: 0.42, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '20% 80%' },
          ),
        );
      }
      const bubble = q(root, 'hunger-bubble');
      if (bubble) {
        gsap.set(bubble, { transformOrigin: '50% 100%' });
        const pop = () =>
          gsap.fromTo(
            bubble,
            { scale: 0.6, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2.2)', yoyo: true, repeat: 1, repeatDelay: 2.4 },
          );
        pop();
        timers.push(setInterval(pop, 20_000));
      }
      break;
    }

    case 'eating': {
      if (head) {
        tl.fromTo(
          head,
          { rotation: 6 },
          { rotation: 10, duration: 0.175, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 95%' },
        );
      }
      const crumbs = children(q(root, 'crumbs'));
      if (crumbs.length) {
        crumbs.forEach((c, i) => {
          extra.push(
            gsap.fromTo(
              c,
              { y: 0, x: 0, opacity: 1 },
              {
                y: 4 + Math.random() * 4,
                x: (i % 2 ? 1 : -1) * (2 + Math.random() * 3),
                opacity: 0.4,
                duration: 0.28,
                yoyo: true,
                repeat: -1,
                ease: 'rough({ strength: 2, points: 12, template: none.out, randomize: true })',
              },
            ),
          );
        });
      }
      break;
    }

    case 'petted': {
      const hearts = children(q(root, 'hearts'));
      if (hearts.length) {
        tl.fromTo(
          hearts,
          { y: 0, opacity: 0, scale: 0.7 },
          {
            y: -20,
            opacity: 1,
            scale: 1,
            duration: 1.4,
            stagger: 0.28,
            repeat: -1,
            ease: 'sine.out',
            transformOrigin: '50% 50%',
          },
        );
      }
      if (tail) {
        extra.push(
          gsap.fromTo(
            tail,
            { rotation: -10 },
            { rotation: 10, duration: 0.34, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '20% 90%' },
          ),
        );
      }
      break;
    }

    case 'playing': {
      if (cat) {
        tl.fromTo(
          cat,
          { x: 0, y: 0 },
          { x: 14, y: -6, duration: 0.25, yoyo: true, repeat: -1, ease: 'power2.inOut' },
        );
      }
      const yarn = q(root, 'yarn');
      if (yarn) {
        extra.push(
          gsap.to(yarn, { rotation: 360, duration: 1.2, repeat: -1, ease: 'none', transformOrigin: '50% 50%' }),
        );
      }
      const yarnTail = q(root, 'yarn-tail');
      if (yarnTail) {
        extra.push(
          gsap.fromTo(
            yarnTail,
            { rotation: -8 },
            { rotation: 8, duration: 0.3, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '0% 50%' },
          ),
        );
      }
      const motion = q(root, 'motion-lines');
      if (motion) {
        extra.push(gsap.fromTo(motion, { opacity: 0.15 }, { opacity: 1, duration: 0.16, yoyo: true, repeat: -1, ease: 'none' }));
      }
      break;
    }

    case 'celebrating': {
      if (cat) {
        tl.fromTo(
          cat,
          { y: 0 },
          { y: -24, duration: 0.25, yoyo: true, repeat: 3, ease: 'power2.out' },
        );
      }
      const coin = q(root, 'coin');
      if (coin) {
        extra.push(
          gsap.fromTo(
            coin,
            { scaleX: 1 },
            { scaleX: -1, duration: 0.35, repeat: -1, yoyo: true, ease: 'sine.inOut', transformOrigin: '50% 50%' },
          ),
        );
      }
      const sparkles = children(q(root, 'sparkles'));
      if (sparkles.length) {
        extra.push(
          gsap.fromTo(
            sparkles,
            { scale: 0.4, opacity: 0.2 },
            {
              scale: 1.2,
              opacity: 1,
              duration: 0.5,
              stagger: 0.12,
              yoyo: true,
              repeat: -1,
              ease: 'sine.inOut',
              transformOrigin: '50% 50%',
            },
          ),
        );
      }
      break;
    }

    case 'sad': {
      const tear = q(root, 'tear');
      if (tear) {
        tl.fromTo(
          tear,
          { y: 0, opacity: 0 },
          { y: 16, opacity: 1, duration: 0.8, ease: 'power1.in', repeat: -1, repeatDelay: 0.8, yoyo: false },
        );
      }
      const cloud = q(root, 'cloud');
      if (cloud) {
        extra.push(
          gsap.fromTo(cloud, { x: -4 }, { x: 4, duration: 1.5, yoyo: true, repeat: -1, ease: 'sine.inOut' }),
        );
      }
      if (tail) {
        extra.push(
          gsap.fromTo(
            tail,
            { rotation: 0 },
            { rotation: -3, duration: 2.4, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '20% 90%' },
          ),
        );
      }
      break;
    }
  }

  return () => {
    tl.kill();
    extra.forEach((t) => t.kill());
    timers.forEach((t) => clearInterval(t));
    gsap.killTweensOf(root.querySelectorAll('*'));
  };
}

/**
 * Reduced-motion path: no looping tweens at all, but the state still reads
 * correctly — decorative groups that only make sense mid-animation (hearts,
 * zzz, sparkles) are simply shown at rest.
 */
function animatePetReduced(root: SVGSVGElement, state: PetState): Teardown {
  const showAtRest = ['hearts', 'zzz', 'sparkles', 'hunger-bubble', 'tear', 'motion-lines'];
  showAtRest.forEach((id) => {
    const el = q(root, id);
    if (el) gsap.set(el, { opacity: 1, y: 0, x: 0, scale: 1 });
  });
  void state;
  return NOOP;
}

// --- scenes ----------------------------------------------------------------

/** Ambient background loops, keyed off the manifest's `ambient` hints. */
export function animateScene(root: SVGSVGElement, scene: SceneId, reduced: boolean): Teardown {
  if (reduced) return NOOP;
  const tweens: gsap.core.Tween[] = [];

  if (scene === 'garden') {
    const clouds = q(root, 'clouds');
    if (clouds) tweens.push(gsap.fromTo(clouds, { x: -60 }, { x: 60, duration: 60, repeat: -1, yoyo: true, ease: 'none' }));
    const flowers = Array.from(root.querySelectorAll<SVGElement>('.flower'));
    flowers.forEach((f, i) => {
      tweens.push(
        gsap.fromTo(
          f,
          { rotation: -3 },
          {
            rotation: 3,
            duration: 2.5,
            yoyo: true,
            repeat: -1,
            ease: 'sine.inOut',
            transformOrigin: '50% 100%',
            delay: i * 0.3,
          },
        ),
      );
    });
    const butterfly = q(root, 'butterfly');
    if (butterfly) {
      tweens.push(
        gsap.to(butterfly, {
          keyframes: [
            { x: 60, y: -30, duration: 3 },
            { x: 120, y: 10, duration: 3 },
            { x: 40, y: -14, duration: 3 },
            { x: 0, y: 0, duration: 3 },
          ],
          repeat: -1,
          ease: 'sine.inOut',
        }),
      );
    }
  }

  if (scene === 'jungle') {
    const fireflies = children(q(root, 'fireflies'));
    fireflies.forEach((f, i) => {
      tweens.push(
        gsap.fromTo(
          f,
          { opacity: 0.3 },
          { opacity: 1, duration: 1.1 + Math.random() * 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: i * 0.22 },
        ),
      );
    });
    const leaves = q(root, 'big-leaves');
    if (leaves) {
      tweens.push(
        gsap.fromTo(
          leaves,
          { rotation: -1 },
          { rotation: 2, duration: 4, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 0%' },
        ),
      );
    }
    const vine = q(root, 'vine');
    if (vine) {
      tweens.push(
        gsap.fromTo(
          vine,
          { rotation: -1.5 },
          { rotation: 1.5, duration: 5.5, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 0%' },
        ),
      );
    }
  }

  if (scene === 'treehouse') {
    const bird = q(root, 'bird');
    if (bird) {
      tweens.push(
        gsap.fromTo(bird, { x: 500, opacity: 0 }, {
          x: -500,
          opacity: 1,
          duration: 25,
          repeat: -1,
          ease: 'none',
        }),
      );
    }
    const hanging = q(root, 'hanging-leaves');
    if (hanging) {
      tweens.push(
        gsap.fromTo(
          hanging,
          { rotation: -3 },
          { rotation: 3, duration: 3.5, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 0%' },
        ),
      );
    }
    const lantern = q(root, 'lantern');
    if (lantern) {
      tweens.push(
        gsap.fromTo(lantern, { opacity: 0.75 }, { opacity: 1, duration: 1.8, yoyo: true, repeat: -1, ease: 'sine.inOut' }),
      );
    }
  }

  if (scene === 'livingroom') {
    const glow = q(root, 'lamp-glow');
    if (glow) {
      tweens.push(
        gsap.fromTo(glow, { opacity: 0.42 }, { opacity: 0.58, duration: 3.2, yoyo: true, repeat: -1, ease: 'sine.inOut' }),
      );
    }
    const plant = q(root, 'plant');
    if (plant) {
      tweens.push(
        gsap.fromTo(
          plant,
          { rotation: -1 },
          { rotation: 1, duration: 5, yoyo: true, repeat: -1, ease: 'sine.inOut', transformOrigin: '50% 100%' },
        ),
      );
    }
  }

  return () => tweens.forEach((t) => t.kill());
}

/**
 * Pointer parallax. Layers translate by (normalised pointer offset × factor)
 * from the manifest. Disabled entirely under reduced motion.
 */
export function attachParallax(
  stage: HTMLElement,
  root: SVGSVGElement,
  scene: SceneId,
  reduced: boolean,
): Teardown {
  const factors = SCENES[scene].parallax;
  const layers = Object.entries(factors)
    .map(([id, factor]) => ({ el: q(root, id), factor }))
    .filter((l): l is { el: SVGElement; factor: number } => l.el != null && l.factor > 0);

  if (reduced || layers.length === 0) {
    layers.forEach((l) => gsap.set(l.el, { x: 0, y: 0 }));
    return NOOP;
  }

  const AMPLITUDE = 42; // scene units at full deflection

  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    layers.forEach(({ el, factor }) => {
      gsap.to(el, {
        x: -nx * AMPLITUDE * factor,
        y: -ny * AMPLITUDE * factor * 0.45,
        duration: 0.7,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    });
  };

  const onLeave = () => {
    layers.forEach(({ el }) => gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'power2.out', overwrite: 'auto' }));
  };

  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerleave', onLeave);
  return () => {
    stage.removeEventListener('pointermove', onMove);
    stage.removeEventListener('pointerleave', onLeave);
    layers.forEach((l) => gsap.killTweensOf(l.el));
  };
}

/**
 * Real-clock day/night for the living room. Night runs 19:00–06:00 local.
 * Re-evaluated every minute so a session can cross the boundary live.
 */
export function attachDayNight(root: SVGSVGElement, scene: SceneId): Teardown {
  if (!SCENES[scene].dayNight) return NOOP;

  const sky = q(root, 'window-sky');
  const sun = q(root, 'sun');
  const stars = q(root, 'stars');
  const glow = q(root, 'lamp-glow');

  const apply = (animate: boolean) => {
    const h = new Date().getHours();
    const night = h >= 19 || h < 6;
    const d = animate ? 1.2 : 0;
    if (sky) gsap.to(sky, { attr: { fill: night ? '#1E2A4A' : '#BEE3F2' }, duration: d });
    if (sun) gsap.to(sun, { opacity: night ? 0 : 1, duration: d });
    if (stars) gsap.to(stars, { opacity: night ? 1 : 0, duration: d });
    if (glow) gsap.to(glow, { opacity: night ? 0.8 : 0.45, duration: d });
  };

  apply(false);
  const id = setInterval(() => apply(true), 60_000);
  return () => clearInterval(id);
}

/** Heart/coin burst used on pet + reward moments. Pure GSAP + inline SVG. */
export function burst(layer: SVGGElement, x: number, y: number, glyph: 'heart' | 'coin' | 'star', reduced: boolean): void {
  if (reduced) return;
  const COUNT = 7;
  const made: SVGElement[] = [];
  for (let i = 0; i < COUNT; i++) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', GLYPH_PATH[glyph]);
    el.setAttribute('fill', GLYPH_FILL[glyph]);
    el.setAttribute('transform', `translate(${x} ${y}) scale(0.9)`);
    layer.appendChild(el);
    made.push(el);
  }
  const angleStep = (Math.PI * 2) / COUNT;
  made.forEach((el, i) => {
    const a = angleStep * i + Math.random() * 0.4;
    const dist = 40 + Math.random() * 34;
    gsap.fromTo(
      el,
      { opacity: 1, scale: 0.4 },
      {
        x: Math.cos(a) * dist,
        y: Math.sin(a) * dist - 24,
        opacity: 0,
        scale: 1.1 + Math.random() * 0.5,
        rotation: (Math.random() - 0.5) * 120,
        duration: 0.9 + Math.random() * 0.4,
        ease: 'power2.out',
        transformOrigin: '50% 50%',
        onComplete: () => el.remove(),
      },
    );
  });
}

const GLYPH_PATH: Record<'heart' | 'coin' | 'star', string> = {
  heart: 'M0 4 C-6 -2 -10 -6 -6 -10 C-3 -13 0 -10 0 -7 C0 -10 3 -13 6 -10 C10 -6 6 -2 0 4 Z',
  coin: 'M0 -8 A8 8 0 1 1 0 8 A8 8 0 1 1 0 -8 Z',
  star: 'M0 -9 L2.6 -2.8 L9 -2.4 L4 1.8 L5.6 8 L0 4.4 L-5.6 8 L-4 1.8 L-9 -2.4 L-2.6 -2.8 Z',
};

const GLYPH_FILL: Record<'heart' | 'coin' | 'star', string> = {
  heart: '#F5788F',
  coin: '#F5C542',
  star: '#FFE9A8',
};
