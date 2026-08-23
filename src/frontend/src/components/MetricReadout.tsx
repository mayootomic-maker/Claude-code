import type { JSX } from 'react';
import {
  ABSENT,
  Availability,
  Quality,
  describeReason,
  hasValue,
  type MetricValue,
} from '../telemetry/availability';

export type ReadoutSize = 'hero' | 'large' | 'medium' | 'small';

interface MetricReadoutProps {
  readonly label: string;
  readonly metric: MetricValue;
  readonly unit?: string | undefined;
  /** Digits after the decimal point. Ignored when the metric has no reading. */
  readonly precision?: number | undefined;
  readonly size?: ReadoutSize | undefined;
  /** A subordinate line under the value: sample counts, a secondary percentile, a caveat. */
  readonly detail?: string | undefined;
}

const sizeClass: Record<ReadoutSize, string> = {
  hero: 't-hero',
  large: 't-metric-lg',
  medium: 't-metric-md',
  small: 't-metric-sm',
};

/**
 * Renders one metric, honestly.
 *
 * Absence is a first-class visual state, not a fallback. A metric with no sensor shows an em
 * dash and explains itself; it never shows a zero, because a zero is a plausible measurement
 * and the user has no way to tell it apart from a real one.
 *
 * Units are always present and always subdued relative to the value. The number is the thing
 * being read; the unit is a label on it.
 */
export function MetricReadout({
  label,
  metric,
  unit,
  precision = 0,
  size = 'large',
  detail,
}: MetricReadoutProps): JSX.Element {
  const stateName = Availability[metric.state].toLowerCase();

  if (hasValue(metric)) {
    // A stale reading with no recorded age is stale without a known age. Showing "0.0s" would
    // claim it arrived this instant, which is the opposite of what stale means.
    const ageSeconds = typeof metric.ageMs === 'number' ? metric.ageMs / 1000 : null;
    const showAge = metric.state === Availability.Stale && ageSeconds !== null;

    return (
      <div
        className="metric-readout"
        data-state={stateName}
        data-quality={Quality[metric.quality].toLowerCase()}
      >
        <div className="t-label metric-readout__label">{label}</div>

        <div className={`metric-readout__value ${sizeClass[size]}`}>
          <span className="metric-readout__number">{metric.value.toFixed(precision)}</span>
          {unit ? <span className="metric-readout__unit">{unit}</span> : null}
          {showAge ? (
            <span
              className="metric-readout__age"
              title={`Last reading ${ageSeconds.toFixed(1)} s ago`}
            >
              ·{ageSeconds.toFixed(1)}s
            </span>
          ) : metric.state === Availability.Stale ? (
            <span className="metric-readout__age" title="Stale reading; age unknown">
              ·stale
            </span>
          ) : null}
        </div>

        {detail ? <div className="metric-readout__detail">{detail}</div> : null}
      </div>
    );
  }

  // No reading. The reason is shown rather than swallowed, because "unavailable" is a shrug
  // and "requires a kernel-mode sensor driver" is a decision the user can make.
  const explanation = describeReason(metric.reason);
  const isDenied = metric.state === Availability.Denied;
  const isFailed = metric.state === Availability.Failed;

  return (
    <div className="metric-readout" data-state={stateName}>
      <div className="t-label metric-readout__label">{label}</div>

      <div className={`metric-readout__value ${sizeClass[size]}`}>
        <span
          className="metric-readout__absent"
          title={explanation}
          aria-label={`${label}: ${explanation}`}
        >
          {ABSENT}
        </span>
      </div>

      <div
        className="metric-readout__detail"
        // Denied is the only absent state the user can act on, so it is the only one that
        // reads as an affordance rather than a statement of fact.
        data-tone={isDenied ? 'action' : isFailed ? 'fault' : undefined}
      >
        {explanation}
      </div>
    </div>
  );
}
