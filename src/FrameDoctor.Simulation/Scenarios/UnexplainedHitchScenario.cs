using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// A real hitch with no correlate in any metric we can observe.
/// </summary>
/// <remarks>
/// <para>
/// The correct diagnosis here is <b>no diagnosis</b> — plus the list of what was ruled out.
/// This is not a gap in the suite, it is the case that decides whether the product is
/// trustworthy.
/// </para>
/// <para>
/// It is also realistic rather than contrived. Shader compilation, asset streaming, driver
/// hitches and engine garbage collection all produce genuine stutters that leave no trace in
/// 1–4 Hz counters, and they are among the most common causes of modern stutter. A detector
/// that manufactures a plausible cause here — "probably background CPU" at 55 % — would be
/// wrong in a way the user cannot check, which is worse than admitting ignorance.
/// </para>
/// </remarks>
public sealed class UnexplainedHitchScenario : SimulationScenario
{
    private static readonly TimeSpan HitchAt = TimeSpan.FromSeconds(50);

    public override string Id => "unexplained-hitch";
    public override string Title => "Unexplained hitch";
    public override string Description =>
        "A 96 ms hitch with every observable metric flat. The correct answer is that the cause " +
        "cannot be determined, with the exclusions listed.";

    public override ExpectedOutcome Expected => ExpectedOutcome.Unexplained(minEvents: 1, maxEvents: 2);

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng)
    {
        var baseline = 6.94 + ((rng.NextDouble() - 0.5) * 0.9);
        return Within(elapsed, HitchAt, HitchAt + TimeSpan.FromMilliseconds(20)) ? 96.0 : baseline;
    }

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        // Everything flat and healthy, through the hitch and on both sides of it.
        yield return Read(MetricId.CpuLoadTotal, 39 + (rng.NextDouble() * 4));
        yield return Read(MetricId.CpuLoadCore, 46 + (rng.NextDouble() * 6), instance: 3);
        yield return Read(MetricId.CpuClockEffective, 4590 + (rng.NextDouble() * 40), quality: Quality.Derived);
        yield return Read(MetricId.CpuTemperature, 62 + (rng.NextDouble() * 2));
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.15));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.08));
        yield return Read(MetricId.CpuActiveCoreCount, 8);
        yield return Read(MetricId.GpuUtilization, 94 + (rng.NextDouble() * 4));
        yield return Read(MetricId.GpuClockCore, 2600 + (rng.NextDouble() * 30));
        yield return Read(MetricId.GpuTemperature, 65 + (rng.NextDouble() * 2));
        yield return Read(MetricId.GpuThrottleReason, 0);
        yield return Read(MetricId.MemoryAvailable, 17800 + (rng.NextDouble() * 300));
        yield return Read(MetricId.MemoryHardFaults, rng.NextDouble() * 2);
        yield return Read(MetricId.DiskLatency, 0.3 + (rng.NextDouble() * 0.15));
        yield return Read(MetricId.DiskActive, 3 + (rng.NextDouble() * 3));
    }
}
