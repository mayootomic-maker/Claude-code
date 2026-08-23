using FrameDoctor.Pipeline.Detection;
using Shouldly;
using Xunit;

namespace FrameDoctor.Pipeline.Tests;

/// <summary>
/// The two hard regimes, and the grouping behaviour that decides whether an event list is
/// readable or a wall of markers.
/// </summary>
public sealed class StutterDetectorTests
{
    private const double Hz60 = 60.0;
    private const double Hz144 = 144.0;

    [Fact]
    public void Vsync_locked_series_produces_no_events()
    {
        // Near-zero variance. A purely relative threshold would fire on rounding noise:
        // six sigma here is about 0.18 ms. The absolute and refresh-interval floors are
        // what make this behave.
        var detector = new StutterDetector(Hz60);
        var events = DetectorHarness.Run(detector, FrameTimeRegimes.VsyncLocked60(6000));

        events.ShouldBeEmpty();
        detector.IsWarmedUp.ShouldBeTrue();
    }

    [Fact]
    public void Genuinely_unstable_series_produces_no_events_from_its_own_noise()
    {
        // Large slow drift plus noise. A dispersion estimate over the raw values would measure
        // the drift and set a threshold too high to be useful; the successive-difference scale
        // measures the noise instead.
        var detector = new StutterDetector(Hz60);
        var events = DetectorHarness.Run(detector, FrameTimeRegimes.Unstable25To40(6000));

        events.ShouldBeEmpty();
    }

    [Fact]
    public void Unstable_series_still_catches_a_real_hitch()
    {
        // The pair to the test above: suppressing the drift must not cost real sensitivity.
        var series = DetectorHarness.WithHitch(
            FrameTimeRegimes.Unstable25To40(6000), atIndex: 3000, hitchMs: 120.0);

        var detector = new StutterDetector(Hz60);
        var events = DetectorHarness.Run(detector, series);

        events.Count.ShouldBe(1);
        events[0].PeakFrameTimeMs.ShouldBe(120.0, 0.01);

        // Classified Stutter rather than SevereHitch, and that is correct: this game is
        // already running at a ~32 ms median, so a 120 ms frame is an 88 ms excess against
        // a 100 ms severe threshold at 60 Hz. Severity is perceptual and relative to the
        // refresh interval - the same absolute frame time is not equally bad everywhere.
        ((int)events[0].Class).ShouldBeGreaterThanOrEqualTo((int)StutterClass.Stutter);
    }

    [Fact]
    public void A_single_large_hitch_is_one_event_classified_severe()
    {
        var series = DetectorHarness.WithHitch(
            FrameTimeRegimes.Uncapped144(6000), atIndex: 3000, hitchMs: 142.0);

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, series);

        events.Count.ShouldBe(1);
        var e = events[0];
        e.Class.ShouldBe(StutterClass.SevereHitch);
        e.PeakFrameTimeMs.ShouldBe(142.0, 0.01);
        e.ExcessMs.ShouldBeGreaterThan(130);
        e.BaselineMedianMs.ShouldBe(6.94, 0.2);
        e.DuringWarmUp.ShouldBeFalse();
        e.CountsTowardTally.ShouldBeTrue();
    }

    [Fact]
    public void A_compound_decaying_hitch_is_one_event_not_a_dozen()
    {
        // Without hysteresis plus the merge window this is twelve separate stutters, and the
        // user's event list becomes noise exactly when something interesting happened.
        var baseSeries = FrameTimeRegimes.Uncapped144(6000);
        var decay = new[] { 200.0, 120.0, 80.0, 60.0, 40.0, 30.0, 25.0, 20.0, 16.0, 12.0, 9.0, 8.0 };
        for (var i = 0; i < decay.Length; i++) baseSeries[3000 + i] = decay[i];

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, baseSeries);

        events.Count.ShouldBe(1);
        events[0].PeakFrameTimeMs.ShouldBe(200.0, 0.01);
    }

    [Fact]
    public void A_burst_of_micro_hitches_is_one_event_not_a_train_of_twenty()
    {
        var baseSeries = FrameTimeRegimes.Uncapped144(6000);
        // Twenty 50 ms hitches spread across roughly 300 ms of wall time.
        for (var i = 0; i < 20; i++) baseSeries[3000 + (i * 2)] = 50.0;

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, baseSeries);

        // Hysteresis alone handles this: the excursions are close enough together that the
        // event never closes between them, so no merge is required.
        events.Count.ShouldBe(1);
        events[0].FrameCount.ShouldBeGreaterThan(20);
    }

    [Fact]
    public void Two_excursions_separated_by_a_recovery_still_merge_into_one_event()
    {
        // This is the case the merge window exists for, distinct from hysteresis: the first
        // event fully closes, then a second excursion arrives inside the merge window.
        var baseSeries = FrameTimeRegimes.Uncapped144(6000);
        baseSeries[3000] = 90.0;
        // ~40 frames at ~6.9 ms is ~277 ms of recovery: long enough to close the first event
        // (4 frames and 250 ms), short enough to fall inside the 500 ms merge window.
        baseSeries[3040] = 90.0;

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, baseSeries);

        events.Count.ShouldBe(1);
        events[0].MergedCount.ShouldBe(1);
    }

    [Fact]
    public void The_baseline_is_frozen_while_an_event_is_open()
    {
        // A long hitch must not raise the scale estimate it is being judged against.
        var series = FrameTimeRegimes.Uncapped144(6000);
        for (var i = 0; i < 40; i++) series[3000 + i] = 90.0;

        var detector = new StutterDetector(Hz144);
        var before = 0.0;
        var t = FrameDoctor.Abstractions.Time.MonotonicTimestamp.Zero;

        for (var i = 0; i < series.Length; i++)
        {
            if (i == 2999) before = detector.BaselineScaleMs;
            detector.Add(t, series[i]);
            t += TimeSpan.FromMilliseconds(series[i]);
        }

        // The scale after a 40-frame 90 ms excursion must not have absorbed it.
        detector.BaselineScaleMs.ShouldBe(before, before * 0.5);
    }

    [Fact]
    public void An_event_that_never_recovers_is_force_closed_rather_than_blinding_the_detector()
    {
        // Frame times step up permanently and never return. Without the timeout the baseline
        // stays frozen forever and nothing is ever detected again.
        var series = new List<double>();
        series.AddRange(FrameTimeRegimes.Uncapped144(3000));
        for (var i = 0; i < 3000; i++) series.Add(60.0);

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, series);

        events.ShouldNotBeEmpty();
        events[0].ForceClosed.ShouldBeTrue();
        events[0].Duration.TotalSeconds.ShouldBeLessThanOrEqualTo(5.1);
    }

    [Fact]
    public void Detection_does_not_fire_before_warm_up_completes()
    {
        // A hitch at frame 100 is real but the baseline is not yet trustworthy, so it is not
        // reported as a steady-state event. It remains recoverable by a retrospective pass.
        var series = DetectorHarness.WithHitch(
            FrameTimeRegimes.Uncapped144(200), atIndex: 100, hitchMs: 180.0);

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, series);

        detector.IsWarmedUp.ShouldBeFalse();
        events.ShouldBeEmpty();
    }

    [Theory]
    [InlineData(12.0, StutterClass.MicroStutter)]
    [InlineData(30.0, StutterClass.Stutter)]
    [InlineData(150.0, StutterClass.SevereHitch)]
    public void Severity_is_classified_against_the_refresh_interval(double hitchMs, StutterClass expected)
    {
        var series = DetectorHarness.WithHitch(
            FrameTimeRegimes.Uncapped144(6000), atIndex: 3000, hitchMs: hitchMs);

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, series);

        events.Count.ShouldBe(1);
        events[0].Class.ShouldBe(expected);
    }

    [Fact]
    public void Non_finite_frame_times_are_not_reported_as_stutters()
    {
        // A NaN is a source defect, not a 142 ms frame. It must neither enter the statistics
        // nor be classified as an anomaly.
        var series = FrameTimeRegimes.Uncapped144(6000);
        series[3000] = double.NaN;
        series[3001] = double.PositiveInfinity;

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, series);

        events.ShouldBeEmpty();
        detector.Statistics.RejectedCount.ShouldBe(2);
    }

    [Fact]
    public void Reset_at_a_discontinuity_restarts_warm_up()
    {
        var detector = new StutterDetector(Hz144);
        DetectorHarness.Run(detector, FrameTimeRegimes.Uncapped144(6000));
        detector.IsWarmedUp.ShouldBeTrue();

        detector.Reset();

        detector.IsWarmedUp.ShouldBeFalse();
        double.IsNaN(detector.BaselineMedianMs).ShouldBeTrue();
    }

    [Fact]
    public void A_sustained_step_up_is_one_regime_change_not_a_train_of_stutters()
    {
        // A rolling median lags an abrupt shift by its whole window, so without this the level
        // change produces a false event every timeout for the rest of the session - each with
        // a baseline that is by then meaningless.
        var series = new List<double>();
        series.AddRange(FrameTimeRegimes.Uncapped144(3000));
        for (var i = 0; i < 6000; i++) series.Add(21.0 + ((i % 7) * 0.4));

        var detector = new StutterDetector(Hz144);
        var events = DetectorHarness.Run(detector, series);

        events.Count.ShouldBeLessThanOrEqualTo(2,
            "a sustained step change is one event, not one per timeout");
        events.ShouldContain(e => e.Class == StutterClass.RegimeChange);

        // And the baseline must have moved to the new level, or everything after is nonsense.
        detector.BaselineMedianMs.ShouldBe(21.0, 3.0);
    }

    [Fact]
    public void A_regime_change_does_not_count_toward_the_stutter_tally()
    {
        // The user's game did not stutter; it changed. Counting it would inflate the number
        // that matters most on the Live view.
        var series = new List<double>();
        series.AddRange(FrameTimeRegimes.Uncapped144(3000));
        for (var i = 0; i < 6000; i++) series.Add(21.0 + ((i % 7) * 0.4));

        var events = DetectorHarness.Run(new StutterDetector(Hz144), series);
        var regime = events.First(e => e.Class == StutterClass.RegimeChange);

        regime.CountsTowardTally.ShouldBeFalse();
    }

    [Fact]
    public void An_events_frame_count_matches_the_span_it_reports()
    {
        // Found in a screenshot of the event inspector: a single-frame hitch reported "36
        // frames" beside "0.00 s". The count was every frame observed while the event was open,
        // including the recovery frames that proved it had ended — so it disagreed with the span
        // and overstated how much of the session was bad.
        var series = DetectorHarness.WithHitch(
            FrameTimeRegimes.VsyncLocked60(6000), atIndex: 3000, hitchMs: 120.0);

        var detector = new StutterDetector(Hz60);
        var events = DetectorHarness.Run(detector, series);

        events.ShouldNotBeEmpty();

        foreach (var e in events)
        {
            if (e.ForceClosed) continue;

            e.FrameCount.ShouldBeGreaterThan(0);

            // A frame cannot take less than nothing, so a span shorter than one frame's worth of
            // time cannot contain more than one frame.
            if (e.Duration == TimeSpan.Zero) e.FrameCount.ShouldBe(1);
        }
    }

    [Fact]
    public void Recovery_frames_are_not_counted_as_part_of_the_event()
    {
        // The detector waits for several consecutive good frames before closing. Those frames
        // are the evidence that the event ended; counting them in the event would make every
        // hitch look an order of magnitude longer than it was.
        var series = DetectorHarness.WithHitch(
            FrameTimeRegimes.VsyncLocked60(6000), atIndex: 3000, hitchMs: 200.0);

        var detector = new StutterDetector(Hz60);
        var events = DetectorHarness.Run(detector, series).Where(e => !e.ForceClosed).ToArray();

        events.ShouldNotBeEmpty();
        events[0].FrameCount.ShouldBeLessThan(10);
    }
}
