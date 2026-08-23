namespace FrameDoctor.Optimization;

/// <summary>What is known about a process before deciding whether it may be restrained.</summary>
/// <param name="ProcessId">The process.</param>
/// <param name="ImageName">Executable file name, lower-cased by the caller or not — matched case-insensitively.</param>
/// <param name="ImagePath">Full path, or null when it could not be read.</param>
/// <param name="IsSameUser">Whether it runs as the current user.</param>
/// <param name="IsForeground">Whether it currently owns the foreground window.</param>
/// <param name="IsGameOrLauncher">Whether game detection identified it as the game or its launcher.</param>
/// <param name="IsOwnProcessTree">Whether it is FrameDoctor or a child of it.</param>
/// <param name="IsVideoEncoding">
/// Whether the process is currently using a video-encode GPU engine.
/// </param>
/// <param name="IsElevated">Whether it runs elevated, which an unelevated FrameDoctor cannot touch.</param>
public readonly record struct ThrottleCandidate(
    int ProcessId,
    string ImageName,
    string? ImagePath,
    bool IsSameUser,
    bool IsForeground,
    bool IsGameOrLauncher,
    bool IsOwnProcessTree,
    bool IsVideoEncoding,
    bool IsElevated);

/// <summary>Why a process may not be restrained.</summary>
public enum ThrottleRefusal
{
    /// <summary>It may be.</summary>
    None = 0,

    /// <summary>Another user's process, or a service account's. Not ours to touch.</summary>
    NotSameUser = 1,

    /// <summary>A Windows component. Restraining these is how a "booster" breaks a machine.</summary>
    SystemComponent = 2,

    /// <summary>On the never-touch list by name.</summary>
    ProtectedByName = 3,

    /// <summary>The game itself, or its launcher.</summary>
    TheGame = 4,

    /// <summary>Whatever the user is looking at. Slowing it is a visible harm.</summary>
    Foreground = 5,

    /// <summary>FrameDoctor's own processes.</summary>
    Ourselves = 6,

    /// <summary>It is encoding video right now.</summary>
    Recording = 7,

    /// <summary>Elevated, and FrameDoctor is not.</summary>
    Elevated = 8,

    /// <summary>Nothing is known about it, which is not a licence to act.</summary>
    Unknown = 9,
}

/// <summary>
/// Deciding which processes may be restrained, and refusing almost all of them.
/// </summary>
/// <remarks>
/// <para>
/// The deny-list is the feature. Anyone can call an API that slows a process down; what makes
/// this safe rather than reckless is the list of things it will not do it to, and that list is
/// written to fail closed — an unknown process is refused, not permitted.
/// </para>
/// <para>
/// The video-encode exclusion matters most. A video encoder is exactly what a naive tool sees as
/// a background CPU offender, and restraining the process that is recording someone's gameplay
/// drops their capture. That is a harm FrameDoctor would be causing, and it is the single most
/// likely way this feature hurts a person.
/// </para>
/// </remarks>
public static class ThrottleEligibility
{
    /// <summary>
    /// Processes that are never restrained regardless of what they are doing.
    /// </summary>
    /// <remarks>
    /// Matched on file name only, which is deliberately weak as a security measure and correct
    /// as a safety measure: a renamed <c>audiodg.exe</c> gets past this, and the same-user,
    /// system-path and elevation gates catch it instead. What this list prevents is the ordinary
    /// case — throttling the audio engine and giving the user crackling sound they will blame on
    /// their headphones.
    /// </remarks>
    private static readonly HashSet<string> NeverThrottle = new(StringComparer.OrdinalIgnoreCase)
    {
        // Audio. Restraining this produces stuttering sound, which a user will attribute to
        // anything except the tool that promised to fix stuttering.
        "audiodg.exe",

        // Service hosts. Anything at all can be inside one.
        "svchost.exe",
        "services.exe",
        "lsass.exe",
        "csrss.exe",
        "wininit.exe",
        "winlogon.exe",
        "dwm.exe",
        "explorer.exe",

        // Anti-cheat and DRM. Interfering with these can get a user banned from a game, which is
        // a harm no frame-time improvement could justify.
        "easyanticheat.exe",
        "eac_launcher.exe",
        "beservice.exe",
        "bedaisy.exe",
        "vgtray.exe",
        "vgc.exe",
        "steamservice.exe",

        // Capture and streaming. Also caught by the video-encode signal, listed here as well
        // because that signal depends on a GPU counter that may be unavailable.
        "obs64.exe",
        "obs32.exe",
        "streamlabs obs.exe",
        "xsplit.core.exe",
        "nvcontainer.exe",
        "action.exe",
        "bdcam.exe",
    };

    /// <summary>Decides whether a process may be restrained, and why not when it may not.</summary>
    /// <param name="candidate">What is known about the process.</param>
    /// <param name="systemRoot">
    /// The Windows directory. Injected so the gate is testable, and required rather than
    /// defaulted-away: when it cannot be determined the candidate is refused, because a gate
    /// that disappears when its input is missing is a gate that fails open.
    /// </param>
    public static ThrottleRefusal Evaluate(in ThrottleCandidate candidate, string? systemRoot = null)
    {
        // Ordered so the most consequential refusals are unreachable past. Anything that would
        // harm the user's machine or their recording is checked before anything about what the
        // process is doing to frame times.
        if (candidate.IsOwnProcessTree) return ThrottleRefusal.Ourselves;
        if (!candidate.IsSameUser) return ThrottleRefusal.NotSameUser;
        if (candidate.IsElevated) return ThrottleRefusal.Elevated;
        if (candidate.IsGameOrLauncher) return ThrottleRefusal.TheGame;
        if (candidate.IsForeground) return ThrottleRefusal.Foreground;
        if (candidate.IsVideoEncoding) return ThrottleRefusal.Recording;

        if (string.IsNullOrWhiteSpace(candidate.ImageName)) return ThrottleRefusal.Unknown;
        if (NeverThrottle.Contains(candidate.ImageName)) return ThrottleRefusal.ProtectedByName;

        // A path that could not be read is not a licence to act. Without it the system-directory
        // test cannot run, and that test is what stands between this feature and a Windows
        // component.
        if (string.IsNullOrWhiteSpace(candidate.ImagePath)) return ThrottleRefusal.Unknown;

        var root = systemRoot ?? Environment.GetFolderPath(Environment.SpecialFolder.Windows);

        // Not knowing where Windows lives is refusal, not permission. This is the one branch
        // where a wrong answer restrains a Windows component, so it fails closed.
        if (string.IsNullOrWhiteSpace(root)) return ThrottleRefusal.Unknown;
        if (IsUnderSystemRoot(candidate.ImagePath, root)) return ThrottleRefusal.SystemComponent;

        return ThrottleRefusal.None;
    }

    /// <summary>Whether a path is inside the Windows directory.</summary>
    /// <remarks>
    /// Compared case-insensitively with a trailing separator, so <c>C:\WindowsApps\game.exe</c>
    /// is not mistaken for something under <c>C:\Windows</c>. The separator is what makes the
    /// prefix test a directory test rather than a string test.
    /// </remarks>
    public static bool IsUnderSystemRoot(string imagePath, string systemRoot)
    {
        ArgumentNullException.ThrowIfNull(imagePath);
        if (string.IsNullOrWhiteSpace(systemRoot)) return false;

        var normalisedRoot = systemRoot.TrimEnd('\\', '/') + '\\';
        return imagePath.StartsWith(normalisedRoot, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>What to tell the user when a process cannot be restrained.</summary>
    public static string Describe(ThrottleRefusal refusal, string imageName) => refusal switch
    {
        ThrottleRefusal.None => string.Empty,
        ThrottleRefusal.NotSameUser =>
            $"{imageName} belongs to another account, so FrameDoctor will not change it.",
        ThrottleRefusal.SystemComponent =>
            $"{imageName} is part of Windows. FrameDoctor never restrains Windows components.",
        ThrottleRefusal.ProtectedByName =>
            $"{imageName} is on the never-restrain list, because slowing it causes visible harm.",
        ThrottleRefusal.TheGame =>
            $"{imageName} is the game, or its launcher.",
        ThrottleRefusal.Foreground =>
            $"{imageName} is what you are looking at right now.",
        ThrottleRefusal.Ourselves => "That is FrameDoctor.",
        ThrottleRefusal.Recording =>
            $"{imageName} is encoding video right now. Restraining it would damage the recording.",
        ThrottleRefusal.Elevated =>
            $"{imageName} runs with administrator rights and FrameDoctor does not.",
        _ =>
            $"FrameDoctor could not learn enough about {imageName} to change it safely.",
    };
}
