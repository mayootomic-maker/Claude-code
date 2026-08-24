using System.Runtime.Versioning;

namespace FrameDoctor.Platform.Windows.Pdh;

/// <summary>
/// Reads per-process 3D engine utilization from the <c>GPU Engine</c> counter object.
/// </summary>
/// <remarks>
/// <para>
/// The instance set changes every time any process starts or stops, because instances are named
/// after the process that owns them. Discovering them means expanding a wildcard path, which on
/// a busy machine returns hundreds of strings — so it is done on a slow cadence and the counters
/// found are held, rather than re-expanded every poll. Putting that cost on the collector's path
/// would make FrameDoctor a plausible cause of the stutters it reports.
/// </para>
/// <para>
/// Once a game is confirmed the cadence slows further: a confirmed process's engine instances do
/// not change, and re-expanding is then paying the whole machine's enumeration cost to learn
/// nothing.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class GpuEngineReader : IDisposable
{
    /// <summary>How often the instance set is rediscovered while hunting for a game.</summary>
    public static readonly TimeSpan HuntingInterval = TimeSpan.FromSeconds(2);

    /// <summary>How often it is rediscovered once a game is confirmed.</summary>
    public static readonly TimeSpan SettledInterval = TimeSpan.FromSeconds(30);

    private readonly TimeProvider _time;
    private readonly List<(string Instance, nint Counter)> _counters = [];

    private nint _query;
    private DateTimeOffset _expandedAt = DateTimeOffset.MinValue;
    private bool _collectedOnce;
    private bool _disposed;

    public GpuEngineReader(TimeProvider? time = null) => _time = time ?? TimeProvider.System;

    /// <summary>Whether the counter object could be opened at all.</summary>
    /// <remarks>
    /// False on a machine whose display driver does not publish the object — some virtual
    /// adapters do not. Reported rather than worked around: Gate B then has a signal it cannot
    /// read, and declines to confirm, which is the correct outcome.
    /// </remarks>
    public bool IsAvailable { get; private set; }

    /// <summary>The last status PDH returned, for the System view.</summary>
    public uint LastStatus { get; private set; }

    /// <summary>Opens the query. Safe to call twice.</summary>
    public bool Open()
    {
        if (_query != 0) return IsAvailable;

        LastStatus = PdhNative.PdhOpenQuery(null, 0, out _query);
        IsAvailable = PdhStatus.IsSuccess(LastStatus) && _query != 0;
        return IsAvailable;
    }

    /// <summary>
    /// Sums 3D utilization for one process, or returns null when it cannot be read.
    /// </summary>
    /// <remarks>
    /// Null covers three different situations — the object is unavailable, the first collect has
    /// not happened yet, and the process has no 3D instance — and they are deliberately the same
    /// answer here, because to the caller they are the same fact: no figure was measured. Zero
    /// would be a claim that the process rendered nothing.
    /// </remarks>
    /// <param name="processId">The process to attribute.</param>
    /// <param name="settled">Whether a game is already confirmed, which slows rediscovery.</param>
    public double? ThreeDUtilizationFor(int processId, bool settled)
    {
        if (!Open()) return null;

        var interval = settled ? SettledInterval : HuntingInterval;
        if (_time.GetUtcNow() - _expandedAt >= interval) Rediscover();

        if (_counters.Count == 0) return null;

        LastStatus = PdhNative.PdhCollectQueryData(_query);
        if (!PdhStatus.IsSuccess(LastStatus)) return null;

        // A rate counter needs two collects before it has an interval to divide by. The first
        // read would otherwise be a formatted zero, which reads as a process doing no work.
        if (!_collectedOnce)
        {
            _collectedOnce = true;
            return null;
        }

        var total = 0.0;
        var found = false;

        foreach (var (instance, counter) in _counters)
        {
            if (!GpuEngineCounters.IsThreeDFor(instance, processId)) continue;

            var status = PdhNative.PdhGetFormattedCounterValue(
                counter, PdhNative.PdhFmtDouble | PdhNative.PdhFmtNoCap100, 0, out var value);

            if (!PdhStatus.IsSuccess(status) || value.CStatus != 0) continue;
            if (!double.IsFinite(value.DoubleValue)) continue;

            total += value.DoubleValue;
            found = true;
        }

        return found ? total : null;
    }

    /// <summary>
    /// Rebuilds the counter set from the instances that exist now.
    /// </summary>
    /// <remarks>
    /// The whole query is closed and reopened rather than adding to it. PDH has no remove-counter
    /// call, so a long session would otherwise accumulate a counter for every process that has
    /// ever rendered anything — and read every one of them on every poll.
    /// </remarks>
    private void Rediscover()
    {
        _expandedAt = _time.GetUtcNow();

        var instances = Expand(GpuEngineCounters.UtilizationCounter);
        if (instances.Count == 0) return;

        Reset();
        if (!Open()) return;

        foreach (var path in instances)
        {
            var instance = GpuEngineCounters.InstanceOf(path);
            if (instance is null) continue;
            if (GpuEngineCounters.Parse(instance) is not { EngineType: GpuEngineCounters.ThreeD })
                continue;

            if (PdhStatus.IsSuccess(PdhNative.PdhAddEnglishCounter(_query, path, 0, out var counter)))
                _counters.Add((instance, counter));
        }
    }

    /// <summary>
    /// Expands a wildcard path into the instance paths that exist.
    /// </summary>
    /// <remarks>
    /// Sized by asking first and allocating second. Guessing a buffer size for a list whose
    /// length depends on how many processes are rendering would either truncate the answer on a
    /// busy machine or allocate for the worst case on every call.
    /// </remarks>
    private static List<string> Expand(string wildCardPath)
    {
        uint length = 0;
        var status = PdhNative.PdhExpandWildCardPath(null, wildCardPath, null, ref length, 0);

        if (status != PdhStatus.MoreData || length == 0) return [];

        var buffer = new char[length];
        status = PdhNative.PdhExpandWildCardPath(null, wildCardPath, buffer, ref length, 0);

        if (!PdhStatus.IsSuccess(status)) return [];

        return GpuEngineCounters.SplitMultiString(buffer, (int)length);
    }

    private void Reset()
    {
        if (_query != 0) _ = PdhNative.PdhCloseQuery(_query);

        _query = 0;
        _counters.Clear();
        _collectedOnce = false;
        IsAvailable = false;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Reset();
    }
}
