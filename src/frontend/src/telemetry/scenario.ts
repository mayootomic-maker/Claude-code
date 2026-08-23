import { Availability, Quality, UnavailableReason } from './availability';

/** One evidence item behind a diagnosis, as exported by the engine. */
export interface EvidenceItem {
  readonly metric: string;
  readonly statement: string;
  readonly role: 'Cause' | 'Consequence' | 'Contradicting';
  readonly sampleCount: number;
  readonly nativeRateHz: number | null;
  readonly canEstablishOrdering: boolean;
  readonly quality: 'Exact' | 'Derived' | 'Estimated' | 'Degraded';
}

/** A hypothesis the engine considered and rejected. */
export interface RuledOutItem {
  readonly title: string;
  readonly reason: string;
  readonly wasCheckable: boolean;
}

/** A detected event together with its diagnosis. */
export interface DetectedEvent {
  readonly startMs: number;
  readonly endMs: number;
  readonly className: string;
  readonly classId: number;
  readonly peakFrameTimeMs: number;
  readonly excessMs: number;
  readonly thresholdMs: number;
  readonly baselineMedianMs: number;
  readonly frameCount: number;
  readonly mergedCount: number;
  readonly duringWarmUp: boolean;
  readonly forceClosed: boolean;
  readonly countsTowardTally: boolean;
  readonly ruleId: string | null;
  readonly title: string;
  /** Absent when the engine could not identify a cause. Never zero. */
  readonly confidence: number | null;
  readonly bindingCap: number;
  readonly whatHappened: string;
  readonly mechanism: string | null;
  readonly recommendedAction: string | null;
  readonly evidence: readonly EvidenceItem[];
  readonly ruledOut: readonly RuledOutItem[];
}

/** A slow-rate metric series at its own native sampling rate. */
export interface MetricSeries {
  readonly metric: string;
  readonly metricId: number;
  readonly instance: number;
  readonly unit: string;
  readonly availability: Availability;
  readonly reason: UnavailableReason;
  readonly quality: Quality;
  /**
   * Which collector produced this series.
   *
   * Carried per series, not per session. Two metrics on the same machine routinely come from
   * different places — a GPU clock from the vendor API, a CPU clock derived from counters — and
   * a source substitution changes what a number means. Without provenance the substitution is
   * invisible and a comparison across sessions can silently span two different measurements.
   */
  readonly source: string;
  readonly sourceId: number;
  readonly timestamps: readonly number[];
  /** NaN where the sample carried no reading. */
  readonly values: readonly number[];
}

/**
 * A scenario exported by the engine: real pipeline output over simulated telemetry.
 *
 * Every number here was produced by the same detection and diagnosis code that will run
 * against a live machine. The only difference is where the samples came from — which is why
 * the interface must state that it is simulating, on every screen, without exception.
 */
export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly refreshRateHz: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly medianFrameTimeMs: number | null;
  readonly p99FrameTimeMs: number | null;
  readonly low1PercentFps: number | null;
  /**
   * Smallest excess the detector could resolve in this regime.
   *
   * Surfaced deliberately. On an unstable game this can exceed 25 ms, and "no stutters
   * detected" without stating the floor would be a misleading claim rather than a reassuring
   * one.
   */
  readonly sensitivityFloorMs: number | null;
  readonly stutterCount: number;
  readonly severeStutterCount: number;
  /** Absent when there were no events to explain. */
  readonly explanationRate: number | null;
  readonly frameTimestamps: readonly number[];
  readonly frameTimes: readonly number[];
  readonly series: readonly MetricSeries[];
  readonly events: readonly DetectedEvent[];
}

export interface ScenarioIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly refreshRateHz: number;
}

const base = import.meta.env.BASE_URL ?? '/';

export async function loadScenarioIndex(): Promise<ScenarioIndexEntry[]> {
  const response = await fetch(`${base}scenarios/index.json`);
  if (!response.ok) throw new Error(`Scenario index unavailable (${response.status})`);
  return (await response.json()) as ScenarioIndexEntry[];
}

export async function loadScenario(id: string): Promise<Scenario> {
  const response = await fetch(`${base}scenarios/${id}.json`);
  if (!response.ok) throw new Error(`Scenario '${id}' unavailable (${response.status})`);
  return (await response.json()) as Scenario;
}

/**
 * Reads a slow series at a point in time, honouring availability.
 *
 * Returns the most recent sample at or before `atMs`. Deliberately does **not** interpolate:
 * a 1 Hz sensor between readings held its last value as far as anyone knows, and drawing a
 * smooth line between two samples a second apart invents measurements that were never taken.
 */
export function sampleAt(
  series: MetricSeries,
  atMs: number,
): { value: number; ageMs: number } | null {
  if (series.availability !== Availability.Available) return null;

  let lo = 0;
  let hi = series.timestamps.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (series.timestamps[mid] <= atMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (found < 0) return null;
  const value = series.values[found];
  if (!Number.isFinite(value)) return null;

  return { value, ageMs: atMs - series.timestamps[found] };
}

/** Finds a series by metric name and optional instance. */
export function findSeries(
  scenario: Scenario,
  metric: string,
  instance = -1,
): MetricSeries | undefined {
  return scenario.series.find((s) => s.metric === metric && s.instance === instance);
}
