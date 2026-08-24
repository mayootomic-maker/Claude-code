using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Pipeline.Attribution;

/// <summary>What the detector currently believes about the process it is watching.</summary>
public enum GameDetectionState : byte
{
    /// <summary>Nothing is confirmed. No session is running.</summary>
    Idle = 0,

    /// <summary>
    /// A candidate is accumulating evidence but has not satisfied every requirement yet.
    /// </summary>
    Watching = 1,

    /// <summary>Confirmed, and in the foreground.</summary>
    Playing = 2,

    /// <summary>
    /// Confirmed, and no longer in the foreground.
    /// </summary>
    /// <remarks>
    /// Not an ending. A minimised game legitimately drops to low QoS and its frame rate
    /// legitimately collapses; ending the session there would lose the alt-tab, and scoring
    /// those frames against the rest of the session would report a regression that never
    /// happened to the machine. Samples taken here are tagged and bucketed separately.
    /// </remarks>
    Background = 3,
}

/// <summary>Which of Gate B's three requirements a candidate has met.</summary>
/// <remarks>
/// Kept as three separate facts rather than a score. A weighted score would let two strong
/// signals carry a missing third, and the missing third is usually the one that distinguishes a
/// game from a video player — which is exactly the confusion the conjunction exists to prevent.
/// </remarks>
/// <param name="ForegroundDwell">Foreground held for at least the required time.</param>
/// <param name="ThreeDWork">Sustained 3D engine work attributable to this process.</param>
/// <param name="PresentRate">A sustained present rate for this process from our frame collector.</param>
public readonly record struct GateBProgress(bool ForegroundDwell, bool ThreeDWork, bool PresentRate)
{
    public bool AllMet => ForegroundDwell && ThreeDWork && PresentRate;

    /// <summary>What is still missing, in the user's terms. Empty when nothing is.</summary>
    public IReadOnlyList<string> Missing
    {
        get
        {
            var missing = new List<string>(3);
            if (!ForegroundDwell) missing.Add("has not held the foreground long enough");
            if (!ThreeDWork) missing.Add("is not doing sustained 3D work");
            if (!PresentRate) missing.Add("is not presenting frames we can see");
            return missing;
        }
    }
}

/// <summary>The detector's answer after one observation.</summary>
/// <param name="State">What is believed now.</param>
/// <param name="ProcessId">The confirmed process, or null.</param>
/// <param name="Exclusion">Why the candidate was excluded, if it was.</param>
/// <param name="Progress">How far the candidate got through Gate B.</param>
/// <param name="Changed">Whether this observation changed the state.</param>
public readonly record struct DetectionResult(
    GameDetectionState State,
    int? ProcessId,
    ExclusionReason Exclusion,
    GateBProgress Progress,
    bool Changed)
{
    public bool IsConfirmed => State is GameDetectionState.Playing or GameDetectionState.Background;

    /// <summary>
    /// Whether samples taken now belong to foreground play.
    /// </summary>
    /// <remarks>
    /// The tag ADR 0003 requires on every sample. Background frames are real and are kept; they
    /// are simply not comparable to foreground ones, and a session that mixed them would have a
    /// median describing neither.
    /// </remarks>
    public bool GameForeground => State is GameDetectionState.Playing;

    /// <summary>One sentence for the interface. Never a guess about a process we excluded.</summary>
    public string Explain() => State switch
    {
        GameDetectionState.Playing => $"Measuring process {ProcessId}.",
        GameDetectionState.Background =>
            $"Still measuring process {ProcessId}, which is no longer in the foreground. " +
            "Frames from here are kept separately.",
        GameDetectionState.Watching when Exclusion is not ExclusionReason.None =>
            ExplainExclusion(Exclusion),
        GameDetectionState.Watching =>
            $"Watching a candidate: it {string.Join(", and it ", Progress.Missing)}.",
        _ => "Nothing is being measured.",
    };

    private static string ExplainExclusion(ExclusionReason reason) => reason switch
    {
        ExclusionReason.SystemImage =>
            "The foreground process is part of Windows, so it is not measured.",
        ExclusionReason.OwnProcess =>
            "The foreground process is FrameDoctor itself.",
        ExclusionReason.KnownLauncher =>
            "The foreground process is a game launcher. The game it starts is a separate " +
            "process, and that is what will be measured.",
        ExclusionReason.UnknownSystemRoot =>
            "The Windows directory could not be determined, so system processes cannot be " +
            "ruled out and nothing is being measured.",
        _ => "Nothing is being measured.",
    };
}

/// <summary>Thresholds Gate B applies. Every one is a judgement, so every one is nameable.</summary>
public sealed record GameDetectorOptions
{
    /// <summary>
    /// How long a candidate must hold the foreground.
    /// </summary>
    /// <remarks>
    /// Two seconds, from ADR 0003. Long enough that alt-tabbing through windows does not start a
    /// session on each one; short enough that it is invisible when a game actually launches.
    /// </remarks>
    public TimeSpan ForegroundDwell { get; init; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// Minimum sustained <c>engtype_3D</c> utilization, as a percentage.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Fifteen percent. Anything that cannot keep one GPU's 3D engine that busy for two seconds,
    /// while holding the foreground and presenting steadily, is not a workload this tool can say
    /// anything useful about — its frame pacing is not being set by rendering.
    /// </para>
    /// <para>
    /// This is the least-founded number in the detector, and it is the one to revisit first with
    /// real hardware in front of you. It errs toward declining: a game wrongly declined is
    /// visible on screen and correctable, and a video player wrongly confirmed would have its
    /// compositor stalls reported as the user's frame pacing.
    /// </para>
    /// </remarks>
    public double MinimumThreeDPercent { get; init; } = 15.0;

    /// <summary>
    /// Minimum sustained present rate, in hertz.
    /// </summary>
    /// <remarks>
    /// Ten, because below it there is nothing to diagnose: a session presenting five frames a
    /// second has no frame pacing, only a slideshow, and every percentile computed from it would
    /// describe the slideshow.
    /// </remarks>
    public double MinimumPresentRateHz { get; init; } = 10.0;

    /// <summary>
    /// How long the positive signals must hold before confirmation.
    /// </summary>
    /// <remarks>
    /// "Sustained" made concrete. A single observation of high GPU work is a loading screen; two
    /// seconds of it alongside a steady present rate is a game running.
    /// </remarks>
    public TimeSpan SustainedFor { get; init; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// How long a confirmed process may go unobserved before the session ends.
    /// </summary>
    /// <remarks>
    /// A poll can miss a process without the process having exited. Ending on the first miss
    /// would split one session into several, and a baseline built from the pieces would describe
    /// a machine that restarts the game every few minutes.
    /// </remarks>
    public TimeSpan MissingGrace { get; init; } = TimeSpan.FromSeconds(5);
}

/// <summary>
/// Decides which process, if any, is the game.
/// </summary>
/// <remarks>
/// <para>
/// Gate A first — unoverridable exclusions, evaluated before any positive evidence is even
/// looked at — then Gate B, which requires all three of foreground dwell, sustained 3D work and
/// a sustained present rate. Not a weighted score: a score lets two strong signals carry a
/// missing third, and the third is usually what separates a game from something else that is
/// fullscreen and busy.
/// </para>
/// <para>
/// Confirmation is <b>sticky to the process, not to the foreground</b>. Alt-tabbing moves the
/// session to <see cref="GameDetectionState.Background"/> rather than ending it.
/// </para>
/// <para>
/// Pure and clock-injected: it holds no handles, calls nothing, and every branch is reachable
/// from a test on a machine with no Windows and no GPU.
/// </para>
/// </remarks>
public sealed class GameDetector
{
    private readonly GameDetectorOptions _options;
    private readonly string? _systemRoot;
    private readonly int _ownProcessId;
    private readonly IReadOnlyList<LauncherEntry> _launchers;

    private GameDetectionState _state = GameDetectionState.Idle;
    private int? _confirmedPid;

    private int? _watchingPid;
    private MonotonicTimestamp _foregroundSince;
    private MonotonicTimestamp _positiveSince;
    private bool _positiveHeld;

    private MonotonicTimestamp _lastSeen;
    private bool _everSeen;

    /// <param name="systemRoot">
    /// The Windows directory. Null or empty makes every candidate excluded rather than every
    /// candidate eligible — an unknown exclusion is not a passed one.
    /// </param>
    /// <param name="ownProcessId">Our own process, which is never the game.</param>
    /// <param name="options">Gate B's thresholds.</param>
    /// <param name="launchers">The deny-list, or the default one.</param>
    public GameDetector(
        string? systemRoot,
        int ownProcessId,
        GameDetectorOptions? options = null,
        IReadOnlyList<LauncherEntry>? launchers = null)
    {
        _options = options ?? new GameDetectorOptions();
        _systemRoot = string.IsNullOrWhiteSpace(systemRoot) ? null : systemRoot.TrimEnd('\\', '/');
        _ownProcessId = ownProcessId;
        _launchers = launchers ?? KnownLaunchers.Default;
    }

    public GameDetectionState State => _state;

    public int? ConfirmedProcessId => _confirmedPid;

    /// <summary>Feeds one observation and returns what is believed afterwards.</summary>
    public DetectionResult Observe(GameCandidate candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate.ImagePath);

        // A confirmed session is bound to its process. Observations of anything else are noted
        // for liveness and otherwise ignored — the foreground moving elsewhere is what
        // Background exists for, not a reason to start hunting for a new game.
        if (_confirmedPid is { } confirmed)
        {
            return candidate.ProcessId == confirmed
                ? ContinueConfirmed(candidate)
                : Unchanged();
        }

        var exclusion = Exclude(candidate);
        if (exclusion is not ExclusionReason.None)
        {
            ResetWatch();
            return new DetectionResult(
                GameDetectionState.Watching, null, exclusion, default, Changed(GameDetectionState.Watching));
        }

        return Accumulate(candidate);
    }

    /// <summary>
    /// Reports that time has passed with no observation of the confirmed process.
    /// </summary>
    /// <remarks>
    /// Separate from <see cref="Observe"/> because "the process was not in this poll" is not an
    /// observation of the process — it is the absence of one, and the two must not be
    /// interchangeable at the call site.
    /// </remarks>
    public DetectionResult NoteMissing(MonotonicTimestamp now)
    {
        if (_confirmedPid is null) return Unchanged();

        if (!_everSeen || now - _lastSeen < _options.MissingGrace) return Unchanged();

        _confirmedPid = null;
        _state = GameDetectionState.Idle;
        ResetWatch();

        return new DetectionResult(GameDetectionState.Idle, null, ExclusionReason.None, default, true);
    }

    /// <summary>
    /// Reports that no process holds the foreground.
    /// </summary>
    /// <remarks>
    /// A real state, not an error: a desktop switch, the lock screen, and a fullscreen mode
    /// change all produce it. A candidate's dwell clock is reset, because dwell is time held
    /// continuously and an absence is not holding. A confirmed session is untouched — the lock
    /// screen is not a game exiting.
    /// </remarks>
    public DetectionResult NoteNoForeground(MonotonicTimestamp now)
    {
        if (_confirmedPid is not null) return NoteMissing(now);

        ResetWatch();

        return new DetectionResult(
            _state, null, ExclusionReason.None, default, Changed(GameDetectionState.Watching));
    }

    /// <summary>Ends the session immediately, for a process exit we were told about.</summary>
    public DetectionResult End()
    {
        if (_state is GameDetectionState.Idle) return Unchanged();

        _confirmedPid = null;
        _state = GameDetectionState.Idle;
        ResetWatch();

        return new DetectionResult(GameDetectionState.Idle, null, ExclusionReason.None, default, true);
    }

    /// <summary>Gate A. Evaluated before any positive evidence is considered.</summary>
    internal ExclusionReason Exclude(GameCandidate candidate)
    {
        if (candidate.ProcessId == _ownProcessId) return ExclusionReason.OwnProcess;

        if (_systemRoot is null) return ExclusionReason.UnknownSystemRoot;

        if (IsUnder(candidate.ImagePath, _systemRoot)) return ExclusionReason.SystemImage;

        return IsKnownLauncher(candidate) ? ExclusionReason.KnownLauncher : ExclusionReason.None;
    }

    /// <summary>
    /// Whether a path lies inside a directory.
    /// </summary>
    /// <remarks>
    /// Compares on a separator boundary, so <c>C:\Windows-Games\game.exe</c> is not read as
    /// living under <c>C:\Windows</c>. A prefix test alone would have excluded it.
    /// </remarks>
    private static bool IsUnder(string path, string directory)
    {
        if (path.Length <= directory.Length) return false;

        if (!path.StartsWith(directory, StringComparison.OrdinalIgnoreCase)) return false;

        var next = path[directory.Length];
        return next is '\\' or '/';
    }

    /// <summary>
    /// Filename <b>and</b> signer, never either alone.
    /// </summary>
    /// <remarks>
    /// An unverifiable signer does not exclude. Stated in <see cref="LauncherEntry"/> and
    /// repeated here because it is the branch someone will later "fix" into a filename match:
    /// doing so would silently exclude any game that ships a binary sharing a name with a
    /// launcher.
    /// </remarks>
    private bool IsKnownLauncher(GameCandidate candidate)
    {
        if (candidate.SignerSubject is not { Length: > 0 } signer) return false;

        var fileName = FileNameOf(candidate.ImagePath);

        foreach (var launcher in _launchers)
        {
            if (!fileName.Equals(launcher.FileName, StringComparison.OrdinalIgnoreCase)) continue;
            if (signer.Contains(launcher.SignerSubjectContains, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static string FileNameOf(string path)
    {
        var slash = path.LastIndexOfAny(['\\', '/']);
        return slash < 0 ? path : path[(slash + 1)..];
    }

    /// <summary>Gate B. All three, held for the sustain window.</summary>
    private DetectionResult Accumulate(GameCandidate candidate)
    {
        if (_watchingPid != candidate.ProcessId)
        {
            _watchingPid = candidate.ProcessId;
            _foregroundSince = candidate.At;
            _positiveHeld = false;
        }

        if (!candidate.IsForeground)
        {
            // Dwell is time held continuously. A candidate that loses the foreground starts
            // again rather than banking the seconds it had.
            _foregroundSince = candidate.At;
            _positiveHeld = false;
        }

        var dwellMet = candidate.IsForeground
            && candidate.At - _foregroundSince >= _options.ForegroundDwell;

        // Null is not zero and is not "below threshold": a signal we could not read has not been
        // met, and cannot be met by the other two.
        var threeDNow = candidate.ThreeDUtilizationPercent is { } gpu
            && gpu >= _options.MinimumThreeDPercent;

        var presentNow = candidate.PresentRateHz is { } hz
            && hz >= _options.MinimumPresentRateHz;

        if (threeDNow && presentNow)
        {
            if (!_positiveHeld)
            {
                _positiveHeld = true;
                _positiveSince = candidate.At;
            }
        }
        else
        {
            _positiveHeld = false;
        }

        var sustained = _positiveHeld && candidate.At - _positiveSince >= _options.SustainedFor;

        var progress = new GateBProgress(dwellMet, sustained && threeDNow, sustained && presentNow);

        if (!progress.AllMet)
        {
            return new DetectionResult(
                GameDetectionState.Watching, null, ExclusionReason.None, progress,
                Changed(GameDetectionState.Watching));
        }

        _confirmedPid = candidate.ProcessId;
        _lastSeen = candidate.At;
        _everSeen = true;

        return new DetectionResult(
            GameDetectionState.Playing, _confirmedPid, ExclusionReason.None, progress,
            Changed(GameDetectionState.Playing));
    }

    private DetectionResult ContinueConfirmed(GameCandidate candidate)
    {
        _lastSeen = candidate.At;
        _everSeen = true;

        var next = candidate.IsForeground
            ? GameDetectionState.Playing
            : GameDetectionState.Background;

        var changed = Changed(next);

        return new DetectionResult(
            next, _confirmedPid, ExclusionReason.None,
            new GateBProgress(true, true, true), changed);
    }

    private bool Changed(GameDetectionState next)
    {
        var changed = _state != next;
        _state = next;
        return changed;
    }

    private DetectionResult Unchanged() =>
        new(_state, _confirmedPid, ExclusionReason.None,
            _confirmedPid is null ? default : new GateBProgress(true, true, true), false);

    /// <summary>
    /// Forgets the candidate being watched.
    /// </summary>
    /// <remarks>
    /// Clearing the watched pid is what resets the dwell clock: the next observation of the same
    /// process starts it again from that moment. Leaving it set would let a candidate bank the
    /// seconds it held before an exclusion, a focus change, or a stretch with no foreground at
    /// all — and confirm on time it was not actually in front.
    /// </remarks>
    private void ResetWatch()
    {
        _watchingPid = null;
        _positiveHeld = false;
        _everSeen = false;
    }
}
