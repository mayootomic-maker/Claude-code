using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Correlation;

namespace FrameDoctor.Diagnostics.Evidence;

/// <summary>
/// Whether a piece of evidence describes a cause or a downstream effect.
/// </summary>
/// <remarks>
/// A non-negotiable distinction for this product. When the CPU stalls, GPU utilization
/// collapses — the GPU is idle <i>because</i> it is waiting, not because anything is wrong with
/// it. Users read an unlabelled GPU drop as the problem, so the label travels with the evidence
/// rather than being left to the prose.
/// </remarks>
public enum EvidenceRole : byte
{
    /// <summary>Supports the proposed mechanism.</summary>
    Cause = 0,

    /// <summary>Follows from the proposed mechanism. Corroborates, but does not explain.</summary>
    Consequence = 1,

    /// <summary>Argues against the hypothesis.</summary>
    Contradicting = 2,
}

/// <summary>
/// One observation supporting or opposing a hypothesis, with everything needed to audit it.
/// </summary>
/// <param name="Metric">Which series this came from.</param>
/// <param name="Statement">
/// What it says, in the product's own voice — e.g. "CPU effective clock fell 4.59 to 1.41 GHz".
/// This is the string a user reads, so it is authored with the evidence, not generated later
/// from a template that has lost the units.
/// </param>
/// <param name="LikelihoodRatio">
/// How much more probable this observation is under the hypothesis than under its negation.
/// Fixed, hand-set and documented per rule — not learned, not a model.
/// </param>
/// <param name="Class">Family, for independence weighting.</param>
/// <param name="Role">Cause, consequence, or contradiction.</param>
/// <param name="SampleCount">Readable samples that back this claim.</param>
/// <param name="NativeRateHz">The series' true rate, so the UI can draw it honestly.</param>
/// <param name="CanEstablishOrdering">
/// Whether the series resolves finely enough to claim its change preceded the event.
/// </param>
/// <param name="Quality">Measurement quality, which caps the weight this item can carry.</param>
public sealed record EvidenceItem(
    MetricKey Metric,
    string Statement,
    double LikelihoodRatio,
    EvidenceClass Class,
    EvidenceRole Role,
    int SampleCount,
    double NativeRateHz,
    bool CanEstablishOrdering,
    Quality Quality)
{
    /// <summary>Weight from measurement quality.</summary>
    public double QualityWeight => Quality switch
    {
        Quality.Exact => 1.0,
        Quality.Derived => 0.8,
        Quality.Estimated => 0.5,
        Quality.Degraded => 0.4,
        _ => 0.5,
    };

    /// <summary>
    /// Weight from how many samples back the claim.
    /// </summary>
    /// <remarks>
    /// A change described by two samples of a 1 Hz sensor is a real observation but a weak one,
    /// and it must not carry the same weight as six hundred frames.
    /// </remarks>
    public double ResolutionWeight => Math.Min(1.0, SampleCount / 4.0);

    /// <summary>Contribution to the log-odds sum, before independence weighting.</summary>
    public double BaseLogOdds => QualityWeight * ResolutionWeight * Math.Log(LikelihoodRatio);
}
