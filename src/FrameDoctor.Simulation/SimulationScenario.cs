using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Simulation;

/// <summary>
/// A deterministic synthetic telemetry scenario.
/// </summary>
/// <remarks>
/// <para>
/// This is the <b>single sanctioned transport for synthetic data</b>. Every sample it produces
/// carries <see cref="SourceId.Simulation"/>, which is what makes randomness anywhere else in
/// the product greppably illegal rather than merely discouraged.
/// </para>
/// <para>
/// Scenarios are seeded and therefore reproducible: a failing diagnostic test names the exact
/// series that produced it.
/// </para>
/// <para>
/// <b>The rule that keeps this honest:</b> a scenario with no detector consuming it tests
/// nothing — it only exercises rendering, while quietly enshrining a guess about what a failure
/// looks like. The scenario list grows when a diagnosis lands, not before. And once real
/// captures exist, replaying them outranks authored fixtures: real data cannot be
/// self-confirming, authored data can.
/// </para>
/// </remarks>
public abstract class SimulationScenario
{
    /// <summary>Stable identifier, used in test names and the UI.</summary>
    public abstract string Id { get; }

    /// <summary>Short human-readable name.</summary>
    public abstract string Title { get; }

    /// <summary>What this scenario depicts, in one sentence.</summary>
    public abstract string Description { get; }

    /// <summary>
    /// What the diagnostic engine is expected to conclude.
    /// </summary>
    /// <remarks>
    /// Asserted by tests. A scenario whose expectation is never checked is decoration.
    /// </remarks>
    public abstract ExpectedOutcome Expected { get; }

    public virtual TimeSpan Duration => TimeSpan.FromSeconds(90);

    /// <summary>Display refresh rate the scenario assumes.</summary>
    public virtual double RefreshRateHz => 144.0;

    /// <summary>Rate at which counter and sensor metrics are emitted.</summary>
    protected virtual double SlowMetricHz => 4.0;

    /// <summary>Frame time at a given point in the scenario.</summary>
    protected abstract double FrameTimeMs(TimeSpan elapsed, Random rng);

    /// <summary>Slow-metric readings at a given point in the scenario.</summary>
    protected abstract IEnumerable<MetricReading> SlowMetrics(TimeSpan elapsed, Random rng);

    /// <summary>
    /// Metrics this scenario's hardware does not expose.
    /// </summary>
    /// <remarks>
    /// Overridden to model a machine with no CPU temperature sensor, which is the common case
    /// without a kernel-mode driver. Those metrics are emitted as
    /// <see cref="Availability.Unavailable"/> — never omitted, and never zero, so downstream
    /// code is forced to handle absence rather than silently reading a plausible number.
    /// </remarks>
    public virtual IReadOnlySet<MetricId> UnavailableMetrics { get; } = new HashSet<MetricId>();

    /// <summary>Reason reported for metrics in <see cref="UnavailableMetrics"/>.</summary>
    public virtual UnavailableReason UnavailableBecause => UnavailableReason.NoSensor;

    /// <summary>
    /// Generates the full telemetry stream, in timestamp order.
    /// </summary>
    /// <param name="seed">
    /// Fixed by default so the same scenario always produces the same series. Vary it only to
    /// check that a detector is not overfitted to one particular noise realisation.
    /// </param>
    public IEnumerable<TelemetrySample> Generate(int seed = 20260823)
    {
        var rng = new Random(seed);
        var elapsed = TimeSpan.Zero;
        var nextSlow = TimeSpan.Zero;
        var slowInterval = TimeSpan.FromSeconds(1.0 / SlowMetricHz);

        while (elapsed < Duration)
        {
            if (elapsed >= nextSlow)
            {
                var t = new MonotonicTimestamp((long)(elapsed.Ticks));
                foreach (var reading in SlowMetrics(elapsed, rng))
                {
                    yield return ToSample(t, reading);
                }

                foreach (var metric in UnavailableMetrics)
                {
                    yield return TelemetrySample.Unavailable(
                        t, metric, SourceId.Simulation, UnavailableBecause,
                        MetricCatalog.UnitOf(metric));
                }

                nextSlow += slowInterval;
            }

            var frameMs = FrameTimeMs(elapsed, rng);
            yield return TelemetrySample.Measured(
                new MonotonicTimestamp(elapsed.Ticks),
                MetricId.FrameTime, SourceId.Simulation, frameMs, Unit.Milliseconds);

            elapsed += TimeSpan.FromMilliseconds(frameMs);
        }
    }

    private TelemetrySample ToSample(MonotonicTimestamp t, MetricReading r) =>
        UnavailableMetrics.Contains(r.Metric)
            ? TelemetrySample.Unavailable(t, r.Metric, SourceId.Simulation, UnavailableBecause,
                MetricCatalog.UnitOf(r.Metric), r.Instance)
            : TelemetrySample.Measured(t, r.Metric, SourceId.Simulation, r.Value,
                MetricCatalog.UnitOf(r.Metric), r.Quality, r.Instance);

    /// <summary>Convenience helper for scenario authors.</summary>
    protected static MetricReading Read(
        MetricId metric, double value, int instance = TelemetrySample.NoInstance,
        Quality quality = Quality.Exact) => new(metric, value, instance, quality);

    /// <summary>Smooth 0→1 ramp over an interval, for modelling a thermal rise.</summary>
    protected static double Ramp(TimeSpan elapsed, TimeSpan start, TimeSpan end)
    {
        if (elapsed <= start) return 0.0;
        if (elapsed >= end) return 1.0;
        var f = (elapsed - start).TotalSeconds / (end - start).TotalSeconds;
        return f * f * (3.0 - (2.0 * f));   // smoothstep
    }

    /// <summary>Whether the scenario is inside a given window.</summary>
    protected static bool Within(TimeSpan elapsed, TimeSpan start, TimeSpan end) =>
        elapsed >= start && elapsed < end;
}

/// <summary>One slow-metric reading produced by a scenario.</summary>
public readonly record struct MetricReading(
    MetricId Metric,
    double Value,
    int Instance = TelemetrySample.NoInstance,
    Quality Quality = Quality.Exact);
