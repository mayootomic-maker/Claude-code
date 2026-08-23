using FrameDoctor.Diagnostics.Correlation;
using FrameDoctor.Diagnostics.Evidence;
using FrameDoctor.Diagnostics.Rules;

namespace FrameDoctor.Diagnostics;

/// <summary>
/// Runs every hypothesis against an event and reports the best-supported one — or, honestly,
/// none.
/// </summary>
/// <remarks>
/// <para>
/// Deterministic and inspectable: the same window always yields the same diagnosis, and every
/// number shown to the user traces to a measurement in the evidence list. No language model
/// sits in this path.
/// </para>
/// <para>
/// <b>The unexplained case is a first-class result, not a fallback.</b> Tier 0 counters sample
/// at 1–4 Hz while stutters last 20–200 ms, and several leading causes of modern stutter —
/// shader compilation, asset streaming, driver hitches, engine garbage collection — leave no
/// trace in them at all. An engine that always produces a plausible answer would be confidently
/// wrong in a way the user cannot check.
/// </para>
/// <para>
/// So when nothing reaches the threshold, the diagnosis is the <i>exclusion list</i>: what was
/// checked and ruled out, and what could not be checked at all. That converts an empty result
/// into evidence of competence, and it saves the user a weekend of tweaking the wrong thing.
/// </para>
/// </remarks>
public sealed class DiagnosticEngine
{
    /// <summary>
    /// Confidence below which no cause is reported.
    /// </summary>
    /// <remarks>
    /// Set where a claim stops being more informative than silence. Reporting a 30 % hypothesis
    /// invites the user to act on it, and acting on a coin-flip wastes their evening.
    /// </remarks>
    public const double ReportingThreshold = 0.40;

    private readonly IReadOnlyList<IDiagnosticRule> _rules;

    public DiagnosticEngine(IEnumerable<IDiagnosticRule>? rules = null)
    {
        _rules = rules?.ToArray() ?? DefaultRules();
    }

    /// <summary>The hypotheses shipped by default.</summary>
    public static IReadOnlyList<IDiagnosticRule> DefaultRules() =>
    [
        new BackgroundCpuContentionRule(),
        new CpuFrequencyCollapseRule(),
        new GpuThermalThrottleRule(),
        new GpuPowerLimitRule(),
        new MemoryPressurePagingRule(),
        new DiskStallRule(),
        new DpcStormRule(),
    ];

    public IReadOnlyList<IDiagnosticRule> Rules => _rules;

    /// <summary>Diagnoses one event.</summary>
    public Diagnosis Diagnose(CorrelationWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);

        var scored = new List<(IDiagnosticRule Rule, RuleEvaluation Eval, ConfidenceScore Score)>();
        var ruledOut = new List<RuledOutHypothesis>();

        foreach (var rule in _rules)
        {
            var evaluation = rule.Evaluate(window);

            if (evaluation.IsRejected)
            {
                ruledOut.Add(new RuledOutHypothesis(
                    rule.Id, rule.Title, evaluation.RejectionReason!, WasCheckable: true));
                continue;
            }

            if (evaluation.Evidence.Count == 0)
            {
                // Not rejected and no evidence means the metrics were unreadable. That is a
                // blind spot, and the user is told about it rather than left to assume coverage.
                var reason = evaluation.MissingRequiredMetrics.Count > 0
                    ? $"Could not check: {string.Join(", ", evaluation.MissingRequiredMetrics)} unavailable."
                    : "Could not check: required telemetry unavailable.";
                ruledOut.Add(new RuledOutHypothesis(rule.Id, rule.Title, reason, WasCheckable: false));
                continue;
            }

            var score = ConfidenceScorer.Score(evaluation.Evidence, evaluation.MissingRequiredMetrics);
            scored.Add((rule, evaluation, score));
        }

        // OrderByDescending + FirstOrDefault rather than MaxBy: MaxBy throws on an empty
        // sequence for value tuples, and "nothing reached the threshold" is a normal outcome
        // here, not an error - it is the unexplained case, which this engine treats as a
        // first-class result.
        var best = scored
            .Where(s => s.Score.Value >= ReportingThreshold)
            .OrderByDescending(s => s.Score.Value)
            .FirstOrDefault();

        // Anything scored but not winning is still reported, with its score, so the user can
        // see what else was considered rather than only what won.
        foreach (var (rule, _, score) in scored)
        {
            if (best.Rule is not null && rule.Id == best.Rule.Id) continue;
            ruledOut.Add(new RuledOutHypothesis(
                rule.Id, rule.Title,
                $"Considered, but the evidence only supported it at {score.Value * 100:F0}%.",
                WasCheckable: true));
        }

        if (best.Rule is null) return Unexplained(window, ruledOut);

        var ordered = best.Eval.Evidence
            .OrderByDescending(e => Math.Abs(e.BaseLogOdds))
            .ToArray();

        return new Diagnosis(
            window.Event,
            best.Rule.Id,
            best.Rule.Title,
            best.Score,
            best.Eval.WhatHappened,
            best.Eval.Mechanism,
            best.Eval.RecommendedAction,
            ordered,
            ruledOut);
    }

    private static Diagnosis Unexplained(
        CorrelationWindow window, IReadOnlyList<RuledOutHypothesis> ruledOut)
    {
        var checkedCount = ruledOut.Count(r => r.WasCheckable);
        var blind = ruledOut.Where(r => !r.WasCheckable).ToArray();

        var mechanism =
            "Frame timing was disturbed, but none of the causes FrameDoctor can observe changed " +
            "around it. This is consistent with work inside the game itself — shader " +
            "compilation, asset streaming, or a driver hitch — which is not visible in " +
            "system-level counters.";

        if (blind.Length > 0)
        {
            mechanism +=
                $" {blind.Length} hypothes{(blind.Length == 1 ? "is" : "es")} could not be tested " +
                "because the required sensors are unavailable on this machine.";
        }

        return new Diagnosis(
            window.Event,
            RuleId: null,
            Title: "Unexplained",
            Confidence: new ConfidenceScore(0, 0, 0, ConfidenceCap.None, []),
            WhatHappened:
                $"One frame took {window.Event.PeakFrameTimeMs:F0} ms against a " +
                $"{window.Event.BaselineMedianMs:F1} ms baseline. " +
                $"{checkedCount} possible cause{(checkedCount == 1 ? " was" : "s were")} checked " +
                "and ruled out.",
            Mechanism: mechanism,
            RecommendedAction: null,
            Evidence: [],
            RuledOut: ruledOut);
    }
}
