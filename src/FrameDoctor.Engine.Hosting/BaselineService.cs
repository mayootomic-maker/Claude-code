using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Baselines;
using FrameDoctor.Storage.Catalog;

namespace FrameDoctor.Engine.Hosting;

/// <summary>What a finished session is worth, set against everything that came before it.</summary>
/// <param name="Baseline">What this configuration normally does.</param>
/// <param name="Median">How this session's median compared.</param>
public readonly record struct SessionStanding(Baseline Baseline, Comparison Median);

/// <summary>
/// Joins the catalog's history to the statistics that interpret it.
/// </summary>
/// <remarks>
/// <para>
/// The seam exists because neither side may know about the other. Storage depends on nothing but
/// the telemetry abstractions, so it cannot compute a baseline; the diagnostics assembly is pure
/// statistics, so it cannot know where sessions are kept. This is the only place that knows both,
/// and it contains no arithmetic of its own — every threshold and every verdict comes from
/// <see cref="BaselineBuilder"/> and <see cref="RegressionDetector"/>, where it is tested.
/// </para>
/// <para>
/// Runs after a session is finalized, never during one. It reads up to thirty rows and writes
/// two, which is affordable once a session and would not be affordable on a timer.
/// </para>
/// </remarks>
public sealed class BaselineService(BaselineRepository repository, TimeProvider? time = null)
{
    private readonly BaselineRepository _repository =
        repository ?? throw new ArgumentNullException(nameof(repository));

    private readonly TimeProvider _time = time ?? TimeProvider.System;

    /// <summary>
    /// Recomputes the baseline for a configuration and compares the session just recorded.
    /// </summary>
    /// <param name="configKeyHash">The configuration whose history to read.</param>
    /// <param name="sessionId">The session to compare, which is itself part of the history.</param>
    /// <remarks>
    /// <para>
    /// The session being compared is <b>excluded from its own baseline</b>. Including it would
    /// pull the baseline toward the very session under test — a run twice as slow as normal
    /// would drag the centre it is measured against up with it, and the difference would come
    /// out smaller than it is. The effect shrinks as history grows, which makes it worst exactly
    /// when the baseline is weakest.
    /// </para>
    /// <para>
    /// Both results are written even when the verdict is "nothing changed", and a session that
    /// is not in the catalog is a no-op rather than an error: this runs after recording, and a
    /// recording that failed has already reported itself.
    /// </para>
    /// </remarks>
    public SessionStanding Evaluate(string configKeyHash, Guid sessionId)
    {
        ArgumentException.ThrowIfNullOrEmpty(configKeyHash);

        var history = _repository.HistoryFor(configKeyHash);

        var priorRows = new List<BaselineHistoryRow>(history.Count);
        BaselineHistoryRow? subject = null;

        foreach (var row in history)
        {
            if (row.SessionId == sessionId) subject = row;
            else priorRows.Add(row);
        }

        var baseline = BaselineBuilder.Build(
            [.. priorRows.Select(ToSample)],
            [.. priorRows.Select(r => r.Duration)]);

        var comparison = RegressionDetector.CompareMedian(
            baseline,
            subject?.MedianFrameTimeMs ?? double.NaN,
            subject?.SensitivityFloorMs ?? double.NaN);

        var now = _time.GetUtcNow();

        _repository.SaveBaseline(configKeyHash, ToStoredBaseline(baseline, priorRows), now);
        _repository.SaveComparison(sessionId, ToStoredComparison(baseline, comparison), now);

        return new SessionStanding(baseline, comparison);
    }

    /// <summary>The standing already recorded for a session, without recomputing anything.</summary>
    /// <remarks>
    /// Reads what was concluded at the time rather than re-deriving it. A session opened a month
    /// later must show the comparison that was actually made, not one against a baseline that has
    /// since moved — otherwise the number in the session list would change every time the user
    /// played another round.
    /// </remarks>
    public StoredComparison? RecordedStanding(Guid sessionId) =>
        _repository.ReadComparison(sessionId, (int)MetricId.FrameTimeMedian);

    private static BaselineSample ToSample(BaselineHistoryRow row) => new(
        row.MedianFrameTimeMs,
        row.P99FrameTimeMs,
        row.Low1PercentFps,
        row.FrameCount,
        row.StutterCount,
        row.SensitivityFloorMs);

    private static StoredBaseline ToStoredBaseline(
        Baseline baseline,
        List<BaselineHistoryRow> contributors)
    {
        // Only the sessions that survived the minimum-length rule are named. Listing every row
        // that was read would claim provenance the baseline does not have.
        var used = contributors
            .Where(r => r.FrameCount >= Baseline.MinimumFramesPerSession
                     && double.IsFinite(r.MedianFrameTimeMs))
            .ToArray();

        var medians = used.Select(r => r.MedianFrameTimeMs).ToArray();

        return new StoredBaseline(
            (int)MetricId.FrameTimeMedian,
            baseline.SessionCount,
            (int)baseline.Trust,
            baseline.Exists ? baseline.MedianFrameTimeMs : null,
            baseline.Exists ? baseline.MedianAbsoluteDeviationMs : null,
            medians.Length == 0 ? null : medians.Min(),
            medians.Length == 0 ? null : medians.Max(),
            [.. used.Select(r => r.SessionId)]);
    }

    private static StoredComparison ToStoredComparison(Baseline baseline, Comparison comparison) => new(
        (int)MetricId.FrameTimeMedian,
        (int)comparison.Verdict,
        baseline.SessionCount,
        (int)baseline.Trust,
        comparison.BaselineValue,
        comparison.SessionValue,
        comparison.DifferenceMs,
        comparison.NoiseMs,
        comparison.Detail);
}
