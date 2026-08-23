import { useEffect, useRef, type JSX } from 'react';
import {
  drawMetricPanel,
  panelScale,
  type MetricPanelRange,
  type MetricPanelTheme,
} from '../charts/metricPanel';
import { Availability, Quality, describeReason } from '../telemetry/availability';
import type { MetricSeries } from '../telemetry/scenario';

interface MetricPanelProps {
  readonly series: MetricSeries;
  readonly label: string;
  readonly unit: string;
  readonly precision: number;
  readonly range: MetricPanelRange;
  readonly theme: MetricPanelTheme;
  /** Whether this metric was cited as evidence for the diagnosis. */
  readonly isEvidence: boolean;
}

/**
 * The series' own median sampling interval, in milliseconds.
 *
 * Used to widen a zero-width event window. A single-frame event starts and ends at the same
 * instant, and reading "during the event" over that instant means a 4 Hz sensor contributes a
 * sample only if one happens to land exactly on it. On the CPU-frequency-collapse scenario that
 * produced a CPU CLOCK headline of 4627 MHz — the pre-collapse reading — on a screen titled
 * "CPU frequency collapse", with the panel's own trace visibly descending beneath it.
 */
function medianIntervalMs(series: MetricSeries): number {
  if (series.timestamps.length < 2) return 0;

  const gaps: number[] = [];
  for (let i = 1; i < series.timestamps.length; i++) {
    const gap = series.timestamps[i] - series.timestamps[i - 1];
    if (gap > 0) gaps.push(gap);
  }

  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

/** Reads the value at a timestamp without interpolating, matching what the panel draws. */
function valueAt(series: MetricSeries, atMs: number): number | null {
  let found: number | null = null;

  for (let i = 0; i < series.timestamps.length; i++) {
    if (series.timestamps[i] > atMs) break;
    const value = series.values[i];
    found = Number.isFinite(value) ? value : null;
  }

  return found;
}

/**
 * One metric over the event's window: a stepped trace, the value at the peak, and the change.
 *
 * The change is the number a reader is actually looking for — "did this move when the frame
 * time did" — and it is computed from the last reading before the event and the extreme during
 * it, not from a smoothed curve.
 */
export function MetricPanel({
  series,
  label,
  unit,
  precision,
  range,
  theme,
  isEvidence,
}: MetricPanelProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const inWindow: number[] = [];
  // Only real readings are counted. A sample that carried nothing is a gap, and counting it
  // would overstate the evidence behind a panel whose sample count is shown to the reader as
  // provenance — the same number that appears beside every piece of evidence in a diagnosis.
  let readingsInWindow = 0;
  for (let i = 0; i < series.timestamps.length; i++) {
    const t = series.timestamps[i];
    if (t < range.fromMs || t > range.toMs) continue;

    inWindow.push(series.values[i]);
    if (Number.isFinite(series.values[i])) readingsInWindow++;
  }

  const scale = panelScale(series.unit, inWindow);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawMetricPanel(canvas, series, range, scale, theme);
  });

  const before = valueAt(series, range.eventStartMs - 1);

  // Widened by one sampling interval so a zero-width event can still contain a reading. Without
  // this the headline number is decided by whether a sensor tick happens to coincide with a
  // single instant, which on a single-frame event is a coin flip.
  const duringEndMs = Math.max(range.eventEndMs, range.eventStartMs + medianIntervalMs(series));
  const extended = duringEndMs > range.eventEndMs;

  let duringExtreme: number | null = null;
  for (let i = 0; i < series.timestamps.length; i++) {
    const t = series.timestamps[i];
    if (t < range.eventStartMs || t > duringEndMs) continue;

    const value = series.values[i];
    if (!Number.isFinite(value)) continue;

    if (duringExtreme === null) duringExtreme = value;
    else if (before !== null && Math.abs(value - before) > Math.abs(duringExtreme - before))
      duringExtreme = value;
    else if (before === null && value > duringExtreme) duringExtreme = value;
  }

  const readable = series.availability === Availability.Available;
  const change = readable && before !== null && duringExtreme !== null ? duringExtreme - before : null;

  return (
    <div className="panel" data-evidence={isEvidence || undefined}>
      <div className="panel__head">
        <span className="t-label panel__label">{label}</span>

        {readable ? (
          <span className="panel__reading t-metric-sm">
            {duringExtreme !== null ? duringExtreme.toFixed(precision) : '—'}
            <span className="panel__unit">{unit}</span>
            {change !== null && Math.abs(change) >= 10 ** -precision ? (
              <span className="panel__change" data-direction={change > 0 ? 'up' : 'down'}>
                {change > 0 ? '+' : ''}
                {change.toFixed(precision)}
              </span>
            ) : null}
          </span>
        ) : (
          // A metric with no sensor is shown, not hidden. Its absence is why a diagnosis is
          // capped, and a reader who cannot see the gap cannot understand the confidence.
          <span className="panel__absent t-label-sm" title={describeReason(series.reason)}>
            unavailable
          </span>
        )}
      </div>

      <div className="panel__plot">
        <canvas ref={canvasRef} className="panel__canvas" />
      </div>

      <div className="panel__foot t-mono-sm">
        {readable ? (
          <>
            <span>
              {readingsInWindow} sample{readingsInWindow === 1 ? '' : 's'}
            </span>
            {/*
              Stated when the reading comes from after the event rather than during it. A number
              that describes the moment after a single-frame hitch is the right number to show,
              and pretending it was measured during the hitch would be a small confident lie.
            */}
            {extended ? <span className="panel__extended">incl. next sample</span> : null}
            {series.quality !== Quality.Exact ? (
              <span className="panel__quality">{Quality[series.quality].toLowerCase()}</span>
            ) : null}
          </>
        ) : (
          <span className="panel__reason">{describeReason(series.reason)}</span>
        )}
      </div>
    </div>
  );
}
