using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Diagnostics;
using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Pipeline.Detection;

namespace FrameDoctor.Engine.Hosting;

/// <summary>What the Live view needs from the running session, recomputed on demand.</summary>
/// <param name="FrameCount">Frames observed since the session began.</param>
/// <param name="Elapsed">Wall time covered.</param>
/// <param name="RollingFps">Frames per second over the recent window.</param>
/// <param name="MedianFrameTimeMs">Rolling median, or NaN below the minimum sample size.</param>
/// <param name="P99FrameTimeMs">Rolling p99, or NaN below the minimum sample size.</param>
/// <param name="Low1PercentFps">1 % low, or NaN below the minimum sample size.</param>
/// <param name="ThresholdMs">The detector's current threshold, shown so a user can see it.</param>
/// <param name="SensitivityFloorMs">Smallest excess resolvable in this regime.</param>
/// <param name="IsWarmedUp">Whether the baseline is established.</param>
/// <param name="StutterCount">Events counting toward the headline tally.</param>
/// <param name="SevereCount">Severe hitches among them.</param>
/// <param name="ExplainedCount">Events that reached a named cause.</param>
/// <param name="FramesLostToBackpressure">
/// Frames FrameDoctor itself failed to keep up with. Surfaced rather than buried: a frame the
/// tool dropped is indistinguishable in the data from a frame the game never rendered.
/// </param>
public readonly record struct LiveStatistics(
    int FrameCount,
    TimeSpan Elapsed,
    double RollingFps,
    double MedianFrameTimeMs,
    double P99FrameTimeMs,
    double Low1PercentFps,
    double ThresholdMs,
    double SensitivityFloorMs,
    bool IsWarmedUp,
    int StutterCount,
    int SevereCount,
    int ExplainedCount,
    long FramesLostToBackpressure)
{
    /// <summary>Share of counted events that reached a named cause, or NaN before any.</summary>
    public double ExplanationRate =>
        StutterCount == 0 ? double.NaN : ExplainedCount / (double)StutterCount;
}

/// <summary>
/// One running measurement session: frames and sensors in, diagnosed events out.
/// </summary>
/// <remarks>
/// <para>
/// The streaming counterpart to <see cref="SessionAnalyzer"/>, and it shares every stage with it
/// — the same detector, the same correlation window, the same rules. What differs is memory: the
/// analyzer holds a whole session, and this holds a bounded window, because a session here runs
/// for as long as someone plays.
/// </para>
/// <para>
/// Source-blind, like everything above the collector seam. Simulation, replay and live Windows
/// collectors reach this identically, which is what lets a six-hour session's logic be tested in
/// a hundred milliseconds against a scenario.
/// </para>
/// <para>
/// Not thread-safe by design. The Engine drives it from a single pipeline thread; making it
/// lockable would put a lock acquisition on the per-frame path, which is the one place in this
/// product where that cost is not acceptable.
/// </para>
/// </remarks>
public sealed class LiveSession
{
    private readonly StutterDetector _detector;
    private readonly DiagnosticEngine _engine;
    private readonly SensorHistory _history;
    private readonly TimeSpan _correlationPadding;

    /// <summary>
    /// Events closed but not yet diagnosed, because their trailing evidence has not arrived.
    /// </summary>
    /// <remarks>
    /// The correlation window extends past the end of an event, so diagnosing the moment an
    /// event closes would read a window that is half empty and reach a conclusion from evidence
    /// that had not been collected yet. Holding the event until its window has filled is what
    /// makes a live diagnosis match the one the batch analyzer produces for the same data.
    /// </remarks>
    private readonly Queue<StutterEvent> _awaitingEvidence = new();

    private MonotonicTimestamp _first;
    private MonotonicTimestamp _last;
    private bool _seenFirst;
    private int _frameCount;
    private int _stutterCount;
    private int _severeCount;
    private int _explainedCount;

    public LiveSession(
        double refreshRateHz = 144.0,
        DiagnosticEngine? engine = null,
        TimeSpan? correlationPadding = null,
        SensorHistory? history = null)
    {
        _detector = new StutterDetector(refreshRateHz);
        _engine = engine ?? new DiagnosticEngine();
        _correlationPadding = correlationPadding ?? TimeSpan.FromSeconds(2);
        _history = history ?? new SensorHistory();

        if (_history.Retention <= _correlationPadding * 2)
        {
            // A history shorter than the window it feeds silently produces diagnoses missing
            // their own evidence, and the symptom — lower confidence — looks like the data
            // rather than like a bug.
            throw new ArgumentException(
                $"Sensor history ({_history.Retention}) must outlast the correlation window " +
                $"(2 x {_correlationPadding}).",
                nameof(history));
        }
    }

    /// <summary>Frames the collector dropped before reaching the pipeline.</summary>
    public long FramesLostToBackpressure { get; set; }

    /// <summary>Raised once per event, after its correlation window has filled.</summary>
    public event Action<Diagnosis>? EventDiagnosed;

    /// <summary>The detector's live view, for the UI's threshold and baseline lines.</summary>
    public StutterDetector Detector => _detector;

    public SensorHistory History => _history;

    /// <summary>
    /// Feeds one presented frame.
    /// </summary>
    /// <remarks>
    /// The hot path. It allocates nothing: the detector writes into pre-sized ring buffers, and
    /// the only object created here is the event record itself, at most a few dozen times in a
    /// session.
    /// </remarks>
    public void AddFrame(in FramePresent frame)
    {
        if (!_seenFirst) { _first = frame.Timestamp; _seenFirst = true; }
        _last = frame.Timestamp;
        _frameCount++;

        var closed = _detector.Add(frame.Timestamp, frame.FrameTimeMs);
        if (closed is not null) _awaitingEvidence.Enqueue(closed);

        DrainReadyEvents(frame.Timestamp);
    }

    /// <summary>
    /// Feeds a frame the source could not measure.
    /// </summary>
    /// <remarks>
    /// Passed through rather than skipped, so the detector can account for the gap. An
    /// unavailable frame time is not a zero-length frame, and it is not the absence of a frame
    /// either.
    /// </remarks>
    public void AddUnreadableFrame(MonotonicTimestamp timestamp)
    {
        if (!_seenFirst) { _first = timestamp; _seenFirst = true; }
        _last = timestamp;

        var closed = _detector.Add(timestamp, double.NaN);
        if (closed is not null) _awaitingEvidence.Enqueue(closed);

        DrainReadyEvents(timestamp);
    }

    /// <summary>Feeds a batch of sensor samples, as one poll produced them.</summary>
    public void AddSensorSamples(ReadOnlySpan<TelemetrySample> samples)
    {
        _history.AddRange(samples);

        foreach (ref readonly var sample in samples)
        {
            if (sample.Timestamp > _last) _last = sample.Timestamp;
            if (!_seenFirst) { _first = sample.Timestamp; _seenFirst = true; }
        }

        DrainReadyEvents(_last);
    }

    /// <summary>
    /// Diagnoses every event whose correlation window has now filled.
    /// </summary>
    /// <remarks>
    /// Trimming happens only after the queue is empty. While an event is waiting for evidence,
    /// the samples it will need are exactly the ones a trim would remove.
    /// </remarks>
    private void DrainReadyEvents(MonotonicTimestamp now)
    {
        while (_awaitingEvidence.TryPeek(out var pending) && pending.End + _correlationPadding <= now)
        {
            _awaitingEvidence.Dequeue();
            Diagnose(pending);
        }

        if (_awaitingEvidence.Count == 0) _history.Trim(now);
    }

    private void Diagnose(StutterEvent stutterEvent)
    {
        if (stutterEvent.CountsTowardTally)
        {
            _stutterCount++;
            if (stutterEvent.IsSevere) _severeCount++;
        }

        var window = CorrelationWindow.Build(_history.Samples, stutterEvent, _correlationPadding);
        var diagnosis = _engine.Diagnose(window);

        if (diagnosis.IsExplained && stutterEvent.CountsTowardTally) _explainedCount++;

        EventDiagnosed?.Invoke(diagnosis);
    }

    /// <summary>
    /// Closes the session, diagnosing whatever is still open or waiting.
    /// </summary>
    /// <remarks>
    /// An event still open when a game exits is a real event — the game quitting is often what
    /// ended it — so it is closed and diagnosed rather than discarded. Its evidence window is
    /// necessarily short, and the confidence it earns reflects that on its own.
    /// </remarks>
    public IReadOnlyList<Diagnosis> Complete()
    {
        var diagnosed = new List<Diagnosis>();

        void Capture(Diagnosis d) => diagnosed.Add(d);
        EventDiagnosed += Capture;

        try
        {
            foreach (var flushed in _detector.Flush(_last)) _awaitingEvidence.Enqueue(flushed);

            while (_awaitingEvidence.TryDequeue(out var pending)) Diagnose(pending);
        }
        finally
        {
            EventDiagnosed -= Capture;
        }

        return diagnosed;
    }

    /// <summary>The current headline numbers.</summary>
    public LiveStatistics Statistics()
    {
        var stats = _detector.Statistics;

        return new LiveStatistics(
            _frameCount,
            _seenFirst ? _last - _first : TimeSpan.Zero,
            stats.RollingFps(),
            stats.Median(),
            stats.PercentileOrInsufficient(99, MetricId.FrameTimeP99),
            stats.Low1PercentFps(),
            _detector.ThresholdMs,
            _detector.SensitivityFloorMs,
            _detector.IsWarmedUp,
            _stutterCount,
            _severeCount,
            _explainedCount,
            FramesLostToBackpressure);
    }
}
