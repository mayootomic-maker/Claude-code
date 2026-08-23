import { useMemo, type JSX } from 'react';
import {
  Availability,
  Quality,
  UnavailableReason,
  describeReason,
} from '../telemetry/availability';
import type { MetricSeries, Scenario } from '../telemetry/scenario';

/**
 * How each source is described, and the order the groups read in.
 *
 * Grouped by where a reading comes from rather than by what it measures, because the question
 * this screen answers is "why can this machine not tell me X" — and the answer is almost always
 * a property of the source, not of the metric.
 */
const SOURCE_NOTES: Readonly<Record<string, string>> = {
  Simulation: 'Deterministic synthetic telemetry. No sensor on this machine was read.',
  Replay: 'A previously recorded capture, replayed through the same pipeline.',
  PresentMonCli: 'Frame timing, from the bundled PresentMon helper.',
  PerformanceCounters: 'Windows performance counters. No elevation, no driver.',
  NvidiaNvml: 'The NVIDIA driver’s own management library.',
  AmdAdlx: 'The AMD driver’s own management library.',
  IntelIgcl: 'The Intel driver’s own control library.',
  NtSystemInformation: 'The Windows process table, read only when an event is detected.',
  Win32MemoryApi: 'The Windows memory manager.',
  Derived: 'Computed from other readings rather than measured directly.',
  LibreHardwareMonitor: 'A third-party sensor library that requires a kernel driver.',
};

const METRIC_LABELS: Readonly<Record<string, string>> = {
  CpuLoadTotal: 'CPU load',
  CpuLoadCore: 'CPU load, per core',
  CpuClock: 'CPU clock',
  CpuClockEffective: 'CPU effective clock',
  CpuTemperature: 'CPU temperature',
  CpuPower: 'CPU package power',
  CpuDpcTime: 'Deferred procedure calls',
  CpuIsrTime: 'Interrupt time',
  CpuActiveCoreCount: 'Busy cores',
  CpuThrottleState: 'CPU throttle state',
  CpuParked: 'Parked cores',
  FrameTimeMedian: 'Frame time, median',
  FrameTimeP99: 'Frame time, 99th percentile',
  FrameLow1Pct: '1 % low',
  FrameFpsRolling: 'Frames per second',
  GpuUtilization: 'GPU load',
  GpuClockCore: 'GPU core clock',
  GpuClockMemory: 'GPU memory clock',
  GpuTemperature: 'GPU temperature',
  GpuTemperatureHotspot: 'GPU hotspot temperature',
  GpuPower: 'GPU board power',
  GpuThrottleReason: 'GPU throttle reason',
  GpuVramUsed: 'GPU memory in use',
  GpuVramTotal: 'GPU memory installed',
  MemoryTotal: 'Memory installed',
  MemoryAvailable: 'Memory free',
  MemoryUsed: 'Memory in use',
  MemoryCommitted: 'Commit charge',
  MemoryCommitLimit: 'Commit limit',
  MemoryHardFaults: 'Hard page faults',
  DiskActive: 'Disk activity',
  DiskLatency: 'Disk response time',
  DiskRead: 'Disk read rate',
  DiskWrite: 'Disk write rate',
  DiskQueue: 'Disk queue length',
  ProcessCpu: 'CPU per process',
};

interface SystemViewProps {
  readonly scenario: Scenario;
}

interface SourceGroup {
  readonly source: string;
  readonly series: readonly MetricSeries[];
}

/**
 * What this machine can and cannot measure, and why.
 *
 * The screen a user reaches after reading "confidence 60 %, capped because a sensor this
 * diagnosis needs is unavailable" and wanting to know which sensor and what it would take. It
 * is also the product's own audit trail: every metric is listed whether or not it works, with
 * the collector that provides it, so a source substitution is visible rather than silent.
 *
 * Nothing here is aspirational. A metric FrameDoctor does not attempt at all is simply not on
 * the list; a metric it attempts and cannot get says so, in the same words the diagnosis uses.
 */
export function SystemView({ scenario }: SystemViewProps): JSX.Element {
  const groups = useMemo<SourceGroup[]>(() => {
    const bySource = new Map<string, MetricSeries[]>();

    for (const series of scenario.series) {
      // Per-core and per-process instances are collapsed into their metric: sixteen rows saying
      // "CPU load, per core" would bury everything else on the screen.
      if (series.instance !== -1 && bySource.get(series.source)?.some((s) => s.metric === series.metric))
        continue;

      const existing = bySource.get(series.source);
      if (existing) existing.push(series);
      else bySource.set(series.source, [series]);
    }

    return [...bySource.entries()]
      .map(([source, series]) => ({
        source,
        series: [...series].sort((a, b) => a.metricId - b.metricId),
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }, [scenario]);

  const total = groups.reduce((n, g) => n + g.series.length, 0);
  const working = groups.reduce(
    (n, g) => n + g.series.filter((s) => s.availability === Availability.Available).length,
    0,
  );

  return (
    <div className="system">
      <header className="system__head">
        <h1 className="t-title">What this machine can measure</h1>
        <p className="t-body system__lede">
          {working} of {total} metrics are available. A metric with no sensor is listed with the
          reason rather than hidden, because an absent reading is why a diagnosis gets capped —
          and a capped diagnosis with no visible gap looks like a weak finding rather than an
          incomplete machine.
        </p>
      </header>

      <div className="system__groups">
        {groups.map((group) => (
          <section key={group.source} className="source">
            <div className="source__head">
              <h2 className="t-subtitle source__name">{group.source}</h2>
              <span className="t-body-sm source__note">
                {SOURCE_NOTES[group.source] ?? 'Source not described.'}
              </span>
            </div>

            <table className="source__table">
              <thead>
                <tr className="t-label">
                  <th scope="col">Metric</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Rate</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {group.series.map((series) => (
                  <MetricRow key={`${series.metric}-${series.instance}`} series={series} />
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The observed sample rate, computed rather than declared.
 *
 * A source's nominal interval and what it actually delivered are different things, and the
 * difference is diagnostic: a 4 Hz metric arriving at 1 Hz is a source falling behind. Returns
 * null below two samples, where there is no interval to measure.
 */
function observedRateHz(series: MetricSeries): number | null {
  if (series.timestamps.length < 2) return null;

  const span = series.timestamps[series.timestamps.length - 1] - series.timestamps[0];
  if (!(span > 0)) return null;

  return ((series.timestamps.length - 1) / span) * 1000;
}

function MetricRow({ series }: { readonly series: MetricSeries }): JSX.Element {
  const label = METRIC_LABELS[series.metric] ?? series.metric;
  const available = series.availability === Availability.Available;
  const rate = observedRateHz(series);

  return (
    <tr data-available={available || undefined}>
      <th scope="row" className="t-body">
        {label}
        {series.quality !== Quality.Exact && available ? (
          // Derived and estimated readings are marked here, not only in the inspector. A user
          // comparing two machines needs to know that one of them is computing a number the
          // other measures.
          <span className="source__quality t-mono-sm">{Quality[series.quality].toLowerCase()}</span>
        ) : null}
      </th>

      <td className="t-mono-sm source__unit">{available ? formatUnit(series.unit) : '—'}</td>

      {/*
        The rate is shown only where there are readings to have a rate. A source polling an
        absent sensor four times a second is still polling at 4 Hz, and printing that beside a
        metric with no data reads as "it is working, at 4 Hz".
      */}
      <td className="t-mono-sm source__rate">
        {available && rate !== null ? `${rate.toFixed(1)} Hz` : '—'}
      </td>

      <td className="source__state">
        {available ? (
          <span className="t-body-sm source__ok">available</span>
        ) : (
          <span
            className="t-body-sm source__missing"
            data-actionable={isActionable(series.reason) || undefined}
          >
            {describeReason(series.reason)}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * Whether the user could change this outcome.
 *
 * Only these three are worth presenting as something to do about. Marking "no sensor on this
 * hardware" as actionable would send someone hunting for a setting that does not exist.
 */
function isActionable(reason: UnavailableReason): boolean {
  return (
    reason === UnavailableReason.InsufficientPrivilege ||
    reason === UnavailableReason.RequiresSensorDriver ||
    reason === UnavailableReason.EtwProviderSlotsExhausted
  );
}

function formatUnit(unit: string): string {
  switch (unit) {
    case 'Percent':
      return '%';
    case 'Milliseconds':
      return 'ms';
    case 'Megahertz':
      return 'MHz';
    case 'Celsius':
      return '°C';
    case 'Watts':
      return 'W';
    case 'Megabytes':
      return 'MB';
    case 'PerSecond':
      return '/s';
    case 'BytesPerSecond':
      return 'B/s';
    case 'FramesPerSecond':
      return 'fps';
    case 'Flags':
      return 'bits';
    case 'Count':
      return '';
    default:
      return unit.toLowerCase();
  }
}
