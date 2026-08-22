import * as audio from './audio';
import { pokePet } from './talk';
import { $profile } from '../stores/profile';

/**
 * Button feedback, installed once for the whole document.
 *
 * A single delegated listener rather than a handler per button: buttons are
 * everywhere (nav, shop, settings, the legal pages) and most of them are
 * server-rendered HTML with no island of their own, so there is nothing to
 * attach a prop to. Delegating from the document catches every one, including
 * markup that mounts later.
 *
 * On a press it does two things: a soft UI tap (`audio.playTap`) on every
 * click, and a throttled reaction from the pet — a meow, a bark, a little jump
 * (`pokePet`). Audio has to be unlocked by a user gesture before it makes a
 * sound; a click is exactly that gesture, so the first click also unlocks it.
 *
 * `click` rather than `pointerdown` so a keyboard-activated button (Enter or
 * Space on a focused control) gets the same feedback — the sound is about the
 * action, not the mouse.
 */
let installed = false;

export function installButtonFx(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener(
    'click',
    (e) => {
      const el = e.target as Element | null;
      // Only real buttons opt in: everything styled as a button carries
      // `pp-btn`, plus an explicit `data-fx="tap"` escape hatch for anything
      // that wants the feedback without the class.
      const btn = el?.closest?.('.pp-btn, [data-fx="tap"]') as HTMLElement | null;
      if (!btn) return;
      if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') return;

      // The mute setting silences the tap and the pet's voice; the pet still
      // performs its little visual reaction, which is not sound.
      if (!$profile.get().settings.muted) {
        void audio.unlock().then(() => audio.playTap());
      }
      pokePet();
    },
    { capture: true },
  );
}
