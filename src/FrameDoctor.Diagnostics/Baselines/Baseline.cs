using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Diagnostics.Baselines;

/// <summary>How far a baseline can be trusted.</summary>
/// <remarks>
/// Mirrors <c>Storage.Catalog.BaselineTrust</c>. Duplicated rather than referenced because the
/// diagnostics assembly does not depend on storage — a baseline is a statistical object, and
/// where its inputs were stored is not its concern.
/// </remarks>
public enum BaselineTrust : byte
{
    /// <summary>Too few sessions. Report "no baseline yet" rather than a number.</summary>
    Insufficient = 0,

    /// <summary>Shown to the user, never used to declare a regression.</summary>
    Provisional = 1,

    /// <summary>Enough sessions for a regression claim to be defensible.</summary>
    Trusted = 2,
}

/// <summary>One session's contribution to a baseline.</summary>
/// <param name="MedianFrameTimeMs">Session median.</param>
/// <param name="P99FrameTimeMs">Session p99.</param>
/// <param name="Low1PercentFps">Session 1 % low.</param>
/// <param name="FrameCount">Frames, for weighting and for the minimum-length rule.</param>
/// <param name="StutterCount">Events that counted toward the tally.</param>
/// <param name="SensitivityFloorMs">
/// Smallest excess that session could resolve. Carried because a stutter count means something
/// different at a 3 ms floor than at a 30 ms one, and a baseline built across both would compare
/// two different measurements.
/// </param>
public readonly record struct BaselineSample(
    double MedianFrameTimeMs,
    double P99FrameTimeMs,
    double Low1PercentFps,
    int FrameCount,
    int StutterCount,
    double SensitivityFloorMs);

/// <summary>
/// What a configuration normally does, and how confident that claim is.
/// </summary>
/// <param name="SessionCount">Sessions the baseline was built from.</param>
/// <param name="Trust">How far the number may be used.</param>
/// <param name="MedianFrameTimeMs">Median of the session medians.</param>
/// <param name="MedianAbsoluteDeviationMs">
/// Spread across sessions, as a median absolute deviation.
/// </param>
/// <param name="P99FrameTimeMs">Median of the session p99s.</param>
/// <param name="Low1PercentFps">Median of the session 1 % lows.</param>
/// <param name="StuttersPerMinute">Median stutter rate, normalised for session length.</param>
/// <param name="WorstSensitivityFloorMs">
/// The coarsest floor among the contributing sessions. Any comparison against this baseline is
/// only as sensitive as its least sensitive member.
/// </param>
public sealed record Baseline(
    int SessionCount,
    BaselineTrust Trust,
    double MedianFrameTimeMs,
    double MedianAbsoluteDeviationMs,
    double P99FrameTimeMs,
    double Low1PercentFps,
    double StuttersPerMinute,
    double WorstSensitivityFloorMs)
{
    /// <summary>Sessions below which there is no baseline at all.</summary>
    /// <remarks>
    /// Three, because two sessions have no spread worth the name: their median absolute
    /// deviation is half their difference, which is as likely to be noise as signal, and a
    /// comparison against it would declare a regression on the first bad run.
    /// </remarks>
    public const int MinimumSessionsForProvisional = 3;

    /// <summary>Sessions below which a regression may be shown but never declared.</summary>
    /// <remarks>
    /// Seven is a week of daily play. Below it the spread estimate is itself unstable, so the
    /// baseline is worth showing — a user wants to know what normal looks like — and is not
    /// worth acting on.
    /// </remarks>
    public const int MinimumSessionsForTrusted = 7;

    /// <summary>Frames below which a session is not a session.</summary>
    /// <remarks>
    /// Ten thousand is roughly a minute at 144 Hz. A thirty-second run has percentiles, and they
    /// describe thirty seconds; averaging them into a baseline gives a short warm-up the same
    /// weight as an hour of play.
    /// </remarks>
    public const int MinimumFramesPerSession = 10_000;

    /// <summary>A baseline that does not exist yet, with the reason.</summary>
    public static Baseline None(int sessionCount) => new(
        sessionCount,
        BaselineTrust.Insufficient,
        double.NaN, double.NaN, double.NaN, double.NaN, double.NaN, double.NaN);

    public bool Exists => Trust is not BaselineTrust.Insufficient;

    /// <summary>Whether this baseline may be used to declare a regression.</summary>
    public bool MayDeclareRegression => Trust is BaselineTrust.Trusted;

    /// <summary>What to say about the baseline's standing, in the user's terms.</summary>
    public string Describe() => Trust switch
    {
        BaselineTrust.Trusted =>
            $"{SessionCount} sessions of history — enough for a difference this size to be " +
            "worth acting on.",
        BaselineTrust.Provisional =>
            $"Built from {SessionCount} sessions — enough to show what normal looks like, not " +
            $"enough to call a change a regression. That needs {MinimumSessionsForTrusted}.",
        _ =>
            $"Not enough sessions yet: {SessionCount} of {MinimumSessionsForProvisional}. " +
            "A number built from fewer would describe the sessions rather than the machine.",
    };
}

/// <summary>
/// Builds a baseline from the sessions of one configuration.
/// </summary>
/// <remarks>
/// <para>
/// Medians throughout, and a median absolute deviation for spread. A mean over sessions is
/// dominated by the one time the machine was doing something else, and a standard deviation over
/// four samples is a number with error bars wider than itself.
/// </para>
/// <para>
/// The caller is responsible for passing only sessions of the same configuration — a game patch,
/// a driver update or a monitor change forks the baseline rather than polluting it — and only
/// sessions marked baseline-eligible. This type does not know what a configuration is.
/// </para>
/// </remarks>
public static class BaselineBuilder
{
    public static Baseline Build(IReadOnlyList<BaselineSample> sessions, TimeSpan[]? durations = null)
    {
        ArgumentNullException.ThrowIfNull(sessions);

        // A session too short to have meaningful percentiles is dropped rather than weighted
        // down. Weighting keeps its influence non-zero, and its percentiles are not a weak
        // measurement of the machine — they are a measurement of a different, shorter thing.
        var usable = new List<BaselineSample>(sessions.Count);
        var usableDurations = new List<TimeSpan>(sessions.Count);

        for (var i = 0; i < sessions.Count; i++)
        {
            var session = sessions[i];
            if (session.FrameCount < Baseline.MinimumFramesPerSession) continue;
            if (!double.IsFinite(session.MedianFrameTimeMs)) continue;

            usable.Add(session);
            usableDurations.Add(durations is not null && i < durations.Length
                ? durations[i]
                : TimeSpan.Zero);
        }

        if (usable.Count < Baseline.MinimumSessionsForProvisional) return Baseline.None(usable.Count);

        var medians = usable.Select(s => s.MedianFrameTimeMs).ToArray();
        var centre = Median(medians);

        var trust = usable.Count >= Baseline.MinimumSessionsForTrusted
            ? BaselineTrust.Trusted
            : BaselineTrust.Provisional;

        return new Baseline(
            usable.Count,
            trust,
            centre,
            MedianAbsoluteDeviation(medians, centre),
            MedianOfFinite(usable.Select(s => s.P99FrameTimeMs)),
            MedianOfFinite(usable.Select(s => s.Low1PercentFps)),
            StutterRate(usable, usableDurations),
            usable.Max(s => double.IsFinite(s.SensitivityFloorMs) ? s.SensitivityFloorMs : 0));
    }

    /// <summary>
    /// Stutters per minute, normalised so a long session does not outvote a short one.
    /// </summary>
    /// <remarks>
    /// A raw count would make "how long did you play" the dominant term. Sessions with no
    /// duration recorded are excluded from this figure alone rather than treated as zero-length,
    /// which would be a division by nothing.
    /// </remarks>
    private static double StutterRate(List<BaselineSample> sessions, List<TimeSpan> durations)
    {
        var rates = new List<double>(sessions.Count);

        for (var i = 0; i < sessions.Count; i++)
        {
            var minutes = durations[i].TotalMinutes;
            if (minutes > 0) rates.Add(sessions[i].StutterCount / minutes);
        }

        return rates.Count == 0 ? double.NaN : Median([.. rates]);
    }

    internal static double Median(double[] values)
    {
        if (values.Length == 0) return double.NaN;

        var sorted = (double[])values.Clone();
        Array.Sort(sorted);

        var middle = sorted.Length / 2;
        return sorted.Length % 2 == 1
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2.0;
    }

    private static double MedianOfFinite(IEnumerable<double> values)
    {
        var finite = values.Where(double.IsFinite).ToArray();
        return finite.Length == 0 ? double.NaN : Median(finite);
    }

    /// <summary>Median absolute deviation: spread that one outlying session cannot inflate.</summary>
    internal static double MedianAbsoluteDeviation(double[] values, double centre)
    {
        if (values.Length == 0) return double.NaN;

        var deviations = new double[values.Length];
        for (var i = 0; i < values.Length; i++) deviations[i] = Math.Abs(values[i] - centre);

        return Median(deviations);
    }
}
