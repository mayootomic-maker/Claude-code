using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// CPU effective clock collapses under unchanged load, with no temperature sensor available.
/// </summary>
/// <remarks>
/// <para>
/// This scenario exists to pin the product's most important piece of honesty. The clock
/// collapse is real, measurable and diagnosable. The <i>reason</i> for it is not: without a die
/// temperature, thermal throttling cannot be distinguished from a power limit, a current limit,
/// or an OS policy change.
/// </para>
/// <para>
/// So the expected outcome is a frequency-collapse diagnosis at moderate confidence, and
/// explicitly <b>not</b> a thermal one. A detector that says "thermal throttling" here is
/// producing exactly the confident nonsense this product exists to avoid — and it would be
/// wrong on a real machine roughly half the time.
/// </para>
/// </remarks>
public sealed class CpuFrequencyCollapseScenario : SimulationScenario
{
    private static readonly TimeSpan CollapseStart = TimeSpan.FromSeconds(40);
    private static readonly TimeSpan CollapseFull = TimeSpan.FromSeconds(42);

    public override string Id => "cpu-frequency-collapse";
    public override string Title => "CPU frequency collapse";
    public override string Description =>
        "Effective clock falls 4.6 to 1.4 GHz under unchanged load. No CPU temperature sensor, " +
        "so the cause cannot be attributed to heat.";

    public override ExpectedOutcome Expected =>
        ExpectedOutcome.Diagnosed("cpu-frequency-collapse", minEvents: 1, maxEvents: 3,
            minConfidence: 0.5, maxConfidence: 0.75);

    /// <summary>No CPU thermal or power sensor: the common case without a kernel-mode driver.</summary>
    public override IReadOnlySet<MetricId> UnavailableMetrics { get; } =
        new HashSet<MetricId> { MetricId.CpuTemperature, MetricId.CpuPower, MetricId.CpuThrottleState };

    public override UnavailableReason UnavailableBecause => UnavailableReason.RequiresSensorDriver;

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng)
    {
        var severity = Ramp(elapsed, CollapseStart, CollapseFull);
        var baseline = 6.94 + ((rng.NextDouble() - 0.5) * 0.9);

        // The onset produces a hitch; the sustained state produces a higher, noisier baseline.
        if (Within(elapsed, CollapseStart, CollapseStart + TimeSpan.FromMilliseconds(60)))
            return 88.0;

        return baseline + (severity * (14.0 + (rng.NextDouble() * 4.0)));
    }

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        var severity = Ramp(elapsed, CollapseStart, CollapseFull);
        var clock = 4600 - (severity * 3200);

        yield return Read(MetricId.CpuClockEffective, clock + (rng.NextDouble() * 40), quality: Quality.Derived);
        yield return Read(MetricId.CpuClock, 4700);

        // Load is unchanged. That is the point: the work did not increase, the machine slowed.
        yield return Read(MetricId.CpuLoadTotal, 41 + (rng.NextDouble() * 5));
        yield return Read(MetricId.CpuActiveCoreCount, 8);
        yield return Read(MetricId.CpuParked, 0);
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.1));

        yield return Read(MetricId.GpuUtilization, 95 - (severity * 42));
        yield return Read(MetricId.GpuClockCore, 2600 + (rng.NextDouble() * 40));
        yield return Read(MetricId.GpuTemperature, 64 + (rng.NextDouble() * 3));
        yield return Read(MetricId.GpuThrottleReason, 0);

        yield return Read(MetricId.MemoryAvailable, 18000 + (rng.NextDouble() * 400));
        yield return Read(MetricId.MemoryHardFaults, rng.NextDouble() * 2);
        yield return Read(MetricId.DiskLatency, 0.3 + (rng.NextDouble() * 0.2));
    }
}
