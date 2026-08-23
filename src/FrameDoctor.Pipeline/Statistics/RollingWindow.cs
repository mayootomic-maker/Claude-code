namespace FrameDoctor.Pipeline.Statistics;

/// <summary>
/// Fixed-capacity sliding window over a value series, with O(1) percentile queries.
/// </summary>
/// <remarks>
/// <para>
/// A ring buffer holds the values so the evicted one is known exactly, and a
/// <see cref="LogHistogram"/> mirrors it for querying. Add and remove must stay exactly
/// inverse — the histogram throws rather than silently diverging if they do not.
/// </para>
/// <para>
/// Capacity is capped so no single histogram bucket can overflow its 16-bit count. Raising
/// the cap without widening those counters would corrupt every percentile silently, which is
/// why the cap is enforced here rather than documented as a caller obligation.
/// </para>
/// </remarks>
public sealed class RollingWindow
{
    /// <summary>
    /// Maximum capacity. Bounded by the histogram's 16-bit bucket counters.
    /// </summary>
    public const int MaxCapacity = 32_768;

    private readonly double[] _ring;
    private readonly LogHistogram _histogram = new();
    private int _head;
    private int _count;

    public RollingWindow(int capacity)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(capacity, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(capacity, MaxCapacity);
        _ring = new double[capacity];
    }

    public int Capacity => _ring.Length;

    public int Count => _count;

    public bool IsFull => _count == _ring.Length;

    /// <summary>Observations rejected as non-finite.</summary>
    /// <remarks>
    /// A source producing these is faulty, not merely noisy. The count is surfaced so the
    /// window's quality can be downgraded rather than the values silently disappearing.
    /// </remarks>
    public long RejectedCount { get; private set; }

    /// <summary>Adds a value, evicting the oldest once full.</summary>
    /// <returns><see langword="false"/> if the value was rejected as non-finite.</returns>
    public bool Add(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            RejectedCount++;
            return false;
        }

        if (IsFull)
        {
            _histogram.TryRemove(_ring[_head]);
            _ring[_head] = value;
            _head = (_head + 1) % _ring.Length;
        }
        else
        {
            _ring[(_head + _count) % _ring.Length] = value;
            _count++;
        }

        _histogram.TryAdd(value);
        return true;
    }

    public void Clear()
    {
        _histogram.Clear();
        Array.Clear(_ring);
        _head = 0;
        _count = 0;
        RejectedCount = 0;
    }

    /// <summary>Nearest-rank percentile, or NaN when empty.</summary>
    public double Percentile(double percentile) => _histogram.Percentile(percentile);

    /// <summary>Median, or NaN when empty.</summary>
    public double Median() => _histogram.Median();

    /// <summary>Observations at or above the histogram's tracked range.</summary>
    public long OverflowCount => _histogram.OverflowCount;

    /// <summary>The most recently added value, or NaN when empty.</summary>
    public double Newest => _count == 0 ? double.NaN : _ring[(_head + _count - 1) % _ring.Length];

    /// <summary>Copies the window into a destination span, oldest first.</summary>
    /// <returns>Number of values written.</returns>
    public int CopyTo(Span<double> destination)
    {
        var n = Math.Min(_count, destination.Length);
        for (var i = 0; i < n; i++) destination[i] = _ring[(_head + i) % _ring.Length];
        return n;
    }
}
