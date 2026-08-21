import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $profile } from '../stores/profile';
import { $talk, canListen, clearBubble, sayTo, stopListening, toggleListening } from '../game/talk';

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
  const inputRef = useRef<HTMLInputElement>(null);

  const onScreen = profile.settings.petMode === 'screen';
  const mine = context === 'screen' ? onScreen : !onScreen;

  // A microphone must never outlive the control that opened it.
  useEffect(() => () => stopListening(), []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!mine) return null;

  const submit = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    setText('');
    if (t) void sayTo(t);
  };

  const listening = talk.listening;

  return (
    <div class="pp-talk" data-context={context} data-open={open ? 'true' : 'false'}>
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
