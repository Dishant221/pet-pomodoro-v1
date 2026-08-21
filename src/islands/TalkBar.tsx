import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile } from '../stores/profile';
import { $talk, canListen, clearBubble, sayTo, stopListening, toggleListening } from '../game/talk';
import { SITE } from '../site';

const SUPPORT_TOPICS = ['Support', 'Issue', 'Query'] as const;
type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/**
 * The control that talks to the pet.
 *
 * Deliberately *not* parented to the animal. The previous microphone was a 22px
 * circle pinned to the on-screen companion, which put it inside an element that
 * translates every frame and is clipped by `contain: paint` — so it walked away
 * from the pointer, and the reply bubble it was supposed to raise was painted
 * outside the clip and never seen at all. It also did not exist in stage mode,
 * where most players actually keep their pet.
 *
 * This lives at a fixed corner of the window instead: it does not move, it is
 * not clipped, and it is the same control in both modes. What it drives is the
 * shared store in `game/talk.ts`, so whichever pet is mounted performs the
 * reaction.
 *
 * The text field is always present, not just when the browser cannot transcribe.
 * That was the other half of "it does not respond": in Chrome, `speechAvailable`
 * is true, so the typed fallback never rendered and a player whose microphone
 * was blocked had no way to say anything at all.
 */

export interface TalkBarProps {
  /**
   * Which pet this instance belongs to, so exactly one is ever mounted: the
   * layout renders the `screen` one on every route, and the game renders the
   * `stage` one on the route that has a stage.
   */
  context: 'screen' | 'stage';
}

export default function TalkBar({ context }: TalkBarProps) {
  const profile = useStore($profile);
  const talk = useStore($talk);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportTopic, setSupportTopic] = useState<SupportTopic>('Support');
  const [supportMsg, setSupportMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const supportRef = useRef<HTMLTextAreaElement>(null);

  const onScreen = profile.settings.petMode === 'screen';
  const mine = context === 'screen' ? onScreen : !onScreen;

  // A microphone must never outlive the control that opened it.
  useEffect(() => () => stopListening(), []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (supportOpen) supportRef.current?.focus();
  }, [supportOpen]);

  if (!mine) return null;

  const submit = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    setText('');
    if (t) void sayTo(t);
  };

  const listening = talk.listening;

  // There is no mail backend, deliberately: the site has no accounts and no
  // server that can send on a user's behalf. The form composes the message and
  // hands it to the user's own mail client, which also means they keep a copy
  // and can see exactly what is being sent.
  const sendSupport = (e: Event) => {
    e.preventDefault();
    const body = supportMsg.trim();
    if (!body) return;
    const subject = `PetPomo ${supportTopic.toLowerCase()}`;
    window.location.href = `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSupportOpen(false);
    setSupportMsg('');
  };

  return (
    <div class="pp-talk" data-context={context} data-open={open ? 'true' : 'false'}>
      {/* Support sits above the talk controls so the two are never confused:
          the row below talks to the pet, this talks to the human behind it. */}
      {supportOpen ? (
        <form class="pp-support-panel" onSubmit={sendSupport}>
          <div class="pp-support-head">
            <strong>Contact support</strong>
            <button
              type="button"
              class="pp-support-close"
              aria-label="Close support form"
              onClick={() => setSupportOpen(false)}
            >
              ✕
            </button>
          </div>
          <select
            class="pp-support-topic"
            aria-label="What is this about?"
            value={supportTopic}
            onChange={(e) => setSupportTopic((e.currentTarget as HTMLSelectElement).value as SupportTopic)}
          >
            {SUPPORT_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            ref={supportRef}
            class="pp-support-msg"
            rows={4}
            maxLength={2000}
            placeholder="Describe your issue or question…"
            aria-label="Your message to support"
            value={supportMsg}
            onInput={(e) => setSupportMsg((e.currentTarget as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSupportOpen(false);
            }}
          />
          <div class="pp-support-actions">
            <button type="submit" class="pp-support-send" disabled={!supportMsg.trim()}>
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
          title="Message support — report an issue or ask a question"
          onClick={() => setSupportOpen(true)}
        >
          <span aria-hidden="true">💬</span>
          <span class="sr-only">Message support — report an issue or ask a question</span>
        </button>
      )}

      {/* The reply, and the only place it is shown. `polite` so it never cuts
          across whatever else is being announced. */}
      {talk.bubble && (
        <p class="pp-talk-bubble" aria-live="polite" onClick={clearBubble}>
          {talk.bubble}
        </p>
      )}

      <div class="pp-talk-row">
        {/* Only offered where it can actually work. Firefox and Safari cannot
            transcribe, and a control that is present and does nothing is worse
            than one that was never there — they get the text field, which is
            the same endpoint and the same reaction. */}
        {canListen() && (
          <button
            type="button"
            class="pp-talk-mic"
            data-on={listening ? 'true' : 'false'}
            aria-pressed={listening}
            title={listening ? 'Listening — click to stop' : 'Say something to your pet'}
            onClick={toggleListening}
          >
            <span aria-hidden="true">{listening ? '◉' : '🎤'}</span>
            <span class="sr-only">{listening ? 'Listening. Click to stop.' : 'Say something to your pet'}</span>
          </button>
        )}

        {open ? (
          <form class="pp-talk-form" onSubmit={submit}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              maxLength={200}
              placeholder="Say something…"
              aria-label="Say something to your pet"
              onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                  setText('');
                }
              }}
            />
            <button type="submit" class="pp-talk-send" disabled={!text.trim() || talk.thinking}>
              {talk.thinking ? '…' : 'Say'}
            </button>
          </form>
        ) : (
          <button type="button" class="pp-talk-open" onClick={() => setOpen(true)}>
            Talk to your pet
          </button>
        )}
      </div>
    </div>
  );
}
