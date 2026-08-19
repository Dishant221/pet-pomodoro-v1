/**
 * The page, read as ground for an animal to walk on.
 *
 * The DOM has no idea which of its boxes are furniture. A button is something a
 * cat could sit on; the paragraph next to it is not, even though both are
 * rectangles of similar size. That distinction has to be stated, and it is
 * stated here as a list of *controls and containers* — never of text.
 *
 * Everything is in viewport coordinates, because `getBoundingClientRect` is,
 * and because the pet is drawn in a `position: fixed` box. Sharing one space
 * with no scroll arithmetic removes a whole class of off-by-a-scroll bugs.
 */

export interface Ledge {
  left: number;
  right: number;
  /** Viewport y of the top edge — what the animal would stand on. */
  top: number;
}

/**
 * What counts as furniture.
 *
 * `p`, `h1`–`h6` and `li` are deliberately absent. The landing page is several
 * screens of prose and the animal should walk in front of all of it without
 * noticing; a cat that climbed every paragraph would be standing on the words
 * the page exists to show.
 */
const SOLID = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  'img',
  '.pp-panel',
  '.pp-card',
].join(',');

/** Narrower than this is not worth standing on. */
const MIN_LEDGE = 40;
/** More than a cat could ever care about; keeps a long page cheap. */
const MAX_LEDGES = 40;

/**
 * Where furniture stops and architecture starts.
 *
 * A `.pp-card` holding half the stats page is 486px wide and 183px tall. It is
 * in the selector list because a card *can* be furniture, but at that size it
 * is the room, not a thing in it — and treating it as a wall penned the animal
 * into an 8px strip at the edge of the window, where it sat down and stayed.
 *
 * A cat walks in front of the furniture that is bigger than the cat. So
 * anything past these bounds is scenery: no ledge, no wall, walked straight
 * past. Buttons, links, inputs and thumbnails all sit comfortably inside them.
 */
const MAX_OBJECT_FRACTION = 0.3;
const MAX_OBJECT_HEIGHT = 180;

export interface MeasureOptions {
  /** How far up from the bottom of the window counts as furniture. */
  band: number;
  /** The pet's own box, so it never treats itself as scenery. */
  exclude?: Element | null;
}

/**
 * Read the furniture near the bottom of the window.
 *
 * Every `getBoundingClientRect` in the companion happens inside this function,
 * in one batch, with no style writes between them. Reading rects interleaved
 * with writes is the classic layout thrash and costs far more frames than
 * drawing the animal does.
 */
export function measureTerrain(opts: MeasureOptions): Ledge[] {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const floor = vh - opts.band;
  const out: Ledge[] = [];

  const candidates = document.querySelectorAll<HTMLElement>(SOLID);
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (opts.exclude?.contains(el)) continue;

    const r = el.getBoundingClientRect();
    if (r.bottom < floor || r.top > vh) continue;
    if (r.width < MIN_LEDGE || r.height < 10) continue;
    if (r.right < 0 || r.left > vw) continue;
    // Too big to be a thing in the room — see MAX_OBJECT_FRACTION.
    if (r.width > vw * MAX_OBJECT_FRACTION || r.height > MAX_OBJECT_HEIGHT) continue;

    // Skip anything not actually painted — a collapsed menu, a hidden panel.
    // `checkVisibility` is recent enough to need a fallback.
    if (el.checkVisibility) {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    } else if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') {
      continue;
    }

    out.push({ left: r.left, right: r.right, top: r.top });
    if (out.length >= MAX_LEDGES) break;
  }
  return out;
}

/**
 * How high the floor is across a span, and nothing about what holds it up.
 *
 * Only ledges the animal could actually get onto count; anything taller is a
 * wall, which is `blockedBy`'s problem.
 */
export function groundAt(ledges: Ledge[], left: number, right: number, hopMax: number): number {
  const vh = window.innerHeight;
  let best = 0;
  for (let i = 0; i < ledges.length; i++) {
    const s = ledges[i];
    if (right < s.left || left > s.right) continue;
    const height = vh - s.top;
    if (height <= hopMax && height > best) best = height;
  }
  return best;
}

/** True when something too tall to climb overlaps the span. */
export function blockedBy(ledges: Ledge[], left: number, right: number, hopMax: number): boolean {
  const vh = window.innerHeight;
  for (let i = 0; i < ledges.length; i++) {
    const s = ledges[i];
    if (right < s.left || left > s.right) continue;
    if (vh - s.top > hopMax) return true;
  }
  return false;
}

/**
 * The rect of a focused text field near the bottom of the window, if there is
 * one.
 *
 * An animal sitting on the field you are typing into is a bug that feels like
 * an insult. Only text entry counts — fleeing every button press would be worse
 * than staying put, because the pet would spend the whole page running away
 * from the thing you just clicked.
 */
export function typingRect(band: number): DOMRect | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return null;
  const typing = a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable;
  if (!typing) return null;
  const r = a.getBoundingClientRect();
  return r.bottom > window.innerHeight - band - 40 ? r : null;
}
