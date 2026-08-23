using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Diagnostics;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Pipeline.Detection;

namespace FrameDoctor.Engine.Hosting;

/// <summary>Everything learned about one session's telemetry.</summary>
/// <param name="Events">Detected frame-timing anomalies, in order.</param>
/// <param name="Diagnoses">One per event, aligned by index.</param>
/// <param name="FrameCount">Frames observed.</param>
/// <param name="Duration">Wall time covered.</param>
/// <param name="MedianFrameTimeMs">Session median, or NaN below the minimum sample size.</param>
/// <param name="P99FrameTimeMs">Session p99, or NaN below the minimum sample size.</param>
/// <param name="Low1PercentFps">1 % low, or NaN below the minimum sample size.</param>
/// <param name="SensitivityFloorMs">
/// Smallest excess the detector could resolve in this regime. Surfaced deliberately: on a
/// genuinely unstable game this can exceed 25 ms, and "no stutters detected" without it would
/// be a misleading claim.
/// </param>
public sealed record SessionAnalysis(
    IReadOnlyList<StutterEvent> Events,
    IReadOnlyList<Diagnosis> Diagnoses,
    int FrameCount,
    TimeSpan Duration,
    double MedianFrameTimeMs,
    double P99FrameTimeMs,
    double Low1PercentFps,
    double SensitivityFloorMs)
{
    public int StutterCount => Events.Count(e => e.CountsTowardTally);

    public int SevereStutterCount => Events.Count(e => e.IsSevere && e.CountsTowardTally);

    /// <summary>
    /// Share of events for which a cause was identified.
    /// </summary>
    /// <remarks>
    /// The product's primary quality measure. A tool that detects stutters and cannot explain
    /// them has confirmed a complaint the user already had and delivered nothing else — which
    /// looks like it is working, and is the most likely reason someone would uninstall it.
    /// </remarks>
    public double ExplanationRate =>
        Diagnoses.Count == 0 ? double.NaN
        : Diagnoses.Count(d => d.IsExplained) / (double)Diagnoses.Count;
}

/// <summary>
/// Runs a telemetry stream through the full pipeline: statistics, detection, correlation,
/// diagnosis.
/// </summary>
/// <remarks>
/// <para>
/// This is the vertical slice the whole product rests on, and it is deliberately source-blind:
/// it consumes <see cref="TelemetrySample"/> and nothing else. Simulation, a recorded replay
/// and a live Windows collector all arrive here identically, which is what lets the diagnostics
/// be fully tested on a machine that cannot run any of the real collectors.
/// </para>
/// <para>
/// The batch form below buffers the session. A live implementation streams the same stages with
/// a bounded ring instead — the stage order and the code that implements each stage are shared.
/// </para>
/// </remarks>
public sealed class SessionAnalyzer
{
    private readonly DiagnosticEngine _engine;
    private readonly double _refreshRateHz;
    private readonly TimeSpan _correlationPadding;

    public SessionAnalyzer(
        double refreshRateHz = 144.0,
        DiagnosticEngine? engine = null,
        TimeSpan? correlationPadding = null)
    {
        _refreshRateHz = refreshRateHz;
        _engine = engine ?? new DiagnosticEngine();
        _correlationPadding = correlationPadding ?? TimeSpan.FromSeconds(2);
    }

    /// <summary>Analyses a complete telemetry stream.</summary>
    public SessionAnalysis Analyze(IEnumerable<TelemetrySample> samples)
    {
        ArgumentNullException.ThrowIfNull(samples);

        var all = samples as IReadOnlyList<TelemetrySample> ?? samples.ToArray();

        var detector = new StutterDetector(_refreshRateHz);
        var events = new List<StutterEvent>();

        var frameCount = 0;
        var first = MonotonicTimestamp.Zero;
        var last = MonotonicTimestamp.Zero;
        var seenFirst = false;

        foreach (var sample in all)
        {
            if (sample.Metric != MetricId.FrameTime) continue;

            if (!seenFirst) { first = sample.Timestamp; seenFirst = true; }
            last = sample.Timestamp;

            // An unavailable frame time is not a zero-length frame. It is fed through so the
            // detector can account for it, and it is not counted as an observation.
            if (!sample.TryGetValue(out var frameMs))
            {
                detector.Add(sample.Timestamp, double.NaN);
                continue;
            }

            frameCount++;
            var completed = detector.Add(sample.Timestamp, frameMs);
            if (completed is not null) events.Add(completed);
        }

        events.AddRange(detector.Flush(last));

        var diagnoses = new List<Diagnosis>(events.Count);
        foreach (var e in events)
        {
            var window = CorrelationWindow.Build(all, e, _correlationPadding);
            diagnoses.Add(_engine.Diagnose(window));
        }

        var stats = detector.Statistics;

        return new SessionAnalysis(
            events,
            diagnoses,
            frameCount,
            seenFirst ? last - first : TimeSpan.Zero,
            stats.Median(),
            stats.PercentileOrInsufficient(99, MetricId.FrameTimeP99),
            stats.Low1PercentFps(),
            detector.SensitivityFloorMs);
    }
}
