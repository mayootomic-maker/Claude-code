using FrameDoctor.Pipeline.Statistics;
using Shouldly;
using Xunit;

namespace FrameDoctor.Pipeline.Tests;

public sealed class LogHistogramTests
{
    /// <summary>Exact nearest-rank percentile, the definition the histogram approximates.</summary>
    private static double ExactPercentile(double[] values, double percentile)
    {
        var sorted = (double[])values.Clone();
        Array.Sort(sorted);
        var rank = (int)Math.Ceiling(percentile / 100.0 * sorted.Length);
        return sorted[Math.Clamp(rank - 1, 0, sorted.Length - 1)];
    }

    public static TheoryData<string, double[]> Regimes() => new()
    {
        { "vsync-60", FrameTimeRegimes.VsyncLocked60(20_000) },
        { "144fps", FrameTimeRegimes.Uncapped144(20_000) },
        { "300fps", FrameTimeRegimes.Uncapped300(20_000) },
        { "unstable-25-40", FrameTimeRegimes.Unstable25To40(20_000) },
    };

    [Theory]
    [MemberData(nameof(Regimes))]
    public void Percentiles_stay_within_the_documented_error_bound(string regime, double[] values)
    {
        var h = new LogHistogram();
        foreach (var v in values) h.TryAdd(v).ShouldBeTrue();

        // The bound is provable, not empirical: half a bucket width at 256 sub-buckets
        // per octave is +/- 0.135%. Allow a hair over for float32 rounding at boundaries.
        const double MaxRelativeError = 0.002;

        foreach (var p in new[] { 50.0, 95.0, 99.0, 99.9 })
        {
            var exact = ExactPercentile(values, p);
            var approx = h.Percentile(p);
            var relativeError = Math.Abs(approx - exact) / exact;

            relativeError.ShouldBeLessThan(MaxRelativeError,
                $"{regime} p{p}: exact {exact:F4} ms, histogram {approx:F4} ms, " +
                $"error {relativeError * 100:F4}%");
        }
    }

    [Fact]
    public void Empty_histogram_reports_NaN_rather_than_zero()
    {
        // Zero would be a plausible-looking frame time. NaN forces the caller to decide,
        // and the caller renders Unavailable(InsufficientData).
        var h = new LogHistogram();
        h.Count.ShouldBe(0);
        double.IsNaN(h.Percentile(50)).ShouldBeTrue();
        double.IsNaN(h.Median()).ShouldBeTrue();
    }

    [Fact]
    public void Sliding_window_gives_the_same_answer_as_a_fresh_histogram()
    {
        // The property that makes a histogram usable where t-digest and P2 are not:
        // add and remove must be exactly inverse.
        var all = FrameTimeRegimes.Uncapped144(5000);
        var window = new LogHistogram();
        var fresh = new LogHistogram();

        const int WindowSize = 1000;
        for (var i = 0; i < all.Length; i++)
        {
            window.TryAdd(all[i]);
            if (i >= WindowSize) window.TryRemove(all[i - WindowSize]);
        }

        for (var i = all.Length - WindowSize; i < all.Length; i++) fresh.TryAdd(all[i]);

        window.Count.ShouldBe(fresh.Count);
        foreach (var p in new[] { 50.0, 95.0, 99.0 })
        {
            window.Percentile(p).ShouldBe(fresh.Percentile(p));
        }
    }

    [Fact]
    public void Remove_of_a_value_never_added_throws_rather_than_corrupting_percentiles()
    {
        var h = new LogHistogram();
        h.TryAdd(16.6);
        Should.Throw<InvalidOperationException>(() => h.TryRemove(3.3));
    }

    [Fact]
    public void Non_finite_values_are_rejected_and_not_counted()
    {
        var h = new LogHistogram();
        h.TryAdd(double.NaN).ShouldBeFalse();
        h.TryAdd(double.PositiveInfinity).ShouldBeFalse();
        h.TryAdd(double.NegativeInfinity).ShouldBeFalse();
        h.Count.ShouldBe(0);
    }

    [Fact]
    public void Overflow_is_counted_separately_rather_than_clamped_into_the_top_bucket()
    {
        // A 5-second frame must not be recorded as a plausible 2048 ms one.
        var h = new LogHistogram();
        h.TryAdd(5000.0);
        h.OverflowCount.ShouldBe(1);
        h.Count.ShouldBe(1);
    }

    [Fact]
    public void Values_below_the_tracked_range_are_counted_as_underflow()
    {
        var h = new LogHistogram();
        h.TryAdd(0.1);
        h.UnderflowCount.ShouldBe(1);
        h.Count.ShouldBe(1);
    }

    [Fact]
    public void Zero_variance_series_yields_its_exact_value_to_within_the_bound()
    {
        var h = new LogHistogram();
        for (var i = 0; i < 1000; i++) h.TryAdd(16.6667);

        h.Median().ShouldBe(16.6667, 16.6667 * 0.002);
        h.Percentile(99).ShouldBe(16.6667, 16.6667 * 0.002);
    }

    [Fact]
    public void Single_sample_is_returned_at_every_percentile()
    {
        var h = new LogHistogram();
        h.TryAdd(6.94);
        h.Percentile(0).ShouldBe(6.94, 0.02);
        h.Percentile(50).ShouldBe(6.94, 0.02);
        h.Percentile(100).ShouldBe(6.94, 0.02);
    }

    [Fact]
    public void Bucket_index_is_monotonic_across_the_whole_tracked_range()
    {
        var last = -1;
        for (var v = 0.25; v < 2048.0; v *= 1.0005)
        {
            var idx = LogHistogram.BucketIndexOf(v);
            idx.ShouldBeGreaterThanOrEqualTo(last);
            last = idx;
        }
    }
}
