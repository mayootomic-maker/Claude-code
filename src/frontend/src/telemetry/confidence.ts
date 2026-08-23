/**
 * Why a diagnosis's confidence stopped where it did.
 *
 * The scoring is a weighted log-odds sum with a hard ceiling and four caps. A number without
 * its cap is the number alone, and "60 %" reads as weak evidence when the truth is often strong
 * evidence held back by a missing sensor — which is a fact about the machine the user can act
 * on, not a fact about the finding.
 *
 * Kept in one place because two screens show it, and a wording that drifts between them would
 * make the same event look like two different findings.
 */
export enum ConfidenceCap {
  /** Nothing capped it; the evidence itself set the value. */
  None = 0,
  Correlational = 1,
  SingleEvidenceClass = 2,
  ModelledEvidence = 3,
  MissingSensor = 4,
}

const explanations: Record<ConfidenceCap, string> = {
  [ConfidenceCap.None]: '',
  [ConfidenceCap.Correlational]:
    'attributing a cause is correlational, so certainty is never claimed',
  [ConfidenceCap.SingleEvidenceClass]: 'only one kind of evidence supported this',
  [ConfidenceCap.ModelledEvidence]: 'some evidence was modelled rather than measured',
  [ConfidenceCap.MissingSensor]: 'a sensor this diagnosis needs is unavailable',
};

/** The cap's explanation, or an empty string when nothing capped the score. */
export function describeCap(cap: number): string {
  return explanations[cap as ConfidenceCap] ?? '';
}

/**
 * Whether the cap is something the user could change.
 *
 * Only the missing-sensor cap is actionable: installing a sensor driver, or running on hardware
 * that has one, would raise it. The others are properties of the evidence and would be
 * dishonest to present as fixable.
 */
export function isCapActionable(cap: number): boolean {
  return cap === ConfidenceCap.MissingSensor;
}
