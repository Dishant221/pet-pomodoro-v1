/**
 * The wall clock: one small analog face per zone, top left of the stage.
 *
 * Analog because it is a *glance* widget. The countdown already gives exact
 * digits and takes the middle of the screen to do it; this one answers "is it
 * still morning in Berlin" from the corner of your eye, which a dial does
 * better than four characters of text.
 *
 * The exact time is not lost, though — every face carries it in its tooltip
 * and its accessible name, so a screen reader hears "Berlin, 09:02" rather
 * than being told there is a picture of a clock.
 *
 * Ticks live in this island and nowhere else. Hoisting `now` into the profile
 * store or into `Game` would re-render the whole stage once a second, and this
 * is a 34-pixel drawing.
 */
import { useEffect, useState } from 'preact/hooks';
import { digitalInZone, localZone, timeInZone, zoneLabel } from '../game/zones';

interface WallClockProps {
  /** Extra zones beside the player's own, already validated. */
  zones: string[];
  reduced: boolean;
}

/**
 * A single face.
 *
 * 34px across, which is small enough to sit beside three siblings on a phone
 * and large enough that the hour hand and the minute hand are telling apart at
 * a glance. Everything is drawn in a 40×40 user space and scaled by the CSS,
 * so the geometry below can use whole numbers.
 */
function Dial({ tz, at, reduced }: { tz: string; at: Date; reduced: boolean }) {
  const { h, m, s } = timeInZone(tz, at);
  const label = zoneLabel(tz, at);
  const digital = digitalInZone(tz, at);

  // The hour hand moves continuously — a hand that jumps a whole hour on the
  // hour reads as broken, and the half-past position is most of how you tell
  // a clock face apart from a clock face.
  const hourAngle = ((h % 12) + m / 60) * 30;
  const minuteAngle = (m + s / 60) * 6;
  const secondAngle = s * 6;

  // Night here, not the player's night: a dial for Tokyo should look like
  // Tokyo. This is the one thing the widget says beyond the time itself.
  const night = h < 6 || h >= 20;

  return (
    <div class="pp-dial" data-zone={tz} data-time={digital}>
      <svg
        viewBox="0 0 40 40"
        role="img"
        aria-label={`${label}, ${digital}`}
        // Title, not a wrapper `title` attribute: an SVG's own <title> is what
        // a browser shows on hover *and* what assistive tech falls back to.
      >
        <title>{`${label} — ${digital}`}</title>
        <circle class="pp-dial-face" cx="20" cy="20" r="18" data-night={String(night)} />
        {/* Quarter marks only. Twelve ticks at this size is a grey smudge. */}
        {[0, 90, 180, 270].map((a) => (
          <line key={a} class="pp-dial-tick" x1="20" y1="5" x2="20" y2="8" transform={`rotate(${a} 20 20)`} />
        ))}
        <line class="pp-dial-hour" x1="20" y1="20" x2="20" y2="12" transform={`rotate(${hourAngle} 20 20)`} />
        <line class="pp-dial-minute" x1="20" y1="20" x2="20" y2="8" transform={`rotate(${minuteAngle} 20 20)`} />
        {/* A sweeping second hand is motion for its own sake — the one thing a
            reduced-motion setting is asking to be spared. The clock is still
            correct without it. */}
        {!reduced && (
          <line class="pp-dial-second" x1="20" y1="23" x2="20" y2="7" transform={`rotate(${secondAngle} 20 20)`} />
        )}
        <circle class="pp-dial-pin" cx="20" cy="20" r="1.6" />
      </svg>
      <span class="pp-dial-label">{label}</span>
    </div>
  );
}

export default function WallClock({ zones, reduced }: WallClockProps) {
  const [now, setNow] = useState(() => new Date());
  const here = localZone();

  useEffect(() => {
    // A second when there is a second hand to move, ten when there is not —
    // without one the only thing that can change is the minute, and a
    // background tab redrawing four SVGs every second to show that nothing
    // happened is a battery cost with no pixel behind it.
    const every = reduced ? 10_000 : 1000;
    const id = setInterval(() => setNow(new Date()), every);
    return () => clearInterval(id);
  }, [reduced]);

  // The player's own zone always leads, and is never one of the extras: two
  // identical faces side by side looks like a rendering bug.
  const shown = [here, ...zones.filter((z) => z !== here)];

  return (
    <div class="pp-wallclock" role="group" aria-label="Wall clock">
      {shown.map((tz) => (
        <Dial key={tz} tz={tz} at={now} reduced={reduced} />
      ))}
    </div>
  );
}
