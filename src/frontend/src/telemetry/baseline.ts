/**
 * A configuration's baseline, and what each session was worth against it.
 *
 * Produced by `framedoctor-engine export-baseline`, which builds the whole history through the
 * real catalog and the real detector. Nothing in the payload is authored: the verdicts are
 * whatever the arithmetic said, including the several that say nothing changed.
 */

/** What a comparison is allowed to claim. Mirrors the engine's `ComparisonVerdict`. */
export type Verdict =
  | 'NoBaseline'
  | 'WithinNoise'
  | 'Regression'
  | 'Improvement'
  | 'IndicativeOnly'
  | 'NotComparable';

/** How far a baseline may be used. Mirrors the engine's `BaselineTrust`. */
export type Trust = 'Insufficient' | 'Provisional' | 'Trusted';

export interface BaselineState {
  readonly sessionCount: number;
  readonly trust: Trust;
  readonly exists: boolean;
  readonly mayDeclareRegression: boolean;
  /** Null when there is no baseline yet — never zero, which would read as an instant machine. */
  readonly medianFrameTimeMs: number | null;
  readonly spreadMs: number | null;
  /** The engine's own sentence about the baseline's standing. */
  readonly describe: string;
}

export interface ComparisonState {
  readonly verdict: Verdict;
  readonly metric: string;
  readonly baselineValue: number | null;
  readonly sessionValue: number | null;
  readonly differenceMs: number | null;
  readonly noiseMs: number | null;
  readonly effectSize: number | null;
  /** The sentence the engine wrote. Rendered verbatim; the UI does not paraphrase a verdict. */
  readonly detail: string;
}

export interface BaselineSession {
  readonly id: string;
  /** The game these sessions are of, so the panel can name what it is about. */
  readonly game: string;
  readonly scenario: string;
  readonly seed: number;
  readonly epochUtcTicks: number;
  readonly frameCount: number;
  readonly medianFrameTimeMs: number | null;
  readonly p99FrameTimeMs: number | null;
  readonly stutterCount: number;
  readonly baseline: BaselineState;
  readonly comparison: ComparisonState;
}

/**
 * Coerces a number that may have arrived as null, absent, or non-finite.
 *
 * The boundary where a missing measurement would otherwise become zero. Every numeric field
 * crossing into the UI goes through this, because one `?? 0` at one call site is all it takes to
 * turn "we never measured this" into "we measured nothing".
 */
function orNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSession(raw: unknown): BaselineSession {
  const session = raw as BaselineSession;
  const baseline = session.baseline ?? ({} as BaselineState);
  const comparison = session.comparison ?? ({} as ComparisonState);

  return {
    ...session,
    medianFrameTimeMs: orNull(session.medianFrameTimeMs),
    p99FrameTimeMs: orNull(session.p99FrameTimeMs),
    baseline: {
      ...baseline,
      medianFrameTimeMs: orNull(baseline.medianFrameTimeMs),
      spreadMs: orNull(baseline.spreadMs),
    },
    comparison: {
      ...comparison,
      baselineValue: orNull(comparison.baselineValue),
      sessionValue: orNull(comparison.sessionValue),
      differenceMs: orNull(comparison.differenceMs),
      noiseMs: orNull(comparison.noiseMs),
      effectSize: orNull(comparison.effectSize),
    },
  };
}

export function normalizeBaselineHistory(raw: unknown): BaselineSession[] {
  return Array.isArray(raw) ? raw.map(normalizeSession) : [];
}

/**
 * The short label for a verdict.
 *
 * Deliberately not a synonym game. "No change" and "No baseline yet" are different facts, and a
 * UI that collapsed them would report a real observation as nothing having happened.
 */
export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case 'Regression':
      return 'Slower than usual';
    case 'Improvement':
      return 'Faster than usual';
    case 'WithinNoise':
      return 'No change';
    case 'IndicativeOnly':
      return 'Possible change';
    case 'NotComparable':
      return 'Not comparable';
    case 'NoBaseline':
      return 'No baseline yet';
  }
}

/**
 * Which severity a verdict carries.
 *
 * `IndicativeOnly` is deliberately not critical. It is a difference the tool has seen but is not
 * yet entitled to call a regression, and dressing it in the same colour as one would be the
 * product overstating its own certainty in the one place that is easiest to get away with.
 */
export function verdictSeverity(verdict: Verdict): 'normal' | 'warning' | 'critical' | 'muted' {
  switch (verdict) {
    case 'Regression':
      return 'critical';
    case 'IndicativeOnly':
      return 'warning';
    case 'Improvement':
    case 'WithinNoise':
      return 'normal';
    case 'NotComparable':
    case 'NoBaseline':
      return 'muted';
  }
}

const base = import.meta.env.BASE_URL ?? '/';

export async function loadBaselineHistory(): Promise<BaselineSession[]> {
  const response = await fetch(`${base}scenarios/baseline.json`);
  if (!response.ok) throw new Error(`Baseline history unavailable (${response.status})`);
  return normalizeBaselineHistory(await response.json());
}
