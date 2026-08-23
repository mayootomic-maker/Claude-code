import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { DiagnosisPanel } from '../components/DiagnosisPanel';
import { FrameTimeChart } from '../components/FrameTimeChart';
import { MetricReadout } from '../components/MetricReadout';
import {
  Availability,
  Quality,
  UnavailableReason,
  available,
  unavailable,
  type MetricValue,
} from '../telemetry/availability';
import { SampleRing } from '../telemetry/ringBuffer';
import { findSeries, sampleAt, type DetectedEvent, type Scenario } from '../telemetry/scenario';

/** How often derived headline numbers reach React. Never per sample. */
const COMMIT_INTERVAL_MS = 100;

const WINDOW_SECONDS = 60;

/** Telemetry strip contents: what a glance should cover, and nothing else. */
const STRIP: ReadonlyArray<{ metric: string; label: string; unit: string; precision: number }> = [
  { metric: 'CpuLoadTotal', label: 'CPU', unit: '%', precision: 0 },
  { metric: 'CpuClockEffective', label: 'CPU clock', unit: 'MHz', precision: 0 },
  { metric: 'CpuDpcTime', label: 'DPC', unit: '%', precision: 1 },
  { metric: 'CpuTemperature', label: 'CPU temp', unit: '°C', precision: 0 },
  { metric: 'GpuUtilization', label: 'GPU', unit: '%', precision: 0 },
  { metric: 'GpuClockCore', label: 'GPU clock', unit: 'MHz', precision: 0 },
  { metric: 'GpuTemperature', label: 'GPU temp', unit: '°C', precision: 0 },
  { metric: 'MemoryAvailable', label: 'RAM free', unit: 'MB', precision: 0 },
  { metric: 'MemoryHardFaults', label: 'Hard faults', unit: '/s', precision: 0 },
  { metric: 'DiskLatency', label: 'Disk', unit: 'ms', precision: 1 },
];

interface LiveViewProps {
  readonly scenario: Scenario;
  readonly playheadMs: number;
  readonly onSelectEvent: (event: DetectedEvent) => void;
  readonly selectedEvent: DetectedEvent | null;
}

/**
 * The main screen.
 *
 * Within about two seconds it must answer: what is running, is performance healthy, what are
 * the frame numbers, did something just happen, and what caused it. Everything on it earns its
 * place against one of those five questions.
 */
export function LiveView({
  scenario,
  playheadMs,
  onSelectEvent,
  selectedEvent,
}: LiveViewProps): JSX.Element {
  const ringRef = useRef<SampleRing | null>(null);
  const filledToRef = useRef(0);

  // One ring per scenario, sized for the visible window at the scenario's frame rate with
  // generous headroom for uncapped rendering.
  if (ringRef.current === null) {
    ringRef.current = new SampleRing(Math.max(4096, Math.ceil(scenario.refreshRateHz * WINDOW_SECONDS * 4)));
  }
  const ring = ringRef.current;

  useEffect(() => {
    ring.clear();
    filledToRef.current = 0;
  }, [ring, scenario.id]);

  // Feed the ring up to the playhead. Seeking backwards refills from scratch, which is the
  // honest thing to do: the ring is a window, not a history.
  useEffect(() => {
    if (playheadMs < filledToRef.current) {
      ring.clear();
      filledToRef.current = 0;
    }

    let i = 0;
    if (filledToRef.current > 0) {
      while (i < scenario.frameTimestamps.length && scenario.frameTimestamps[i] <= filledToRef.current) i++;
    }

    for (; i < scenario.frameTimestamps.length; i++) {
      const t = scenario.frameTimestamps[i];
      if (t > playheadMs) break;
      ring.push(t, scenario.frameTimes[i]);
    }
    filledToRef.current = playheadMs;
  }, [ring, scenario, playheadMs]);

  // React sees derived numbers at 10 Hz, never samples. This is the whole discipline.
  const [, forceCommit] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => forceCommit((n) => n + 1), COMMIT_INTERVAL_MS);
    return () => clearInterval(handle);
  }, []);

  const eventsSoFar = useMemo(
    () => scenario.events.filter((e) => e.startMs <= playheadMs),
    [scenario.events, playheadMs],
  );

  const latest = eventsSoFar.length > 0 ? eventsSoFar[eventsSoFar.length - 1] : null;
  const shown = selectedEvent ?? latest;

  const rollingFps = useRollingFps(ring, playheadMs);
  const strip = useStrip(scenario, playheadMs);

  const elapsed = formatElapsed(playheadMs);
  const countedEvents = eventsSoFar.filter((e) => e.countsTowardTally);
  const severeEvents = countedEvents.filter((e) => e.className === 'SevereHitch');

  const availableSeries = scenario.series.filter((s) => s.availability === Availability.Available).length;
  const totalSeries = scenario.series.length;

  return (
    <div className="live">
      <header className="live__header">
        <div className="live__game">
          <span className="live__status-dot" data-state={latest ? 'warning' : 'normal'} />
          <span className="t-subtitle">{scenario.title}</span>
          <span className="t-mono live__exe">simulated · {scenario.id}</span>
        </div>
        <div className="live__header-right">
          <span className="t-label">Elapsed</span>
          <span className="t-metric-md">{elapsed}</span>
          <span className="t-label live__display">{scenario.refreshRateHz} Hz</span>
          <span
            className="live__telemetry-chip t-label-sm"
            data-degraded={availableSeries < totalSeries || undefined}
            title={
              availableSeries < totalSeries
                ? `${totalSeries - availableSeries} metric(s) unavailable on this hardware`
                : 'All telemetry sources reporting'
            }
          >
            Telemetry {availableSeries}/{totalSeries}
          </span>
        </div>
      </header>

      <section className="live__metrics" aria-label="Headline metrics">
        <MetricReadout
          label="FPS · rolling"
          metric={rollingFps}
          unit="fps"
          precision={0}
          size="hero"
          detail={
            scenario.medianFrameTimeMs !== null
              ? `median ${scenario.medianFrameTimeMs.toFixed(1)} ms`
              : undefined
          }
        />
        <MetricReadout
          label="Frame time p99"
          metric={toMetric(scenario.p99FrameTimeMs)}
          unit="ms"
          precision={1}
          size="large"
        />
        {/* 1% low sits at the same weight as FPS elsewhere in the product because consistency
            is the thesis; here it is one step down only because FPS answers "right now". */}
        <MetricReadout
          label="1 % low"
          metric={toMetric(scenario.low1PercentFps)}
          unit="fps"
          precision={0}
          size="large"
          detail={`${scenario.frameCount.toLocaleString()} frames`}
        />
        <MetricReadout
          label="Events"
          metric={available(countedEvents.length)}
          precision={0}
          size="large"
          detail={
            severeEvents.length > 0
              ? `${severeEvents.length} severe`
              : countedEvents.length === 0
                ? 'none detected'
                : 'none severe'
          }
        />
        <MetricReadout
          label="Detection floor"
          metric={toMetric(scenario.sensitivityFloorMs)}
          unit="ms"
          precision={1}
          size="medium"
          detail="smallest excess resolvable"
        />
      </section>

      <section className="live__strip" aria-label="System telemetry">
        {STRIP.map(({ metric, label, unit, precision }) => (
          <MetricReadout
            key={metric}
            label={label}
            metric={strip[metric] ?? unavailable(UnavailableReason.NotYetSampled)}
            unit={unit}
            precision={precision}
            size="medium"
          />
        ))}
      </section>

      <FrameTimeChart
        ring={ring}
        nowMs={playheadMs}
        windowSeconds={WINDOW_SECONDS}
        refreshIntervalMs={1000 / scenario.refreshRateHz}
        baselineMs={latest?.baselineMedianMs ?? scenario.medianFrameTimeMs}
        thresholdMs={latest?.thresholdMs ?? null}
        events={eventsSoFar}
        selectedEventStartMs={shown?.startMs ?? null}
        onSelectEvent={onSelectEvent}
      />

      <div className="live__lower">
        <DiagnosisPanel event={shown} />

        <section className="live__log" aria-label="Session events">
          <h2 className="t-label live__log-title">Session events</h2>
          {eventsSoFar.length === 0 ? (
            <p className="t-body-sm live__log-empty">
              Nothing detected. Excesses below {scenario.sensitivityFloorMs?.toFixed(1) ?? '—'} ms
              are not resolvable in this regime.
            </p>
          ) : (
            <div className="live__log-scroll">
            <table className="live__log-table">
              <thead>
                <tr className="t-label-sm">
                  <th>Time</th>
                  <th>Class</th>
                  <th className="num">Peak</th>
                  <th>Diagnosis</th>
                  <th className="num">Conf.</th>
                </tr>
              </thead>
              <tbody>
                {[...eventsSoFar].reverse().map((event) => (
                  <tr
                    key={event.startMs}
                    data-selected={event.startMs === shown?.startMs || undefined}
                    onClick={() => onSelectEvent(event)}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectEvent(event);
                      }
                    }}
                  >
                    <td className="t-mono">{formatElapsed(event.startMs)}</td>
                    <td>
                      <span className="live__log-class" data-class={event.className.toLowerCase()}>
                        {event.className.replace(/([a-z])([A-Z])/g, '$1 $2')}
                      </span>
                    </td>
                    <td className="num t-metric-sm">{event.peakFrameTimeMs.toFixed(0)} ms</td>
                    <td className="t-body-sm">{event.title}</td>
                    <td className="num t-metric-sm">
                      {event.confidence !== null ? `${(event.confidence * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}

          <footer className="live__log-footer t-label-sm">
            {countedEvents.length} event{countedEvents.length === 1 ? '' : 's'} ·{' '}
            {eventsSoFar.filter((e) => e.ruleId !== null).length} explained
            {scenario.explanationRate !== null
              ? ` · explanation rate ${(scenario.explanationRate * 100).toFixed(0)}%`
              : ''}
          </footer>
        </section>
      </div>
    </div>
  );
}

/** Rolling FPS over the visible window: frames divided by their true duration. */
function useRollingFps(ring: SampleRing, nowMs: number): MetricValue {
  const from = nowMs - 5000;
  const start = ring.indexAtOrAfter(from);
  const n = ring.count - start;

  // Below the documented minimum this is describing too few frames to mean anything.
  if (n < 30) return unavailable(UnavailableReason.InsufficientData);

  let total = 0;
  for (let i = start; i < ring.count; i++) total += ring.valueAt(i);
  if (total <= 0) return unavailable(UnavailableReason.InsufficientData);

  return available(n / (total / 1000));
}

/** Current value of each strip metric, at its own native rate. */
function useStrip(scenario: Scenario, atMs: number): Record<string, MetricValue> {
  return useMemo(() => {
    const result: Record<string, MetricValue> = {};

    for (const { metric } of STRIP) {
      const series = findSeries(scenario, metric);
      if (!series) {
        result[metric] = unavailable(UnavailableReason.NoSensor);
        continue;
      }

      if (series.availability !== Availability.Available) {
        result[metric] = { state: series.availability, reason: series.reason } as MetricValue;
        continue;
      }

      const sample = sampleAt(series, atMs);
      if (!sample) {
        result[metric] = unavailable(UnavailableReason.NotYetSampled);
        continue;
      }

      // Past five times its own interval a reading is stale rather than current, and the UI
      // must say so rather than presenting an old number as live.
      const staleAfterMs = 5000;
      result[metric] =
        sample.ageMs > staleAfterMs
          ? { state: Availability.Stale, value: sample.value, quality: Quality.Degraded, ageMs: sample.ageMs }
          : available(sample.value, series.quality);
    }

    return result;
  }, [scenario, atMs]);
}

function toMetric(value: number | null): MetricValue {
  return value === null ? unavailable(UnavailableReason.InsufficientData) : available(value);
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
