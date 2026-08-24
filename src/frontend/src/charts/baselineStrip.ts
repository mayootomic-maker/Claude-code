/**
 * Geometry for the baseline strip: session medians against the band they are judged inside.
 *
 * Pure arithmetic, no drawing. The component renders SVG from what this returns, which keeps
 * every scaling decision — the ones that decide whether a difference looks real — testable
 * without a browser.
 */

/** One session's place on the strip. */
export interface StripPoint {
  readonly id: string;
  /** Horizontal position, 0..1 across the plot. */
  readonly x: number;
  /** Vertical position in pixels, or null when the session has no median to plot. */
  readonly y: number | null;
  readonly valueMs: number | null;
}

export interface StripGeometry {
  readonly points: readonly StripPoint[];
  /** Pixel row of the baseline centre, or null when there is no baseline. */
  readonly centreY: number | null;
  /** Pixel rows bounding the noise band, or null when there is no baseline. */
  readonly bandTopY: number | null;
  readonly bandBottomY: number | null;
  readonly minMs: number;
  readonly maxMs: number;
}

export interface StripInput {
  readonly id: string;
  readonly valueMs: number | null;
}

/**
 * Lays out the strip.
 *
 * **The axis does not start at zero, and that is correct here.** This chart answers "did this
 * move relative to what is normal", so the interesting range is a few milliseconds around the
 * centre; anchoring at zero would compress every session into one indistinguishable line and
 * hide the exact thing being asked about. The cost is that a reader could mistake a small
 * difference for a large one, which is why the band is drawn behind the points: the band *is*
 * the scale, and a point inside it is inside it at any zoom.
 *
 * @param values Sessions in the order they happened, oldest first.
 * @param centreMs Baseline centre, or null when there is no baseline yet.
 * @param noiseMs Half-height of the band, or null.
 * @param height Plot height in pixels.
 */
export function stripGeometry(
  values: readonly StripInput[],
  centreMs: number | null,
  noiseMs: number | null,
  height: number,
): StripGeometry {
  const plotted = values.map((v) => v.valueMs).filter((v): v is number => v !== null);

  const band =
    centreMs !== null && noiseMs !== null && Number.isFinite(centreMs) && Number.isFinite(noiseMs)
      ? { centre: centreMs, half: Math.abs(noiseMs) }
      : null;

  // The band always fits, even when every session sits far outside it. A band clipped off the
  // top would leave the points floating against nothing, which is the one reading this chart
  // must not allow.
  const candidates = [
    ...plotted,
    ...(band ? [band.centre - band.half, band.centre + band.half] : []),
  ];

  if (candidates.length === 0) {
    return {
      points: values.map((v, i) => ({
        id: v.id,
        x: xOf(i, values.length),
        y: null,
        valueMs: null,
      })),
      centreY: null,
      bandTopY: null,
      bandBottomY: null,
      minMs: 0,
      maxMs: 0,
    };
  }

  let min = Math.min(...candidates);
  let max = Math.max(...candidates);

  // A degenerate range — one session, or a run of identical ones — would divide by zero. Open it
  // symmetrically so the single point lands in the middle rather than on an edge, where its
  // position would imply a comparison that was never made.
  if (!(max > min)) {
    const pad = Math.max(Math.abs(max) * 0.05, 0.1);
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
  }

  const y = (ms: number): number => height - ((ms - min) / (max - min)) * height;

  return {
    points: values.map((v, i) => ({
      id: v.id,
      x: xOf(i, values.length),
      y: v.valueMs === null ? null : y(v.valueMs),
      valueMs: v.valueMs,
    })),
    centreY: band ? y(band.centre) : null,
    bandTopY: band ? y(band.centre + band.half) : null,
    bandBottomY: band ? y(band.centre - band.half) : null,
    minMs: min,
    maxMs: max,
  };
}

/** Evenly spaced, with a single session centred rather than pinned to the left edge. */
function xOf(index: number, count: number): number {
  return count <= 1 ? 0.5 : index / (count - 1);
}
