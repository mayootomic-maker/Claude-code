import { useEffect, useState, type JSX } from 'react';
import { EventInspector } from './views/EventInspector';
import { LiveView } from './views/LiveView';
import { SystemView } from './views/SystemView';
import {
  loadScenario,
  loadScenarioIndex,
  type DetectedEvent,
  type Scenario,
  type ScenarioIndexEntry,
} from './telemetry/scenario';

type Section = 'live' | 'sessions' | 'system' | 'settings';

const SECTIONS: ReadonlyArray<{ id: Section; label: string; available: boolean }> = [
  { id: 'live', label: 'Live', available: true },
  // Marked unavailable rather than shown as an empty screen. Invariant 9: a control with no
  // implementation behind it is absent or explicitly unavailable, never a placeholder.
  { id: 'sessions', label: 'Sessions', available: false },
  { id: 'system', label: 'System', available: true },
  { id: 'settings', label: 'Settings', available: false },
];

export function App(): JSX.Element {
  const [section, setSection] = useState<Section>('live');
  const [index, setIndex] = useState<ScenarioIndexEntry[]>([]);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<DetectedEvent | null>(null);
  const [inspecting, setInspecting] = useState<DetectedEvent | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    loadScenarioIndex()
      .then((entries) => {
        setIndex(entries);
        if (entries.length > 0) return loadScenario(entries[0].id).then(setScenario);
        return undefined;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Seek to the end by default: the interesting part of a recorded scenario is all of it, and
  // an empty chart is a worse first impression than a full one.
  useEffect(() => {
    if (scenario) {
      setPlayheadMs(scenario.durationMs);
      setSelectedEvent(null);
      setInspecting(null);
    }
  }, [scenario]);

  useEffect(() => {
    if (!playing || !scenario) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const delta = now - last;
      last = now;
      setPlayheadMs((t) => (t + delta >= scenario.durationMs ? scenario.durationMs : t + delta));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, scenario]);

  useEffect(() => {
    if (!inspecting) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspecting(null);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspecting]);

  const selectScenario = (id: string) => {
    setPlaying(false);
    loadScenario(id)
      .then(setScenario)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="app">
      {/*
        Not dismissible, on every screen, and therefore in every screenshot. A corner badge
        would be missing from the screenshot someone pastes into an issue, and a wrong
        diagnosis would then be debugged as if it were real.
      */}
      <div className="simulation-banner" role="status">
        <strong>Simulation</strong>
        {scenario ? ` — ${scenario.title}. ` : ' — '}
        No real telemetry. Every number is real pipeline output over synthetic input.
      </div>

      <div className="app__body">
        <nav className="rail" aria-label="Sections">
          <div className="rail__brand t-label">FrameDoctor</div>
          <ul className="rail__list">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="rail__item t-nav"
                  data-active={section === s.id || undefined}
                  disabled={!s.available}
                  title={s.available ? undefined : 'Not implemented yet'}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                  {!s.available ? <span className="rail__pending">not built</span> : null}
                </button>
              </li>
            ))}
          </ul>

          <div className="rail__scenarios">
            <div className="t-label rail__scenarios-title">Scenario</div>
            {index.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="rail__scenario t-body-sm"
                data-active={scenario?.id === entry.id || undefined}
                onClick={() => selectScenario(entry.id)}
                title={entry.description}
              >
                {entry.title}
              </button>
            ))}
          </div>

          <div className="rail__foot">
            <div className="t-label-sm">Own overhead</div>
            {/* Deliberately not a number yet. Invariant 8 makes our overhead a measured metric,
                and it has never been measured on Windows, so claiming a figure would be fake. */}
            <div className="t-mono-sm rail__foot-value">not yet measured</div>
          </div>
        </nav>

        <main className="app__main">
          {error ? (
            <div className="app__error t-body">
              <strong>Could not load telemetry.</strong> {error}
              <p className="t-body-sm">
                Scenario fixtures are produced by <code>framedoctor export-all</code>. Run it and
                reload.
              </p>
            </div>
          ) : section === 'system' ? (
            scenario ? (
              <SystemView scenario={scenario} />
            ) : (
              <div className="app__loading t-body">Loading telemetry…</div>
            )
          ) : section !== 'live' ? (
            <div className="app__unbuilt t-body">
              <h2 className="t-title">{SECTIONS.find((s) => s.id === section)?.label}</h2>
              <p>
                Not built yet. It is listed here so the navigation reflects the intended product,
                and disabled so it cannot pretend to work.
              </p>
            </div>
          ) : !scenario ? (
            <div className="app__loading t-body">Loading telemetry…</div>
          ) : inspecting ? (
            <EventInspector
              scenario={scenario}
              event={inspecting}
              onClose={() => setInspecting(null)}
            />
          ) : (
            <LiveView
              scenario={scenario}
              playheadMs={playheadMs}
              selectedEvent={selectedEvent}
              onSelectEvent={(event) => {
                // First click selects and shows the diagnosis beside the chart; a second click
                // on the same event opens it in full. Opening the inspector on every click
                // would make the timeline unusable for scanning.
                if (selectedEvent?.startMs === event.startMs) setInspecting(event);
                else setSelectedEvent(event);
              }}
            />
          )}
        </main>
      </div>

      {/* The transport belongs to the Live timeline. On a screen with no timeline it would be a
          control that appears to do nothing. */}
      {scenario && !inspecting && section === 'live' ? (
        <footer className="transport">
          <button
            type="button"
            className="transport__button t-body-sm"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            className="transport__scrub"
            type="range"
            min={0}
            max={Math.round(scenario.durationMs)}
            value={Math.round(playheadMs)}
            aria-label="Playhead"
            onChange={(e) => {
              setPlaying(false);
              setPlayheadMs(Number(e.target.value));
            }}
          />
          <span className="t-mono transport__time">
            {(playheadMs / 1000).toFixed(1)}s / {(scenario.durationMs / 1000).toFixed(0)}s
          </span>
        </footer>
      ) : null}
    </div>
  );
}
