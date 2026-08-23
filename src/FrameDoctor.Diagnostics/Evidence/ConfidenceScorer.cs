namespace FrameDoctor.Diagnostics.Evidence;

/// <summary>
/// Combines evidence into a confidence value.
/// </summary>
/// <remarks>
/// <para>
/// A weighted sum of log-likelihood ratios, passed through a logistic function and then capped.
/// It is called that in the UI too: it is Bayesian arithmetic with hand-set, documented ratios,
/// and describing it as anything more sophisticated would be dressing up basic statistics.
/// </para>
/// <para>
/// The caps are the part that matters. Without them, a handful of agreeing thermal sensors
/// drives the logistic function to 0.9998 and the product reports near-certainty about a
/// correlational claim — which is precisely the failure it exists to avoid.
/// </para>
/// </remarks>
public static class ConfidenceScorer
{
    /// <summary>Highest confidence the product will ever report.</summary>
    public const double GlobalCeiling = 0.97;

    /// <summary>Ceiling when only one evidence class contributed.</summary>
    public const double SingleClassCeiling = 0.75;

    /// <summary>Ceiling when any contributing item was modelled rather than measured.</summary>
    public const double EstimatedEvidenceCeiling = 0.85;

    /// <summary>Ceiling when a metric the rule requires was unavailable.</summary>
    public const double MissingMetricCeiling = 0.60;

    /// <summary>Prior odds before any evidence. Deliberately pessimistic.</summary>
    private const double PriorOdds = 0.25;

    /// <summary>
    /// Scores a hypothesis.
    /// </summary>
    /// <param name="evidence">Supporting, corroborating and contradicting items.</param>
    /// <param name="missingRequiredMetrics">
    /// Metrics the rule wanted but could not read. Their <i>absence</i> caps confidence; it
    /// never counts against the hypothesis, because a sensor that does not exist cannot
    /// disprove anything.
    /// </param>
    public static ConfidenceScore Score(
        IReadOnlyList<EvidenceItem> evidence,
        IReadOnlyList<string>? missingRequiredMetrics = null)
    {
        ArgumentNullException.ThrowIfNull(evidence);
        var missing = missingRequiredMetrics ?? [];

        var logOdds = Math.Log(PriorOdds);
        var perClassCount = new Dictionary<EvidenceClass, int>();
        var contributingClasses = new HashSet<EvidenceClass>();
        var hasEstimated = false;

        foreach (var item in evidence)
        {
            var k = perClassCount.GetValueOrDefault(item.Class) + 1;
            perClassCount[item.Class] = k;

            // Correlated evidence within a class is discounted: the k-th thermal sensor to
            // agree adds a fraction of what the first one did.
            var independenceWeight = 1.0 / k;
            logOdds += item.BaseLogOdds * independenceWeight;

            if (item.Role != EvidenceRole.Contradicting) contributingClasses.Add(item.Class);
            if (item.Quality == Abstractions.Telemetry.Quality.Estimated) hasEstimated = true;
        }

        var raw = 1.0 / (1.0 + Math.Exp(-logOdds));

        var value = raw;
        var cap = ConfidenceCap.None;

        void Apply(double ceiling, ConfidenceCap reason)
        {
            if (value > ceiling)
            {
                value = ceiling;
                cap = reason;
            }
        }

        // Ordered weakest ceiling last so the tightest constraint is the one reported.
        Apply(GlobalCeiling, ConfidenceCap.GlobalCeiling);
        if (hasEstimated) Apply(EstimatedEvidenceCeiling, ConfidenceCap.EstimatedEvidence);
        if (contributingClasses.Count < 2) Apply(SingleClassCeiling, ConfidenceCap.SingleEvidenceClass);
        if (missing.Count > 0) Apply(MissingMetricCeiling, ConfidenceCap.RequiredMetricMissing);

        return new ConfidenceScore(value, raw, logOdds, cap, missing);
    }
}
