namespace FrameDoctor.Diagnostics.Evidence;

/// <summary>Why a confidence value was limited below what the raw evidence implied.</summary>
public enum ConfidenceCap : byte
{
    /// <summary>No cap bound; the raw score stands.</summary>
    None = 0,

    /// <summary>
    /// The global ceiling.
    /// </summary>
    /// <remarks>
    /// Attributing a stutter to a cause is a correlational step even when every input is a
    /// direct measurement. There is always an unobserved alternative, so certainty is not
    /// available and the product does not offer it.
    /// </remarks>
    GlobalCeiling = 1,

    /// <summary>Fewer than two independent evidence classes contributed.</summary>
    SingleEvidenceClass = 2,

    /// <summary>At least one item was modelled rather than measured.</summary>
    EstimatedEvidence = 3,

    /// <summary>
    /// A metric the rule needs was unavailable.
    /// </summary>
    /// <remarks>
    /// The UI must name the missing metric. "Could not check: CPU power — no sensor" tells the
    /// user where the diagnosis was blind, which is the difference between honest uncertainty
    /// and a shrug.
    /// </remarks>
    RequiredMetricMissing = 4,
}

/// <summary>
/// A computed confidence, with the arithmetic that produced it.
/// </summary>
/// <param name="Value">Final confidence in [0, 0.97].</param>
/// <param name="RawValue">Before caps.</param>
/// <param name="LogOdds">The weighted log-odds sum.</param>
/// <param name="BindingCap">Which cap limited the result, if any.</param>
/// <param name="MissingMetrics">Required metrics that were unavailable.</param>
public readonly record struct ConfidenceScore(
    double Value,
    double RawValue,
    double LogOdds,
    ConfidenceCap BindingCap,
    IReadOnlyList<string> MissingMetrics)
{
    /// <summary>
    /// Below this, the UI says "possible cause" rather than "most likely cause", and must state
    /// what additional measurement would settle it.
    /// </summary>
    public const double PossibleRatherThanLikelyThreshold = 0.60;

    public bool IsMerelyPossible => Value < PossibleRatherThanLikelyThreshold;
}
