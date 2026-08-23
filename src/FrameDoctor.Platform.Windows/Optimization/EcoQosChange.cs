using System.Globalization;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using FrameDoctor.Optimization;

namespace FrameDoctor.Platform.Windows.Optimization;

/// <summary>
/// Windows' own quality-of-service throttle, applied to one background process.
/// </summary>
/// <remarks>
/// <para>
/// The only system mutation FrameDoctor ships. It is documented, it is reversible through a
/// documented reset, and it needs nothing more than <c>PROCESS_SET_INFORMATION</c> on a
/// same-user target — no elevation, no driver, no undocumented call.
/// </para>
/// <para>
/// What it does is ask the scheduler to prefer efficiency over speed for that process. It does
/// not suspend it, does not change its priority class, and does not touch its affinity. Those
/// are the mechanisms that make a "booster" break things, and the reason this one is shippable
/// is that Windows itself offers it as a supported setting with a supported way to undo it.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: the calls here cannot execute on the Linux container this
/// repository is developed in. Everything around them — the journal, the eligibility rules, the
/// apply ordering and the compare-and-restore decision — is tested there.
/// </para>
/// </remarks>

/// <summary>
/// The vocabulary of process throttling states, and the mapping to Windows' two flag masks.
/// </summary>
/// <remarks>
/// Deliberately not marked Windows-only, because none of it is: it is the translation between
/// two integers and the three states FrameDoctor tells apart, and it is where a silent mistake
/// changes what happens to a user's machine. Keeping it platform-neutral is what lets it be
/// tested on a machine that cannot make the call.
/// </remarks>
public static class EcoQosState
{
    /// <summary>PROCESS_POWER_THROTTLING_EXECUTION_SPEED.</summary>
    internal const uint ExecutionSpeed = 0x1;

    internal const uint CurrentVersion = 1;

    /// <summary>Windows' value for "this process is throttled for efficiency".</summary>
    public const string Restrained = "eco";

    /// <summary>Windows' value for "the system decides", which is the shipped default.</summary>
    public const string SystemManaged = "system-managed";

    /// <summary>Windows' value for "explicitly not throttled", which a user may have chosen.</summary>
    /// <remarks>
    /// Distinct from <see cref="SystemManaged"/> on purpose. Restoring "system managed" over
    /// someone's explicit "never throttle this" would be overwriting a decision they made.
    /// </remarks>
    public const string NotThrottled = "unthrottled";

    /// <summary>Turns the throttling flags into the three states FrameDoctor distinguishes.</summary>
    public static string Describe(uint controlMask, uint stateMask)
    {
        // Control mask clear means the process is neither opting in nor out: Windows decides.
        // This is the shipped default and the state almost every process is in, and reading it
        // as "explicitly not throttled" would make a later restore write an explicit choice
        // where the user had none.
        if ((controlMask & ExecutionSpeed) == 0) return SystemManaged;

        return (stateMask & ExecutionSpeed) != 0 ? Restrained : NotThrottled;
    }

    /// <summary>Turns one of the three states back into flags.</summary>
    /// <remarks>
    /// An unrecognised value composes to the documented reset rather than to anything of our
    /// choosing: fail-safe, not fail-arbitrary.
    /// </remarks>
    public static (uint ControlMask, uint StateMask) Compose(string value) => value switch
    {
        Restrained => (ExecutionSpeed, ExecutionSpeed),
        NotThrottled => (ExecutionSpeed, 0u),

        // Both masks zero is the documented reset. It hands the decision back to Windows rather
        // than pinning the process to a state we picked.
        _ => (0u, 0u),
    };

    /// <summary>
    /// Builds a target string that cannot be confused with a different process.
    /// </summary>
    /// <remarks>
    /// The start time is what makes this safe. Windows reuses process ids freely, and restoring
    /// a captured value onto a different process holding the same id would be a mutation of an
    /// innocent target — which the compare-and-restore table cannot catch, because the new
    /// process's value would look like a third-party change at best and like our own applied
    /// value at worst.
    /// </remarks>
    public static string TargetFor(int processId, long startTimeTicks) =>
        string.Create(CultureInfo.InvariantCulture, $"pid:{processId}|started:{startTimeTicks}");

    /// <summary>Recovers the process id from a target string.</summary>
    /// <remarks>
    /// Returns false rather than defaulting. A default of zero addresses the System Idle
    /// Process, which is the worst possible place for a stray write to land.
    /// </remarks>
    public static bool TryParseTarget(string target, out uint processId)
    {
        processId = 0;
        if (string.IsNullOrWhiteSpace(target)) return false;

        var start = target.IndexOf("pid:", StringComparison.Ordinal);
        if (start < 0) return false;

        var rest = target.AsSpan(start + 4);
        var end = rest.IndexOf('|');
        var digits = end < 0 ? rest : rest[..end];

        return uint.TryParse(digits, NumberStyles.Integer, CultureInfo.InvariantCulture, out processId);
    }
}

[SupportedOSPlatform("windows")]
public sealed partial class EcoQosChange : IReversibleChange
{
    /// <summary>PROCESS_INFORMATION_CLASS.ProcessPowerThrottling.</summary>
    private const int ProcessPowerThrottling = 4;

    private const uint ProcessSetInformation = 0x0200;
    private const uint ProcessQueryLimitedInformation = 0x1000;

    public string ChangeKind => "process-eco-qos";

    public string RestrainedValue => EcoQosState.Restrained;

    /// <summary>
    /// Reads a process's current throttling state.
    /// </summary>
    /// <remarks>
    /// The distinction between "the process is gone" and "the state could not be read" is carried
    /// out of here deliberately. Reconciliation settles the first and refuses to act on the
    /// second; collapsing them would either leave journal entries forever or restore blindly.
    /// </remarks>
    public CurrentValue Read(string target)
    {
        if (!EcoQosState.TryParseTarget(target, out var processId)) return CurrentValue.Unreadable;

        var handle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (handle == nint.Zero)
        {
            // ERROR_INVALID_PARAMETER from OpenProcess means no such process. Anything else means
            // the process is there and we cannot see it, which is a different situation.
            const int ErrorInvalidParameter = 87;
            return Marshal.GetLastWin32Error() == ErrorInvalidParameter
                ? CurrentValue.Gone
                : CurrentValue.Unreadable;
        }

        try
        {
            var state = new ProcessPowerThrottlingState { Version = EcoQosState.CurrentVersion };

            var size = (uint)Marshal.SizeOf<ProcessPowerThrottlingState>();

            if (!GetProcessInformation(handle, ProcessPowerThrottling, ref state, size))
                return CurrentValue.Unreadable;

            return CurrentValue.Read(EcoQosState.Describe(state.ControlMask, state.StateMask));
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    /// <summary>Writes a throttling state. Only ever called with a journal entry already durable.</summary>
    public bool Write(string target, string value)
    {
        if (!EcoQosState.TryParseTarget(target, out var processId)) return false;

        var handle = OpenProcess(ProcessSetInformation, false, processId);
        if (handle == nint.Zero) return false;

        try
        {
            var (controlMask, stateMask) = EcoQosState.Compose(value);
            var state = new ProcessPowerThrottlingState
            {
                Version = EcoQosState.CurrentVersion,
                ControlMask = controlMask,
                StateMask = stateMask,
            };
            var size = (uint)Marshal.SizeOf<ProcessPowerThrottlingState>();

            return SetProcessInformation(handle, ProcessPowerThrottling, ref state, size);
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct ProcessPowerThrottlingState
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static partial nint OpenProcess(
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        uint processId);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool CloseHandle(nint handle);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetProcessInformation(
        nint process,
        int informationClass,
        ref ProcessPowerThrottlingState information,
        uint size);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetProcessInformation(
        nint process,
        int informationClass,
        ref ProcessPowerThrottlingState information,
        uint size);
}
