import type { JSX } from 'react';
import { stripGeometry } from '../charts/baselineStrip';
import {
  verdictLabel,
  verdictSeverity,
  type BaselineSession,
} from '../telemetry/baseline';

const PLOT_HEIGHT = 96;

/** Horizontal inset, so the first and last points are drawn whole rather than half-clipped. */
const INSET_PERCENT = 2.5;

/**
 * How a configuration has behaved, and what the newest session was worth against it.
 *
 * The screen exists to answer one question — *is this normal for my machine?* — so it is built
 * around the band rather than the trend line. A point inside the band has not been shown to have
 * moved, at any zoom, and that is the reading the layout has to make effortless. The trend is
 * secondary and is drawn as points, not a connecting line: consecutive sessions are separate
 * measurements days apart, and a line between them would imply a continuity nothing measured.
 */
export function BaselineTrend({
  history,
}: {
  readonly history: readonly BaselineSession[];
}): JSX.Element | null {
  if (history.length === 0) return null;

  const latest = history[history.length - 1];
  const { baseline, comparison } = latest;

  const geometry = stripGeometry(
    history.map((s) => ({ id: s.id, valueMs: s.medianFrameTimeMs })),
    baseline.medianFrameTimeMs,
    comparison.noiseMs,
    PLOT_HEIGHT,
  );

  const severity = verdictSeverity(comparison.verdict);

  return (
    <section className="baseline" aria-labelledby="baseline-heading">
      <header className="baseline__head">
        {/*
          The configuration is named. The table below this panel lists sessions from several
          different games, and an unnamed panel would be read as describing all of them — a
          baseline only ever describes one configuration.
        */}
        <h2 className="t-label" id="baseline-heading">
          {latest.game} &mdash; against this configuration&rsquo;s history
        </h2>
        <span className="baseline__verdict t-body-sm" data-severity={severity}>
          {verdictLabel(comparison.verdict)}
        </span>
      </header>

      {/*
        The engine's sentence, verbatim. It is written where the arithmetic is, and it names the
        thing that actually set the bar — the configuration's spread, or the resolution of the
        frame-time source. A paraphrase here would be the UI asserting a reason it does not have.
      */}
      <p className="t-body baseline__detail">{comparison.detail}</p>

      <div className="baseline__figures">
        <Figure
          label="Usual median"
          value={baseline.medianFrameTimeMs}
          unit="ms"
          unavailable="no baseline yet"
        />
        <Figure
          label="This session"
          value={comparison.sessionValue}
          unit="ms"
          unavailable="not measured"
        />
        <Figure
          label="Worth mentioning above"
          value={comparison.noiseMs}
          unit="ms"
          unavailable="not established"
        />
        <div className="baseline__figure">
          <span className="t-label baseline__figure-label">Built from</span>
          <span className="t-mono baseline__figure-value">
            {baseline.sessionCount}
            <span className="baseline__figure-unit">
              {baseline.sessionCount === 1 ? 'session' : 'sessions'}
            </span>
          </span>
        </div>
      </div>

      <Strip geometry={geometry} history={history} severity={severity} />

      {/*
        The standing of the baseline itself, always shown — including when it is trusted. A
        qualification that appears only when the news is bad teaches a reader to skip it.
      */}
      <p className="t-body-sm baseline__trust" data-trust={baseline.trust.toLowerCase()}>
        {baseline.describe}
      </p>
    </section>
  );
}

function Figure({
  label,
  value,
  unit,
  unavailable,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly unavailable: string;
}): JSX.Element {
  return (
    <div className="baseline__figure">
      <span className="t-label baseline__figure-label">{label}</span>
      {/*
        Absent renders as words, never as a number. A null shown as 0.00 ms would be the most
        flattering possible misreading of a measurement that was never taken.
      */}
      {value === null ? (
        <span className="t-body-sm baseline__figure-absent">{unavailable}</span>
      ) : (
        <span className="t-mono baseline__figure-value">
          {value.toFixed(2)}
          <span className="baseline__figure-unit">{unit}</span>
        </span>
      )}
    </div>
  );
}

/**
 * The strip: every session in the window, against the band it is judged inside.
 *
 * Only the newest point is emphasised. Colouring every point by its own verdict would turn the
 * history into a rainbow and break the rule that colour carries meaning only — and most of those
 * verdicts are "no change", which deserves no colour at all.
 */
function Strip({
  geometry,
  history,
  severity,
}: {
  readonly geometry: ReturnType<typeof stripGeometry>;
  readonly history: readonly BaselineSession[];
  readonly severity: string;
}): JSX.Element {
  const hasBand = geometry.bandTopY !== null && geometry.bandBottomY !== null;
  const lastId = history[history.length - 1]?.id;

  // Drawn in real pixels with no viewBox, so nothing is scaled. An earlier version used a
  // viewBox with preserveAspectRatio="none" and every point came out as a horizontal streak —
  // a defect invisible in review and obvious in the first screenshot.
  const bandHeight = hasBand ? geometry.bandBottomY - geometry.bandTopY : 0;

  // A band thinner than the display can draw is reported as such rather than padded to a
  // visible thickness. Padding it would draw a tolerance wider than the one actually applied.
  const bandBelowResolution = hasBand && bandHeight < 1.5;

  return (
    <figure className="baseline__strip">
      <svg
        width="100%"
        height={PLOT_HEIGHT}
        role="img"
        aria-label={
          hasBand
            ? `${history.length} sessions plotted against the band this configuration normally stays inside.`
            : `${history.length} sessions plotted. There is no baseline band yet.`
        }
      >
        {hasBand ? (
          <>
            <rect
              className="baseline__band"
              x={0}
              y={geometry.bandTopY}
              width="100%"
              height={Math.max(bandHeight, 0)}
            />
            {/*
              The edges are stroked as well as filled. A stroke has no implied thickness in
              milliseconds, so a band too thin to fill still reads as a boundary without
              claiming to be wider than it is.
            */}
            <line
              className="baseline__edge"
              x1={0}
              x2="100%"
              y1={geometry.bandTopY}
              y2={geometry.bandTopY}
            />
            <line
              className="baseline__edge"
              x1={0}
              x2="100%"
              y1={geometry.bandBottomY}
              y2={geometry.bandBottomY}
            />
          </>
        ) : null}

        {geometry.centreY !== null ? (
          <line
            className="baseline__centre"
            x1={0}
            x2="100%"
            y1={geometry.centreY}
            y2={geometry.centreY}
          />
        ) : null}

        {geometry.points.map((point) =>
          point.y === null ? null : (
            <circle
              key={point.id}
              className="baseline__point"
              data-latest={point.id === lastId || undefined}
              data-severity={point.id === lastId ? severity : undefined}
              // Inset from both edges. At exactly 0 % and 100 % half of each end point falls
              // outside the plot, and the newest session is always an end point.
              cx={`${(INSET_PERCENT + point.x * (100 - 2 * INSET_PERCENT)).toFixed(3)}%`}
              cy={point.y}
              r={point.id === lastId ? 4 : 3}
            />
          ),
        )}
      </svg>

      <figcaption className="t-body-sm baseline__caption">
        {/*
          The axis does not start at zero, and says so. This chart is about deviation from what
          is normal; a zero-anchored axis would flatten every session into one line and hide the
          question being asked.
        */}
        {history.length} session{history.length === 1 ? '' : 's'}, oldest to newest.{' '}
        {geometry.minMs.toFixed(2)}&ndash;{geometry.maxMs.toFixed(2)} ms, scaled to the range
        shown rather than to zero.
        {bandBelowResolution
          ? ' The band is narrower than this chart can draw, so it is shown as a single line.'
          : null}
        {geometry.points.some((p) => p.y === null)
          ? ' Sessions with no qualified median are omitted from the plot.'
          : null}
      </figcaption>
    </figure>
  );
}
