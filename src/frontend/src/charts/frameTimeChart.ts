import type { SampleRing } from '../telemetry/ringBuffer';

/** Colours and geometry the renderer needs, resolved from CSS custom properties. */
export interface FrameTimeChartTheme {
  readonly background: string;
  readonly gridLine: string;
  readonly axisText: string;
  readonly envelope: string;
  readonly trace: string;
  readonly referenceLine: string;
  readonly thresholdLine: string;
  /** Mark drawn on a column whose peak exceeds the visible ceiling. */
  readonly clipped: string;
}

export interface FrameTimeChartOptions {
  /** Seconds of history to show. */
  readonly windowSeconds: number;
  /**
   * Default Y-axis ceiling in milliseconds.
   *
   * The axis is fixed here by default, grows the instant a frame exceeds it, and shrinks back
   * only after the tall frame has been out of the window for a while.
   *
   * Both halves matter. A continuously auto-scaling axis makes every stutter look the same
   * size, which is exactly backwards. But an axis that only ever grows is worse: one 104 ms
   * spike rescales the top of the chart and never gives the space back.
   */
  readonly defaultCeilingMs: number;

  /**
   * Hard lower bound for the Y axis in milliseconds. The axis is logarithmic, so it can never
   * be zero, and this is the smallest value the adaptive floor is allowed to reach.
   */
  readonly minFloorMs?: number;

  /** How long the axis holds an expanded ceiling after the tall frame leaves the window. */
  readonly ceilingHoldMs?: number;
  /** Display refresh interval, drawn as a reference line. */
  readonly refreshIntervalMs: number;
  /**
   * Threshold the detector is using, drawn as a dashed reference line.
   *
   * Deliberately not used to colour the trace. Colouring each column by severity turns the
   * frame-time series into a rainbow and breaks the rule that colour carries meaning only —
   * severity belongs in the event ribbon, where it is paired with a shape and a word.
   */
  readonly thresholdMs: number | null;
}

/** Result of a draw, for instrumentation against the performance budget. */
export interface DrawStats {
  readonly durationMs: number;
  readonly columnsDrawn: number;
  readonly samplesConsidered: number;
  readonly ceilingMs: number;
}

/**
 * Draws a frame-time timeline onto a canvas, using min/max column decimation on a log Y axis.
 *
 * **Decimation.** Two vertices per pixel column — the lowest and highest frame time falling in
 * that column — rather than sampling or averaging. This is not merely faster than drawing every
 * point; it is the *correct* rendering for this data. Largest-triangle-three-buckets, nth-point
 * sampling and averaging can all drop a single-frame spike, and a 142 ms stutter surviving
 * decimation is the entire point of the chart.
 *
 * **Log axis.** Frame-time series routinely span more than a decade: a 6.9 ms baseline with a
 * 104 ms hitch is an ordinary 60 seconds of gameplay, not an outlier. Drawn linearly, the hitch
 * sets the scale and presses the baseline flat against the axis, destroying exactly the pacing
 * detail that distinguishes a smooth session from a rough one. The pipeline already stores
 * frame times in a log histogram for the same reason; the chart follows it rather than
 * contradicting it. The axis is labelled as logarithmic on the chart, because a compressed axis
 * that does not say so overstates how mild a spike was.
 *
 * The renderer owns no React state and is called from a `requestAnimationFrame` loop that skips
 * entirely when the ring's sequence number has not moved.
 */
export class FrameTimeChartRenderer {
  private ceilingMs: number;
  private ceilingSetAtMs = Number.NEGATIVE_INFINITY;
  private floorMsValue: number;
  private floorSetAtMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly theme: FrameTimeChartTheme,
    private readonly options: FrameTimeChartOptions,
  ) {
    this.ceilingMs = niceCeiling(options.defaultCeilingMs);
    this.floorMsValue = this.defaultFloorMs();
  }

  private defaultFloorMs(): number {
    const anchor = this.options.refreshIntervalMs > 0 ? this.options.refreshIntervalMs / 2 : 1;
    return Math.max(this.options.minFloorMs ?? 0.5, niceFloor(anchor));
  }

  /**
   * Bottom of the axis.
   *
   * Anchored to half the display's refresh interval — twice the display's rate, below which
   * frame pacing stops being a thing the user can perceive — and lowered when the game actually
   * renders faster than that. A fixed 1 ms floor is defensible in isolation but wastes a third
   * of the plot on a range no game reaches, and the wasted third comes out of the resolution of
   * the baseline, which is the part being read.
   */
  get floorMs(): number {
    return this.floorMsValue;
  }

  /** Current Y-axis ceiling. */
  get currentCeilingMs(): number {
    return this.ceilingMs;
  }

  /** Resets the axis, e.g. when a new session starts. */
  resetCeiling(): void {
    this.ceilingMs = niceCeiling(this.options.defaultCeilingMs);
    this.ceilingSetAtMs = Number.NEGATIVE_INFINITY;
    this.floorMsValue = this.defaultFloorMs();
    this.floorSetAtMs = Number.NEGATIVE_INFINITY;
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

    let observedMax = 0;
    let observedMin = Infinity;
    for (let i = startIndex; i < ring.count; i++) {
      const v = ring.valueAt(i);
      if (v > observedMax) observedMax = v;
      if (v < observedMin) observedMin = v;
    }

    const targetCeiling = Math.max(
      niceCeiling(this.options.defaultCeilingMs),
      niceCeiling(observedMax),
    );
    const holdMs = this.options.ceilingHoldMs ?? 4000;

    if (targetCeiling > this.ceilingMs) {
      // Grow instantly: a spike must never be clipped on the frame it arrives.
      this.ceilingMs = targetCeiling;
      this.ceilingSetAtMs = nowMs;
    } else if (targetCeiling < this.ceilingMs && nowMs - this.ceilingSetAtMs > holdMs) {
      // Shrink only after a hold, so the axis does not twitch on every passing spike, and
      // step rather than ease — an animated axis makes a stutter look like a gentle hill.
      this.ceilingMs = targetCeiling;
      this.ceilingSetAtMs = nowMs;
    }

    // The floor moves on the same asymmetric rule as the ceiling, mirrored: it drops instantly
    // so a fast frame is never pinned to the axis, and rises only after a hold.
    const targetFloor =
      observedMin === Infinity
        ? this.defaultFloorMs()
        : Math.min(this.defaultFloorMs(), Math.max(this.options.minFloorMs ?? 0.5, niceFloor(observedMin)));

    if (targetFloor < this.floorMsValue) {
      this.floorMsValue = targetFloor;
      this.floorSetAtMs = nowMs;
    } else if (targetFloor > this.floorMsValue && nowMs - this.floorSetAtMs > holdMs) {
      this.floorMsValue = targetFloor;
      this.floorSetAtMs = nowMs;
    }

    const floor = Math.min(this.floorMsValue, this.ceilingMs / 2);
    const ceiling = this.ceilingMs;
    const yOf = (ms: number) => logY(ms, floor, ceiling, height);

    this.drawGrid(ctx, width, height, yOf, dpr);

    // One pass over the visible samples, accumulating per-column min and max.
    let columnsDrawn = 0;
    if (sampleCount > 0) {
      const pixelsPerMs = width / windowMs;
      let columnIndex = -1;
      let columnMin = Infinity;
      let columnMax = -Infinity;

      ctx.lineWidth = Math.max(1, dpr);

      // One colour for every column. The trace is a measurement, not a verdict.
      ctx.strokeStyle = this.theme.envelope;

      const flush = (column: number) => {
        if (columnMin === Infinity) return;
        const x = column + 0.5;
        const top = yOf(columnMax);
        const bottom = yOf(columnMin);
        ctx.beginPath();
        ctx.moveTo(x, bottom);
        // A column whose min and max coincide would otherwise draw a zero-length path and
        // vanish, so a steady 6.9 ms baseline must still be given a pixel of height.
        ctx.lineTo(x, Math.min(top, bottom - Math.max(1, dpr)));
        ctx.stroke();
        columnsDrawn++;

        // A column whose peak is off-scale gets a cap mark, so the reader knows the value
        // continued past the top rather than stopping there. A silently clipped spike
        // understates the very thing the chart exists to show.
        if (columnMax > ceiling) {
          ctx.save();
          ctx.strokeStyle = this.theme.clipped;
          ctx.beginPath();
          ctx.moveTo(x - 2 * dpr, 2 * dpr);
          ctx.lineTo(x + 2 * dpr, 2 * dpr);
          ctx.stroke();
          ctx.restore();
        }
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
   * Labelled gridlines plus the display's refresh interval.
   *
   * The refresh line is the single most informative mark on the chart: it turns "is 11 ms bad?"
   * into a visual yes or no, and no consumer tool draws it.
   *
   * Gridlines are labelled. An unlabelled gridline on a logarithmic axis is worse than none,
   * because the reader's linear instinct will misread every distance on the plot.
   */
  private drawGrid(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    yOf: (ms: number) => number,
    dpr: number,
  ): void {
    const ticks = logTicks(this.floorMs, this.ceilingMs);

    ctx.lineWidth = 1;
    ctx.font = `${Math.round(10 * dpr)}px ${LABEL_FONT}`;
    ctx.textBaseline = 'bottom';

    for (const ms of ticks) {
      const y = Math.round(yOf(ms)) + 0.5;
      ctx.strokeStyle = this.theme.gridLine;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      // Labels sit inside the plot, hard against the left edge. A dedicated gutter would cost
      // width that the trace uses better, and the leftmost column is the oldest data.
      if (y > 12 * dpr && y < height - 2 * dpr) {
        ctx.fillStyle = this.theme.axisText;
        ctx.fillText(formatTick(ms), 3 * dpr, y - 2 * dpr);
      }
    }

    const refresh = this.options.refreshIntervalMs;
    if (refresh > 0 && refresh < this.ceilingMs) {
      this.dashedLine(ctx, width, yOf(refresh), this.theme.referenceLine, [1 * dpr, 3 * dpr]);
    }

    // The detector's own threshold, so a user can see how far a spike was from being called an
    // event rather than having to take the classification on trust.
    const threshold = this.options.thresholdMs;
    if (threshold !== null && threshold > 0 && threshold < this.ceilingMs) {
      this.dashedLine(ctx, width, yOf(threshold), this.theme.thresholdLine, [4 * dpr, 3 * dpr]);
    }
  }

  private dashedLine(
    ctx: CanvasRenderingContext2D,
    width: number,
    y: number,
    colour: string,
    dash: readonly number[],
  ): void {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.setLineDash([...dash]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  }
}

const LABEL_FONT =
  "'JetBrains Mono Variable', 'Cascadia Mono', consolas, 'Courier New', monospace";

/**
 * Maps a frame time to a Y pixel on a logarithmic axis.
 *
 * Values at or below the floor pin to the bottom rather than running off to −∞, and values
 * above the ceiling pin to the top — the caller marks those columns as clipped.
 */
export function logY(ms: number, floorMs: number, ceilingMs: number, height: number): number {
  // A zero floor makes the ratio infinite rather than merely large, so the span has to be
  // checked for finiteness and not just for sign.
  const span = Math.log(ceilingMs / floorMs);
  if (!(floorMs > 0) || !(span > 0) || !Number.isFinite(span)) return height;
  const clamped = Math.min(Math.max(ms, floorMs), ceilingMs);
  return height - (Math.log(clamped / floorMs) / span) * height;
}

/**
 * The 1-2-5 ticks strictly inside a logarithmic range.
 *
 * Capped at twelve so a wide range degrades to decades rather than to a grey block. The
 * endpoints are excluded: a gridline drawn on the axis line itself is invisible, and its label
 * would be clipped by the plot edge.
 */
export function logTicks(floorMs: number, ceilingMs: number): number[] {
  if (!(floorMs > 0) || !(ceilingMs > floorMs)) return [];

  for (const mantissas of [
    [1, 2, 5],
    [1, 5],
    [1],
  ]) {
    const ticks: number[] = [];
    const startExp = Math.floor(Math.log10(floorMs));
    const endExp = Math.ceil(Math.log10(ceilingMs));
    for (let exp = startExp; exp <= endExp; exp++) {
      for (const m of mantissas) {
        const value = m * 10 ** exp;
        if (value > floorMs && value < ceilingMs) ticks.push(value);
      }
    }
    if (ticks.length <= 12) return ticks;
  }

  return [];
}

/** Rounds a floor down to the largest 1-2-5 tick at or below the value. */
export function niceFloor(ms: number): number {
  if (!(ms > 0) || !Number.isFinite(ms)) return 1;
  const exp = Math.floor(Math.log10(ms));
  for (let e = exp + 1; e >= exp - 2; e--) {
    for (const m of [5, 2, 1]) {
      const value = m * 10 ** e;
      if (value <= ms) return roundTick(value);
    }
  }
  return roundTick(10 ** (exp - 2));
}

/** Rounds a ceiling up to the next 1-2-5 tick strictly above the peak. */
export function niceCeiling(peakMs: number): number {
  if (!(peakMs > 0)) return 1;
  const exp = Math.floor(Math.log10(peakMs));
  for (let e = exp; e <= exp + 2; e++) {
    for (const m of [1, 2, 5]) {
      const value = m * 10 ** e;
      if (value > peakMs) return roundTick(value);
    }
  }
  return roundTick(10 ** (exp + 2));
}

/** Undoes the float error in `m * 10 ** e` for the small exponents this chart uses. */
function roundTick(value: number): number {
  return value >= 1 ? Math.round(value) : Number(value.toPrecision(2));
}

/** Tick labels carry their unit only once, on the topmost label the caller draws. */
export function formatTick(ms: number): string {
  return ms >= 10 ? `${Math.round(ms)}` : ms >= 1 ? `${ms}` : `${ms}`;
}
