import { useEffect, useState, type JSX } from 'react';

/**
 * Settings as the engine actually holds them.
 *
 * Read from the engine's own file rather than being told the values, so this screen cannot drift
 * away from what the engine would honour.
 */
interface EngineSettings {
  readonly path: string;
  /** Whether a settings file has been written yet. Distinct from every value being default. */
  readonly exists: boolean;
  readonly highResolutionRetentionDays: number;
  readonly autoStartOnGameDetected: boolean;
  readonly keepMeasuringWithWindowClosed: boolean;
  readonly liveWindowSeconds: number;
  readonly simulationMode: boolean;
}

interface SettingRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly explanation: string;
}

const base = import.meta.env.BASE_URL ?? '/';

async function loadSettings(): Promise<EngineSettings> {
  const response = await fetch(`${base}scenarios/settings.json`);
  if (!response.ok) throw new Error(`Settings unavailable (${response.status})`);
  return (await response.json()) as EngineSettings;
}

function rows(settings: EngineSettings): SettingRow[] {
  return [
    {
      key: 'retention-days',
      label: 'Keep full frame data for',
      value: `${settings.highResolutionRetentionDays} days`,
      explanation:
        'After this, a session keeps its summary and its events but not the frame-by-frame ' +
        'series. The summary is never deleted — reclaiming space by destroying the session ' +
        'index would destroy the regression history, which is what the history is for. ' +
        'The sweep runs when the measuring process starts and after a session is recorded, ' +
        'never while a game is running.',
    },
    {
      key: 'auto-start',
      label: 'Start measuring when a game is detected',
      value: settings.autoStartOnGameDetected ? 'yes' : 'no',
      explanation:
        'Off by default. A tool that starts recording without being asked is one you have to ' +
        'trust rather than verify.',
    },
    {
      key: 'keep-measuring',
      label: 'Keep measuring with the window closed',
      value: settings.keepMeasuringWithWindowClosed ? 'yes' : 'no',
      explanation:
        'The measuring process is separate from this window. With this on, closing the window ' +
        'disconnects the display and the session keeps running.',
    },
    {
      key: 'live-window-seconds',
      label: 'Live timeline shows',
      value: `${settings.liveWindowSeconds} seconds`,
      explanation:
        'Between 15 and 300. Below 15 a stutter and its recovery do not fit on screen ' +
        'together; above 300 one pixel column spans more than a second of frames and stops ' +
        'distinguishing a spike from a busy period.',
    },
    {
      key: 'simulation',
      label: 'Simulation mode',
      // The saved value, and what this window is actually doing, are two different facts. The
      // banner above says which one is in force; this row would otherwise appear to contradict
      // it, and would do so in the reassuring direction.
      value: `${settings.simulationMode ? 'on' : 'off'} (saved)`,
      explanation:
        'Runs the whole product against synthetic telemetry instead of this machine. Every ' +
        'number stays real pipeline output; only the input is invented, and the interface says ' +
        'so on every screen — including now, if the banner above is showing.',
    },
  ];
}

/**
 * Settings, and how to change them.
 *
 * There are no controls on this screen yet, and there are no controls that pretend to be. The
 * command channel from this window to the measuring process is not built, so a switch here would
 * be a switch that does nothing — the exact thing invariant 9 forbids. What is here instead is
 * the current value of every setting, read from the engine's own file, and the command that
 * changes it.
 *
 * The list is short on purpose. Every setting is one where the honest answer genuinely depends
 * on the person. There is deliberately no detection-sensitivity control: the threshold is
 * derived from the measured noise of this machine, and a slider over it would let someone tune
 * away the stutters instead of finding them.
 */
export function SettingsView(): JSX.Element {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="settings settings--empty">
        <p className="t-body">Could not read the settings file. {error}</p>
      </div>
    );
  }

  if (!settings) return <div className="app__loading t-body">Reading settings…</div>;

  return (
    <div className="settings">
      <header className="settings__head">
        <h1 className="t-title">Settings</h1>
        {/*
          It said "the values the measuring process is using right now", which was not true: this
          reads the settings file, and the file is what a *future* process would start from. On
          the screen whose whole premise is that it does not lie to you, that mattered — and it
          was self-refuting, since it reported simulation mode off underneath a simulation
          banner.
        */}
        <p className="t-body settings__lede">
          {settings.exists
            ? 'These are the values saved on this machine. A measuring process started now would use them.'
            : 'No settings file has been written yet, so these are the defaults a measuring process would start from.'}{' '}
          Changing them from this window is not built yet, so nothing here is a switch that does
          nothing — the command that changes each one is shown instead.
        </p>
      </header>

      <div className="settings__body">
        <dl className="settings__list">
          {rows(settings).map((row) => (
            <div key={row.key} className="setting">
              <dt className="setting__label t-body-strong">{row.label}</dt>
              <dd className="setting__value t-metric-sm">{row.value}</dd>
              <dd className="setting__explanation t-body-sm">{row.explanation}</dd>
              <dd className="setting__command t-mono-sm">
                framedoctor-engine settings {row.key} &lt;value&gt;
              </dd>
            </div>
          ))}
        </dl>

        <aside className="settings__aside">
          <h2 className="t-label">Where your data is</h2>
          <p className="t-body-sm">
            Settings are in a plain JSON file you can read and edit:
          </p>
          <p className="t-mono-sm settings__path">
            {settings.path}
            {!settings.exists ? (
              // A first run and a run after someone reset every value produce the same numbers
              // and are different situations.
              <span className="settings__pending"> — not written yet, these are the defaults</span>
            ) : null}
          </p>
          <p className="t-body-sm">
            Nothing is stored in the registry, so removing FrameDoctor leaves nothing behind.
            There is no account, nothing is uploaded, and there is no analytics of any kind. Every
            session stays on this machine.
          </p>

          <h2 className="t-label">Not settings</h2>
          <p className="t-body-sm">
            There is no detection sensitivity control. The threshold FrameDoctor uses is derived
            from the measured frame-to-frame noise of this machine, and it is shown on the Live
            view so you can see it. A slider over it would let you tune the stutters away instead
            of finding them.
          </p>
        </aside>
      </div>
    </div>
  );
}
