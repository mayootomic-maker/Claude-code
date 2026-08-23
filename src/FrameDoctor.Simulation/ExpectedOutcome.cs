namespace FrameDoctor.Simulation;

/// <summary>
/// What a scenario asserts the diagnostic engine should conclude.
/// </summary>
/// <param name="ExpectStutter">Whether any event should be detected at all.</param>
/// <param name="MinimumEvents">Fewest acceptable events. Zero means none is correct.</param>
/// <param name="MaximumEvents">
/// Most acceptable events. Guards against a detector that reports a train of markers where a
/// user would perceive one problem.
/// </param>
/// <param name="DiagnosisId">
/// Expected diagnosis, or <see langword="null"/> when the correct answer is that the cause
/// cannot be determined.
/// </param>
/// <param name="MinimumConfidence">Lowest acceptable confidence for that diagnosis.</param>
/// <param name="MaximumConfidence">
/// Highest acceptable confidence. Present because overconfidence is a failure: a scenario with
/// weak evidence that produces a 95 % diagnosis has failed just as surely as one that misses.
/// </param>
public readonly record struct ExpectedOutcome(
    bool ExpectStutter,
    int MinimumEvents,
    int MaximumEvents,
    string? DiagnosisId,
    double MinimumConfidence = 0.0,
    double MaximumConfidence = 0.97)
{
    /// <summary>A healthy session: no events, no diagnosis.</summary>
    /// <remarks>
    /// The most important expectation in the suite. A tool that only proves itself by finding
    /// something will find something.
    /// </remarks>
    public static ExpectedOutcome Healthy() => new(false, 0, 0, null);

    /// <summary>Events detected, and their cause identified.</summary>
    public static ExpectedOutcome Diagnosed(
        string diagnosisId, int minEvents = 1, int maxEvents = 3,
        double minConfidence = 0.5, double maxConfidence = 0.97) =>
        new(true, minEvents, maxEvents, diagnosisId, minConfidence, maxConfidence);

    /// <summary>Events detected, but no cause determinable — and that is the correct answer.</summary>
    public static ExpectedOutcome Unexplained(int minEvents = 1, int maxEvents = 3) =>
        new(true, minEvents, maxEvents, null);
}
