namespace FrameDoctor.Diagnostics.Baselines;

/// <summary>What a comparison against a baseline is allowed to claim.</summary>
public enum ComparisonVerdict : byte
{
    /// <summary>There is no baseline to compare against.</summary>
    NoBaseline = 0,

    /// <summary>
    /// The difference is inside the noise this configuration normally shows.
    /// </summary>
    /// <remarks>
    /// The most common honest answer, and the one a tool is most tempted to dress up. A number
    /// that moved by less than the machine's own session-to-session spread has not been shown to
    /// have moved at all.
    /// </remarks>
    WithinNoise = 1,

    /// <summary>Worse than baseline by more than the noise.</summary>
    Regression = 2,

    /// <summary>Better than baseline by more than the noise.</summary>
    Improvement = 3,

    /// <summary>
    /// The difference clears the noise, but the baseline is not trusted enough to say so.
    /// </summary>
    /// <remarks>
    /// Kept distinct from <see cref="WithinNoise"/> because they are different facts and lead to
    /// different actions: this one says "play a few more sessions and ask again", and reporting
    /// it as no-change would throw away a real observation.
    /// </remarks>
    IndicativeOnly = 4,

    /// <summary>
    /// The two sides could not detect the same size of problem, so they are not comparable.
    /// </summary>
    /// <remarks>
    /// A session that could resolve a 30 ms excess compared against a baseline built at 3 ms is
    /// not a worse session; it is a less sensitive measurement. Reporting the difference as a
    /// change would manufacture one out of the instrument.
    /// </remarks>
    NotComparable = 5,
}

/// <summary>The result of comparing one session against its baseline.</summary>
/// <param name="Verdict">What may be claimed.</param>
/// <param name="Metric">Which number was compared, for wording.</param>
/// <param name="BaselineValue">The baseline's figure.</param>
/// <param name="SessionValue">This session's figure.</param>
/// <param name="DifferenceMs">Session minus baseline. Positive is slower.</param>
/// <param name="NoiseMs">
/// The difference this configuration would have to exceed to be worth mentioning.
/// </param>
/// <param name="Detail">One sentence for the user.</param>
public readonly record struct Comparison(
    ComparisonVerdict Verdict,
    string Metric,
    double BaselineValue,
    double SessionValue,
    double DifferenceMs,
    double NoiseMs,
    string Detail)
{
    /// <summary>How many times the noise the difference is. NaN when there is no noise estimate.</summary>
    public double EffectSize => NoiseMs > 0 ? DifferenceMs / NoiseMs : double.NaN;
}

/// <summary>
/// Comparing a session against what this configuration normally does.
/// </summary>
/// <remarks>
/// <para>
/// The rule the product is written to: an optimization is only "successful" with an effect size
/// that survives the noise. This is where that is enforced, and it is enforced symmetrically —
/// the same bar applies to a regression, so the tool cannot be quick to warn and slow to
/// congratulate, or the reverse.
/// </para>
/// <para>
/// Pure and dependency-free, so every branch is testable without a store, a session, or a
/// machine.
/// </para>
/// </remarks>
public static class RegressionDetector
{
    /// <summary>
    /// Multiples of the baseline's spread a difference must clear to be reported.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Three median absolute deviations. Under a normal distribution that is roughly two
    /// standard deviations, and frame-time session medians are not normal — they are
    /// right-skewed — so the robust estimator and the wider multiple are doing the same job:
    /// making the bar hard enough that a bad afternoon does not clear it.
    /// </para>
    /// <para>
    /// The cost of setting this too low is a tool that cries regression at a user who changed
    /// nothing, which is exactly how a diagnostic tool loses the standing to be believed when it
    /// is right.
    /// </para>
    /// </remarks>
    public const double NoiseMultiple = 3.0;

    /// <summary>
    /// A floor on the noise band, in milliseconds.
    /// </summary>
    /// <remarks>
    /// A configuration that happens to have produced three nearly identical sessions has a
    /// near-zero deviation, and without a floor every subsequent session clears three times
    /// almost-nothing. The floor is a tenth of a millisecond because a difference smaller than
    /// that is below what the frame-time source itself resolves.
    /// </remarks>
    public const double MinimumNoiseMs = 0.1;

    /// <summary>
    /// Compares a session's median frame time against its baseline.
    /// </summary>
    /// <param name="baseline">What this configuration normally does.</param>
    /// <param name="sessionMedianMs">This session's median.</param>
    /// <param name="sessionSensitivityFloorMs">
    /// The smallest excess this session could resolve, so a mismatch in instrument sensitivity
    /// is reported as such rather than as a change in performance.
    /// </param>
    public static Comparison CompareMedian(
        Baseline baseline,
        double sessionMedianMs,
        double sessionSensitivityFloorMs = double.NaN)
    {
        ArgumentNullException.ThrowIfNull(baseline);

        const string metric = "median frame time";

        if (!baseline.Exists || !double.IsFinite(sessionMedianMs))
        {
            return new Comparison(
                ComparisonVerdict.NoBaseline, metric,
                baseline.MedianFrameTimeMs, sessionMedianMs, double.NaN, double.NaN,
                baseline.Describe());
        }

        // Sensitivity first. A comparison between two measurements that could not have seen the
        // same thing is not a weak comparison; it is not a comparison.
        if (NotComparable(baseline.WorstSensitivityFloorMs, sessionSensitivityFloorMs))
        {
            return new Comparison(
                ComparisonVerdict.NotComparable, metric,
                baseline.MedianFrameTimeMs, sessionMedianMs,
                sessionMedianMs - baseline.MedianFrameTimeMs, double.NaN,
                $"This session could only resolve a {sessionSensitivityFloorMs:F1} ms excess " +
                $"against the baseline's {baseline.WorstSensitivityFloorMs:F1} ms. That is a " +
                "difference in what could be measured, not in how the game ran.");
        }

        var observed = baseline.MedianAbsoluteDeviationMs * NoiseMultiple;
        var noise = Math.Max(MinimumNoiseMs, observed);

        // Which of the two set the bar changes what the bar means, and therefore what may
        // honestly be said about it. When the floor binds, the configuration's own variation is
        // smaller than the frame-time source can resolve, and calling the floor "how much this
        // configuration varies" would credit the instrument's limit to the machine.
        var floorIsBinding = observed < MinimumNoiseMs;

        var difference = sessionMedianMs - baseline.MedianFrameTimeMs;

        if (Math.Abs(difference) <= noise)
        {
            var why = floorIsBinding
                ? $"Differences below {noise:F2} ms are smaller than the frame-time source " +
                  "resolves, so nothing has been shown to change."
                : $"This configuration varies by about {noise:F2} ms between sessions, so " +
                  "nothing has been shown to change.";

            return new Comparison(
                ComparisonVerdict.WithinNoise, metric,
                baseline.MedianFrameTimeMs, sessionMedianMs, difference, noise,
                $"{sessionMedianMs:F2} ms against a usual {baseline.MedianFrameTimeMs:F2} ms. " +
                why);
        }

        var worse = difference > 0;

        // The difference cleared the bar, and a provisional baseline is not allowed to turn that
        // into a verdict. Saying so is not the same as saying nothing happened.
        if (!baseline.MayDeclareRegression)
        {
            return new Comparison(
                ComparisonVerdict.IndicativeOnly, metric,
                baseline.MedianFrameTimeMs, sessionMedianMs, difference, noise,
                $"{Math.Abs(difference):F2} ms {(worse ? "slower" : "faster")} than the usual " +
                $"{baseline.MedianFrameTimeMs:F2} ms, which is more than " +
                $"{(floorIsBinding ? "the frame-time source resolves" : "this configuration normally varies")}. " +
                baseline.Describe());
        }

        return new Comparison(
            worse ? ComparisonVerdict.Regression : ComparisonVerdict.Improvement, metric,
            baseline.MedianFrameTimeMs, sessionMedianMs, difference, noise,
            $"{Math.Abs(difference):F2} ms {(worse ? "slower" : "faster")} than the usual " +
            $"{baseline.MedianFrameTimeMs:F2} ms, across {baseline.SessionCount} sessions. " +
            $"That is {Math.Abs(difference) / noise:F1} times " +
            (floorIsBinding
                ? "the smallest difference the frame-time source resolves."
                : "this configuration's session-to-session variation."));
    }

    /// <summary>
    /// Whether two measurements were sensitive enough to be compared.
    /// </summary>
    /// <remarks>
    /// A factor of two, in either direction. The floors do not have to match — they never will —
    /// but one that can resolve a 3 ms excess and one that can only resolve 30 ms are looking at
    /// different things, and subtracting them produces a number about the instrument.
    /// </remarks>
    internal static bool NotComparable(double baselineFloorMs, double sessionFloorMs)
    {
        if (!double.IsFinite(baselineFloorMs) || !double.IsFinite(sessionFloorMs)) return false;
        if (baselineFloorMs <= 0 || sessionFloorMs <= 0) return false;

        var ratio = sessionFloorMs / baselineFloorMs;
        return ratio > 2.0 || ratio < 0.5;
    }
}
