import { Availability, type Quality } from '../telemetry/availability';
import type { MetricSeries } from '../telemetry/scenario';

export interface MetricPanelTheme {
  readonly background: string;
  readonly gridLine: string;
  readonly axisText: string;
  readonly trace: string;
  readonly eventSpan: string;
  /** Edges of the event span, drawn as rules rather than as more fill. */
  readonly eventEdge: string;
  readonly gap: string;
}

export interface MetricPanelRange {
  readonly fromMs: number;
  readonly toMs: number;
  /** The event's own span, shaded so the reader can see what happened inside it. */
  readonly eventStartMs: number;
  readonly eventEndMs: number;
}

/** Vertical extent of a panel, chosen from the data and its unit. */
export interface PanelScale {
  readonly min: number;
  readonly max: number;
}

/**
 * Picks a vertical range for one metric.
 *
 * Percentages are pinned to 0-100 so two percentage panels can be compared by eye without
 * reading their axes. Everything else is fitted to the data with a margin, because a
 * temperature panel spanning 0-100 °C wastes almost all of itself on temperatures no CPU
 * reaches — and the whole question in an inspector is whether a value *moved*, which a
 * squashed panel hides.
 */
export function panelScale(unit: string, values: readonly number[]): PanelScale {
  if (unit === 'Percent') return { min: 0, max: 100 };

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };

  if (min === max) {
    // A perfectly flat series is a real and common reading — a clock that never moved is
    // evidence. Giving it a band rather than a zero-height range keeps the line visible and
    // keeps it visibly flat.
    const pad = Math.max(Math.abs(min) * 0.05, 1);
    return { min: min - pad, max: max + pad };
  }

  const margin = (max - min) * 0.12;
  return { min: min - margin, max: max + margin };
}

/**
 * Draws one metric over the inspector's time range.
 *
 * **Stepped, never smoothed.** A 4 Hz metric drawn as a smooth curve invents 250 ms of readings
 * between every pair of real samples, and those invented readings are exactly what a viewer
 * would use to decide whether the metric moved before or after the stutter. The step is
 * sample-and-hold: the value is drawn as constant until the next real sample, which is what the
 * measurement actually says.
 *
 * **Gaps are gaps.** A sample with no reading breaks the line. Bridging it would draw a
 * measurement across the moment the sensor was not answering.
 */
export function drawMetricPanel(
  canvas: HTMLCanvasElement,
  series: MetricSeries,
  range: MetricPanelRange,
  scale: PanelScale,
  theme: MetricPanelTheme,
): void {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const dpr = self.devicePixelRatio || 1;
  const width = Math.max(1, Math.round((canvas.clientWidth || canvas.width) * dpr));
  const height = Math.max(1, Math.round((canvas.clientHeight || canvas.height) * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const span = range.toMs - range.fromMs;
  if (span <= 0) return;

  const xOf = (ms: number) => ((ms - range.fromMs) / span) * width;
  const denominator = scale.max - scale.min;
  const yOf = (value: number) =>
    denominator > 0 ? height - ((value - scale.min) / denominator) * height : height / 2;

  // The event's span, behind everything. Reading a metric panel means asking "did this move
  // during the marked part", so the mark is the panel's frame of reference — which is exactly
  // why it must not be strong enough to compete with the trace. A solid fill turns a flat
  // series into a coloured block with a faint line on it, and the line is the measurement.
  const eventLeft = xOf(range.eventStartMs);
  const eventWidth = Math.max(1, xOf(range.eventEndMs) - eventLeft);

  ctx.fillStyle = theme.eventSpan;
  ctx.fillRect(eventLeft, 0, eventWidth, height);

  ctx.strokeStyle = theme.eventEdge;
  ctx.lineWidth = Math.max(1, dpr);
  for (const x of [eventLeft, eventLeft + eventWidth]) {
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }

  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  const midpoint = Math.round(height / 2) + 0.5;
  ctx.beginPath();
  ctx.moveTo(0, midpoint);
  ctx.lineTo(width, midpoint);
  ctx.stroke();

  if (series.availability !== Availability.Available) return;

  ctx.strokeStyle = theme.trace;
  ctx.lineWidth = Math.max(1, dpr * 1.25);
  ctx.lineJoin = 'miter';
  ctx.beginPath();

  let open = false;
  let lastY = 0;

  for (let i = 0; i < series.timestamps.length; i++) {
    const t = series.timestamps[i];
    if (t < range.fromMs || t > range.toMs) continue;

    const value = series.values[i];
    const x = xOf(t);

    if (!Number.isFinite(value)) {
      // The sensor did not answer here. End the line rather than carrying the previous value
      // across the gap, which would draw a reading that was never taken.
      open = false;
      continue;
    }

    const y = yOf(value);

    if (!open) {
      ctx.moveTo(x, y);
      open = true;
    } else {
      // Hold, then step. This is the shape of a sampled measurement.
      ctx.lineTo(x, lastY);
      ctx.lineTo(x, y);
    }

    lastY = y;
  }

  // Carry the final sample to the right edge: the last reading is still the current reading
  // until a new one arrives, and stopping the line early would read as the sensor stopping.
  if (open) ctx.lineTo(width, lastY);

  ctx.stroke();
}

/** How a series' quality should be worded beside its panel. */
export function describeQuality(quality: Quality): string | null {
  switch (quality) {
    case 1:
      return 'derived';
    case 2:
      return 'estimated';
    case 3:
      return 'degraded';
    default:
      return null;
  }
}
