using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// A well-behaved session: 144 fps, GPU-bound, nothing wrong.
/// </summary>
/// <remarks>
/// The most important scenario in the suite, and the one most likely to be omitted. A detector
/// is only trustworthy if it can say "nothing happened" — a tool that proves itself by finding
/// something will always find something.
/// </remarks>
public sealed class HealthyScenario : SimulationScenario
{
    public override string Id => "healthy";
    public override string Title => "Healthy session";
    public override string Description =>
        "144 fps, GPU-bound, comfortable thermals. Nothing to report.";
    public override ExpectedOutcome Expected => ExpectedOutcome.Healthy();

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng) =>
        6.94 + ((rng.NextDouble() - 0.5) * 0.9);

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        yield return Read(MetricId.CpuLoadTotal, 38 + (rng.NextDouble() * 6));
        yield return Read(MetricId.CpuClockEffective, 4550 + (rng.NextDouble() * 90), quality: Quality.Derived);
        yield return Read(MetricId.CpuTemperature, 62 + (rng.NextDouble() * 4));
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.1));
        yield return Read(MetricId.CpuActiveCoreCount, 8);
        yield return Read(MetricId.GpuUtilization, 95 + (rng.NextDouble() * 4));
        yield return Read(MetricId.GpuClockCore, 2600 + (rng.NextDouble() * 40));
        yield return Read(MetricId.GpuTemperature, 66 + (rng.NextDouble() * 3));
        yield return Read(MetricId.GpuThrottleReason, 0);
        yield return Read(MetricId.GpuVramUsed, 7400 + (rng.NextDouble() * 200));
        yield return Read(MetricId.GpuVramTotal, 12288);
        yield return Read(MetricId.MemoryAvailable, 18000 + (rng.NextDouble() * 500));
        yield return Read(MetricId.MemoryHardFaults, rng.NextDouble() * 2);
        yield return Read(MetricId.DiskLatency, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.DiskActive, 3 + (rng.NextDouble() * 4));
    }
}
