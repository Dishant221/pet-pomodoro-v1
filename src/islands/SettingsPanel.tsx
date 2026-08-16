import { useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import {
  $profile,
  applyAppearance,
  equip,
  exportJSON,
  importJSON,
  isOwned,
  resetAll,
  updateSettings,
} from '../stores/profile';
import type { ClockDock, ClockFont, ClockMode, ClockSize, Settings } from '../stores/profile';
import { syncDurations } from '../stores/timer';
import { SCENES, SCENE_IDS } from '../game/manifest';
import { THEME_ITEMS } from '../game/economy';
import { pull, push, getSyncCode, setSyncCode, newSyncCode } from '../game/sync';
import * as audio from '../game/audio';

export default function SettingsPanel() {
  const profile = useStore($profile);
  const s = profile.settings;
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [code, setCode] = useState(getSyncCode());
  const [syncing, setSyncing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3200);
  };

  const num = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch);
    syncDurations();
  };

  const handleNotifications = async (want: boolean) => {
    if (!want) {
      updateSettings({ notifications: false });
      return;
    }
    if (typeof Notification === 'undefined') {
      say('This browser does not support notifications.');
      return;
    }
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm === 'granted') {
      updateSettings({ notifications: true });
      say('Notifications on.');
    } else {
      updateSettings({ notifications: false });
      say('Permission denied — check your browser settings.');
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `petpomo-save-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    say('Save exported.');
  };

  const handleImportFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = importJSON(text);
    say(res.ok ? 'Save imported.' : `Import failed: ${res.error}`);
    input.value = '';
  };

  const handleReset = () => {
    resetAll();
    applyAppearance($profile.get());
    syncDurations();
    setConfirmReset(false);
    say('Everything reset.');
  };

  const handlePush = async () => {
    setSyncing(true);
    const res = await push();
    setSyncing(false);
    say(res.ok ? 'Uploaded to the cloud.' : `Upload failed: ${res.error}`);
  };

  const handlePull = async () => {
    setSyncing(true);
    const res = await pull();
    setSyncing(false);
    if (res.ok) {
      applyAppearance($profile.get());
      syncDurations();
      say('Downloaded from the cloud.');
    } else {
      say(`Download failed: ${res.error}`);
    }
  };

  return (
    <section class="pb-4">
      <header class="mb-5">
        <h1 class="text-2xl font-extrabold tracking-tight sm:text-3xl">Settings</h1>
        <p class="text-sm" style="color: var(--ink-soft)">
          Changes apply immediately and are saved on this device.
        </p>
      </header>

      {msg && (
        <p class="pp-card mb-4 px-3 py-2 text-sm font-semibold" role="status" aria-live="polite">
          {msg}
        </p>
      )}

      <div class="grid gap-4">
        <Group title="Timer">
          <Num label="Focus" value={s.focusMin} min={1} max={180} onInput={(v) => num({ focusMin: v })} suffix="min" />
          <Num label="Short break" value={s.shortMin} min={1} max={60} onInput={(v) => num({ shortMin: v })} suffix="min" />
          <Num label="Long break" value={s.longMin} min={1} max={90} onInput={(v) => num({ longMin: v })} suffix="min" />
          <Num
            label="Long break every"
            value={s.longEvery}
            min={2}
            max={12}
            onInput={(v) => num({ longEvery: v })}
            suffix="sessions"
          />
          <Toggle
            label="Auto-start breaks"
            hint="Roll straight into the break when the focus bell rings."
            checked={s.autoStartBreaks}
            onChange={(v) => updateSettings({ autoStartBreaks: v })}
          />
        </Group>

        <Group title="Clock">
          <Row label="Placement">
            <Choice
              value={s.clockMode}
              options={[
                { id: 'docked', label: 'Docked' },
                { id: 'float', label: 'Floating' },
              ]}
              onPick={(v) => updateSettings({ clockMode: v as ClockMode })}
            />
          </Row>
          <Row label="Countdown font">
            <Choice
              value={s.clockFont}
              options={[
                { id: 'rounded', label: 'Rounded' },
                { id: 'mono', label: 'Mono' },
                { id: 'serif', label: 'Serif' },
              ]}
              onPick={(v) => updateSettings({ clockFont: v as ClockFont })}
            />
          </Row>
          <Row label="Countdown size">
            <Choice
              value={s.clockSize}
              options={[
                { id: 'sm', label: 'Small' },
                { id: 'md', label: 'Medium' },
                { id: 'lg', label: 'Large' },
              ]}
              onPick={(v) => updateSettings({ clockSize: v as ClockSize })}
            />
          </Row>
          {s.clockMode === 'docked' ? (
            <Row label="Edge">
              <Choice
                value={s.clockDock}
                options={[
                  { id: 'top', label: 'Top' },
                  { id: 'left', label: 'Left' },
                ]}
                onPick={(v) => updateSettings({ clockDock: v as ClockDock })}
              />
            </Row>
          ) : (
            <Row label="Position">
              <span class="flex items-center gap-2">
                <span class="text-xs" style="color: var(--ink-soft)">
                  Drag the bar at the top of the clock, or nudge it with the arrow keys.
                </span>
                <button
                  type="button"
                  class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                  onClick={() => {
                    updateSettings({ clockX: 0.5, clockY: 0.04 });
                    say('Clock recentred.');
                  }}
                >
                  Recentre
                </button>
              </span>
            </Row>
          )}
        </Group>

        <Group title="World">
          <p class="text-sm" style="color: var(--ink-soft)">
            On <strong>Auto</strong> the world matches the one outside your window — your device's
            clock, your local weather, and the season where you are. Pin any of them to work in a
            fixed sky instead.
          </p>
          <Row label="Time of day">
            <Choice
              value={s.phaseMode}
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'dawn', label: 'Dawn' },
                { id: 'morning', label: 'Morning' },
                { id: 'noon', label: 'Noon' },
                { id: 'afternoon', label: 'Afternoon' },
                { id: 'dusk', label: 'Dusk' },
                { id: 'night', label: 'Night' },
              ]}
              onPick={(v) => updateSettings({ phaseMode: v as Settings['phaseMode'] })}
            />
          </Row>
          <Row label="Weather">
            <Choice
              value={s.weatherMode}
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'clear', label: 'Clear' },
                { id: 'cloudy', label: 'Cloudy' },
                { id: 'overcast', label: 'Overcast' },
                { id: 'fog', label: 'Fog' },
                { id: 'rain', label: 'Rain' },
                { id: 'snow', label: 'Snow' },
                { id: 'storm', label: 'Storm' },
              ]}
              onPick={(v) => updateSettings({ weatherMode: v as Settings['weatherMode'] })}
            />
          </Row>
          <Row label="Season">
            <Choice
              value={s.seasonMode}
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'spring', label: 'Spring' },
                { id: 'summer', label: 'Summer' },
                { id: 'autumn', label: 'Autumn' },
                { id: 'winter', label: 'Winter' },
              ]}
              onPick={(v) => updateSettings({ seasonMode: v as Settings['seasonMode'] })}
            />
          </Row>
        </Group>

        <Group title="Appearance">
          <Row label="Theme">
            <div class="flex flex-wrap gap-1.5">
              {THEME_ITEMS.map((t) => {
                const owned = isOwned(profile, 'themes', t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!owned}
                    onClick={() => {
                      equip('themes', t.id);
                      applyAppearance($profile.get());
                    }}
                    class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                    style={
                      profile.equipped.theme === t.id
                        ? 'background: var(--accent); color: var(--accent-ink); border-color: transparent;'
                        : ''
                    }
                    title={owned ? t.name : `Buy ${t.name} in the shop first`}
                  >
                    {t.name}
                    {!owned && <span aria-hidden="true"> 🔒</span>}
                  </button>
                );
              })}
            </div>
          </Row>

          <Row label="Scene">
            <div class="flex flex-wrap gap-1.5">
              {SCENE_IDS.map((id) => {
                const owned = isOwned(profile, 'scenes', id);
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!owned}
                    onClick={() => equip('scenes', id)}
                    class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                    style={
                      profile.equipped.scene === id
                        ? 'background: var(--accent); color: var(--accent-ink); border-color: transparent;'
                        : ''
                    }
                    title={owned ? SCENES[id].label : `Buy ${SCENES[id].label} in the shop first`}
                  >
                    {SCENES[id].label}
                    {!owned && <span aria-hidden="true"> 🔒</span>}
                  </button>
                );
              })}
            </div>
          </Row>

          <Toggle
            label="Reduce motion"
            hint="Turns off parallax, particles and looping animations."
            checked={s.reducedMotion}
            onChange={(v) => {
              updateSettings({ reducedMotion: v });
              applyAppearance($profile.get());
            }}
          />
        </Group>

        <Group title="Audio">
          <Toggle
            label="Sound"
            hint="Audio starts muted — browsers require a click before playing anything."
            checked={!s.muted}
            onChange={(v) => {
              updateSettings({ muted: !v });
              if (v) audio.unlock();
            }}
          />
          <Slider label="Master" value={s.volMaster} onInput={(v) => updateSettings({ volMaster: v })} />
          <Slider label="Effects" value={s.volSfx} onInput={(v) => updateSettings({ volSfx: v })} />
          <Slider label="Weather" value={s.volAmbient} onInput={(v) => updateSettings({ volAmbient: v })} />
          <Row label="Test">
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                onClick={() => audio.unlock().then(() => audio.playVoice(undefined, { force: true }))}
              >
                Meow
              </button>
              <button
                type="button"
                class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                onClick={() => audio.unlock().then(() => audio.playBell())}
              >
                Bell
              </button>
              <button
                type="button"
                class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                onClick={() => audio.unlock().then(() => audio.playCoin())}
              >
                Coin
              </button>
            </div>
          </Row>
        </Group>

        <Group title="Notifications">
          <Toggle
            label="Notify me when a timer ends"
            hint="Uses your browser's notification permission."
            checked={s.notifications}
            onChange={handleNotifications}
          />
        </Group>

        <Group title="Cloud sync (optional)">
          <p class="text-sm" style="color: var(--ink-soft)">
            No account needed. Your sync code <em>is</em> your key — keep it somewhere safe and paste it on another
            device to pull your save. Requires the Worker API to be deployed.
          </p>
          <Row label="Sync code">
            <div class="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={code}
                spellcheck={false}
                onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
                onBlur={() => setSyncCode(code)}
                placeholder="not set"
                class="pp-focus-ring min-w-0 flex-1 rounded-lg px-3 py-1.5 font-mono text-sm"
                style="background: var(--bg); border: 1px solid var(--border); color: var(--ink)"
              />
              <button
                type="button"
                class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                onClick={() => {
                  const c = newSyncCode();
                  setCode(c);
                  say('New sync code generated.');
                }}
              >
                Generate
              </button>
            </div>
          </Row>
          <Row label="Transfer">
            <div class="flex flex-wrap gap-1.5">
              <button type="button" disabled={syncing || !code} onClick={handlePush} class="pp-btn pp-focus-ring px-3 py-1.5 text-sm">
                Upload
              </button>
              <button type="button" disabled={syncing || !code} onClick={handlePull} class="pp-btn pp-focus-ring px-3 py-1.5 text-sm">
                Download
              </button>
            </div>
          </Row>
        </Group>

        <Group title="Your data">
          <Row label="Backup">
            <div class="flex flex-wrap gap-1.5">
              <button type="button" onClick={handleExport} class="pp-btn pp-focus-ring px-3 py-1.5 text-sm">
                Export JSON
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} class="pp-btn pp-focus-ring px-3 py-1.5 text-sm">
                Import JSON
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" class="hidden" onChange={handleImportFile} />
            </div>
          </Row>
          <Row label="Danger zone">
            {confirmReset ? (
              <div class="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setConfirmReset(false)} class="pp-btn pp-focus-ring px-3 py-1.5 text-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
                  style="background: #d95c5c; color: white; border-color: transparent"
                >
                  Yes, erase everything
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmReset(true)} class="pp-btn pp-focus-ring px-3 py-1.5 text-sm">
                Reset all progress
              </button>
            )}
          </Row>
        </Group>
      </div>
    </section>
  );
}

// --- form primitives ---------------------------------------------------------

function Group({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="pp-card p-4 sm:p-5">
      <h2 class="mb-3 text-sm font-bold uppercase tracking-wide" style="color: var(--ink-soft)">
        {title}
      </h2>
      <div class="grid gap-3">{children}</div>
    </div>
  );
}

/** A row of mutually exclusive buttons, styled like the theme/scene pickers. */
function Choice({
  value,
  options,
  onPick,
}: {
  value: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
}) {
  return (
    <div class="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onPick(o.id)}
          aria-pressed={value === o.id}
          class="pp-btn pp-focus-ring px-3 py-1.5 text-sm"
          style={
            value === o.id ? 'background: var(--accent); color: var(--accent-ink); border-color: transparent;' : ''
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm font-semibold">{label}</span>
      {children}
    </div>
  );
}

function Num({
  label,
  value,
  min,
  max,
  suffix,
  onInput,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onInput: (v: number) => void;
}) {
  return (
    <Row label={label}>
      <span class="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          onInput={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(v)) onInput(v);
          }}
          class="pp-focus-ring pp-tabular w-20 rounded-lg px-3 py-1.5 text-sm"
          style="background: var(--bg); border: 1px solid var(--border); color: var(--ink)"
          aria-label={`${label} in ${suffix}`}
        />
        <span class="text-xs" style="color: var(--ink-soft)">
          {suffix}
        </span>
      </span>
    </Row>
  );
}

function Slider({ label, value, onInput }: { label: string; value: number; onInput: (v: number) => void }) {
  return (
    <Row label={label}>
      <span class="flex items-center gap-2">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onInput={(e) => onInput(Number((e.currentTarget as HTMLInputElement).value))}
          class="pp-focus-ring w-40"
          style="accent-color: var(--accent)"
          aria-label={`${label} volume`}
        />
        <span class="pp-tabular w-9 text-right text-xs" style="color: var(--ink-soft)">
          {Math.round(value * 100)}%
        </span>
      </span>
    </Row>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="flex cursor-pointer items-start justify-between gap-3">
      <span class="min-w-0">
        <span class="block text-sm font-semibold">{label}</span>
        {hint && (
          <span class="block text-xs" style="color: var(--ink-soft)">
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        class="pp-focus-ring mt-0.5 h-5 w-5 shrink-0"
        style="accent-color: var(--accent)"
      />
    </label>
  );
}
