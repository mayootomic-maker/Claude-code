using FrameDoctor.Diagnostics.Evidence;
using FrameDoctor.Pipeline.Detection;

namespace FrameDoctor.Diagnostics;

/// <summary>A hypothesis that was considered and rejected, with the measurement that killed it.</summary>
/// <param name="RuleId">The hypothesis.</param>
/// <param name="Title">Its human-readable name.</param>
/// <param name="Reason">
/// Why it was rejected, phrased as the observation — "no process exceeded 5 % CPU", not
/// "insufficient evidence".
/// </param>
/// <param name="WasCheckable">
/// Whether the metrics needed to test it were available. A hypothesis that could not be tested
/// is a blind spot, and the difference between "ruled out" and "could not check" is exactly
/// what a user needs in order to trust the ones that were ruled out.
/// </param>
public sealed record RuledOutHypothesis(
    string RuleId,
    string Title,
    string Reason,
    bool WasCheckable);

/// <summary>
/// The engine's conclusion about one event.
/// </summary>
/// <param name="Event">The event being explained.</param>
/// <param name="RuleId">
/// Winning hypothesis, or <see langword="null"/> when nothing reached the reporting threshold.
/// </param>
/// <param name="Title">Human-readable name of the cause, or "Unexplained".</param>
/// <param name="Confidence">Computed confidence, with the cap that bound it.</param>
/// <param name="WhatHappened">Facts only, no cause.</param>
/// <param name="Mechanism">
/// The physical story — <i>why</i> that cause produces that symptom. A diagnosis that names a
/// number without naming a mechanism has failed.
/// </param>
/// <param name="RecommendedAction">What the user can do, or null when there is nothing useful.</param>
/// <param name="Evidence">Ordered by contribution, strongest first.</param>
/// <param name="RuledOut">
/// Every hypothesis considered and rejected. Not an appendix: ruling out is itself a diagnosis,
/// it saves the user a weekend of tweaking, and on an unexplained event it is the entire value.
/// </param>
public sealed record Diagnosis(
    StutterEvent Event,
    string? RuleId,
    string Title,
    ConfidenceScore Confidence,
    string WhatHappened,
    string? Mechanism,
    string? RecommendedAction,
    IReadOnlyList<EvidenceItem> Evidence,
    IReadOnlyList<RuledOutHypothesis> RuledOut)
{
    /// <summary>Whether a cause was identified at all.</summary>
    public bool IsExplained => RuleId is not null;

    /// <summary>Hypotheses that could not be tested because their metrics were unavailable.</summary>
    public IEnumerable<RuledOutHypothesis> BlindSpots => RuledOut.Where(r => !r.WasCheckable);
}
