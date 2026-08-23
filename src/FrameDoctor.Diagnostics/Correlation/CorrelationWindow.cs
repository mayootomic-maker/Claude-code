using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Pipeline.Detection;

namespace FrameDoctor.Diagnostics.Correlation;

/// <summary>
/// All telemetry around a detected event, assembled for the diagnostic engine.
/// </summary>
/// <remarks>
/// <para>
/// Series are kept at their native rates and are never resampled or interpolated. Alignment is
/// the consumer's problem, stated explicitly, rather than something hidden by a resampler that
/// invents values between real readings.
/// </para>
/// <para>
/// The window includes the bracketing samples immediately outside each edge. Without them the
/// trajectory at the boundaries is unknown, and their absence is a common silent source of
/// fabricated trends: a series whose last in-window sample is mid-transition looks like it
/// settled there.
/// </para>
/// </remarks>
public sealed class CorrelationWindow
{
    private readonly Dictionary<MetricKey, MetricSeries> _series;

    private CorrelationWindow(
        StutterEvent stutterEvent,
        MonotonicTimestamp start,
        MonotonicTimestamp end,
        Dictionary<MetricKey, MetricSeries> series)
    {
        Event = stutterEvent;
        Start = start;
        End = end;
        _series = series;
    }

    public StutterEvent Event { get; }
    public MonotonicTimestamp Start { get; }
    public MonotonicTimestamp End { get; }

    public IReadOnlyDictionary<MetricKey, MetricSeries> Series => _series;

    /// <summary>Looks up a machine-wide series.</summary>
    public MetricSeries? Get(MetricId metric) => Get(new MetricKey(metric));

    /// <summary>Looks up a series by metric and instance.</summary>
    public MetricSeries? Get(MetricKey key) => _series.GetValueOrDefault(key);

    /// <summary>All series for a metric across every instance.</summary>
    public IEnumerable<MetricSeries> AllInstancesOf(MetricId metric) =>
        _series.Where(kv => kv.Key.Metric == metric).Select(kv => kv.Value);

    /// <summary>
    /// Whether a metric is readable in this window.
    /// </summary>
    /// <remarks>
    /// The gate for negative evidence. A rule may only take the <i>absence</i> of a signal as
    /// evidence against a hypothesis when the metric was actually available — otherwise a
    /// machine with no sensor would appear to disprove every hypothesis that sensor could have
    /// supported.
    /// </remarks>
    public bool IsReadable(MetricId metric) =>
        Get(metric) is { Availability: Availability.Available } s && s.ReadableCount > 0;

    /// <summary>
    /// Builds a window around an event from a telemetry stream.
    /// </summary>
    /// <param name="samples">Samples in timestamp order. Out-of-order input is tolerated.</param>
    /// <param name="stutterEvent">The event to centre on.</param>
    /// <param name="padding">How far either side of the event to include.</param>
    public static CorrelationWindow Build(
        IEnumerable<TelemetrySample> samples,
        StutterEvent stutterEvent,
        TimeSpan? padding = null)
    {
        var pad = padding ?? TimeSpan.FromSeconds(2);
        var start = stutterEvent.Start - pad;
        var end = stutterEvent.End + pad;

        var inWindow = new Dictionary<MetricKey, List<TelemetrySample>>();
        var bracketBefore = new Dictionary<MetricKey, TelemetrySample>();
        var bracketAfter = new Dictionary<MetricKey, TelemetrySample>();

        foreach (var s in samples)
        {
            var key = new MetricKey(s.Metric, s.Instance);

            if (s.Timestamp < start)
            {
                // Keep the latest sample before the window as the leading bracket.
                if (!bracketBefore.TryGetValue(key, out var existing) ||
                    s.Timestamp > existing.Timestamp)
                {
                    bracketBefore[key] = s;
                }
                continue;
            }

            if (s.Timestamp > end)
            {
                // Keep the earliest sample after the window as the trailing bracket.
                if (!bracketAfter.TryGetValue(key, out var existing) ||
                    s.Timestamp < existing.Timestamp)
                {
                    bracketAfter[key] = s;
                }
                continue;
            }

            if (!inWindow.TryGetValue(key, out var list))
            {
                list = [];
                inWindow[key] = list;
            }
            list.Add(s);
        }

        var series = new Dictionary<MetricKey, MetricSeries>();
        var keys = inWindow.Keys.Union(bracketBefore.Keys).Union(bracketAfter.Keys);

        foreach (var key in keys)
        {
            var list = inWindow.GetValueOrDefault(key) ?? [];
            if (bracketBefore.TryGetValue(key, out var before)) list.Insert(0, before);
            if (bracketAfter.TryGetValue(key, out var after)) list.Add(after);
            list.Sort((a, b) => a.Timestamp.CompareTo(b.Timestamp));

            series[key] = new MetricSeries(key, list, stutterEvent.Start, stutterEvent.Duration);
        }

        return new CorrelationWindow(stutterEvent, start, end, series);
    }
}
