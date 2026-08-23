using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;

namespace FrameDoctor.Diagnostics.Rules;

/// <summary>
/// The outcome of testing one hypothesis against a correlation window.
/// </summary>
/// <param name="Evidence">Items supporting, corroborating or contradicting the hypothesis.</param>
/// <param name="MissingRequiredMetrics">
/// Metrics the rule needed but could not read. These cap confidence and are surfaced as blind
/// spots; they never count against the hypothesis.
/// </param>
/// <param name="RejectionReason">
/// Non-null when the hypothesis is positively excluded, stating the observation that excluded
/// it. This is what populates the ruled-out list.
/// </param>
/// <param name="WhatHappened">Facts about the event, no cause attributed.</param>
/// <param name="Mechanism">Why this cause produces this symptom.</param>
/// <param name="RecommendedAction">What the user can do, if anything.</param>
public sealed record RuleEvaluation(
    IReadOnlyList<EvidenceItem> Evidence,
    IReadOnlyList<string> MissingRequiredMetrics,
    string? RejectionReason,
    string WhatHappened,
    string? Mechanism,
    string? RecommendedAction)
{
    /// <summary>The hypothesis does not apply, with the observation that excluded it.</summary>
    public static RuleEvaluation Rejected(string reason) =>
        new([], [], reason, string.Empty, null, null);

    /// <summary>The hypothesis could not be tested because its metrics were unreadable.</summary>
    public static RuleEvaluation NotCheckable(params string[] missingMetrics) =>
        new([], missingMetrics, null, string.Empty, null, null);

    public bool IsRejected => RejectionReason is not null;

    public bool IsCheckable => Evidence.Count > 0 || RejectionReason is not null;
}

/// <summary>
/// One deterministic hypothesis about why an event occurred.
/// </summary>
/// <remarks>
/// Rules are pure functions of a correlation window: same window, same verdict, every time. No
/// language model sits in this path. A diagnosis a user cannot re-derive from the evidence
/// shown is a guess with a percentage attached, and the whole product rests on that not being
/// true.
/// </remarks>
public interface IDiagnosticRule
{
    /// <summary>Stable identifier, used in tests, storage and the UI.</summary>
    string Id { get; }

    /// <summary>Human-readable name of the cause.</summary>
    string Title { get; }

    /// <summary>Tests this hypothesis against the window.</summary>
    RuleEvaluation Evaluate(CorrelationWindow window);
}
