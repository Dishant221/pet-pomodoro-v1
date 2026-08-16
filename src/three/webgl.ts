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
