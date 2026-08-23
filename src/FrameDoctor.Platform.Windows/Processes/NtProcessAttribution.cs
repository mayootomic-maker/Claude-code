using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Platform.Windows.Processes;

/// <summary>One process's cumulative CPU time, from a single enumeration.</summary>
/// <param name="ProcessId">The process.</param>
/// <param name="Name">Image name, or empty when the process would not name itself.</param>
/// <param name="CpuTicks">Kernel plus user time in 100 ns units, since the process started.</param>
public readonly record struct ProcessCpuSnapshot(int ProcessId, string Name, long CpuTicks);

/// <summary>
/// Turning two process enumerations into a CPU share per process.
/// </summary>
/// <remarks>
/// Pure arithmetic, kept away from the P/Invoke so it can be tested on a machine with no
/// processes to enumerate. The subtleties it exists for are all about processes that appear or
/// vanish between the two readings, which is the common case on a busy desktop and the easiest
/// way to publish a nonsense percentage.
/// </remarks>
public static class ProcessCpuDelta
{
    /// <summary>
    /// Computes each process's share of the machine's CPU between two enumerations.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Expressed as a percentage of one machine's worth of CPU, not of one core: a process using
    /// four saturated cores of a sixteen-thread machine reports 25 %, which is the number that
    /// composes with total CPU load. Reporting 400 % would be defensible and would make every
    /// comparison in the diagnostic engine wrong.
    /// </para>
    /// <para>
    /// A process present in only one of the two readings is skipped, not assumed to have started
    /// at zero. A process that exited mid-interval would otherwise appear to have used its
    /// entire lifetime's CPU during that interval, which on a long-running process is thousands
    /// of percent and would name the wrong culprit every time.
    /// </para>
    /// </remarks>
    /// <param name="before">The earlier enumeration.</param>
    /// <param name="after">The later enumeration.</param>
    /// <param name="elapsed">Wall time between them.</param>
    /// <param name="logicalProcessorCount">Used to normalise to whole-machine percent.</param>
    /// <param name="minimumPercent">
    /// Processes below this are dropped. Publishing every idle process on the machine would put
    /// a few hundred near-zero series into a correlation window for nothing.
    /// </param>
    public static List<(int ProcessId, string Name, double CpuPercent)> Compute(
        IReadOnlyList<ProcessCpuSnapshot> before,
        IReadOnlyList<ProcessCpuSnapshot> after,
        TimeSpan elapsed,
        int logicalProcessorCount,
        double minimumPercent = 1.0)
    {
        ArgumentNullException.ThrowIfNull(before);
        ArgumentNullException.ThrowIfNull(after);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(logicalProcessorCount);

        var result = new List<(int, string, double)>();
        if (elapsed <= TimeSpan.Zero) return result;

        var capacityTicks = elapsed.Ticks * (double)logicalProcessorCount;
        if (!(capacityTicks > 0)) return result;

        var earlier = new Dictionary<int, long>(before.Count);
        foreach (var snapshot in before) earlier[snapshot.ProcessId] = snapshot.CpuTicks;

        foreach (var snapshot in after)
        {
            if (!earlier.TryGetValue(snapshot.ProcessId, out var previousTicks)) continue;

            var used = snapshot.CpuTicks - previousTicks;

            // A process id reused by a new process between the readings produces a negative
            // delta. There is no correct value to publish for it, so it is dropped rather than
            // clamped to zero, which would claim the process was idle.
            if (used < 0) continue;

            var percent = used / capacityTicks * 100.0;
            if (percent < minimumPercent) continue;

            result.Add((snapshot.ProcessId, snapshot.Name, Math.Min(percent, 100.0)));
        }

        result.Sort((a, b) => b.Item3.CompareTo(a.Item3));
        return result;
    }
}

/// <summary>
/// The native process enumeration.
/// </summary>
/// <remarks>
/// <c>NtQuerySystemInformation</c> is documented as subject to change between releases, and the
/// documented alternatives cannot return every process's CPU time in one call. The mitigation is
/// the one Microsoft asks for: the call is made through a single wrapper, its result is treated
/// as advisory, and a failure disables process attribution for the session rather than failing
/// the session.
/// </remarks>
[SupportedOSPlatform("windows")]
internal static partial class ProcessEnumerationNative
{
    private const int SystemProcessInformation = 5;
    private const uint StatusInfoLengthMismatch = 0xC000_0004;
    private const int StatusSuccess = 0;

    [LibraryImport("ntdll.dll")]
    private static unsafe partial uint NtQuerySystemInformation(
        int systemInformationClass,
        void* systemInformation,
        uint systemInformationLength,
        uint* returnLength);

    /// <summary>
    /// The head of each SYSTEM_PROCESS_INFORMATION entry, up to the fields FrameDoctor reads.
    /// </summary>
    /// <remarks>
    /// Only the prefix is declared. The full structure continues with per-thread entries and
    /// fields that have changed between Windows releases; walking it by <c>NextEntryOffset</c>
    /// and reading only the stable prefix is what keeps this from breaking on an update.
    /// </remarks>
    [StructLayout(LayoutKind.Sequential)]
    private struct SystemProcessInformationHeader
    {
        public uint NextEntryOffset;
        public uint NumberOfThreads;
        public long WorkingSetPrivateSize;
        public uint HardFaultCount;
        public uint NumberOfThreadsHighWatermark;
        public ulong CycleTime;
        public long CreateTime;
        public long UserTime;
        public long KernelTime;

        // UNICODE_STRING ImageName
        public ushort ImageNameLength;
        public ushort ImageNameMaximumLength;
        private readonly uint _padding;
        public nint ImageNameBuffer;

        public int BasePriority;
        public nint UniqueProcessId;
        public nint InheritedFromUniqueProcessId;
    }

    /// <summary>
    /// Enumerates every process's cumulative CPU time.
    /// </summary>
    /// <returns><see langword="null"/> when the call failed; the caller disables attribution.</returns>
    internal static unsafe List<ProcessCpuSnapshot>? Enumerate()
    {
        // The required size changes between the query and the call, because processes start and
        // exit. Growing on mismatch is the documented pattern; the attempt cap stops a machine
        // churning processes from spinning here forever.
        var length = 512 * 1024u;

        for (var attempt = 0; attempt < 6; attempt++)
        {
            var buffer = GC.AllocateUninitializedArray<byte>((int)length, pinned: true);

            fixed (byte* p = buffer)
            {
                uint returned = 0;
                var status = NtQuerySystemInformation(SystemProcessInformation, p, length, &returned);

                if (status == StatusInfoLengthMismatch)
                {
                    length = Math.Max(returned + (64 * 1024), length * 2);
                    continue;
                }

                if (status != StatusSuccess) return null;

                return Walk(p, returned == 0 ? length : returned);
            }
        }

        return null;
    }

    private static unsafe List<ProcessCpuSnapshot> Walk(byte* buffer, uint length)
    {
        var snapshots = new List<ProcessCpuSnapshot>(256);
        var offset = 0u;

        while (offset + (uint)sizeof(SystemProcessInformationHeader) <= length)
        {
            var entry = (SystemProcessInformationHeader*)(buffer + offset);

            var name = entry->ImageNameBuffer != 0 && entry->ImageNameLength > 0
                ? new string((char*)entry->ImageNameBuffer, 0, entry->ImageNameLength / 2)
                : string.Empty;

            snapshots.Add(new ProcessCpuSnapshot(
                (int)entry->UniqueProcessId,
                name,
                entry->KernelTime + entry->UserTime));

            // A zero next-offset marks the last entry. Without this check the walk runs off the
            // end of the buffer into whatever follows it.
            if (entry->NextEntryOffset == 0) break;
            offset += entry->NextEntryOffset;
        }

        return snapshots;
    }
}
