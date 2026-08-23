namespace FrameDoctor.Storage.Codecs;

/// <summary>
/// The quantum frame timing is stored at, and the conversions to and from it.
/// </summary>
/// <remarks>
/// <para>
/// 1/64 ms is 15.625 µs. Against a typical QPC tick of ~0.1 µs that is lossy, and deliberately
/// so — it is the single decision that takes the stored series from four bytes per frame to
/// roughly four bits. At 1000 fps it is 1.56 % of a frame time, which is far below anything the
/// detector acts on and far below the resolution any slow sensor can corroborate.
/// </para>
/// <para>
/// The quantum is declared here rather than buried in an encoder because it is a lossy choice
/// the product makes on the user's behalf, and a reader of the format needs to know it exactly.
/// </para>
/// </remarks>
public static class FrameQuantum
{
    /// <summary>Units per millisecond.</summary>
    public const long UnitsPerMillisecond = 64;

    /// <summary>Milliseconds per unit.</summary>
    public const double MillisecondsPerUnit = 1.0 / UnitsPerMillisecond;

    /// <summary>Monotonic ticks (100 ns) per millisecond.</summary>
    private const double TicksPerMillisecond = TimeSpan.TicksPerMillisecond;

    /// <summary>Quantizes a monotonic tick count to storage units.</summary>
    public static long FromTicks(long ticks) =>
        (long)Math.Round(ticks / TicksPerMillisecond * UnitsPerMillisecond, MidpointRounding.AwayFromZero);

    /// <summary>Converts storage units back to monotonic ticks.</summary>
    public static long ToTicks(long units) =>
        (long)Math.Round(units * MillisecondsPerUnit * TicksPerMillisecond, MidpointRounding.AwayFromZero);

    /// <summary>Quantizes a millisecond value to storage units.</summary>
    public static long FromMilliseconds(double milliseconds) =>
        (long)Math.Round(milliseconds * UnitsPerMillisecond, MidpointRounding.AwayFromZero);

    /// <summary>Converts storage units to milliseconds.</summary>
    public static double ToMilliseconds(long units) => units * MillisecondsPerUnit;

    /// <summary>Worst-case error introduced by quantizing a single value, in milliseconds.</summary>
    public const double MaxQuantizationErrorMs = MillisecondsPerUnit / 2.0;
}
