using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// A background process wakes and saturates a core, starving the render thread.
/// </summary>
/// <remarks>
/// The GPU utilization collapse here is a <i>consequence</i>, not a cause — the GPU is idle
/// because it is waiting for work the CPU could not submit. A diagnostic engine that reads the
/// GPU drop as the problem has the causality backwards, which is why the evidence model
/// distinguishes cause evidence from consequence evidence.
/// </remarks>
public sealed class BackgroundCpuSpikeScenario : SimulationScenario
{
    private static readonly TimeSpan SpikeStart = TimeSpan.FromSeconds(45);
    private static readonly TimeSpan SpikeEnd = TimeSpan.FromSeconds(46.4);

    /// <summary>Process id the offender is reported under.</summary>
    public const int OffenderPid = 4812;

    public override string Id => "background-cpu-spike";
    public override string Title => "Background CPU contention";
    public override string Description =>
        "A background process saturates a core for 1.4 s, starving the render thread.";
    public override ExpectedOutcome Expected =>
        ExpectedOutcome.Diagnosed("background-cpu-contention", minEvents: 1, maxEvents: 2,
            minConfidence: 0.6);

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng)
    {
        var baseline = 6.94 + ((rng.NextDouble() - 0.5) * 0.9);
        if (!Within(elapsed, SpikeStart, SpikeEnd)) return baseline;

        // One large hitch at onset, then sustained but lesser damage while contention persists.
        var since = (elapsed - SpikeStart).TotalSeconds;
        if (since < 0.02) return 104.0;
        return baseline + 8.0 + (rng.NextDouble() * 6.0);
    }

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        var contended = Within(elapsed, SpikeStart, SpikeEnd);

        yield return Read(MetricId.CpuLoadTotal, contended ? 82 + (rng.NextDouble() * 8) : 38 + (rng.NextDouble() * 6));
        yield return Read(MetricId.CpuLoadCore, contended ? 99 : 44 + (rng.NextDouble() * 8), instance: 3);

        // Clocks stay high: this is contention, not a frequency problem. That distinction is
        // exactly what separates this diagnosis from CPU frequency collapse.
        yield return Read(MetricId.CpuClockEffective, 4560 + (rng.NextDouble() * 80), quality: Quality.Derived);
        yield return Read(MetricId.CpuTemperature, 64 + (rng.NextDouble() * 5));
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.1));
        yield return Read(MetricId.CpuActiveCoreCount, contended ? 9 : 8);

        yield return Read(MetricId.GpuUtilization, contended ? 44 + (rng.NextDouble() * 10) : 95 + (rng.NextDouble() * 4));
        yield return Read(MetricId.GpuClockCore, 2600 + (rng.NextDouble() * 40));
        yield return Read(MetricId.GpuTemperature, 65 + (rng.NextDouble() * 3));
        yield return Read(MetricId.GpuThrottleReason, 0);

        yield return Read(MetricId.ProcessCpu, contended ? 78 + (rng.NextDouble() * 8) : 1.0 + rng.NextDouble(),
            instance: OffenderPid);

        yield return Read(MetricId.MemoryAvailable, 18000 + (rng.NextDouble() * 400));
        yield return Read(MetricId.MemoryHardFaults, rng.NextDouble() * 2);
        yield return Read(MetricId.DiskLatency, 0.3 + (rng.NextDouble() * 0.2));
    }
}
