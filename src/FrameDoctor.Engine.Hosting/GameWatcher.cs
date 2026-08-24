using FrameDoctor.Abstractions.Time;
using FrameDoctor.Pipeline.Attribution;

namespace FrameDoctor.Engine.Hosting;

/// <summary>The facts about the foreground process that only the platform layer can read.</summary>
/// <param name="ProcessId">The process that owns the foreground window.</param>
/// <param name="ImagePath">Full path to its executable, or empty when it could not be read.</param>
/// <param name="SignerSubject">Its Authenticode subject, or null.</param>
public readonly record struct ForegroundFacts(int ProcessId, string ImagePath, string? SignerSubject);

/// <summary>
/// Assembles a candidate out of three sources and asks the detector about it.
/// </summary>
/// <remarks>
/// <para>
/// The seam exists because no source knows all three things Gate B requires. The foreground
/// belongs to the window manager, 3D utilization to the GPU engine counters, and the present rate
/// to our own frame collector — and the pipeline, which decides, may not reach any of them: it is
/// portable and must stay testable on a machine with no Windows and no GPU.
/// </para>
/// <para>
/// Delegates rather than interfaces, because each of the three is one reading. An interface per
/// source here would be three types whose only member is a getter, and the seam would be harder
/// to see rather than easier.
/// </para>
/// </remarks>
public sealed class GameWatcher
{
    private readonly GameDetector _detector;
    private readonly Func<ForegroundFacts?> _foreground;
    private readonly Func<int, double?> _threeDUtilization;
    private readonly Func<int, double?> _presentRate;

    /// <param name="detector">The gates. This class contains none of the decision.</param>
    /// <param name="foreground">
    /// The foreground process, or null when there is not one. Null is a real state — a desktop
    /// switch, the lock screen, a fullscreen mode change — and is not the same as a process we
    /// failed to identify.
    /// </param>
    /// <param name="threeDUtilization">
    /// Sustained 3D engine utilization for a process, or null when the counters are unavailable.
    /// </param>
    /// <param name="presentRate">
    /// Present rate for a process from our frame collector, or null when we see no frames for it.
    /// </param>
    public GameWatcher(
        GameDetector detector,
        Func<ForegroundFacts?> foreground,
        Func<int, double?> threeDUtilization,
        Func<int, double?> presentRate)
    {
        ArgumentNullException.ThrowIfNull(detector);
        ArgumentNullException.ThrowIfNull(foreground);
        ArgumentNullException.ThrowIfNull(threeDUtilization);
        ArgumentNullException.ThrowIfNull(presentRate);

        _detector = detector;
        _foreground = foreground;
        _threeDUtilization = threeDUtilization;
        _presentRate = presentRate;
    }

    /// <summary>Raised when the detector's belief changes, so the session can start, tag or stop.</summary>
    public event Action<DetectionResult>? Changed;

    public DetectionResult Current { get; private set; }

    /// <summary>
    /// Takes one reading and updates the detector.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A confirmed session keeps being polled for its own process even while something else holds
    /// the foreground — that is what makes confirmation sticky, and it is why the confirmed pid is
    /// asked about separately rather than only when it happens to be in front.
    /// </para>
    /// <para>
    /// When there is no foreground process at all, a confirmed session is told the truth: nothing
    /// was observed. That feeds the grace period rather than ending the session, because a lock
    /// screen is not a game exiting.
    /// </para>
    /// </remarks>
    public DetectionResult Poll(MonotonicTimestamp now)
    {
        var facts = _foreground();

        // The confirmed process first. It is the subject of the session, and whether it is in
        // front is a property of the observation rather than a reason to skip it.
        if (_detector.ConfirmedProcessId is { } confirmed)
        {
            var stillThere = _presentRate(confirmed) is not null
                || _threeDUtilization(confirmed) is not null
                || facts?.ProcessId == confirmed;

            var result = stillThere
                ? _detector.Observe(CandidateFor(
                    confirmed,
                    facts?.ProcessId == confirmed ? facts.Value : new ForegroundFacts(confirmed, string.Empty, null),
                    isForeground: facts?.ProcessId == confirmed,
                    now))
                : _detector.NoteMissing(now);

            return Publish(result);
        }

        // No foreground at all. Told as such rather than as a missing observation: a candidate
        // must not bank the dwell it held before the lock screen appeared.
        if (facts is not { } candidate) return Publish(_detector.NoteNoForeground(now));

        return Publish(_detector.Observe(
            CandidateFor(candidate.ProcessId, candidate, isForeground: true, now)));
    }

    /// <summary>Ends the session for a process exit we were told about, rather than inferred.</summary>
    public DetectionResult End() => Publish(_detector.End());

    private GameCandidate CandidateFor(
        int processId,
        ForegroundFacts facts,
        bool isForeground,
        MonotonicTimestamp now) =>
        new(
            processId,
            facts.ImagePath,
            facts.SignerSubject,
            isForeground,
            _threeDUtilization(processId),
            _presentRate(processId),
            now);

    private DetectionResult Publish(DetectionResult result)
    {
        Current = result;
        if (result.Changed) Changed?.Invoke(result);
        return result;
    }
}
