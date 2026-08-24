using FrameDoctor.Diagnostics.Baselines;
using Shouldly;
using Xunit;

namespace FrameDoctor.Diagnostics.Tests;

/// <summary>
/// What a baseline is allowed to claim, and how little it is allowed to claim early on.
/// </summary>
/// <remarks>
/// The failure this suite exists to prevent is a baseline that sounds authoritative after two
/// sessions. Every threshold here is a promise made to the user in the UI, so each one is
/// asserted at its boundary rather than in the comfortable middle.
/// </remarks>
public sealed class BaselineTests
{
    private const int LongEnough = Baseline.MinimumFramesPerSession;

    private static BaselineSample Session(
        double medianMs,
        int frames = LongEnough,
        int stutters = 0,
        double floorMs = 3.0) =>
        new(medianMs, medianMs * 2.0, 1000.0 / (medianMs * 2.0), frames, stutters, floorMs);

    private static List<BaselineSample> Sessions(params double[] medians) =>
        [.. medians.Select(m => Session(m))];

    [Fact]
    public void No_sessions_is_no_baseline()
    {
        var baseline = BaselineBuilder.Build([]);

        baseline.Exists.ShouldBeFalse();
        baseline.Trust.ShouldBe(BaselineTrust.Insufficient);
        baseline.SessionCount.ShouldBe(0);
    }

    [Fact]
    public void Two_sessions_is_still_no_baseline()
    {
        // Two sessions have a spread, arithmetically. It is half their difference, and it is as
        // likely to be noise as signal — which is exactly the number that would make the third
        // session a regression.
        var baseline = BaselineBuilder.Build(Sessions(8.0, 8.4));

        baseline.Exists.ShouldBeFalse();
        baseline.MayDeclareRegression.ShouldBeFalse();
        baseline.Describe().ShouldContain("2 of 3");
    }

    [Fact]
    public void Three_sessions_is_provisional_and_may_not_declare_a_regression()
    {
        var baseline = BaselineBuilder.Build(Sessions(8.0, 8.2, 8.4));

        baseline.Trust.ShouldBe(BaselineTrust.Provisional);
        baseline.Exists.ShouldBeTrue();
        baseline.MayDeclareRegression.ShouldBeFalse();
        baseline.MedianFrameTimeMs.ShouldBe(8.2, 1e-9);
    }

    [Fact]
    public void Six_sessions_is_still_provisional()
    {
        var baseline = BaselineBuilder.Build(Sessions(8.0, 8.1, 8.2, 8.3, 8.4, 8.5));

        baseline.SessionCount.ShouldBe(6);
        baseline.Trust.ShouldBe(BaselineTrust.Provisional);
        baseline.MayDeclareRegression.ShouldBeFalse();
    }

    [Fact]
    public void Seven_sessions_is_trusted()
    {
        var baseline = BaselineBuilder.Build(Sessions(8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6));

        baseline.SessionCount.ShouldBe(7);
        baseline.Trust.ShouldBe(BaselineTrust.Trusted);
        baseline.MayDeclareRegression.ShouldBeTrue();
        baseline.Describe().ShouldContain("7 sessions of history");

        // Never a bare restatement of the count. The panel shows that figure beside this
        // sentence, and a trust line that only repeats it teaches the reader to skip it.
        baseline.Describe().ShouldContain("worth acting on");
    }

    [Fact]
    public void Short_sessions_are_dropped_not_weighted_down()
    {
        // A thirty-second warm-up has percentiles. They describe thirty seconds. Averaging them
        // in — at any weight — moves the baseline by a measurement of a different thing.
        var withShortRuns = new List<BaselineSample>
        {
            Session(8.0),
            Session(8.2),
            Session(8.4),
            Session(30.0, frames: 400),
            Session(31.0, frames: 900),
        };

        var baseline = BaselineBuilder.Build(withShortRuns);

        baseline.SessionCount.ShouldBe(3);
        baseline.MedianFrameTimeMs.ShouldBe(8.2, 1e-9);
    }

    [Fact]
    public void Dropped_short_sessions_can_leave_no_baseline_at_all()
    {
        var baseline = BaselineBuilder.Build(
        [
            Session(8.0),
            Session(8.2),
            Session(8.4, frames: LongEnough - 1),
        ]);

        baseline.Exists.ShouldBeFalse();

        // The count reported is the usable count, not the stored count. Telling a user they have
        // three sessions and no baseline invites them to conclude the tool is broken.
        baseline.SessionCount.ShouldBe(2);
    }

    [Fact]
    public void A_session_exactly_at_the_frame_minimum_counts()
    {
        var baseline = BaselineBuilder.Build(
        [
            Session(8.0),
            Session(8.2),
            Session(8.4, frames: Baseline.MinimumFramesPerSession),
        ]);

        baseline.SessionCount.ShouldBe(3);
    }

    [Fact]
    public void A_non_finite_median_is_dropped_rather_than_poisoning_the_baseline()
    {
        var baseline = BaselineBuilder.Build(
        [
            Session(8.0),
            Session(8.2),
            Session(8.4),
            Session(double.NaN),
        ]);

        baseline.SessionCount.ShouldBe(3);
        double.IsFinite(baseline.MedianFrameTimeMs).ShouldBeTrue();
        double.IsFinite(baseline.MedianAbsoluteDeviationMs).ShouldBeTrue();
    }

    [Fact]
    public void One_bad_afternoon_does_not_move_the_centre()
    {
        // The property that makes a median the right choice: an outlier changes the spread
        // estimate but not the claim about what is normal.
        var calm = BaselineBuilder.Build(Sessions(8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6));
        var withOutlier = BaselineBuilder.Build(Sessions(8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 40.0));

        withOutlier.MedianFrameTimeMs.ShouldBe(calm.MedianFrameTimeMs, 1e-9);
    }

    [Fact]
    public void Spread_is_a_median_absolute_deviation_not_a_range()
    {
        // Medians 8.0 8.1 8.2 8.3 8.4 8.5 8.6 → centre 8.3, deviations 0.3 0.2 0.1 0 .1 .2 .3
        // → median deviation 0.2.
        var baseline = BaselineBuilder.Build(Sessions(8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6));

        baseline.MedianFrameTimeMs.ShouldBe(8.3, 1e-9);
        baseline.MedianAbsoluteDeviationMs.ShouldBe(0.2, 1e-9);
    }

    [Fact]
    public void The_worst_sensitivity_floor_wins()
    {
        // A baseline is only as sensitive as its least sensitive member. Averaging the floors
        // would claim a sensitivity no contributing session actually had.
        var baseline = BaselineBuilder.Build(
        [
            Session(8.0, floorMs: 3.0),
            Session(8.2, floorMs: 3.0),
            Session(8.4, floorMs: 16.7),
        ]);

        baseline.WorstSensitivityFloorMs.ShouldBe(16.7, 1e-9);
    }

    [Fact]
    public void Stutter_rate_is_per_minute_so_a_long_session_does_not_outvote_a_short_one()
    {
        var sessions = new List<BaselineSample>
        {
            Session(8.0, stutters: 10),
            Session(8.2, stutters: 20),
            Session(8.4, stutters: 60),
        };
        TimeSpan[] durations =
        [
            TimeSpan.FromMinutes(10),
            TimeSpan.FromMinutes(10),
            TimeSpan.FromMinutes(60),
        ];

        var baseline = BaselineBuilder.Build(sessions, durations);

        // Rates are 1, 2 and 1 per minute. A raw count would have made the hour-long session the
        // loudest voice; the median rate is 1.
        baseline.StuttersPerMinute.ShouldBe(1.0, 1e-9);
    }

    [Fact]
    public void A_session_with_no_recorded_duration_is_excluded_from_the_rate_not_treated_as_zero()
    {
        var baseline = BaselineBuilder.Build(
            [Session(8.0, stutters: 4), Session(8.2, stutters: 4), Session(8.4, stutters: 99)],
            [TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(2), TimeSpan.Zero]);

        baseline.StuttersPerMinute.ShouldBe(2.0, 1e-9);
    }

    [Fact]
    public void With_no_durations_at_all_the_rate_is_unavailable_rather_than_zero()
    {
        // The product rule: a metric with no input renders as unavailable, never as zero. Zero
        // stutters per minute is a claim, and it is one nothing here supports.
        var baseline = BaselineBuilder.Build(Sessions(8.0, 8.2, 8.4));

        double.IsNaN(baseline.StuttersPerMinute).ShouldBeTrue();
    }

    [Fact]
    public void Describe_never_promises_more_than_the_trust_allows()
    {
        BaselineBuilder.Build(Sessions(8.0, 8.2, 8.4)).Describe()
            .ShouldContain("not enough to call a change a regression");

        BaselineBuilder.Build(Sessions(8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6)).Describe()
            .ShouldNotContain("not enough");
    }

    [Fact]
    public void Build_rejects_a_null_session_list()
    {
        Should.Throw<ArgumentNullException>(() => BaselineBuilder.Build(null!));
    }

    [Fact]
    public void Median_of_an_even_count_is_the_midpoint_of_the_middle_pair()
    {
        BaselineBuilder.Median([4.0, 1.0, 3.0, 2.0]).ShouldBe(2.5, 1e-9);
    }

    [Fact]
    public void Median_does_not_reorder_the_caller_s_array()
    {
        double[] values = [4.0, 1.0, 3.0, 2.0];
        BaselineBuilder.Median(values);
        values.ShouldBe([4.0, 1.0, 3.0, 2.0]);
    }
}
