import { useEffect, useRef, useState } from 'preact/hooks';
import { SITE } from '../site';

/**
 * The 💬 that reaches a human.
 *
 * This began life inside `TalkBar`, which was the wrong parent: the talk bar
 * renders only where the pet's own controls do — every page in screen mode,
 * but only the game page in stage mode — so a stage player reading the blog
 * had no way to report the bug they were looking at. Support is a property of
 * the site, not of the pet, so it mounts from the layout on every route and
 * gates on nothing.
 *
 * It sits directly above the talk bar's corner. There is deliberately no mail
 * backend: the form composes the message and hands it to the user's own mail
 * client, which means there is no endpoint to spam, nothing stored, and the
 * user sees exactly what is sent. Everything user-typed goes through
 * encodeURIComponent, so newlines cannot smuggle extra headers into the
 * mailto URL.
 */

const SUPPORT_TOPICS = ['Support', 'Issue', 'Query'] as const;
type SupportTopic = (typeof SUPPORT_TOPICS)[number];

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<SupportTopic>('Support');
  const [msg, setMsg] = useState('');
  const msgRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) msgRef.current?.focus();
  }, [open]);

  const send = (e: Event) => {
    e.preventDefault();
    const body = msg.trim();
    if (!body) return;
    const subject = `PetPomo ${topic.toLowerCase()}`;
    window.location.href = `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setOpen(false);
    setMsg('');
  };

  return (
    <div class="pp-support-dock">
      {open ? (
        <form class="pp-support-panel" onSubmit={send}>
          <div class="pp-support-head">
            <strong>Contact support</strong>
            <button
              type="button"
              class="pp-support-close"
              aria-label="Close support form"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
          <select
            class="pp-support-topic"
            aria-label="What is this about?"
            value={topic}
            onChange={(e) => setTopic((e.currentTarget as HTMLSelectElement).value as SupportTopic)}
          >
            {SUPPORT_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            ref={msgRef}
            class="pp-support-msg"
            rows={4}
            maxLength={2000}
            placeholder="Describe your issue or question…"
            aria-label="Your message to support"
            value={msg}
            onInput={(e) => setMsg((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div class="pp-support-actions">
            <button type="submit" class="pp-support-send" disabled={!msg.trim()}>
              Send to {SITE.supportEmail}
            </button>
          </div>
          <p class="pp-support-note">
            Opens in your email app. For general enquiries see the <a href="/contact">contact page</a>.
          </p>
        </form>
      ) : (
        <button
          type="button"
          class="pp-support-toggle"
          aria-expanded={open}
          title="Message support — report an issue or ask a question"
          onClick={() => setOpen(true)}
        >
          <span aria-hidden="true">💬</span>
          <span class="sr-only">Message support — report an issue or ask a question</span>
        </button>
      )}
    </div>
  );
}
