/**
 * The capability check, deliberately kept out of `engine.ts`.
 *
 * It has to run before anything decides whether to load the 3D stage at all,
 * and importing it from the engine would drag Three.js — the single largest
 * thing this app ships — into the critical path just to ask a question that a
 * bare canvas can answer. This module imports nothing.
 */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Run `fn` once the browser has a spare moment, instead of the instant the
 * engine chunk finishes downloading.
 *
 * The very first WebGL frame compiles shaders and builds the shadow map — the
 * single most expensive frame the engine ever draws. Firing it synchronously
 * inside the mount effect lands it right in the middle of initial hydration,
 * which is exactly the window page-load metrics like Total Blocking Time
 * measure. `requestIdleCallback` pushes it just past that window instead.
 */
export function whenIdle(fn: () => void): void {
  const ric = (window as typeof window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
    .requestIdleCallback;
  if (ric) ric(fn, { timeout: 500 });
  else setTimeout(fn, 1);
}
