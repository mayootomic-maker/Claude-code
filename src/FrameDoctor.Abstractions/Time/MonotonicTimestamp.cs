namespace FrameDoctor.Abstractions.Time;

/// <summary>
/// A point in time measured from the session epoch on a monotonic clock.
/// </summary>
/// <remarks>
/// <para>
/// Telemetry is never timestamped with wall-clock time. A machine that suspends mid-session,
/// or has its clock stepped by NTP or a daylight-saving change, produces negative or wildly
/// inflated intervals in a wall-clock series — and correlating a 142 ms stutter against
/// telemetry that jumped an hour sideways yields confident nonsense.
/// </para>
/// <para>
/// Wall-clock time is stored once per session as an anchor, purely for display. This type is
/// deliberately not convertible to <see cref="DateTime"/> without going through that anchor,
/// so the conversion is always explicit and always re-anchorable.
/// </para>
/// </remarks>
public readonly record struct MonotonicTimestamp(long Ticks) : IComparable<MonotonicTimestamp>
{
    /// <summary>Ticks per second, matching <see cref="TimeSpan"/> (100 ns resolution).</summary>
    public const long TicksPerSecond = TimeSpan.TicksPerSecond;

    /// <summary>The session epoch.</summary>
    public static MonotonicTimestamp Zero => new(0);

    public TimeSpan SinceEpoch => TimeSpan.FromTicks(Ticks);

    public static MonotonicTimestamp FromMilliseconds(double ms) =>
        new((long)(ms * TimeSpan.TicksPerMillisecond));

    public double TotalMilliseconds => (double)Ticks / TimeSpan.TicksPerMillisecond;

    public static TimeSpan operator -(MonotonicTimestamp a, MonotonicTimestamp b) =>
        TimeSpan.FromTicks(a.Ticks - b.Ticks);

    public static MonotonicTimestamp operator +(MonotonicTimestamp t, TimeSpan d) =>
        new(t.Ticks + d.Ticks);

    public static MonotonicTimestamp operator -(MonotonicTimestamp t, TimeSpan d) =>
        new(t.Ticks - d.Ticks);

    public static bool operator <(MonotonicTimestamp a, MonotonicTimestamp b) => a.Ticks < b.Ticks;
    public static bool operator >(MonotonicTimestamp a, MonotonicTimestamp b) => a.Ticks > b.Ticks;
    public static bool operator <=(MonotonicTimestamp a, MonotonicTimestamp b) => a.Ticks <= b.Ticks;
    public static bool operator >=(MonotonicTimestamp a, MonotonicTimestamp b) => a.Ticks >= b.Ticks;

    public int CompareTo(MonotonicTimestamp other) => Ticks.CompareTo(other.Ticks);

    public override string ToString() => $"+{TotalMilliseconds:F3}ms";
}
