using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// Memory pressure forces hard page faults, and the game stalls waiting on the disk.
/// </summary>
/// <remarks>
/// Hard faults are the paging metric that matters. Soft faults are routine and carry no
/// diagnostic weight, so a detector keying on total page faults would fire constantly on a
/// healthy machine.
/// </remarks>
public sealed class PagingStormScenario : SimulationScenario
{
    private static readonly TimeSpan StormStart = TimeSpan.FromSeconds(38);
    private static readonly TimeSpan StormEnd = TimeSpan.FromSeconds(44);

    public override string Id => "paging-storm";
    public override string Title => "Memory pressure and paging";
    public override string Description =>
        "Available memory falls below 400 MB, hard faults climb to ~900/s, and frames stall " +
        "waiting on the page file.";

    public override ExpectedOutcome Expected =>
        ExpectedOutcome.Diagnosed("memory-pressure-paging", minEvents: 1, maxEvents: 6,
            minConfidence: 0.65);

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng)
    {
        var baseline = 6.94 + ((rng.NextDouble() - 0.5) * 0.9);
        if (!Within(elapsed, StormStart, StormEnd)) return baseline;

        // Paging produces irregular, repeated stalls rather than one clean hitch.
        return rng.NextDouble() < 0.06
            ? 45.0 + (rng.NextDouble() * 70.0)
            : baseline + (rng.NextDouble() * 5.0);
    }

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        var storm = Within(elapsed, StormStart, StormEnd);
        var pressure = Ramp(elapsed, StormStart - TimeSpan.FromSeconds(6), StormStart);

        yield return Read(MetricId.MemoryAvailable, 18000 - (pressure * 17600) + (rng.NextDouble() * 80));
        yield return Read(MetricId.MemoryCommitted, 14000 + (pressure * 17000));
        yield return Read(MetricId.MemoryCommitLimit, 33000);
        yield return Read(MetricId.MemoryHardFaults, storm ? 700 + (rng.NextDouble() * 400) : rng.NextDouble() * 3);

        yield return Read(MetricId.DiskActive, storm ? 92 + (rng.NextDouble() * 7) : 4 + (rng.NextDouble() * 4));
        yield return Read(MetricId.DiskLatency, storm ? 9 + (rng.NextDouble() * 8) : 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.DiskRead, storm ? 480e6 : 4e6);

        // CPU and GPU are both fine. Nothing here is contended or hot; the machine is waiting.
        yield return Read(MetricId.CpuLoadTotal, storm ? 28 + (rng.NextDouble() * 6) : 38 + (rng.NextDouble() * 5));
        yield return Read(MetricId.CpuClockEffective, 4550 + (rng.NextDouble() * 70), quality: Quality.Derived);
        yield return Read(MetricId.CpuTemperature, 61 + (rng.NextDouble() * 3));
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.1));
        yield return Read(MetricId.GpuUtilization, storm ? 38 + (rng.NextDouble() * 14) : 95 + (rng.NextDouble() * 4));
        yield return Read(MetricId.GpuTemperature, 63 + (rng.NextDouble() * 3));
        yield return Read(MetricId.GpuThrottleReason, 0);
    }
}
