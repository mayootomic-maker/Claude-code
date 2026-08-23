import type { SampleRing } from '../telemetry/ringBuffer';

/** Colours and geometry the renderer needs, resolved from CSS custom properties. */
export interface FrameTimeChartTheme {
  readonly background: string;
  readonly gridLine: string;
  readonly axisText: string;
  readonly envelope: string;
  readonly trace: string;
  readonly referenceLine: string;
  readonly warn: string;
  readonly critical: string;
}

export interface FrameTimeChartOptions {
  /** Seconds of history to show. */
  readonly windowSeconds: number;
  /**
   * Default Y-axis ceiling in milliseconds.
   *
   * Fixed by default and expanded only when exceeded. An auto-scaling Y axis makes every
   * stutter look the same size, which is exactly backwards for a tool whose job is to show how
   * bad one was.
   */
  readonly defaultCeilingMs: number;
  /** Display refresh interval, drawn as a reference line. */
  readonly refreshIntervalMs: number;
  /** Frame time above which a column is drawn in the warning colour. */
  readonly warnAboveMs: number;
  /** Frame time above which a column is drawn in the critical colour. */
  readonly criticalAboveMs: number;
}

/** Result of a draw, for instrumentation against the performance budget. */
export interface DrawStats {
  readonly durationMs: number;
  readonly columnsDrawn: number;
  readonly samplesConsidered: number;
  readonly ceilingMs: number;
}

/**
 * Draws a frame-time timeline onto a canvas, using min/max column decimation.
 *
 * Two vertices per pixel column — the lowest and highest frame time falling in that column —
 * rather than sampling or averaging. This is not merely faster than drawing every point; it is
 * the **correct** rendering for this data. Largest-triangle-three-buckets, nth-point sampling
 * and averaging can all drop a single-frame spike, and a 142 ms stutter surviving decimation is
 * the entire point of the chart.
 *
 * The renderer owns no React state and is called from a `requestAnimationFrame` loop that skips
 * entirely when the ring's sequence number has not moved.
 */
export class FrameTimeChartRenderer {
  private ceilingMs: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly theme: FrameTimeChartTheme,
    private readonly options: FrameTimeChartOptions,
  ) {
    this.ceilingMs = options.defaultCeilingMs;
  }

  /** Current Y-axis ceiling, which only ever grows within a session. */
  get currentCeilingMs(): number {
    return this.ceilingMs;
  }

  /** Resets the ceiling, e.g. when a new session starts. */
  resetCeiling(): void {
    this.ceilingMs = this.options.defaultCeilingMs;
  }

  draw(ring: SampleRing, nowMs: number): DrawStats {
    const started = performance.now();

    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      return { durationMs: 0, columnsDrawn: 0, samplesConsidered: 0, ceilingMs: this.ceilingMs };
    }

    const dpr = self.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth || this.canvas.width;
    const cssHeight = this.canvas.clientHeight || this.canvas.height;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);

    const windowMs = this.options.windowSeconds * 1000;
    const fromMs = nowMs - windowMs;
    const startIndex = ring.indexAtOrAfter(fromMs);
    const sampleCount = ring.count - startIndex;

    // Grow the ceiling only when a frame genuinely exceeds it, so the vertical scale is
    // comparable across the session and a spike looks as large as it was.
    let observedMax = 0;
    for (let i = startIndex; i < ring.count; i++) {
      const v = ring.valueAt(i);
      if (v > observedMax) observedMax = v;
    }
    if (observedMax > this.ceilingMs) {
      this.ceilingMs = Math.ceil(observedMax / 10) * 10;
    }

    const yOf = (ms: number) => height - (Math.min(ms, this.ceilingMs) / this.ceilingMs) * height;

    this.drawGrid(ctx, width, yOf, dpr);

    // One pass over the visible samples, accumulating per-column min and max.
    let columnsDrawn = 0;
    if (sampleCount > 0) {
      const pixelsPerMs = width / windowMs;
      let columnIndex = -1;
      let columnMin = Infinity;
      let columnMax = -Infinity;

      ctx.lineWidth = Math.max(1, dpr);

      const flush = (column: number) => {
        if (columnMin === Infinity) return;
        const x = column + 0.5;
        ctx.strokeStyle =
          columnMax >= this.options.criticalAboveMs
            ? this.theme.critical
            : columnMax >= this.options.warnAboveMs
              ? this.theme.warn
              : this.theme.envelope;
        ctx.beginPath();
        ctx.moveTo(x, yOf(columnMin));
        ctx.lineTo(x, yOf(columnMax));
        ctx.stroke();
        columnsDrawn++;
      };

      for (let i = startIndex; i < ring.count; i++) {
        const t = ring.timestampAt(i);
        const v = ring.valueAt(i);
        const column = Math.min(width - 1, Math.max(0, Math.floor((t - fromMs) * pixelsPerMs)));

        if (column !== columnIndex) {
          flush(columnIndex);
          columnIndex = column;
          columnMin = v;
          columnMax = v;
        } else {
          if (v < columnMin) columnMin = v;
          if (v > columnMax) columnMax = v;
        }
      }
      flush(columnIndex);
    }

    return {
      durationMs: performance.now() - started,
      columnsDrawn,
      samplesConsidered: sampleCount,
      ceilingMs: this.ceilingMs,
    };
  }

  /**
   * Horizontal gridlines plus the display's refresh interval.
   *
   * The refresh line is the single most informative mark on the chart: it turns "is 11 ms bad?"
   * into a visual yes or no, and no consumer tool draws it.
   */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    yOf: (ms: number) => number,
    dpr: number,
  ): void {
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.theme.gridLine;

    // At most four gridlines. More is noise on a chart this short.
    const step = niceStep(this.ceilingMs / 4);
    for (let ms = step; ms < this.ceilingMs; ms += step) {
      const y = Math.round(yOf(ms)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const refresh = this.options.refreshIntervalMs;
    if (refresh > 0 && refresh < this.ceilingMs) {
      const y = Math.round(yOf(refresh)) + 0.5;
      ctx.save();
      ctx.strokeStyle = this.theme.referenceLine;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/** Rounds a gridline step to 1, 2, 5 or 10 times a power of ten. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}
