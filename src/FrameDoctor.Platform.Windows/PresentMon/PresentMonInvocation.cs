using System.Globalization;
using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Platform.Windows.PresentMon;

/// <summary>
/// How PresentMon is invoked, and how its failures are read.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately free of process management so it can be tested where PresentMon cannot run. The
/// part that matters is not spawning a child — it is turning an exit code and a line of stderr
/// into an honest <see cref="UnavailableReason"/>, and that logic is where a wrong answer sends
/// the user to reinstall a driver over a group-membership problem.
/// </para>
/// </remarks>
public static class PresentMonInvocation
{
    /// <summary>ETW session name FrameDoctor owns.</summary>
    /// <remarks>
    /// Named rather than defaulted so a stale session from a crashed run is identifiable and
    /// can be stopped, instead of colliding with an unrelated tool's "PresentMon" session.
    /// </remarks>
    public const string SessionName = "FrameDoctor";

    /// <summary>
    /// Builds the pinned argument list for a target process.
    /// </summary>
    /// <remarks>
    /// Pinned by ADR 0002. Each flag earns its place:
    /// <list type="bullet">
    ///   <item><c>--process_id</c> scopes the capture to the game, not the whole desktop.</item>
    ///   <item><c>--output_stdout</c> streams CSV to a pipe, avoiding a temp file per session.</item>
    ///   <item><c>--qpc_time</c> emits raw counter ticks on the same timebase as our own clock,
    ///     so frames need no conversion through a formatted time and lose no precision.</item>
    ///   <item><c>--stop_existing_session</c> recovers from our own previous crash.</item>
    ///   <item><c>--terminate_on_proc_exit</c> means the child cannot outlive the game.</item>
    ///   <item><c>--no_track_input</c> declines input-to-photon latency, which needs a
    ///     system-wide input hook FrameDoctor has no reason to install.</item>
    /// </list>
    /// The metric-vocabulary flags are deliberately absent: <c>--v1_metrics</c> and
    /// <c>--v2_metrics</c> each drop columns the diagnostics use.
    /// </remarks>
    public static string[] BuildArguments(int targetProcessId)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(targetProcessId);

        return
        [
            "--process_id", targetProcessId.ToString(CultureInfo.InvariantCulture),
            "--output_stdout",
            "--qpc_time",
            "--session_name", SessionName,
            "--stop_existing_session",
            "--terminate_on_proc_exit",
            "--no_track_input",
        ];
    }

    /// <summary>Why a PresentMon run ended, in FrameDoctor's terms.</summary>
    /// <param name="IsFault">Whether this needs to be surfaced as a broken frame source.</param>
    /// <param name="Reason">The reason to attach to unavailable frame-time samples.</param>
    /// <param name="Detail">One sentence for the user, not a copy of the child's stderr.</param>
    public readonly record struct Outcome(bool IsFault, UnavailableReason Reason, string Detail)
    {
        public static readonly Outcome Clean =
            new(false, UnavailableReason.None, string.Empty);
    }

    /// <summary>
    /// Classifies a finished PresentMon run.
    /// </summary>
    /// <param name="exitCode">The child's exit code.</param>
    /// <param name="stderrText">Everything the child wrote to stderr, possibly empty.</param>
    /// <param name="targetStillRunning">
    /// Whether the game is still running. This is the authoritative signal, not the child's exit
    /// code: PresentMon detects target exit through a kernel provider whose enable it tolerates
    /// failing, so on a locked-down machine <c>--terminate_on_proc_exit</c> may never fire.
    /// </param>
    public static Outcome Classify(int exitCode, string stderrText, bool targetStillRunning)
    {
        ArgumentNullException.ThrowIfNull(stderrText);

        // Windows reports an unhandled exception by returning its code, all of which are above
        // this line. A crash is never a clean exit no matter what the game is doing.
        if ((uint)exitCode >= 0xC000_0000u)
        {
            return new Outcome(
                true,
                UnavailableReason.SourceFaulted,
                $"The frame-timing helper crashed (0x{(uint)exitCode:X8}). Frame data stopped here.");
        }

        switch (exitCode)
        {
            case 0 when !targetStillRunning:
                return Outcome.Clean;

            case 0:
                // A clean exit while the game is still presenting means something stopped the
                // child that was not the game ending. Restarting in a loop would hide it.
                return new Outcome(
                    true,
                    UnavailableReason.SourceFaulted,
                    "The frame-timing helper stopped while the game was still running.");

            case 1:
                // Argument parsing or the NVIDIA manifest. The first is our bug; the second is
                // a broken driver install. They are indistinguishable from the exit code alone.
                return new Outcome(
                    true,
                    UnavailableReason.SourceFaulted,
                    "The frame-timing helper rejected its own start-up. This is a FrameDoctor bug " +
                    "unless the display driver is mid-install.");

            case 6:
                return ClassifySessionStartFailure(stderrText);

            default:
                return new Outcome(
                    true,
                    UnavailableReason.SourceFaulted,
                    $"The frame-timing helper exited with code {exitCode}.");
        }
    }

    /// <summary>
    /// Reads the one exit code that has several genuinely different causes.
    /// </summary>
    /// <remarks>
    /// Exit 6 covers every trace-session start failure, and the three that matter to a user need
    /// three different answers: join a group, close an overlay, or nothing at all. Only the
    /// stderr text separates them, and for the provider-slot case upstream prints a bare error
    /// number with no distinguishing words — hence the numeric match.
    /// </remarks>
    private static Outcome ClassifySessionStartFailure(string stderrText)
    {
        if (stderrText.Contains("access denied", StringComparison.OrdinalIgnoreCase))
        {
            var mentionsGroup = stderrText.Contains("Performance Log Users", StringComparison.OrdinalIgnoreCase);

            return new Outcome(
                true,
                UnavailableReason.InsufficientPrivilege,
                mentionsGroup
                    ? "Frame timing needs your account to be in the Windows \"Performance Log Users\" " +
                      "group, or FrameDoctor to be run as administrator."
                    : "Windows refused the frame-timing trace session even though the account looks " +
                      "eligible. A policy or another security product is blocking it.");
        }

        // ERROR_NO_SYSTEM_RESOURCES. Windows allows a limited number of concurrent sessions per
        // provider, and overlays hold them; upstream surfaces only the raw number.
        if (stderrText.Contains("error code 1450", StringComparison.OrdinalIgnoreCase))
        {
            return new Outcome(
                true,
                UnavailableReason.EtwProviderSlotsExhausted,
                "Windows has no free tracing slots for frame timing. Another overlay or capture " +
                "tool is holding them — closing it frees one.");
        }

        if (stderrText.Contains("already running", StringComparison.OrdinalIgnoreCase))
        {
            return new Outcome(
                true,
                UnavailableReason.SourceFaulted,
                "A previous FrameDoctor tracing session is still running and could not be stopped.");
        }

        return new Outcome(
            true,
            UnavailableReason.SourceFaulted,
            "The frame-timing trace session could not be started.");
    }

    /// <summary>
    /// Whether a stderr line is one of the warnings that occur on every healthy run.
    /// </summary>
    /// <remarks>
    /// PresentMon warns on every unelevated start that it cannot name short-lived processes.
    /// FrameDoctor runs unelevated by design (invariant 6), so treating that line as a problem
    /// would put a permanent false fault in front of the user.
    /// </remarks>
    public static bool IsExpectedWarning(ReadOnlySpan<char> line)
    {
        var trimmed = line.Trim();
        if (!trimmed.StartsWith("warning:", StringComparison.OrdinalIgnoreCase)) return false;

        return trimmed.Contains("elevated privilege", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("will be stopped", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("ETW buffers were lost", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("ETW events were lost", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("overflowed present events", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Whether a stderr line reports lost ETW data.
    /// </summary>
    /// <remarks>
    /// Expected, in the sense that it does not stop the run — and still a measurement problem.
    /// Lost events mean missing frames, and missing frames in a frame-pacing tool look exactly
    /// like a smooth session. Samples spanning such a run are marked
    /// <see cref="Quality.Degraded"/> rather than silently trusted.
    /// </remarks>
    public static bool ReportsLostData(ReadOnlySpan<char> line)
    {
        var trimmed = line.Trim();
        return trimmed.Contains("were lost", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("overflowed present events", StringComparison.OrdinalIgnoreCase);
    }
}
