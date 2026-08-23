using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Simulation.Scenarios;

/// <summary>
/// GPU hits its board power limit and cuts core clock, while staying cool.
/// </summary>
/// <remarks>
/// <para>
/// The scenario that separates two diagnoses a user would otherwise conflate. Everything here
/// looks like the thermal case — clock falls, frame time rises, the vendor reports a throttle —
/// except the temperature, which sits at an unremarkable 68 °C while board power pins to the
/// limit.
/// </para>
/// <para>
/// It exists because the wrong answer here is expensive in the user's time: told they are
/// overheating, they clean a cooler and repaste a card that was never hot. It is also the
/// scenario that catches a detector reading any nonzero throttle bitmask as "thermal", which is
/// the easy way to write this rule and is wrong.
/// </para>
/// </remarks>
public sealed class GpuPowerLimitScenario : SimulationScenario
{
    /// <summary>Vendor bitmask for a software power cap.</summary>
    public const int SoftwarePowerCap = (int)GpuThrottleReason.SoftwarePowerCap;

    /// <summary>Board power limit this card is configured for, in watts.</summary>
    private const double PowerLimitWatts = 285.0;

    private static readonly TimeSpan RampStart = TimeSpan.FromSeconds(25);
    private static readonly TimeSpan RampEnd = TimeSpan.FromSeconds(45);

    public override string Id => "gpu-power-limit";
    public override string Title => "GPU power limit";
    public override string Description =>
        "GPU pins to a 285 W board power limit and drops core clock 2640 to 2050 MHz at 68 C, " +
        "with the vendor reporting a power cap rather than a thermal one.";

    public override ExpectedOutcome Expected =>
        ExpectedOutcome.Diagnosed("gpu-power-limit", minEvents: 1, maxEvents: 6,
            minConfidence: 0.70);

    public override TimeSpan Duration => TimeSpan.FromSeconds(100);

    protected override double FrameTimeMs(TimeSpan elapsed, Random rng)
    {
        var severity = Ramp(elapsed, RampStart, RampEnd);
        var baseline = 6.94 + ((rng.NextDouble() - 0.5) * 0.9);

        // A power cap settles into a lower sustained clock rather than oscillating, so the frame
        // time rises to a new floor and stays there. That is the shape the regime-change path in
        // the detector has to recognise; a train of hitches would be a different fault.
        var value = baseline * (1.0 + (severity * 0.30));

        if (severity > 0.6 && rng.NextDouble() < 0.0008) value += 28.0 + (rng.NextDouble() * 14);
        return value;
    }

    protected override IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng)
    {
        var severity = Ramp(elapsed, RampStart, RampEnd);

        // The whole point of the scenario: comfortably cool throughout. A rule that concludes
        // "thermal" from these numbers has read the bitmask carelessly.
        yield return Read(MetricId.GpuTemperature, 64 + (severity * 4) + (rng.NextDouble() * 1.2));
        yield return Read(MetricId.GpuTemperatureHotspot, 74 + (severity * 5) + (rng.NextDouble() * 1.5));

        yield return Read(MetricId.GpuClockCore, 2640 - (severity * 590) + (rng.NextDouble() * 20));
        yield return Read(MetricId.GpuClockMemory, 10500 + (rng.NextDouble() * 20));

        // Power rises to the limit and then stops, which is what a cap looks like from outside.
        yield return Read(
            MetricId.GpuPower,
            Math.Min(PowerLimitWatts, 210 + (severity * 90)) - (rng.NextDouble() * 2));

        yield return Read(MetricId.GpuUtilization, 97 + (rng.NextDouble() * 2));
        yield return Read(MetricId.GpuThrottleReason, severity > 0.5 ? SoftwarePowerCap : 0);

        yield return Read(MetricId.CpuLoadTotal, 34 + (rng.NextDouble() * 5));
        yield return Read(MetricId.CpuClockEffective, 4580 + (rng.NextDouble() * 60), quality: Quality.Derived);
        yield return Read(MetricId.CpuDpcTime, 0.3 + (rng.NextDouble() * 0.2));
        yield return Read(MetricId.CpuIsrTime, 0.1 + (rng.NextDouble() * 0.1));
        yield return Read(MetricId.MemoryHardFaults, rng.NextDouble() * 2);
        yield return Read(MetricId.DiskLatency, 0.3 + (rng.NextDouble() * 0.2));
    }
}
