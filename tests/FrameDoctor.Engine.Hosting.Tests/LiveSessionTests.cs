using Xunit;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Simulation;
using Shouldly;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// The streaming session, held against the batch analyzer it has to agree with.
/// </summary>
/// <remarks>
/// The property that matters: a session running for six hours on bounded memory must reach the
/// same conclusions the analyzer reaches with the whole session in hand. If it does not, then
/// either every test written against the analyzer describes something the product does not do,
/// or the live path is quietly worse — and the symptom of the latter is lower confidence, which
/// reads as a property of the user's machine rather than as a bug.
/// </remarks>
public sealed class LiveSessionTests
{
    private static (List<Diagnosis> Live, SessionAnalysis Batch) RunBoth(string scenarioId, int seed = 20260823)
    {
        var scenario = ScenarioCatalog.ById(scenarioId);
        var samples = scenario.Generate(seed).ToArray();

        var live = new LiveSession(scenario.RefreshRateHz);
        var diagnosed = new List<Diagnosis>();
        live.EventDiagnosed += diagnosed.Add;

        Span<TelemetrySample> one = stackalloc TelemetrySample[1];

        foreach (var sample in samples)
        {
            if (sample.Metric == MetricId.FrameTime)
            {
                if (sample.TryGetValue(out var ms))
                    live.AddFrame(new FramePresent(sample.Timestamp, ms, null, false, 0));
                else
                    live.AddUnreadableFrame(sample.Timestamp);
            }
            else
            {
                one[0] = sample;
                live.AddSensorSamples(one);
            }
        }

        diagnosed.AddRange(live.Complete());

        var batch = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(samples);
        return (diagnosed, batch);
    }

    [Theory]
    [InlineData("healthy")]
    [InlineData("background-cpu-spike")]
    [InlineData("cpu-frequency-collapse")]
    [InlineData("gpu-thermal-throttle")]
    [InlineData("gpu-power-limit")]
    [InlineData("paging-storm")]
    [InlineData("unexplained-hitch")]
    public void The_streaming_session_reaches_the_same_verdicts_as_the_batch_analyzer(string scenarioId)
    {
        var (live, batch) = RunBoth(scenarioId);

        live.Count.ShouldBe(batch.Diagnoses.Count);

        for (var i = 0; i < live.Count; i++)
        {
            live[i].RuleId.ShouldBe(batch.Diagnoses[i].RuleId);
            live[i].Event.Start.ShouldBe(batch.Diagnoses[i].Event.Start);
            live[i].Event.Class.ShouldBe(batch.Diagnoses[i].Event.Class);
        }
    }

    [Theory]
    [InlineData("background-cpu-spike")]
    [InlineData("gpu-thermal-throttle")]
    [InlineData("gpu-power-limit")]
    public void Confidence_matches_too_because_the_evidence_window_is_the_same(string scenarioId)
    {
        // The interesting half. Matching rule ids with lower confidence would mean the live path
        // is diagnosing on partial evidence — which is exactly what happens if an event is
        // diagnosed the moment it closes, before its trailing evidence has arrived.
        var (live, batch) = RunBoth(scenarioId);

        for (var i = 0; i < live.Count; i++)
            live[i].Confidence.Value.ShouldBe(batch.Diagnoses[i].Confidence.Value, 1e-9);
    }

    [Theory]
    [InlineData("background-cpu-spike")]
    [InlineData("cpu-frequency-collapse")]
    public void Headline_statistics_match_the_batch_analyzer(string scenarioId)
    {
        var scenario = ScenarioCatalog.ById(scenarioId);
        var samples = scenario.Generate().ToArray();

        var live = new LiveSession(scenario.RefreshRateHz);
        Span<TelemetrySample> one = stackalloc TelemetrySample[1];

        foreach (var sample in samples)
        {
            if (sample.Metric == MetricId.FrameTime && sample.TryGetValue(out var ms))
                live.AddFrame(new FramePresent(sample.Timestamp, ms, null, false, 0));
            else if (sample.Metric != MetricId.FrameTime)
            {
                one[0] = sample;
                live.AddSensorSamples(one);
            }
        }

        live.Complete();

        var stats = live.Statistics();
        var batch = new SessionAnalyzer(scenario.RefreshRateHz).Analyze(samples);

        stats.FrameCount.ShouldBe(batch.FrameCount);
        stats.MedianFrameTimeMs.ShouldBe(batch.MedianFrameTimeMs, 1e-9);
        stats.StutterCount.ShouldBe(batch.StutterCount);
        stats.SevereCount.ShouldBe(batch.SevereStutterCount);
    }

    [Fact]
    public void Memory_stays_bounded_across_a_long_session()
    {
        // The reason this class exists. The analyzer holds every sample; a six-hour session at
        // 4 Hz across fifteen metrics is millions of them.
        var scenario = ScenarioCatalog.ById("healthy");
        var live = new LiveSession(scenario.RefreshRateHz);

        Span<TelemetrySample> one = stackalloc TelemetrySample[1];

        // Ten passes of a 90-second scenario, with timestamps advanced so it reads as one long
        // session rather than ten replays of the same ninety seconds.
        for (var pass = 0; pass < 10; pass++)
        {
            var offset = TimeSpan.FromSeconds(pass * 90);

            foreach (var sample in scenario.Generate(20260823 + pass))
            {
                var shifted = sample.Timestamp + offset;

                if (sample.Metric == MetricId.FrameTime)
                {
                    if (sample.TryGetValue(out var ms))
                        live.AddFrame(new FramePresent(shifted, ms, null, false, 0));
                }
                else
                {
                    one[0] = TelemetrySample.Measured(
                        shifted, sample.Metric, sample.Source, sample.GetValueOr(0),
                        sample.Unit, sample.Quality, sample.Instance);
                    live.AddSensorSamples(one);
                }
            }
        }

        // Retention is 30 s at roughly 15 metrics x 4 Hz. The bound is generous on purpose: the
        // assertion is that the history does not grow with session length, not that it holds an
        // exact number.
        live.History.Count.ShouldBeLessThan(5_000);
        live.History.DroppedAsTooOld.ShouldBeGreaterThan(10_000);
    }

    [Fact]
    public void An_event_still_open_when_the_session_ends_is_diagnosed_rather_than_discarded()
    {
        // The game quitting is often what ended the stutter. Dropping the event would lose the
        // most severe one in the session precisely when it matters.
        var live = new LiveSession(refreshRateHz: 144.0);
        var t = Abstractions.Time.MonotonicTimestamp.Zero;

        for (var i = 0; i < 4000; i++)
        {
            t += TimeSpan.FromMilliseconds(6.94);
            live.AddFrame(new FramePresent(t, 6.94, null, false, 0));
        }

        // A long frame at the very end, with nothing after it to close the event.
        t += TimeSpan.FromMilliseconds(180);
        live.AddFrame(new FramePresent(t, 180, null, false, 0));

        var remaining = live.Complete();

        remaining.ShouldNotBeEmpty();
        remaining[0].Event.PeakFrameTimeMs.ShouldBeGreaterThan(100);
    }

    [Fact]
    public void A_history_shorter_than_its_correlation_window_is_refused_at_construction()
    {
        // Silently producing diagnoses that are missing their own evidence would look like the
        // user's machine being poorly instrumented rather than like a bug.
        Should.Throw<ArgumentException>(() => new LiveSession(
            144.0,
            correlationPadding: TimeSpan.FromSeconds(5),
            history: new SensorHistory(TimeSpan.FromSeconds(4))));
    }
}
