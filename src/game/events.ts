/**
 * Fire-and-forget analytics — the client half of worker/src/analytics.ts.
 *
 * Rules this file lives by:
 *  - NEVER throws, never awaited by gameplay, never logs (the acceptance
 *    suite fails on console errors, and `astro preview` has no /api at all).
 *  - sendBeacon first (survives page unloads — a gift click navigates away
 *    immediately), keepalive fetch as the fallback.
 *  - Events are anonymous unless a session cookie rides along; the server
 *    decides identity, the client only names what happened.
 *
 * What is tracked (the whole list): pomodoro session completions (with
 * focused minutes), gift letter opens, and external gift-link clicks (the
 * revenue attribution trail — AFFILIATES.md). No pageviews, no mouse paths.
 */
import { isBrowser } from '../stores/persist';

export type TrackedEvent =
  | { type: 'session_complete'; minutes: number }
  | { type: 'letter_open'; giftId: string }
  | { type: 'gift_click'; giftId: string; network: string; campaignId?: string };

export function track(event: TrackedEvent): void {
  if (!isBrowser) return;
  try {
    const body = JSON.stringify([event]);
    if (navigator.sendBeacon?.('/api/events', body)) return;
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* analytics must never be a reason anything else fails */
  }
}
