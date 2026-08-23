import { useMemo, type JSX } from 'react';
import { MetricPanel } from '../components/MetricPanel';
import type { MetricPanelRange, MetricPanelTheme } from '../charts/metricPanel';
import { Availability, Quality, UnavailableReason } from '../telemetry/availability';
import { describeCap, isCapActionable } from '../telemetry/confidence';
import type { DetectedEvent, MetricSeries, Scenario } from '../telemetry/scenario';

/**
 * How far either side of the event to show.
 *
 * The same padding the diagnostic engine uses to build its correlation window. Showing more
 * than the engine saw would invite a reader to attribute the event to something the diagnosis
 * never considered; showing less would hide evidence the diagnosis did use.
 */
const PADDING_MS = 2000;

/** How a metric is labelled and formatted here. Order is the reading order of the grid. */
const PANELS: ReadonlyArray<{
  readonly metric: string;
  readonly label: string;
  readonly unit: string;
  readonly precision: number;
}> = [
  { metric: 'CpuLoadTotal', label: 'CPU load', unit: '%', precision: 0 },
  { metric: 'CpuClockEffective', label: 'CPU clock', unit: 'MHz', precision: 0 },
  { metric: 'CpuTemperature', label: 'CPU temperature', unit: '°C', precision: 0 },
  { metric: 'CpuDpcTime', label: 'DPC time', unit: '%', precision: 2 },
  { metric: 'CpuIsrTime', label: 'Interrupt time', unit: '%', precision: 2 },
  { metric: 'GpuUtilization', label: 'GPU load', unit: '%', precision: 0 },
  { metric: 'GpuClockCore', label: 'GPU core clock', unit: 'MHz', precision: 0 },
  { metric: 'GpuTemperature', label: 'GPU temperature', unit: '°C', precision: 0 },
  { metric: 'GpuPower', label: 'GPU power', unit: 'W', precision: 0 },
  { metric: 'MemoryAvailable', label: 'Memory free', unit: 'MB', precision: 0 },
  { metric: 'MemoryHardFaults', label: 'Hard page faults', unit: '/s', precision: 0 },
  { metric: 'DiskLatency', label: 'Disk response', unit: 'ms', precision: 1 },
];

interface EventInspectorProps {
  readonly scenario: Scenario;
  readonly event: DetectedEvent;
  readonly onClose: () => void;
}

function token(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * One event, in full.
 *
 * The Live view answers "what just happened". This answers "why should I believe that", and it
 * is the screen that separates FrameDoctor from a frame counter with an opinion. Everything the
 * diagnosis rested on is here: the evidence with its sample counts, the hypotheses that were
 * tested and rejected, the ones that could not be tested at all, and every metric the engine
 * could see over the same window it saw.
 */
export function EventInspector({ scenario, event, onClose }: EventInspectorProps): JSX.Element {
  const range: MetricPanelRange = {
    fromMs: event.startMs - PADDING_MS,
    toMs: event.endMs + PADDING_MS,
    eventStartMs: event.startMs,
    eventEndMs: event.endMs,
  };

  const theme: MetricPanelTheme = useMemo(
    () => ({
      background: token('--bg-raised', '#11151c'),
      gridLine: token('--chart-grid', '#1b212b'),
      axisText: token('--chart-axis', '#7a8494'),
      trace: token('--chart-trace', '#c9d4e3'),
      eventSpan: token('--chart-event-span', 'rgb(242 103 97 / 16%)'),
      eventEdge: token('--chart-event-edge', 'rgb(242 103 97 / 45%)'),
      baseline: token('--chart-baseline', '#606d7c'),
      gap: token('--chart-hatch', '#1e242e'),
    }),
    [],
  );

  const byMetric = useMemo(() => {
    const map = new Map<string, MetricSeries>();
    // Instance -1 is the whole-machine series. Per-process and per-core instances are evidence
    // in their own right but belong in the evidence list, not in a grid of twelve panels.
    for (const series of scenario.series) {
      if (series.instance === -1 && !map.has(series.metric)) map.set(series.metric, series);
    }
    return map;
  }, [scenario]);

  const citedMetrics = useMemo(
    () => new Set(event.evidence.map((e) => e.metric.split('[')[0])),
    [event],
  );

  const checkable = event.ruledOut.filter((r) => r.wasCheckable);
  const blindSpots = event.ruledOut.filter((r) => !r.wasCheckable);

  const explained = event.ruleId !== null && event.confidence !== null;

  return (
    <div className="inspector">
      <header className="inspector__head">
        <div className="inspector__identity">
          <span className="inspector__class" data-class={event.className.toLowerCase()}>
            {event.className.replace(/([a-z])([A-Z])/g, '$1 $2')}
          </span>
          <h1 className="t-title inspector__title">
            {explained ? event.title : 'Unexplained event'}
          </h1>
          <span className="t-mono-sm inspector__when">
            at {(event.startMs / 1000).toFixed(2)}s · {event.frameCount} frame
            {event.frameCount === 1 ? '' : 's'}
            {event.mergedCount > 0 ? ` · ${event.mergedCount} merged` : ''}
          </span>
        </div>

        <button type="button" className="inspector__close t-body-sm" onClick={onClose}>
          Back to Live
        </button>
      </header>

      {/*
        The measurement, before any interpretation. A reader who disagrees with the diagnosis can
        still use these numbers, and they are the ones that make the event reproducible: the
        threshold and baseline in force at the time are what the detector actually compared
        against, not what it would compare against now.
      */}
      <section className="inspector__facts">
        <Fact label="Peak frame time" value={event.peakFrameTimeMs.toFixed(1)} unit="ms" />
        {/*
          Over the baseline, not over the threshold. `excessMs` is peak minus the baseline
          median, and the old label invited a reader to check 88.0 − 3.5 = 84.5 against a
          displayed 81.1 and conclude the detector was broken — on the strip that exists so the
          arithmetic can be checked.
        */}
        <Fact label="Excess over baseline" value={event.excessMs.toFixed(1)} unit="ms" />
        <Fact label="Threshold in force" value={event.thresholdMs.toFixed(1)} unit="ms" />
        <Fact label="Baseline median" value={event.baselineMedianMs.toFixed(2)} unit="ms" />
        {/*
          A single-frame event has zero width by construction: its start and end are the same
          instant. Printing "0.00 s" beside a frame that took 88 ms is a plausible-looking zero
          standing in for a known non-zero quantity, which is the failure this product exists to
          avoid. The frame count says what a duration cannot.
        */}
        <Fact
          label="Duration"
          value={
            event.endMs > event.startMs
              ? ((event.endMs - event.startMs) / 1000).toFixed(2)
              : `${event.frameCount}`
          }
          unit={event.endMs > event.startMs ? 's' : event.frameCount === 1 ? 'frame' : 'frames'}
        />
        <Fact
          label="Confidence"
          value={explained ? (event.confidence! * 100).toFixed(0) : '—'}
          unit={explained ? '%' : ''}
          // Without this the number is the number alone, and 60 % reads as weak evidence when
          // the truth is often strong evidence held back by a missing sensor — which is a fact
          // about the machine the reader can act on, not a fact about the finding.
          note={explained && event.bindingCap !== 0 ? describeCap(event.bindingCap) : undefined}
          noteTone={isCapActionable(event.bindingCap) ? 'action' : undefined}
        />
      </section>

      <div className="inspector__body">
        <section className="inspector__narrative">
          <h2 className="t-label">What happened</h2>
          <p className="t-body">{event.whatHappened}</p>

          {event.mechanism ? (
            <>
              <h2 className="t-label">Why</h2>
              <p className="t-body">{event.mechanism}</p>
            </>
          ) : null}

          <h2 className="t-label">Evidence</h2>
          {event.evidence.length > 0 ? (
            <ul className="inspector__evidence">
              {event.evidence.map((item) => (
                <li key={`${item.metric}-${item.statement}`} data-role={item.role.toLowerCase()}>
                  <span className="t-body">{item.statement}</span>
                  <span className="t-mono-sm inspector__provenance">
                    {item.sampleCount} sample{item.sampleCount === 1 ? '' : 's'}
                    {item.nativeRateHz !== null ? ` · ${item.nativeRateHz.toFixed(1)} Hz` : ''}
                    {item.quality !== 'Exact' ? ` · ${item.quality.toLowerCase()}` : ''}
                    {/*
                      Whether the series resolves finely enough to say the change came first.
                      A 1 Hz metric cannot establish that it moved before a 40 ms stutter, and
                      saying so is the difference between evidence and coincidence.
                    */}
                    {!item.canEstablishOrdering ? ' · too coarse to order' : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-body inspector__none">
              Nothing the engine can measure changed around this event.
            </p>
          )}

          <h2 className="t-label">Ruled out</h2>
          <ul className="inspector__ruled-out">
            {checkable.map((item) => (
              <li key={item.title}>
                <span className="t-body-strong">{item.title}</span>
                <span className="t-body inspector__reason"> — {item.reason}</span>
              </li>
            ))}
          </ul>

          {blindSpots.length > 0 ? (
            <>
              {/*
                Kept separate from the ruled-out list on purpose. "Checked and excluded" and
                "could not be checked" are different claims, and merging them would let an
                unmeasurable cause read as an eliminated one.
              */}
              <h2 className="t-label">Could not be checked</h2>
              <ul className="inspector__blind-spots">
                {blindSpots.map((item) => (
                  <li key={item.title}>
                    <span className="t-body-strong">{item.title}</span>
                    <span className="t-body inspector__reason"> — {item.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {event.recommendedAction ? (
            <>
              <h2 className="t-label">What you can do</h2>
              <p className="t-body">{event.recommendedAction}</p>
            </>
          ) : null}
        </section>

        <section className="inspector__panels" aria-label="Metrics over the event window">
          <div className="inspector__panels-head">
            <span className="t-label">
              Every metric, {PADDING_MS / 1000}s either side
            </span>
            <span className="t-label-sm inspector__panels-note">
              {/*
                The marker meant something and said so nowhere. A blue edge on two of twelve
                panels is countable at a glance and uninterpretable without this, and it was
                invisible to a screen reader entirely.
              */}
              <span className="inspector__key" aria-hidden="true" /> cited as evidence · change
              measured against the last reading before the event · stepped at each metric&rsquo;s
              own sample rate, never interpolated
            </span>
          </div>

          <div className="inspector__grid">
            {PANELS.map((panel) => {
              // A metric this machine never produced still gets a panel. Dropping it would make
              // the grid look complete, and the gap in coverage is exactly what a reader needs
              // to see to understand why a confidence was capped.
              const series = byMetric.get(panel.metric) ?? absentSeries(panel.metric);

              return (
                <MetricPanel
                  key={panel.metric}
                  series={series}
                  label={panel.label}
                  unit={panel.unit}
                  precision={panel.precision}
                  range={range}
                  theme={theme}
                  isEvidence={citedMetrics.has(panel.metric)}
                />
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * A placeholder series for a metric this machine never produced.
 *
 * Carries no samples and an explicit reason, so the panel renders as unavailable in exactly the
 * same way a sensor that failed mid-session does. There is no code path here that can produce a
 * number.
 */
function absentSeries(metric: string): MetricSeries {
  return {
    metric,
    metricId: 0,
    instance: -1,
    unit: 'None',
    availability: Availability.Unavailable,
    reason: UnavailableReason.NoSensor,
    quality: Quality.Exact,
    // No collector claimed it, which is the point: there is no source to name.
    source: 'None',
    sourceId: 0,
    timestamps: [],
    values: [],
  };
}

function Fact({
  label,
  value,
  unit,
  note,
  noteTone,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly note?: string | undefined;
  readonly noteTone?: 'action' | undefined;
}): JSX.Element {
  return (
    <div className="fact">
      <div className="t-label fact__label">{label}</div>
      <div className="t-metric-md fact__value">
        {value}
        {unit ? <span className="fact__unit">{unit}</span> : null}
      </div>
      {note ? (
        <div className="fact__note t-label-sm" data-tone={noteTone}>
          capped — {note}
        </div>
      ) : null}
    </div>
  );
}
