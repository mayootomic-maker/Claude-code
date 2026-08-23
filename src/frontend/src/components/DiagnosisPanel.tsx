import type { JSX } from 'react';
import type { DetectedEvent } from '../telemetry/scenario';

/** Why a confidence value was limited below what the raw evidence implied. */
const capExplanation: Record<number, string> = {
  0: '',
  1: 'attributing a cause is correlational, so certainty is never claimed',
  2: 'only one kind of evidence supported this',
  3: 'some evidence was modelled rather than measured',
  4: 'a sensor this diagnosis needs is unavailable',
};

interface DiagnosisPanelProps {
  readonly event: DetectedEvent | null;
  readonly compact?: boolean;
}

/**
 * The explanation. This is the product.
 *
 * Five blocks, in a fixed order: what happened (facts, no cause), the likely cause with its
 * confidence, the evidence, what was ruled out, and what the user can do.
 *
 * The ruled-out block is the one most tools omit and the one that earns trust. On an
 * unexplained event it is the entire value: "23 events, 19 unexplained" is a retention killer,
 * while the same event with five things ruled out is evidence of competence and saves the user
 * a weekend of changing the wrong settings.
 */
export function DiagnosisPanel({ event, compact = false }: DiagnosisPanelProps): JSX.Element {
  if (!event) {
    return (
      <section className="diagnosis diagnosis--empty">
        <p className="t-body diagnosis__placeholder">
          No events detected yet in this session.
        </p>
      </section>
    );
  }

  // Copied to a local so TypeScript narrows it, and deliberately never defaulted to zero: a
  // missing confidence is not zero confidence, and rendering the two the same way would put a
  // fabricated "0%" next to a real diagnosis.
  const confidence = event.confidence;
  const explained = event.ruleId !== null && confidence !== null;

  // Below 60% the heading changes, and the panel must say what would settle it. Presenting a
  // coin-flip as "most likely cause" invites the user to act on it.
  const merelyPossible = explained && confidence !== null && confidence < 0.6;
  const heading = !explained
    ? 'Unexplained'
    : merelyPossible
      ? 'Possible cause'
      : 'Most likely cause';

  const checkable = event.ruledOut.filter((r) => r.wasCheckable);
  const blindSpots = event.ruledOut.filter((r) => !r.wasCheckable);

  return (
    <section className="diagnosis" data-explained={explained || undefined}>
      <header className="diagnosis__header">
        <span className="diagnosis__severity" data-class={event.className.toLowerCase()}>
          {formatClass(event.className)}
        </span>
        <h2 className="t-subtitle diagnosis__title">{event.title}</h2>

        {explained && confidence !== null ? (
          <div className="diagnosis__confidence">
            <span className="t-label">Confidence</span>
            <span className="t-metric-lg diagnosis__confidence-value">
              {(confidence * 100).toFixed(0)}
              <span className="diagnosis__confidence-unit">%</span>
            </span>
            <ConfidenceBar value={confidence} />
            {event.bindingCap !== 0 ? (
              <span className="t-label-sm diagnosis__cap">
                capped — {capExplanation[event.bindingCap]}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="diagnosis__block">
        <h3 className="t-label">What happened</h3>
        <p className="t-body">{event.whatHappened}</p>
      </div>

      {event.mechanism ? (
        <div className="diagnosis__block">
          <h3 className="t-label">{heading}</h3>
          <p className="t-body">{event.mechanism}</p>
          {merelyPossible ? (
            <p className="t-body-sm diagnosis__caveat">
              Not enough evidence to be confident.
            </p>
          ) : null}
        </div>
      ) : null}

      {event.evidence.length > 0 && !compact ? (
        <div className="diagnosis__block">
          <h3 className="t-label">Evidence</h3>
          <table className="diagnosis__evidence">
            <tbody>
              {event.evidence.map((item) => (
                <tr key={item.metric + item.statement} data-role={item.role.toLowerCase()}>
                  <td className="diagnosis__evidence-statement t-body-sm">
                    {item.statement}
                    {/*
                      Consequence evidence is labelled inline and non-negotiably. When the CPU
                      stalls, GPU utilization collapses because the GPU is waiting — users read
                      an unlabelled GPU drop as the problem.
                    */}
                    {item.role === 'Consequence' ? (
                      <span className="diagnosis__role"> follows, does not cause</span>
                    ) : null}
                  </td>
                  <td className="diagnosis__evidence-provenance t-mono-sm">
                    {item.sampleCount} sample{item.sampleCount === 1 ? '' : 's'}
                    {item.nativeRateHz !== null ? ` · ${item.nativeRateHz.toFixed(1)} Hz` : ''}
                    {!item.canEstablishOrdering ? ' · too coarse to order' : ''}
                    {item.quality !== 'Exact' ? ` · ${item.quality.toLowerCase()}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {checkable.length > 0 ? (
        <div className="diagnosis__block">
          <h3 className="t-label">Ruled out</h3>
          <ul className="diagnosis__ruled-out t-body-sm">
            {checkable.map((r) => (
              <li key={r.title}>
                <span className="diagnosis__ruled-out-title">{r.title}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blindSpots.length > 0 ? (
        <div className="diagnosis__block diagnosis__block--blind">
          <h3 className="t-label">Could not check</h3>
          <ul className="diagnosis__ruled-out t-body-sm">
            {blindSpots.map((r) => (
              <li key={r.title}>
                <span className="diagnosis__ruled-out-title">{r.title}</span> — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {event.recommendedAction ? (
        <div className="diagnosis__block diagnosis__block--action">
          <h3 className="t-label">What you can do</h3>
          <p className="t-body">{event.recommendedAction}</p>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Confidence as a segmented bar.
 *
 * Segmented rather than continuous, so it reads as a measurement with a resolution rather than
 * a progress indicator. The final segment is never reachable: the scorer caps at 0.97 and the
 * bar shows that ceiling honestly.
 */
function ConfidenceBar({ value }: { readonly value: number }): JSX.Element {
  const segments = 12;
  const filled = Math.round(value * segments);
  return (
    <span className="confidence-bar" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className="confidence-bar__segment" data-filled={i < filled || undefined} />
      ))}
    </span>
  );
}

function formatClass(className: string): string {
  return className.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}
