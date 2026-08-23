using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// GPU reaches its thermal limit and cuts core clock, with the vendor reporting why.
/// </summary>
/// <remarks>
/// <para>
/// This is the strongest diagnosis FrameDoctor can make without any kernel driver, because the
/// vendor supplies an explicit throttle-reason bitmask alongside the temperature and the clock.
/// Three independent signals agreeing — rising temperature, falling clock, and the hardware
/// itself saying "thermal" — is what justifies high confidence.
/// </para>
/// <para>
/// It is deliberately the GPU rather than the CPU. The equivalent CPU claim needs a die
/// temperature that requires ring-0 access, so on the CPU side the honest answer is a frequency
/// collapse of undetermined cause. Making the flagship thermal example the GPU one is what
/// keeps a kernel driver off the product's critical path.
/// </para>
/// </remarks>
public sealed class GpuThermalThrottleScenario : SimulationScenario
{
    /// <summary>Vendor bitmask value for a hardware thermal slowdown.</summary>
    /// <remarks>
    /// Taken from the shared throttle vocabulary rather than restated here, so a scenario cannot
    /// drift away from what the detector reads.
    /// </remarks>
    public const int HardwareThermalSlowdown = (int)GpuThrottleReason.HardwareThermalSlowdown;

    private static readonly TimeSpan RampStart = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan RampEnd = TimeSpan.FromSeconds(55);

    public override string Id => "gpu-thermal-throttle";
    public override string Title => "GPU thermal throttling";
    public override string Description =>
        "GPU reaches 87 C, core clock falls 2610 to 1830 MHz, and the vendor reports a hardware " +
        "thermal slowdown.";

    public override ExpectedOutcome Expected =>
        ExpectedOutcome.Diagnosed("gpu-thermal-throttle", minEvents: 1, maxEvents: 6,
            minConfidence: 0.75);

    public override TimeSpan Duration => TimeSpan.FromSeconds(100);

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng)
    {
        var severity = Ramp(elapsed, RampStart, RampEnd);
        var baseline = 6.94 + ((rng.NextDouble() - 0.5) * 0.9);

        // A thermal ramp is gradual: mostly a rising floor rather than discrete hitches, which
        // is why sustained-low-performance detection matters as much as outlier detection here.
        var value = baseline * (1.0 + (severity * 0.42));

        // Clock-stepping produces occasional discrete jumps as the card drops a power bin.
        // Deliberately infrequent: thermal throttling is overwhelmingly a sustained rise in
        // frame time, not a train of hitches. A generator that produced a spike every few
        // hundred frames would be modelling something else, and a detector tuned against it
        // would learn the wrong shape.
        if (severity > 0.5 && rng.NextDouble() < 0.0012) value += 34.0 + (rng.NextDouble() * 20);
        return value;
    }

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        var severity = Ramp(elapsed, RampStart, RampEnd);

        yield return Read(MetricId.GpuTemperature, 66 + (severity * 21) + (rng.NextDouble() * 1.5));
        yield return Read(MetricId.GpuTemperatureHotspot, 78 + (severity * 26) + (rng.NextDouble() * 2));
        yield return Read(MetricId.GpuClockCore, 2610 - (severity * 780) + (rng.NextDouble() * 25));
        yield return Read(MetricId.GpuPower, 320 - (severity * 40));
        yield return Read(MetricId.GpuUtilization, 96 + (rng.NextDouble() * 3));

        // The load-bearing signal: the hardware itself reporting the reason.
        yield return Read(MetricId.GpuThrottleReason, severity > 0.45 ? HardwareThermalSlowdown : 0);

        yield return Read(MetricId.CpuLoadTotal, 37 + (rng.NextDouble() * 5));
        yield return Read(MetricId.CpuClockEffective, 4560 + (rng.NextDouble() * 60), quality: Quality.Derived);
        yield return Read(MetricId.CpuTemperature, 63 + (rng.NextDouble() * 3));
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.1));
        yield return Read(MetricId.MemoryHardFaults, rng.NextDouble() * 2);
        yield return Read(MetricId.DiskLatency, 0.3 + (rng.NextDouble() * 0.2));
    }
}
