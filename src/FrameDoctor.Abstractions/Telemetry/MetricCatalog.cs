using System.Collections.Frozen;

namespace FrameDoctor.Abstractions.Telemetry;

/// <summary>
/// Static description of every metric: its unit, and the minimum sample count below which it
/// must report <see cref="UnavailableReason.InsufficientData"/> rather than a number.
/// </summary>
/// <param name="Unit">Fixed per metric. A collector emitting a different unit is a bug.</param>
/// <param name="MinimumSamples">
/// Below this, the metric is not merely imprecise — it is describing too few events to mean
/// anything. See <see cref="MetricCatalog"/> for why this is enforced rather than advised.
/// </param>
/// <param name="HigherIsWorse">
/// Direction of badness, so the UI can colour a deviation without every call site knowing
/// whether more milliseconds or fewer frames is the bad direction.
/// </param>
public readonly record struct MetricDescriptor(
    Unit Unit,
    int MinimumSamples,
    bool HigherIsWorse);

/// <summary>
/// The metric catalog.
/// </summary>
/// <remarks>
/// <para>
/// The minimum-sample rules here are the honesty mechanism for percentiles. A 0.1 % low
/// computed from 300 frames is describing a single frame; reporting it as a stable metric
/// invites a user to compare it against another single frame from a different session and
/// conclude their machine regressed. Enforcing the minimum in one table, rather than hoping
/// each call site remembers, is what makes that impossible.
/// </para>
/// <para>
/// Percentile definitions are pinned in <c>docs/architecture/telemetry-model.md</c> and the
/// implementation is tested against that text. "1 % low" is ambiguous across measurement
/// tools, so ours is stated once and never restated.
/// </para>
/// </remarks>
public static class MetricCatalog
{
    private static readonly FrozenDictionary<MetricId, MetricDescriptor> Descriptors =
        new Dictionary<MetricId, MetricDescriptor>
        {
            // Frame. Percentile minimums come from the telemetry model.
            [MetricId.FrameTime] = new(Unit.Milliseconds, 1, true),
            [MetricId.FrameFpsInstant] = new(Unit.FramesPerSecond, 1, false),
            [MetricId.FrameFpsRolling] = new(Unit.FramesPerSecond, 30, false),
            [MetricId.FrameTimeMedian] = new(Unit.Milliseconds, 30, true),
            [MetricId.FrameTimeP95] = new(Unit.Milliseconds, 200, true),
            [MetricId.FrameTimeP99] = new(Unit.Milliseconds, 2000, true),
            [MetricId.FrameLow1Pct] = new(Unit.FramesPerSecond, 200, false),
            [MetricId.FrameLow01Pct] = new(Unit.FramesPerSecond, 2000, false),
            [MetricId.FrameTimeVariance] = new(Unit.MillisecondsSquared, 30, true),
            [MetricId.FrameStutterCount] = new(Unit.Count, 1, true),
            [MetricId.FrameSevereStutterCount] = new(Unit.Count, 1, true),
            [MetricId.FrameAnimationError] = new(Unit.Milliseconds, 1, true),
            [MetricId.FrameDisplayedTime] = new(Unit.Milliseconds, 1, true),
            [MetricId.FrameDropped] = new(Unit.Count, 1, true),

            // CPU
            [MetricId.CpuLoadTotal] = new(Unit.Percent, 1, true),
            [MetricId.CpuLoadCore] = new(Unit.Percent, 1, true),
            [MetricId.CpuClock] = new(Unit.Megahertz, 1, false),
            [MetricId.CpuClockEffective] = new(Unit.Megahertz, 1, false),
            [MetricId.CpuTemperature] = new(Unit.Celsius, 1, true),
            [MetricId.CpuPower] = new(Unit.Watts, 1, true),
            [MetricId.CpuThrottleState] = new(Unit.Flags, 1, true),
            [MetricId.CpuDpcTime] = new(Unit.Percent, 1, true),
            [MetricId.CpuIsrTime] = new(Unit.Percent, 1, true),
            [MetricId.CpuActiveCoreCount] = new(Unit.Count, 1, false),
            [MetricId.CpuParked] = new(Unit.Flags, 1, true),

            // GPU
            [MetricId.GpuUtilization] = new(Unit.Percent, 1, false),
            [MetricId.GpuClockCore] = new(Unit.Megahertz, 1, false),
            [MetricId.GpuClockMemory] = new(Unit.Megahertz, 1, false),
            [MetricId.GpuVramUsed] = new(Unit.Megabytes, 1, true),
            [MetricId.GpuVramTotal] = new(Unit.Megabytes, 1, false),
            [MetricId.GpuTemperature] = new(Unit.Celsius, 1, true),
            [MetricId.GpuTemperatureHotspot] = new(Unit.Celsius, 1, true),
            [MetricId.GpuPower] = new(Unit.Watts, 1, true),
            [MetricId.GpuThrottleReason] = new(Unit.Flags, 1, true),

            // Memory
            [MetricId.MemoryTotal] = new(Unit.Megabytes, 1, false),
            [MetricId.MemoryUsed] = new(Unit.Megabytes, 1, true),
            [MetricId.MemoryAvailable] = new(Unit.Megabytes, 1, false),
            [MetricId.MemoryCommitted] = new(Unit.Megabytes, 1, true),
            [MetricId.MemoryCommitLimit] = new(Unit.Megabytes, 1, false),
            [MetricId.MemoryHardFaults] = new(Unit.PerSecond, 1, true),

            // Storage
            [MetricId.DiskActive] = new(Unit.Percent, 1, true),
            [MetricId.DiskRead] = new(Unit.BytesPerSecond, 1, false),
            [MetricId.DiskWrite] = new(Unit.BytesPerSecond, 1, false),
            [MetricId.DiskLatency] = new(Unit.Milliseconds, 1, true),
            [MetricId.DiskQueue] = new(Unit.Count, 1, true),

            // Process
            [MetricId.ProcessCpu] = new(Unit.Percent, 1, true),
            [MetricId.ProcessWorkingSet] = new(Unit.Megabytes, 1, true),
            [MetricId.ProcessDiskBytes] = new(Unit.BytesPerSecond, 1, true),
            [MetricId.ProcessGpuUtilization] = new(Unit.Percent, 1, true),

            // Self
            [MetricId.SelfCpu] = new(Unit.Percent, 1, true),
            [MetricId.SelfWorkingSet] = new(Unit.Megabytes, 1, true),
            [MetricId.SelfDiskWriteRate] = new(Unit.BytesPerSecond, 1, true),
            [MetricId.SelfTelemetryLatency] = new(Unit.Milliseconds, 1, true),
            [MetricId.SelfDroppedSamples] = new(Unit.Count, 1, true),
        }.ToFrozenDictionary();

    /// <summary>All metrics in the catalog.</summary>
    public static IReadOnlyCollection<MetricId> All => Descriptors.Keys;

    /// <summary>Looks up a metric's descriptor.</summary>
    /// <exception cref="ArgumentOutOfRangeException">The metric is not in the catalog.</exception>
    public static MetricDescriptor Describe(MetricId metric) =>
        Descriptors.TryGetValue(metric, out var d)
            ? d
            : throw new ArgumentOutOfRangeException(
                nameof(metric), metric, "Metric is not in the catalog.");

    public static bool IsKnown(MetricId metric) => Descriptors.ContainsKey(metric);

    public static Unit UnitOf(MetricId metric) => Describe(metric).Unit;

    /// <summary>
    /// Minimum sample count before this metric may report a value.
    /// </summary>
    public static int MinimumSamplesFor(MetricId metric) => Describe(metric).MinimumSamples;

    /// <summary>
    /// Whether <paramref name="sampleCount"/> observations are enough for this metric.
    /// </summary>
    /// <remarks>
    /// Callers that get <see langword="false"/> emit
    /// <see cref="TelemetrySample.Unavailable"/> with
    /// <see cref="UnavailableReason.InsufficientData"/> — never a value, and never zero.
    /// </remarks>
    public static bool HasEnoughSamples(MetricId metric, int sampleCount) =>
        sampleCount >= Describe(metric).MinimumSamples;
}
