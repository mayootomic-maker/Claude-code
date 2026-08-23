using Xunit;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Engine.Hosting;
using Shouldly;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// Adversarial: what a misbehaving collector does to a session that runs for hours.
/// </summary>
/// <remarks>
/// The existing suite feeds the live session well-formed simulation output, in order, at a sane
/// rate. Real collectors do none of those things reliably: PresentMon restarts, a sensor poll
/// lands late, a clock steps at resume, a source stamps with the wrong base. Every test here
/// feeds something a real collector can emit.
/// </remarks>
public sealed class LiveSessionAbuseTests
{
    private static TelemetrySample Sensor(double atMs, double value) =>
        TelemetrySample.Measured(
            MonotonicTimestamp.FromMilliseconds(atMs),
            MetricId.CpuTemperature,
            SourceId.Simulation,
            value,
            Unit.Celsius);

    /// <summary>
    /// One sample stamped in the future permanently disables sensor-history retention.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>SensorHistory.Trim</c> stops at the first sample that is not older than the cutoff, and
    /// the queue is FIFO by <i>arrival</i>, not by timestamp. A single sample whose timestamp is
    /// ahead of the session — a clock step at resume, a source using a different clock base, a
    /// sensor returning a stuck value with a stale stamp — sits at the head of the queue and is
    /// never older than any future cutoff. Nothing behind it is ever dropped.
    /// </para>
    /// <para>
    /// The buffer that the design says is "the entire working set" then grows for the whole
    /// session. At a few hundred samples a second over a six-hour session that is millions of
    /// live samples, which is GC pressure in the process whose stated purpose is not to cause
    /// stutters (invariant 8).
    /// </para>
    /// </remarks>
    [Fact]
    public void One_future_stamped_sample_stops_the_sensor_history_from_ever_trimming()
    {
        var history = new SensorHistory(TimeSpan.FromSeconds(30));

        // A clock step: one sample an hour ahead, arriving first.
        history.Add(Sensor(3_600_000, 51));

        // Then a normal session: 4 Hz for an hour of session time.
        for (var i = 1; i <= 14_400; i++)
        {
            history.Add(Sensor(i * 250.0, 50));
            history.Trim(MonotonicTimestamp.FromMilliseconds(i * 250.0));
        }

        // 30 s of retention at 4 Hz is ~120 samples, plus the stuck one.
        history.Count.ShouldBeLessThan(
            200,
            "the bounded sensor buffer is unbounded after a single out-of-order timestamp");
    }

    /// <summary>
    /// The session's elapsed time runs backwards whenever a frame lands behind a sensor poll.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>AddFrame</c> and <c>AddSensorSamples</c> both assign the session's end from whatever
    /// they were handed, and <c>AddFrame</c> does it unconditionally. The frame source is a CSV
    /// pipe read from another process, so it is always some tens of milliseconds behind the
    /// sensor poll that stamps itself from the clock directly. Every poll therefore pushes the
    /// session end ahead of the frames, and the next frame pulls it back.
    /// </para>
    /// <para>
    /// The user sees a session duration that ticks backwards in the Live view, and
    /// <c>SessionRecorder</c> stores <c>statistics.Elapsed.Ticks</c> as the session's recorded
    /// length — so the number a session is remembered by depends on whether a frame or a sensor
    /// sample happened to arrive last.
    /// </para>
    /// </remarks>
    [Fact]
    public void The_session_duration_runs_backwards_when_a_frame_lands_behind_a_sensor_poll()
    {
        var session = new LiveSession(144.0);
        Span<TelemetrySample> one = stackalloc TelemetrySample[1];

        var longest = TimeSpan.Zero;
        var wentBackwards = false;

        for (var i = 0; i < 600; i++)
        {
            var frameAt = i * 6.94;
            session.AddFrame(new FramePresent(
                MonotonicTimestamp.FromMilliseconds(frameAt), 6.94, null, false, 0));

            // A sensor poll every 250 ms, stamped from the clock rather than from the frame
            // stream, which the collector reads with a lag.
            if (i % 36 == 0)
            {
                one[0] = Sensor(frameAt + 40.0, 55);
                session.AddSensorSamples(one);
            }

            var elapsed = session.Statistics().Elapsed;
            if (elapsed < longest) wentBackwards = true;
            if (elapsed > longest) longest = elapsed;
        }

        wentBackwards.ShouldBeFalse(
            "the session duration shown to the user decreases as the session goes on");
    }

    /// <summary>
    /// A sensor stamped in the future throws away every event's evidence.
    /// </summary>
    /// <remarks>
    /// <c>AddSensorSamples</c> advances the session clock from sensor timestamps and then trims
    /// history against it. One future-stamped sample moves the cutoff hours ahead, and the trim
    /// that follows discards the whole correlation window. The events diagnosed afterwards have
    /// no evidence at all — and FrameDoctor does not report that its evidence was deleted, it
    /// reports an unexplained stutter, which the user reads as a property of their machine.
    /// </remarks>
    [Fact]
    public void A_future_stamped_sensor_sample_deletes_the_evidence_of_a_stutter()
    {
        var session = new LiveSession(144.0);

        Span<TelemetrySample> one = stackalloc TelemetrySample[1];

        for (var i = 0; i < 400; i++)
        {
            session.AddFrame(new FramePresent(
                MonotonicTimestamp.FromMilliseconds(i * 6.94), 6.94, null, false, 0));

            if (i % 10 == 0)
            {
                one[0] = Sensor(i * 6.94, 60);
                session.AddSensorSamples(one);
            }
        }

        session.History.Count.ShouldBeGreaterThan(0);

        // One sample an hour ahead. Nothing else changes.
        one[0] = Sensor(3_600_000, 60);
        session.AddSensorSamples(one);

        session.History.Count.ShouldBeGreaterThan(
            1,
            "a single future-stamped sensor sample wiped the whole correlation window");
    }

    /// <summary>
    /// A frozen source clock leaves an event open forever and blinds the detector.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The five-second <c>MaximumEventDuration</c> exists so that a pathological event cannot
    /// freeze the baseline permanently. It is measured in source timestamps. A source that stops
    /// advancing its clock while still emitting frames — a stuck QPC-derived stamp, a CSV whose
    /// timestamp column repeats, a replay that forgot to advance — never reaches that timeout.
    /// </para>
    /// <para>
    /// The event stays open, the baseline stays frozen, and no stutter is reported for the rest
    /// of the session. FrameDoctor tells the user their game is fine while it is measuring
    /// nothing at all, which is worse than saying it cannot measure.
    /// </para>
    /// </remarks>
    [Fact]
    public void A_frozen_source_clock_leaves_an_event_open_for_the_rest_of_the_session()
    {
        var session = new LiveSession(60.0);
        var diagnosed = 0;
        session.EventDiagnosed += _ => diagnosed++;

        var t = 0.0;

        // Warm up honestly.
        for (var i = 0; i < 900; i++)
        {
            session.AddFrame(new FramePresent(MonotonicTimestamp.FromMilliseconds(t), 16.67, null, false, 0));
            t += 16.67;
        }

        // A hitch opens an event, and the clock stops right here.
        session.AddFrame(new FramePresent(MonotonicTimestamp.FromMilliseconds(t), 180.0, null, false, 0));

        var frozen = MonotonicTimestamp.FromMilliseconds(t);

        // Twenty more minutes of perfectly healthy frames, all stamped at the same instant.
        for (var i = 0; i < 72_000; i++)
            session.AddFrame(new FramePresent(frozen, 16.67, null, false, 0));

        session.Detector.HasOpenEvent.ShouldBeFalse(
            "the event never force-closed, so the baseline is frozen and detection is dead");

        diagnosed.ShouldBeGreaterThan(0, "the 180 ms hitch was never reported to the user");
    }

    /// <summary>
    /// Alt-tabbing away for two minutes is reported back as the user's worst stutter.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The frame source measures CPU frame time as the interval between successive app frame
    /// starts (<c>MsBetweenAppStart</c>). While a game is minimised, alt-tabbed, on a lock screen
    /// or on a suspended machine it presents nothing, so the first frame after it comes back
    /// carries the length of the whole absence.
    /// </para>
    /// <para>
    /// <c>StutterDetector.Reset()</c> exists for exactly this — "statistics must never span a
    /// suspend, a session lock or a source restart" — but nothing in the product calls it.
    /// <c>WireCondition.AfterDiscontinuity</c> is rendered by the shell and set by no producer,
    /// and <c>SessionRecorder</c> writes <c>DiscontinuityCount: 0</c> as a literal.
    /// </para>
    /// <para>
    /// So a user who takes a phone call mid-game is told their session contained a 120,000 ms
    /// severe hitch, and the diagnostic engine goes looking for a cause for it. That is the
    /// single most confident wrong answer this product can give.
    /// </para>
    /// </remarks>
    [Fact]
    public void A_two_minute_alt_tab_is_reported_as_the_users_worst_stutter()
    {
        var session = new LiveSession(144.0);
        var events = new List<FrameDoctor.Diagnostics.Diagnosis>();
        session.EventDiagnosed += events.Add;

        var t = 0.0;

        for (var i = 0; i < 900; i++)
        {
            session.AddFrame(new FramePresent(MonotonicTimestamp.FromMilliseconds(t), 6.94, null, false, 0));
            t += 6.94;
        }

        // The user alt-tabs for two minutes. One frame carries the whole absence.
        t += 120_000.0;
        session.AddFrame(new FramePresent(MonotonicTimestamp.FromMilliseconds(t), 120_000.0, null, false, 0));

        for (var i = 0; i < 900; i++)
        {
            t += 6.94;
            session.AddFrame(new FramePresent(MonotonicTimestamp.FromMilliseconds(t), 6.94, null, false, 0));
        }

        session.Complete();

        session.Statistics().SevereCount.ShouldBe(
            0,
            "two minutes of the game not being on screen is counted as a severe hitch");
    }

    /// <summary>
    /// The Live view publishes a median from fewer frames than the catalog permits.
    /// </summary>
    /// <remarks>
    /// <c>MetricCatalog</c> requires 30 samples for <c>FrameTimeMedian</c>, and
    /// <c>LiveStatistics.MedianFrameTimeMs</c> documents itself as "rolling median, or NaN below
    /// the minimum sample size". <c>LiveSession.Statistics</c> calls <c>Median()</c> directly,
    /// which has no minimum-sample rule, so the number is published from the first frame onward.
    /// The p99 beside it correctly says "insufficient data", which makes the median look like a
    /// figure that has been earned.
    /// </remarks>
    [Fact]
    public void The_live_median_is_published_from_fewer_frames_than_the_catalog_allows()
    {
        var session = new LiveSession(144.0);

        for (var i = 0; i < 5; i++)
            session.AddFrame(new FramePresent(
                MonotonicTimestamp.FromMilliseconds(i * 6.94), 6.94, null, false, 0));

        double.IsNaN(session.Statistics().MedianFrameTimeMs).ShouldBeTrue(
            "a median computed from 5 frames is published as if it were established");
    }
}
