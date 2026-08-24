using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Pipeline.Attribution;

/// <summary>
/// One observation of a process that might be a game.
/// </summary>
/// <remarks>
/// <para>
/// Every measurement is nullable, and null means "we could not read this", never zero. A process
/// whose 3D utilization could not be read is not a process doing no 3D work, and treating the
/// two alike would confirm a game on evidence that was never gathered.
/// </para>
/// <para>
/// Assembled by the platform layer from three different sources — the foreground window, the GPU
/// engine counters, and our own frame collector — because no single source knows all three.
/// </para>
/// </remarks>
/// <param name="ProcessId">The process this observation is about.</param>
/// <param name="ImagePath">Full path to the executable, as the OS reports it.</param>
/// <param name="SignerSubject">
/// Authenticode signer subject, or null when the image is unsigned or the signature could not be
/// checked. The two are deliberately not distinguished here: neither one identifies the binary,
/// and the deny-list requires a positive identification to exclude anything.
/// </param>
/// <param name="IsForeground">Whether this process owned the foreground window at this instant.</param>
/// <param name="ThreeDUtilizationPercent">
/// Sustained <c>engtype_3D</c> utilization attributable to this process, or null when the GPU
/// engine counters are unavailable.
/// </param>
/// <param name="PresentRateHz">
/// Present rate for this process from our own frame collector, or null when we are not receiving
/// frames for it. This is the signal that separates a game from an application that merely holds
/// the foreground and touches the GPU.
/// </param>
/// <param name="At">When the observation was taken.</param>
public readonly record struct GameCandidate(
    int ProcessId,
    string ImagePath,
    string? SignerSubject,
    bool IsForeground,
    double? ThreeDUtilizationPercent,
    double? PresentRateHz,
    MonotonicTimestamp At);

/// <summary>Why a candidate was excluded before any positive evidence was considered.</summary>
/// <remarks>
/// Gate A of ADR 0003. These are unoverridable: no amount of foreground dwell, GPU work or
/// present rate promotes an excluded process, because each of these describes something that is
/// definitionally not the user's game.
/// </remarks>
public enum ExclusionReason : byte
{
    /// <summary>Not excluded.</summary>
    None = 0,

    /// <summary>The image lives under the Windows directory.</summary>
    SystemImage = 1,

    /// <summary>It is us. Measuring ourselves would make our own overhead the subject.</summary>
    OwnProcess = 2,

    /// <summary>A known launcher, identified by filename <b>and</b> signer.</summary>
    KnownLauncher = 3,

    /// <summary>
    /// The system directory is not known, so the first exclusion cannot be evaluated.
    /// </summary>
    /// <remarks>
    /// Fails closed. An earlier component in this codebase treated an unreadable system path as
    /// "nothing is under it" and would have happily operated on system binaries; the same
    /// mistake here would attach the profiler to a Windows process and report its frame pacing
    /// as the user's game.
    /// </remarks>
    UnknownSystemRoot = 4,
}

/// <summary>
/// A launcher that must never be mistaken for the game it starts.
/// </summary>
/// <remarks>
/// <para>
/// Matched on filename <b>and</b> signer subject, per ADR 0003. Filename alone would let a game
/// shipping <c>launcher.exe</c> be silently excluded, and would let anything renamed to
/// <c>steam.exe</c> ride the list. Requiring both means an entry only ever excludes the actual
/// vendor binary.
/// </para>
/// <para>
/// The cost, stated rather than hidden: an unsigned or unverifiable copy of a real launcher is
/// <b>not</b> excluded. That is the deliberate direction to fail. Measuring a launcher wastes a
/// session and is visible on screen; excluding a real game because its signature could not be
/// read would silently measure nothing at all.
/// </para>
/// </remarks>
/// <param name="FileName">Executable file name, compared case-insensitively.</param>
/// <param name="SignerSubjectContains">
/// A fragment that must appear in the signer subject. A fragment rather than the whole subject
/// because the full distinguished name carries an address and an incorporation state, and those
/// change without the publisher changing.
/// </param>
public readonly record struct LauncherEntry(string FileName, string SignerSubjectContains);

/// <summary>
/// The launchers FrameDoctor knows about.
/// </summary>
/// <remarks>
/// Short on purpose, and not a general-purpose blocklist. Every entry is here because it is a
/// process that stays running, holds the foreground, and does sustained 3D work while a game is
/// launched from it — which is to say, one that would otherwise pass Gate B. A launcher that
/// does not do that does not need an entry, because the conjunction already declines it.
/// </remarks>
public static class KnownLaunchers
{
    public static IReadOnlyList<LauncherEntry> Default { get; } =
    [
        // Big Picture Mode is fullscreen, sustained 3D, and holds the foreground — it passes
        // every positive signal there is. When a game starts from it, the game is a different
        // process with its own foreground window, and that is what gets detected.
        new("steam.exe", "Valve"),
        new("steamwebhelper.exe", "Valve"),
        new("EpicGamesLauncher.exe", "Epic Games"),
        new("Battle.net.exe", "Blizzard"),
        new("GalaxyClient.exe", "GOG"),
        new("Origin.exe", "Electronic Arts"),
        new("EADesktop.exe", "Electronic Arts"),
        new("UbisoftConnect.exe", "Ubisoft"),
        new("upc.exe", "Ubisoft"),
    ];
}
