using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Platform.Windows.Memory;

/// <summary>
/// System memory, from two kernel32 calls rather than from performance counters.
/// </summary>
/// <remarks>
/// <para>
/// One call each, no counter handles, no query lifetime, no localization. Where PDH would work
/// equally well this is preferred simply because it cannot fail in the interesting ways PDH can.
/// </para>
/// <para>
/// Commit charge against the commit limit is the number that matters for stutter diagnosis, more
/// than free physical memory: a machine can have gigabytes free and still be paging because the
/// commit limit is close. Both are published.
/// </para>
/// <para>
/// <c>REQUIRES-WINDOWS-VALIDATION</c>: cannot execute on the Linux container this repository is
/// developed in.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed partial class MemorySensorSource : ISensorSource
{
    private const double BytesPerMegabyte = 1024.0 * 1024.0;

    private readonly TimeSpan _interval;
    private bool _available = true;
    private nuint _pageSize = 4096;

    public MemorySensorSource(TimeSpan? interval = null)
    {
        // 1 Hz. Memory pressure builds over seconds, and nothing in the diagnosis needs finer
        // resolution than that — reading it four times a second would buy nothing and cost
        // three more kernel transitions per second for the length of a session.
        _interval = interval ?? TimeSpan.FromSeconds(1);
    }

    public SourceId Id => SourceId.Win32MemoryApi;

    public string DisplayName => "Windows memory manager";

    public IReadOnlyList<MetricId> DeclaredMetrics { get; } =
    [
        MetricId.MemoryTotal,
        MetricId.MemoryAvailable,
        MetricId.MemoryUsed,
        MetricId.MemoryCommitted,
        MetricId.MemoryCommitLimit,
    ];

    public TimeSpan Interval => _interval;

    public int MaxSamplesPerPoll => DeclaredMetrics.Count;

    public ValueTask<SourceProbe> ProbeAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var status = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        var performance = new PerformanceInformation { Size = (uint)Marshal.SizeOf<PerformanceInformation>() };

        var physicalOk = GlobalMemoryStatusEx(ref status);
        var commitOk = GetPerformanceInfo(ref performance, performance.Size);

        if (!physicalOk && !commitOk)
        {
            _available = false;
            return ValueTask.FromResult(SourceProbe.NotWorking(
                Id, DisplayName, UnavailableReason.SourceFaulted,
                "Windows did not report its memory state."));
        }

        if (commitOk) _pageSize = performance.PageSize;

        MetricAvailability Physical(MetricId metric) => physicalOk
            ? MetricAvailability.Available(metric)
            : MetricAvailability.Missing(metric, UnavailableReason.SourceFaulted,
                "Windows did not report physical memory.");

        MetricAvailability Commit(MetricId metric) => commitOk
            ? MetricAvailability.Available(metric)
            : MetricAvailability.Missing(metric, UnavailableReason.SourceFaulted,
                "Windows did not report commit charge.");

        return ValueTask.FromResult(SourceProbe.Working(Id, DisplayName,
        [
            Physical(MetricId.MemoryTotal),
            Physical(MetricId.MemoryAvailable),
            Physical(MetricId.MemoryUsed),
            Commit(MetricId.MemoryCommitted),
            Commit(MetricId.MemoryCommitLimit),
        ]));
    }

    public ValueTask StartAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return ValueTask.CompletedTask;
    }

    public int Poll(MonotonicTimestamp now, Span<TelemetrySample> destination)
    {
        if (destination.Length < MaxSamplesPerPoll)
        {
            throw new ArgumentException(
                $"Needs room for {MaxSamplesPerPoll} samples, got {destination.Length}.",
                nameof(destination));
        }

        var written = 0;

        if (!_available)
        {
            foreach (var metric in DeclaredMetrics)
            {
                destination[written++] = TelemetrySample.Failed(
                    now, metric, Id, UnavailableReason.SourceFaulted, Unit.Megabytes);
            }

            return written;
        }

        var status = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (GlobalMemoryStatusEx(ref status))
        {
            var totalMb = status.TotalPhys / BytesPerMegabyte;
            var availableMb = status.AvailPhys / BytesPerMegabyte;

            destination[written++] = TelemetrySample.Measured(
                now, MetricId.MemoryTotal, Id, totalMb, Unit.Megabytes);
            destination[written++] = TelemetrySample.Measured(
                now, MetricId.MemoryAvailable, Id, availableMb, Unit.Megabytes);

            // Used is total minus available, which is a derivation and is marked as one. It is
            // deliberately not "total minus free": on Windows most of the difference is cache
            // that a program can have back on demand, and calling that "used" is how a tool
            // convinces a user with 32 GB that they are out of memory.
            destination[written++] = TelemetrySample.Measured(
                now, MetricId.MemoryUsed, Id, totalMb - availableMb, Unit.Megabytes,
                Quality.Derived);
        }
        else
        {
            destination[written++] = Failed(now, MetricId.MemoryTotal);
            destination[written++] = Failed(now, MetricId.MemoryAvailable);
            destination[written++] = Failed(now, MetricId.MemoryUsed);
        }

        var performance = new PerformanceInformation { Size = (uint)Marshal.SizeOf<PerformanceInformation>() };
        if (GetPerformanceInfo(ref performance, performance.Size))
        {
            // Reported in pages, not bytes. Publishing the page count as megabytes would
            // understate commit charge by a factor of 256 on a 4 KB page — small enough to look
            // plausible and wrong enough to hide every paging problem there is.
            var pageMb = (double)_pageSize / BytesPerMegabyte;

            destination[written++] = TelemetrySample.Measured(
                now, MetricId.MemoryCommitted, Id, performance.CommitTotal * pageMb, Unit.Megabytes);
            destination[written++] = TelemetrySample.Measured(
                now, MetricId.MemoryCommitLimit, Id, performance.CommitLimit * pageMb, Unit.Megabytes);
        }
        else
        {
            destination[written++] = Failed(now, MetricId.MemoryCommitted);
            destination[written++] = Failed(now, MetricId.MemoryCommitLimit);
        }

        return written;
    }

    private TelemetrySample Failed(MonotonicTimestamp now, MetricId metric) =>
        TelemetrySample.Failed(now, metric, Id, UnavailableReason.SourceFaulted, Unit.Megabytes);

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    /// <remarks>
    /// <c>Length</c> must be set by the caller before the call; the API uses it to tell struct
    /// versions apart and fails outright if it is wrong.
    /// </remarks>
    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    /// <remarks>All the count fields are in pages, not bytes.</remarks>
    [StructLayout(LayoutKind.Sequential)]
    private struct PerformanceInformation
    {
        public uint Size;
        public nuint CommitTotal;
        public nuint CommitLimit;
        public nuint CommitPeak;
        public nuint PhysicalTotal;
        public nuint PhysicalAvailable;
        public nuint SystemCache;
        public nuint KernelTotal;
        public nuint KernelPaged;
        public nuint KernelNonpaged;
        public nuint PageSize;
        public uint HandleCount;
        public uint ProcessCount;
        public uint ThreadCount;
    }

    [LibraryImport("kernel32.dll", EntryPoint = "GlobalMemoryStatusEx")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [LibraryImport("psapi.dll", EntryPoint = "GetPerformanceInfo")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetPerformanceInfo(ref PerformanceInformation buffer, uint size);
}
