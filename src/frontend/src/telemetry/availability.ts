/**
 * Availability and quality, mirroring the .NET telemetry model.
 *
 * The rule this file exists to carry across the process boundary: **a missing metric is never
 * zero.** Reading an absent temperature sensor as 0 °C says the CPU is cold. Every guarantee
 * upstream would be pointless if the UI collapsed absence into a number here.
 */

export enum Availability {
  Available = 0,
  Unavailable = 1,
  Denied = 2,
  Failed = 3,
  Stale = 4,
}

export enum UnavailableReason {
  None = 0,
  NoSensor = 1,
  RequiresSensorDriver = 2,
  InsufficientPrivilege = 3,
  NotExposedByVendor = 4,
  InsufficientData = 5,
  NotYetSampled = 6,
  SourceFaulted = 7,
  EtwProviderSlotsExhausted = 8,
  TargetProcessProtected = 9,
  NotMeaningfulInCurrentState = 10,
  ClockDiscontinuity = 11,
}

export enum Quality {
  Exact = 0,
  Derived = 1,
  Estimated = 2,
  Degraded = 3,
}

/**
 * A value that may not exist.
 *
 * Modelled as a discriminated union rather than `number | null` so the compiler forces every
 * call site to decide what absence looks like. `value` is simply not present on the absent
 * variant, which makes `metric.value ?? 0` unwritable rather than merely discouraged.
 */
export type MetricValue =
  | {
      readonly state: Availability.Available | Availability.Stale;
      readonly value: number;
      readonly quality: Quality;
      /** Milliseconds since the reading was taken. Only meaningful when stale. */
      readonly ageMs?: number;
    }
  | {
      readonly state: Availability.Unavailable | Availability.Denied | Availability.Failed;
      readonly reason: UnavailableReason;
    };

/**
 * A reading.
 *
 * Refuses anything that is not a finite number, including `undefined` arriving through an
 * unvalidated boundary. The discriminated union makes `metric.value ?? 0` unwritable inside this
 * module, and that guarantee was defeated at the edges: `hasValue` tests the *state*, so an
 * `{ state: Available, value: undefined }` passed it and reached `.toFixed()` — a blank screen,
 * or worse, a headline number rendered from nothing.
 */
export const available = (value: number, quality: Quality = Quality.Exact): MetricValue =>
  Number.isFinite(value)
    ? { state: Availability.Available, value, quality }
    : { state: Availability.Unavailable, reason: UnavailableReason.SourceFaulted };

export const stale = (value: number, ageMs: number): MetricValue =>
  Number.isFinite(value)
    ? { state: Availability.Stale, value, quality: Quality.Degraded, ageMs }
    : { state: Availability.Unavailable, reason: UnavailableReason.SourceFaulted };

export const unavailable = (reason: UnavailableReason): MetricValue => ({
  state: Availability.Unavailable,
  reason,
});

export const denied = (
  reason: UnavailableReason = UnavailableReason.InsufficientPrivilege,
): MetricValue => ({ state: Availability.Denied, reason });

export const failed = (
  reason: UnavailableReason = UnavailableReason.SourceFaulted,
): MetricValue => ({ state: Availability.Failed, reason });

/** Whether a reading exists. Narrows the union for the caller. */
export function hasValue(
  metric: MetricValue,
): metric is Extract<MetricValue, { value: number }> {
  return metric.state === Availability.Available || metric.state === Availability.Stale;
}

/**
 * Why a metric has no reading, in language a user can act on.
 *
 * "Unavailable" is a shrug. "Requires a kernel-mode sensor driver" is a decision they can make.
 */
export function describeReason(reason: UnavailableReason): string {
  switch (reason) {
    case UnavailableReason.NoSensor:
      return 'No sensor for this metric on this hardware';
    case UnavailableReason.RequiresSensorDriver:
      return 'Requires a kernel-mode sensor driver, which is not installed';
    case UnavailableReason.InsufficientPrivilege:
      return 'FrameDoctor does not have permission to read this';
    case UnavailableReason.NotExposedByVendor:
      return 'This GPU driver does not report this value';
    case UnavailableReason.InsufficientData:
      return 'Not enough samples yet for this to mean anything';
    case UnavailableReason.NotYetSampled:
      return 'Waiting for the first reading';
    case UnavailableReason.SourceFaulted:
      return 'The source stopped responding';
    case UnavailableReason.EtwProviderSlotsExhausted:
      return 'Windows allows only eight programs at a time to receive graphics-timing events, and all eight are in use';
    case UnavailableReason.TargetProcessProtected:
      return 'The game blocks inspection, most likely its anti-cheat';
    case UnavailableReason.NotMeaningfulInCurrentState:
      return 'Not meaningful while the session is locked or disconnected';
    case UnavailableReason.ClockDiscontinuity:
      return 'The machine slept, so this interval cannot be trusted';
    case UnavailableReason.None:
      return '';
  }
}

/** Short label for a metric with no reading. Never a zero. */
export const ABSENT = '—';
