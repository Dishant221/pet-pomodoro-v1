/**
 * The one gate every piece of user-written text passes through before it can
 * touch the database. Pure and dependency-free, so it is trivially testable
 * and impossible to bypass by accident — community.ts refuses to INSERT
 * anything this file did not return `ok` for.
 *
 * House rule (owner's requirement): community text is PLAIN TEXT with NO
 * LINKS, no handles, no markup. The pipeline, in order:
 *
 *   1. type/length gate           — string, non-empty after trim, <= maxLen
 *   2. NFKC normalisation         — folds fullwidth/compatibility forms so
 *                                    "ｈｔｔｐ" and "example．com" become the
 *                                    ASCII the URL patterns below can see
 *   3. strip invisibles           — zero-width and bidi control characters
 *                                    are REMOVED (phone keyboards emit some
 *                                    innocently), which also de-cloaks
 *                                    "h[ZWSP]ttp://" style smuggling
 *   4. REJECT, not strip, on      — URL schemes, www., bare-domain TLD
 *                                    patterns, @handles, and any raw < or >
 *
 * Rejection over stripping is deliberate: stripping mangles legitimate text
 * unpredictably, the author learns the rule either way, and a spammer's
 * payload with the link removed is still spam in the queue.
 *
 * Defence in depth around this file: everything is rendered as text nodes
 * (Preact escapes by default; the `< >` rejection makes markup impossible at
 * the source anyway), and the CSP's `script-src 'self'` is the backstop.
 */

export type Sanitized = { ok: true; text: string } | { ok: false; reason: string };

/** Zero-width + bidi controls. Removal, not rejection — see header. */
const INVISIBLES = /[\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** URL schemes, after normalisation and invisible-stripping. */
const SCHEMES = /(?:https?|ftps?|mailto|tel|data|javascript|vbscript):/i;

/** www. anywhere, and bare domains on the TLDs link spam actually uses. */
const WWW = /\bwww\./i;
const BARE_DOMAIN =
  /\b[a-z0-9][a-z0-9-]{0,62}\.(?:com|net|org|io|co|xyz|info|biz|me|ru|cn|uk|de|in|app|dev|site|online|shop|store|top|club|link|gg|tv|ai|ly|to)\b/i;

/** @handles — the "contact me on telegram @x" spam shape. */
const HANDLE = /(^|\s)@[a-z0-9_.]{2,}/i;

export function sanitizeUserText(raw: unknown, maxLen: number): Sanitized {
  if (typeof raw !== 'string') return { ok: false, reason: 'text is required' };

  let text = raw.normalize('NFKC').replace(INVISIBLES, '');
  // Collapse blank-line runs; nobody needs a 40-newline comment.
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  if (!text) return { ok: false, reason: 'write something first' };
  if (text.length > maxLen) return { ok: false, reason: `too long — the limit is ${maxLen} characters` };

  if (/[<>]/.test(text)) return { ok: false, reason: 'angle brackets are not allowed' };
  if (SCHEMES.test(text) || WWW.test(text) || BARE_DOMAIN.test(text)) {
    return { ok: false, reason: "links aren't allowed here" };
  }
  if (HANDLE.test(text)) return { ok: false, reason: 'handles and mentions are not allowed' };

  return { ok: true, text };
}

/** Guest display names: tighter than body text — letters, digits, spaces and
 * a few name characters, and the same no-links rules via the main gate. */
export function sanitizeGuestName(raw: unknown): Sanitized {
  const base = sanitizeUserText(raw, 40);
  if (!base.ok) return base;
  if (!/^[\p{L}\p{N} .''-]+$/u.test(base.text)) {
    return { ok: false, reason: 'names can use letters, numbers, spaces, dots and dashes' };
  }
  return base;
}
