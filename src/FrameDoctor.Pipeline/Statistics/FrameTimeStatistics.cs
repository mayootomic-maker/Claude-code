using FrameDoctor.Abstractions.Telemetry;

namespace FrameDoctor.Pipeline.Statistics;

/// <summary>
/// Rolling frame-time statistics: level, robust scale, and the documented percentiles.
/// </summary>
/// <remarks>
/// <para>
/// Two windows are maintained. One holds the frame times, giving the level (median) and the
/// percentiles. The other holds the <i>absolute successive differences</i>, giving a robust
/// scale.
/// </para>
/// <para>
/// <b>Why the scale comes from differences, not values.</b> A median absolute deviation taken
/// over the raw values measures whatever slow drift the series has. On a genuinely unstable
/// 25–40 fps game that drift dominates, producing a scale of roughly 11 ms and therefore a
/// threshold near 66 ms — high enough to miss an 80 ms hitch entirely. Differencing cancels the
/// drift and leaves the frame-to-frame noise, which is the quantity a stutter is an outlier
/// against. It is also the statistically correct move given that frame-time series are
/// autocorrelated: differencing removes the low-frequency component that invalidates a naive
/// dispersion estimate.
/// </para>
/// </remarks>
public sealed class FrameTimeStatistics
{
    /// <summary>Scale factor making the median absolute deviation a consistent estimator of σ for a normal distribution.</summary>
    private const double MadToSigma = 1.4826;

    /// <summary>Successive differences of a series have √2 times the spread of the series itself.</summary>
    private static readonly double SuccessiveDifferenceCorrection = Math.Sqrt(2.0);

    private readonly RollingWindow _values;
    private readonly RollingWindow _differences;
    private double _previous = double.NaN;

    public FrameTimeStatistics(int capacity)
    {
        _values = new RollingWindow(capacity);
        _differences = new RollingWindow(capacity);
    }

    public int Count => _values.Count;

    public int DifferenceCount => _differences.Count;

    /// <summary>Samples rejected as non-finite across both windows.</summary>
    public long RejectedCount => _values.RejectedCount;

    /// <summary>Frames at or above the histogram's tracked range, which downgrades percentile quality.</summary>
    public long OverflowCount => _values.OverflowCount;

    /// <summary>Largest frame time seen since the last reset.</summary>
    /// <remarks>
    /// Tracked exactly rather than read from the histogram, because the worst frame is the one
    /// the user most wants to know and a bucket centre would understate it.
    /// </remarks>
    public double Maximum { get; private set; } = double.NaN;

    /// <summary>Adds a frame time.</summary>
    /// <returns><see langword="false"/> if the value was rejected as non-finite.</returns>
    public bool Add(double frameTimeMs)
    {
        if (!_values.Add(frameTimeMs)) return false;

        if (!double.IsNaN(_previous)) _differences.Add(Math.Abs(frameTimeMs - _previous));
        _previous = frameTimeMs;

        if (double.IsNaN(Maximum) || frameTimeMs > Maximum) Maximum = frameTimeMs;
        return true;
    }

    /// <summary>
    /// Resets all state.
    /// </summary>
    /// <remarks>
    /// Called at a discontinuity. Statistics must not span a suspend, a session lock, or a
    /// source restart: averaging a window that straddles a three-hour sleep would report a
    /// stutter that never happened.
    /// </remarks>
    public void Reset()
    {
        _values.Clear();
        _differences.Clear();
        _previous = double.NaN;
        Maximum = double.NaN;
    }

    /// <summary>Rolling median frame time, or NaN when empty.</summary>
    public double Median() => _values.Median();

    /// <summary>
    /// Robust scale estimate from the median absolute successive difference.
    /// </summary>
    /// <returns>NaN when there are too few differences to estimate.</returns>
    public double RobustScale()
    {
        if (_differences.Count < 2) return double.NaN;
        var masd = _differences.Median();
        return double.IsNaN(masd) ? double.NaN : masd * MadToSigma / SuccessiveDifferenceCorrection;
    }

    /// <summary>
    /// Percentile of frame time, honouring the metric's documented minimum sample size.
    /// </summary>
    /// <returns>
    /// NaN when there are fewer samples than the catalog requires. A p99.9 computed from 300
    /// frames describes a single frame; returning it would invite a comparison across sessions
    /// that manufactures a regression out of noise.
    /// </returns>
    public double PercentileOrInsufficient(double percentile, MetricId metric)
    {
        if (!MetricCatalog.HasEnoughSamples(metric, _values.Count)) return double.NaN;
        return _values.Percentile(percentile);
    }

    /// <summary>
    /// The "1 % low" as an FPS figure: the 99th-percentile frame time expressed as frames per second.
    /// </summary>
    /// <remarks>
    /// This is the frame-time-percentile definition, not an average of the worst frames. The two
    /// differ, and disagreement between measurement tools usually traces to exactly this. The
    /// definition is pinned in <c>docs/architecture/telemetry-model.md</c> and this method is
    /// tested against that text.
    /// </remarks>
    public double Low1PercentFps()
    {
        var p99 = PercentileOrInsufficient(99, MetricId.FrameLow1Pct);
        return double.IsNaN(p99) || p99 <= 0 ? double.NaN : 1000.0 / p99;
    }

    /// <summary>The "0.1 % low" as an FPS figure. See <see cref="Low1PercentFps"/>.</summary>
    public double Low01PercentFps()
    {
        var p999 = PercentileOrInsufficient(99.9, MetricId.FrameLow01Pct);
        return double.IsNaN(p999) || p999 <= 0 ? double.NaN : 1000.0 / p999;
    }

    /// <summary>Rolling frames per second: frames in the window divided by their total duration.</summary>
    /// <remarks>
    /// Deliberately not a mean of instantaneous FPS values, which over-weights short frames and
    /// reads higher than the user's experience.
    /// </remarks>
    public double RollingFps()
    {
        if (!MetricCatalog.HasEnoughSamples(MetricId.FrameFpsRolling, _values.Count)) return double.NaN;

        Span<double> buffer = _values.Count <= 4096
            ? stackalloc double[_values.Count]
            : new double[_values.Count];

        var n = _values.CopyTo(buffer);
        var totalMs = 0.0;
        for (var i = 0; i < n; i++) totalMs += buffer[i];
        return totalMs <= 0 ? double.NaN : n / (totalMs / 1000.0);
    }
}
