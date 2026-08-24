using FrameDoctor.Diagnostics.Baselines;
using Shouldly;
using Xunit;

namespace FrameDoctor.Diagnostics.Tests;

/// <summary>
/// The bar a difference has to clear before FrameDoctor is allowed to call it a change.
/// </summary>
/// <remarks>
/// Two failure modes are equally fatal here and both are asserted against: a tool that declares
/// a regression whenever a number moves, and a tool that declares a success whenever an
/// optimization is applied. The bar is symmetric on purpose.
/// </remarks>
public sealed class RegressionDetectorTests
{
    private static BaselineSample Session(double medianMs, double floorMs = 3.0) =>
        new(medianMs, medianMs * 2.0, 1000.0 / (medianMs * 2.0),
            Baseline.MinimumFramesPerSession, 0, floorMs);

    /// <summary>Seven sessions centred on 8.3 ms with a 0.2 ms median absolute deviation.</summary>
    private static Baseline Trusted(double floorMs = 3.0) => BaselineBuilder.Build(
        [.. new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }.Select(m => Session(m, floorMs))]);

    /// <summary>Three sessions with the same centre and spread, so only trust differs.</summary>
    private static Baseline Provisional() => BaselineBuilder.Build(
        [Session(8.1), Session(8.3), Session(8.5)]);

    [Fact]
    public void No_baseline_yields_no_verdict_and_says_why()
    {
        var result = RegressionDetector.CompareMedian(BaselineBuilder.Build([]), 12.0);

        result.Verdict.ShouldBe(ComparisonVerdict.NoBaseline);
        result.Detail.ShouldContain("Not enough sessions yet");
        double.IsNaN(result.EffectSize).ShouldBeTrue();
    }

    [Fact]
    public void A_non_finite_session_median_yields_no_verdict()
    {
        var result = RegressionDetector.CompareMedian(Trusted(), double.NaN);

        result.Verdict.ShouldBe(ComparisonVerdict.NoBaseline);
    }

    [Fact]
    public void A_difference_inside_the_noise_is_no_change()
    {
        // Baseline 8.30 ms, MAD 0.20 ms, so the bar is 0.60 ms. 8.80 is 0.50 ms out.
        var result = RegressionDetector.CompareMedian(Trusted(), 8.80);

        result.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);
        result.NoiseMs.ShouldBe(0.6, 1e-9);
        result.Detail.ShouldContain("nothing has been shown to change");
    }

    [Fact]
    public void An_improvement_inside_the_noise_is_also_no_change()
    {
        var result = RegressionDetector.CompareMedian(Trusted(), 7.80);

        result.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);
    }

    [Fact]
    public void Exactly_at_the_bar_is_not_a_change()
    {
        // The boundary belongs to "no change". A tool that rounds ties towards a claim is a tool
        // that makes claims.
        //
        // Binary-exact medians throughout, so this asserts the rule rather than the rounding:
        // centre 8.375, deviations 0.375 0.25 0.125 0 0.125 0.25 0.375 → MAD 0.25 → bar 0.75.
        var baseline = BaselineBuilder.Build(
        [
            .. new[] { 8.0, 8.125, 8.25, 8.375, 8.5, 8.625, 8.75 }.Select(m => Session(m)),
        ]);

        baseline.MedianAbsoluteDeviationMs.ShouldBe(0.25);

        var result = RegressionDetector.CompareMedian(baseline, 8.375 + 0.75);

        result.NoiseMs.ShouldBe(0.75);
        result.DifferenceMs.ShouldBe(result.NoiseMs);
        result.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);

        // And a hair beyond it is.
        RegressionDetector.CompareMedian(baseline, 8.375 + 0.8)
            .Verdict.ShouldBe(ComparisonVerdict.Regression);
    }

    [Fact]
    public void A_difference_outside_the_noise_against_a_trusted_baseline_is_a_regression()
    {
        var result = RegressionDetector.CompareMedian(Trusted(), 10.0);

        result.Verdict.ShouldBe(ComparisonVerdict.Regression);
        result.DifferenceMs.ShouldBe(1.7, 1e-9);
        result.EffectSize.ShouldBe(1.7 / 0.6, 1e-9);
        result.Detail.ShouldContain("slower");
    }

    [Fact]
    public void The_same_bar_applies_to_an_improvement()
    {
        var worse = RegressionDetector.CompareMedian(Trusted(), 8.30 + 0.61);
        var better = RegressionDetector.CompareMedian(Trusted(), 8.30 - 0.61);

        worse.Verdict.ShouldBe(ComparisonVerdict.Regression);
        better.Verdict.ShouldBe(ComparisonVerdict.Improvement);
        better.Detail.ShouldContain("faster");

        // Symmetry is the point: the same distance either side gets the same strength of claim.
        Math.Abs(better.EffectSize).ShouldBe(Math.Abs(worse.EffectSize), 1e-9);
    }

    [Fact]
    public void A_provisional_baseline_downgrades_a_clear_difference_to_indicative()
    {
        var result = RegressionDetector.CompareMedian(Provisional(), 12.0);

        result.Verdict.ShouldBe(ComparisonVerdict.IndicativeOnly);
        result.Verdict.ShouldNotBe(ComparisonVerdict.Regression);
    }

    [Fact]
    public void Indicative_is_not_the_same_as_no_change()
    {
        // These are different facts and they lead to different actions. Collapsing indicative
        // into within-noise would throw away a real observation and tell the user nothing
        // happened.
        var indicative = RegressionDetector.CompareMedian(Provisional(), 12.0);
        var quiet = RegressionDetector.CompareMedian(Provisional(), 8.35);

        indicative.Verdict.ShouldBe(ComparisonVerdict.IndicativeOnly);
        quiet.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);
        indicative.Detail.ShouldContain("more than this configuration normally varies");
        indicative.Detail.ShouldContain("7");
    }

    [Fact]
    public void A_provisional_baseline_also_withholds_a_success_claim()
    {
        // The dangerous direction. "Your optimization worked" off three sessions is exactly the
        // claim this product exists not to make.
        var result = RegressionDetector.CompareMedian(Provisional(), 5.0);

        result.Verdict.ShouldBe(ComparisonVerdict.IndicativeOnly);
        result.Detail.ShouldContain("faster");
    }

    [Fact]
    public void Three_near_identical_sessions_do_not_make_every_later_session_a_regression()
    {
        // The zero-spread trap: a configuration that happened to produce identical sessions has
        // a MAD of zero, and three times nothing is nothing. Without the floor, a tenth of a
        // millisecond would be a regression forever after.
        var identical = BaselineBuilder.Build(
            [.. Enumerable.Repeat(Session(8.30), Baseline.MinimumSessionsForTrusted)]);

        identical.MedianAbsoluteDeviationMs.ShouldBe(0.0, 1e-12);
        identical.MayDeclareRegression.ShouldBeTrue();

        var result = RegressionDetector.CompareMedian(identical, 8.35);

        result.NoiseMs.ShouldBe(RegressionDetector.MinimumNoiseMs, 1e-12);
        result.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);
    }

    [Fact]
    public void The_noise_floor_does_not_hide_a_real_difference()
    {
        var identical = BaselineBuilder.Build(
            [.. Enumerable.Repeat(Session(8.30), Baseline.MinimumSessionsForTrusted)]);

        RegressionDetector.CompareMedian(identical, 11.0)
            .Verdict.ShouldBe(ComparisonVerdict.Regression);
    }

    [Fact]
    public void The_bar_is_credited_to_whichever_thing_actually_set_it()
    {
        // Two different facts wearing the same number. When the observed spread sets the bar, it
        // is a statement about the machine; when the floor sets it, it is a statement about the
        // frame-time source. Saying "this configuration varies by 0.10 ms" in the second case
        // would credit the instrument's resolution limit to the user's hardware.
        var spread = RegressionDetector.CompareMedian(Trusted(), 8.35);

        var identical = BaselineBuilder.Build(
            [.. Enumerable.Repeat(Session(8.30), Baseline.MinimumSessionsForTrusted)]);
        var floored = RegressionDetector.CompareMedian(identical, 8.35);

        spread.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);
        floored.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);

        spread.Detail.ShouldContain("This configuration varies by");
        spread.Detail.ShouldNotContain("frame-time source");

        floored.Detail.ShouldContain("smaller than the frame-time source resolves");
        floored.Detail.ShouldNotContain("This configuration varies by");
    }

    [Fact]
    public void A_declared_regression_says_what_it_is_a_multiple_of()
    {
        var againstSpread = RegressionDetector.CompareMedian(Trusted(), 12.0);

        var identical = BaselineBuilder.Build(
            [.. Enumerable.Repeat(Session(8.30), Baseline.MinimumSessionsForTrusted)]);
        var againstFloor = RegressionDetector.CompareMedian(identical, 12.0);

        againstSpread.Detail.ShouldContain("session-to-session variation");
        againstFloor.Detail.ShouldContain("smallest difference the frame-time source resolves");
    }

    [Fact]
    public void Mismatched_sensitivity_floors_are_not_comparable()
    {
        // A 16.7 ms floor against a 3 ms baseline is a less sensitive instrument, not a worse
        // machine. Subtracting the two produces a number about the measurement.
        var result = RegressionDetector.CompareMedian(Trusted(floorMs: 3.0), 20.0, 16.7);

        result.Verdict.ShouldBe(ComparisonVerdict.NotComparable);
        result.Detail.ShouldContain("not in how the game ran");
        double.IsNaN(result.EffectSize).ShouldBeTrue();
    }

    [Fact]
    public void Sensitivity_is_checked_before_the_noise_bar()
    {
        // Ordering matters: a difference that would clear the bar must still be refused when the
        // two sides could not have seen the same thing.
        var result = RegressionDetector.CompareMedian(Trusted(floorMs: 3.0), 8.31, 16.7);

        result.Verdict.ShouldBe(ComparisonVerdict.NotComparable);
    }

    [Theory]
    [InlineData(3.0, 3.0)]
    [InlineData(3.0, 6.0)]
    [InlineData(3.0, 1.5)]
    [InlineData(3.0, 5.9)]
    public void Floors_within_a_factor_of_two_are_comparable(double baselineFloor, double sessionFloor)
    {
        RegressionDetector.NotComparable(baselineFloor, sessionFloor).ShouldBeFalse();
    }

    [Theory]
    [InlineData(3.0, 6.1)]
    [InlineData(3.0, 1.4)]
    [InlineData(16.7, 3.0)]
    public void Floors_beyond_a_factor_of_two_are_not(double baselineFloor, double sessionFloor)
    {
        RegressionDetector.NotComparable(baselineFloor, sessionFloor).ShouldBeTrue();
    }

    [Theory]
    [InlineData(double.NaN, 3.0)]
    [InlineData(3.0, double.NaN)]
    [InlineData(0.0, 3.0)]
    [InlineData(3.0, 0.0)]
    public void An_unknown_floor_does_not_block_the_comparison(double baselineFloor, double sessionFloor)
    {
        // Refusing to compare because a floor is missing would make an unrecorded field silently
        // disable the feature. The noise bar still governs the claim.
        RegressionDetector.NotComparable(baselineFloor, sessionFloor).ShouldBeFalse();
    }

    [Fact]
    public void A_session_with_an_unrecorded_floor_is_still_compared()
    {
        var result = RegressionDetector.CompareMedian(Trusted(), 10.0);

        result.Verdict.ShouldBe(ComparisonVerdict.Regression);
    }

    [Fact]
    public void Every_verdict_carries_a_sentence_a_user_could_read()
    {
        Comparison[] all =
        [
            RegressionDetector.CompareMedian(BaselineBuilder.Build([]), 9.0),
            RegressionDetector.CompareMedian(Trusted(), 8.35),
            RegressionDetector.CompareMedian(Trusted(), 10.0),
            RegressionDetector.CompareMedian(Trusted(), 6.0),
            RegressionDetector.CompareMedian(Provisional(), 12.0),
            RegressionDetector.CompareMedian(Trusted(floorMs: 3.0), 20.0, 16.7),
        ];

        foreach (var result in all)
        {
            result.Detail.ShouldNotBeNullOrWhiteSpace();
            result.Detail.ShouldNotContain("NaN");
            result.Detail.ShouldNotContain("Infinity");
            result.Metric.ShouldBe("median frame time");
        }

        all.Select(r => r.Verdict).Distinct().Count().ShouldBe(all.Length);
    }

    [Fact]
    public void CompareMedian_rejects_a_null_baseline()
    {
        Should.Throw<ArgumentNullException>(() => RegressionDetector.CompareMedian(null!, 8.0));
    }
}
