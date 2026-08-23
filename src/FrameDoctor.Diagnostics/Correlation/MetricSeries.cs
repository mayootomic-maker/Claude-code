using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Diagnostics.Correlation;

/// <summary>Identifies one series: a metric, optionally scoped to a core, disk or process.</summary>
public readonly record struct MetricKey(MetricId Metric, int Instance)
{
    public MetricKey(MetricId metric) : this(metric, TelemetrySample.NoInstance) { }

    public override string ToString() =>
        Instance == TelemetrySample.NoInstance ? Metric.ToString() : $"{Metric}[{Instance}]";
}

/// <summary>
/// One metric's samples inside a correlation window, with the honesty metadata that stops a
/// two-sample series being described as if it were a measured curve.
/// </summary>
/// <remarks>
/// <para>
/// Slow counters sample at 1–4 Hz while stutters last 20–200 ms. Correlating them is legitimate;
/// pretending the slow series has the fast series' resolution is not. Every consumer of this
/// type is given <see cref="SampleCount"/>, <see cref="NativeRateHz"/> and
/// <see cref="CanEstablishOrdering"/> so the claim it makes can be checked against the data
/// that supports it.
/// </para>
/// </remarks>
public sealed class MetricSeries
{
    private readonly List<TelemetrySample> _samples;

    internal MetricSeries(MetricKey key, List<TelemetrySample> samples, MonotonicTimestamp eventStart,
        TimeSpan eventDuration)
    {
        Key = key;
        _samples = samples;
        EventStart = eventStart;
        EventDuration = eventDuration;
    }

    public MetricKey Key { get; }
    public MonotonicTimestamp EventStart { get; }
    public TimeSpan EventDuration { get; }

    public IReadOnlyList<TelemetrySample> Samples => _samples;

    /// <summary>Total samples in the window, including unavailable ones.</summary>
    public int SampleCount => _samples.Count;

    /// <summary>Samples that carry an actual reading.</summary>
    public int ReadableCount => _samples.Count(s => s.TryGetValue(out _));

    /// <summary>
    /// The series' aggregate availability.
    /// </summary>
    /// <remarks>
    /// If nothing in the window was readable, the reason from the first sample is preserved, so
    /// the UI can say <i>why</i> rather than showing a bare dash.
    /// </remarks>
    public Availability Availability =>
        ReadableCount > 0 ? Availability.Available
        : _samples.Count > 0 ? _samples[0].Availability
        : Availability.Unavailable;

    public UnavailableReason Reason =>
        ReadableCount > 0 ? UnavailableReason.None
        : _samples.Count > 0 ? _samples[0].Reason
        : UnavailableReason.NotYetSampled;

    /// <summary>Worst quality present in the window; quality never improves by aggregation.</summary>
    public Quality Quality =>
        _samples.Count == 0 ? Quality.Estimated : _samples.Max(s => s.Quality);

    /// <summary>Observed sampling rate, or NaN with fewer than two samples.</summary>
    public double NativeRateHz
    {
        get
        {
            if (_samples.Count < 2) return double.NaN;
            var span = (_samples[^1].Timestamp - _samples[0].Timestamp).TotalSeconds;
            return span <= 0 ? double.NaN : (_samples.Count - 1) / span;
        }
    }

    /// <summary>
    /// Whether this series can support a claim that its change <i>preceded</i> the event.
    /// </summary>
    /// <remarks>
    /// A 1 Hz sensor cannot establish ordering against a 142 ms hitch — its samples are further
    /// apart than the whole event. Such a series may still contribute to a coincidence claim, at
    /// reduced weight, but is structurally barred from a causal-ordering one. Enforcing that
    /// here rather than in prose is what stops the diagnosis prose from overstating the data.
    /// </remarks>
    public bool CanEstablishOrdering
    {
        get
        {
            var rate = NativeRateHz;
            if (double.IsNaN(rate) || rate <= 0) return false;
            return (1.0 / rate) < EventDuration.TotalSeconds;
        }
    }

    /// <summary>Median of readable samples strictly before the event, or NaN.</summary>
    public double MedianBefore() => MedianOf(s => s.Timestamp < EventStart);

    /// <summary>Median of readable samples at or after the event start, or NaN.</summary>
    public double MedianAfter() => MedianOf(s => s.Timestamp >= EventStart);

    public int CountBefore => _samples.Count(s => s.Timestamp < EventStart && s.TryGetValue(out _));

    public int CountAfter => _samples.Count(s => s.Timestamp >= EventStart && s.TryGetValue(out _));

    /// <summary>Highest readable value in the window, or NaN.</summary>
    public double Max() => Extreme(Math.Max, double.NegativeInfinity);

    /// <summary>Lowest readable value in the window, or NaN.</summary>
    public double Min() => Extreme(Math.Min, double.PositiveInfinity);

    /// <summary>
    /// Change across the event: <c>after − before</c>, or NaN when either side lacks data.
    /// </summary>
    /// <remarks>
    /// Returns NaN rather than zero when a side is empty. A delta of zero means "measured, and
    /// it did not move"; NaN means "we could not tell" — conflating them would let a diagnosis
    /// treat missing evidence as evidence of absence.
    /// </remarks>
    public double Delta()
    {
        var before = MedianBefore();
        var after = MedianAfter();
        return double.IsNaN(before) || double.IsNaN(after) ? double.NaN : after - before;
    }

    /// <summary>Fractional change across the event, or NaN.</summary>
    public double RelativeDelta()
    {
        var before = MedianBefore();
        var delta = Delta();
        return double.IsNaN(delta) || before == 0 ? double.NaN : delta / Math.Abs(before);
    }

    /// <summary>Whether any readable sample has the given bits set.</summary>
    public bool AnyFlagSet(int mask) =>
        _samples.Any(s => s.TryGetValue(out var v) && ((int)v & mask) != 0);

    private double MedianOf(Func<TelemetrySample, bool> predicate)
    {
        var values = new List<double>();
        foreach (var s in _samples)
        {
            if (predicate(s) && s.TryGetValue(out var v)) values.Add(v);
        }
        if (values.Count == 0) return double.NaN;
        values.Sort();
        return values[values.Count / 2];
    }

    private double Extreme(Func<double, double, double> pick, double seed)
    {
        var found = false;
        var acc = seed;
        foreach (var s in _samples)
        {
            if (!s.TryGetValue(out var v)) continue;
            acc = found ? pick(acc, v) : v;
            found = true;
        }
        return found ? acc : double.NaN;
    }
}
