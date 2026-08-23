using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Diagnostics;
using FrameDoctor.Pipeline.Detection;
using FrameDoctor.Storage.Catalog;

namespace FrameDoctor.Engine.Hosting;

/// <summary>
/// Turns a finished session into rows the catalog can hold.
/// </summary>
/// <remarks>
/// <para>
/// The whole session is written in one transaction at the end, never incrementally. SQLite's
/// write cost scales with dirty pages: affordable once, and not something to do every few
/// seconds inside the process whose overhead is the product's own headline claim.
/// </para>
/// <para>
/// The consequence is that a session lost to a crash is lost. That is the accepted trade — the
/// alternative writes to disk during gameplay, and a tool that causes a stutter to record that
/// it saw one has failed at the only thing it promises.
/// </para>
/// </remarks>
public sealed class SessionRecorder
{
    private readonly SessionRepository _repository;

    public SessionRecorder(SessionRepository repository)
    {
        ArgumentNullException.ThrowIfNull(repository);
        _repository = repository;
    }

    /// <summary>Writes a completed session.</summary>
    /// <param name="config">What must match for two sessions to be comparable.</param>
    /// <param name="clock">The session clock, for the wall-clock anchor.</param>
    /// <param name="statistics">The session's headline numbers.</param>
    /// <param name="diagnoses">Every diagnosed event, in order.</param>
    /// <param name="baselineEligible">
    /// Whether this session may contribute to a baseline. A session with a degraded source or a
    /// discontinuity in it is recorded and excluded: including it would move a baseline for a
    /// reason that has nothing to do with the machine's performance.
    /// </param>
    /// <returns>The stored session's identifier.</returns>
    public Guid Record(
        ConfigRecord config,
        IMonotonicClock clock,
        LiveStatistics statistics,
        IReadOnlyList<Diagnosis> diagnoses,
        bool baselineEligible = true)
    {
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(diagnoses);

        var id = Guid.NewGuid();

        var session = new SessionRecord(
            id,
            clock.EpochUtc.UtcTicks,
            MonotonicTimestamp.TicksPerSecond,
            statistics.Elapsed.Ticks,
            statistics.FrameCount,
            SessionState.Finalized,
            DiscontinuityCount: 0,
            // Recorded rather than recomputed on read. The floor depends on the regime the
            // detector was in at the time, and a session read back a month later must report
            // what it could actually resolve then, not what today's thresholds would give.
            SensitivityFloorMs: double.IsNaN(statistics.SensitivityFloorMs)
                ? null
                : statistics.SensitivityFloorMs,
            SegmentPath: null,
            SegmentBytes: null,
            BaselineEligible: baselineEligible && statistics.FramesLostToBackpressure == 0);

        var events = new List<(EventRecord, DiagnosisRecord?)>(diagnoses.Count);
        foreach (var diagnosis in diagnoses) events.Add((ToEvent(diagnosis.Event), ToDiagnosis(diagnosis)));

        _repository.Save(session, config, events, BuildStats(statistics));
        return id;
    }

    private static EventRecord ToEvent(StutterEvent e) => new(
        e.Start.Ticks,
        e.End.Ticks,
        (int)e.Class,
        e.PeakFrameTimeMs,
        e.ExcessMs,
        // The threshold and baseline in force at the time, not the current ones. This is what
        // makes a stored event reproducible: a reader can check the arithmetic without needing
        // the detector's state from a month ago.
        e.ThresholdMs,
        e.BaselineMedianMs,
        e.BaselineScaleMs,
        e.FrameCount,
        e.MergedCount,
        e.DuringWarmUp,
        e.ForceClosed,
        e.CountsTowardTally);

    private static DiagnosisRecord ToDiagnosis(Diagnosis d) => new(
        d.RuleId,
        d.Title,
        d.Confidence.Value,
        d.Confidence.RawValue,
        d.Confidence.LogOdds,
        (int)d.Confidence.BindingCap,
        d.WhatHappened,
        d.Mechanism,
        d.RecommendedAction,
        [.. d.Evidence.Select(e => new EvidenceRecord(
            (int)e.Metric.Metric,
            e.Metric.Instance,
            e.Statement,
            e.LikelihoodRatio,
            (int)e.Class,
            (int)e.Role,
            e.SampleCount,
            e.NativeRateHz,
            e.CanEstablishOrdering,
            (int)e.Quality))],
        // Stored with the diagnosis, not derived on read. What was ruled out depends on which
        // sensors existed at the time, and a session read back after a driver install must not
        // claim a hypothesis was excluded using evidence that did not exist yet.
        [.. d.RuledOut.Select(r => new RuledOutRecord(r.RuleId, r.Title, r.Reason, r.WasCheckable))]);

    /// <summary>
    /// The session-wide aggregates worth keeping after the frame series is purged.
    /// </summary>
    /// <remarks>
    /// A statistic below its metric's minimum sample size is stored as absent rather than as a
    /// number. Retention eventually deletes the frames these were computed from, so an
    /// unqualified percentile stored today becomes an unfalsifiable one later.
    /// </remarks>
    private static List<SessionStatRecord> BuildStats(LiveStatistics statistics)
    {
        var stats = new List<SessionStatRecord>();

        Add(MetricId.FrameTimeMedian, statistics.MedianFrameTimeMs);
        Add(MetricId.FrameTimeP99, statistics.P99FrameTimeMs);
        Add(MetricId.FrameLow1Pct, statistics.Low1PercentFps);

        return stats;

        void Add(MetricId metric, double value)
        {
            var available = !double.IsNaN(value);

            stats.Add(new SessionStatRecord(
                (int)metric,
                Instance: TelemetrySample.NoInstance,
                SampleCount: statistics.FrameCount,
                Availability: (int)(available ? Availability.Available : Availability.Unavailable),
                Quality: (int)Quality.Derived,
                Min: null,
                P50: metric == MetricId.FrameTimeMedian && available ? value : null,
                P95: null,
                P99: metric == MetricId.FrameTimeP99 && available ? value : null,
                P999: null,
                Max: null,
                Sum: metric == MetricId.FrameLow1Pct && available ? value : null));
        }
    }
}
