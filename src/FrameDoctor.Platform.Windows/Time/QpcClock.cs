using System.Diagnostics;
using System.Runtime.Versioning;
using FrameDoctor.Abstractions.Time;

namespace FrameDoctor.Platform.Windows.Time;

/// <summary>
/// Converts raw <c>QueryPerformanceCounter</c> ticks to session time.
/// </summary>
/// <remarks>
/// Separated from the clock itself because the arithmetic is the part that can be wrong, and it
/// is wrong in ways that only appear after the session has been running a while.
/// </remarks>
public static class QpcConversion
{
    /// <summary>
    /// Converts a counter delta to <see cref="MonotonicTimestamp"/> ticks (100 ns).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Done in <see cref="Int128"/> and not in <see cref="long"/>. On a 10 MHz counter — the
    /// value modern Windows reports — <c>delta * 10_000_000</c> overflows a signed 64-bit
    /// integer after about 29 seconds of session time, and the result silently becomes negative
    /// rather than throwing. Every frame time computed from it would then be nonsense, and the
    /// nonsense starts half a minute into a session, which is exactly late enough to pass a
    /// quick manual test.
    /// </para>
    /// <para>
    /// Also not done in <see cref="double"/>. At 10 MHz a double loses sub-100 ns exactness
    /// after roughly two and a half hours, and the on-disk frame codec encodes second
    /// differences of these integers — a value that fails to round-trip corrupts every
    /// subsequent timestamp in the segment, not just its own.
    /// </para>
    /// </remarks>
    /// <param name="qpcDelta">
    /// Counter ticks since the session epoch. May be negative: PresentMon's trace session can
    /// begin before FrameDoctor's epoch and flush a frame that started earlier.
    /// </param>
    /// <param name="qpcFrequency">Counter frequency, fixed at boot.</param>
    public static long DeltaToTicks(long qpcDelta, long qpcFrequency)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(qpcFrequency);

        return (long)((Int128)qpcDelta * MonotonicTimestamp.TicksPerSecond / qpcFrequency);
    }

    /// <summary>
    /// Converts an absolute counter reading to a session timestamp, clamping at the epoch.
    /// </summary>
    /// <param name="qpc">The reading.</param>
    /// <param name="epochQpc">The counter value at the session epoch.</param>
    /// <param name="qpcFrequency">Counter frequency.</param>
    /// <param name="precededEpoch">
    /// Set when the reading was earlier than the epoch and had to be clamped. Counted rather
    /// than ignored: a steady stream of these means the epoch is wrong, and clamping would
    /// otherwise pile frames onto timestamp zero and manufacture a burst of impossible
    /// zero-length frames.
    /// </param>
    public static MonotonicTimestamp ToTimestamp(
        ulong qpc,
        ulong epochQpc,
        long qpcFrequency,
        out bool precededEpoch)
    {
        // Unsigned subtraction would wrap; the difference is taken in signed space on purpose.
        var delta = unchecked((long)qpc - (long)epochQpc);
        precededEpoch = delta < 0;
        return new MonotonicTimestamp(precededEpoch ? 0 : DeltaToTicks(delta, qpcFrequency));
    }
}

/// <summary>
/// The session clock, backed by <c>QueryPerformanceCounter</c>.
/// </summary>
/// <remarks>
/// <para>
/// Uses <see cref="Stopwatch"/>, which is <c>QueryPerformanceCounter</c> on Windows and exposes
/// the same frequency, rather than a P/Invoke that would add nothing. What matters is that the
/// raw counter value is reachable, because PresentMon reports frame times in raw counter ticks
/// on the same system-wide timebase and any conversion in between would lose precision.
/// </para>
/// <para>
/// The wall-clock anchor is captured once and re-anchored explicitly. It exists for display and
/// never for measurement: a session's intervals are computed from the counter alone, so a user
/// changing their clock mid-session cannot alter a single stored frame time.
/// </para>
/// </remarks>
[SupportedOSPlatform("windows")]
public sealed class QpcMonotonicClock : IMonotonicClock
{
    private readonly long _epochQpc;
    private DateTimeOffset _epochUtc;

    public QpcMonotonicClock()
    {
        // Order matters: take the counter first, so the wall-clock anchor is never earlier than
        // the epoch it is anchoring.
        _epochQpc = Stopwatch.GetTimestamp();
        _epochUtc = DateTimeOffset.UtcNow;
    }

    /// <summary>Counter frequency in ticks per second, fixed at boot.</summary>
    public static long Frequency => Stopwatch.Frequency;

    /// <summary>The raw counter value at the session epoch.</summary>
    /// <remarks>Needed to convert PresentMon's raw counter timestamps into session time.</remarks>
    public ulong EpochQpc => unchecked((ulong)_epochQpc);

    public MonotonicTimestamp Now =>
        new(QpcConversion.DeltaToTicks(Stopwatch.GetTimestamp() - _epochQpc, Stopwatch.Frequency));

    public DateTimeOffset EpochUtc => _epochUtc;

    public DateTimeOffset ToUtc(MonotonicTimestamp timestamp) => _epochUtc + timestamp.SinceEpoch;

    /// <summary>
    /// Re-anchors the display clock after the system time was stepped.
    /// </summary>
    /// <remarks>
    /// Called by the discontinuity detector, never on a timer. Re-anchoring changes what stored
    /// timestamps <i>display</i> as and nothing about what they measure, which is why it is safe
    /// to do at all.
    /// </remarks>
    public void ReanchorWallClock()
    {
        var nowQpc = Stopwatch.GetTimestamp();
        var elapsed = TimeSpan.FromTicks(
            QpcConversion.DeltaToTicks(nowQpc - _epochQpc, Stopwatch.Frequency));
        _epochUtc = DateTimeOffset.UtcNow - elapsed;
    }
}
