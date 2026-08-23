using Xunit;
using FrameDoctor.Abstractions.Collection;
using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Abstractions.Time;
using FrameDoctor.Diagnostics;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Simulation;
using FrameDoctor.Storage.Catalog;
using Shouldly;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// The whole loop: simulated telemetry through the live pipeline, into the catalog, and back.
/// </summary>
/// <remarks>
/// The storage layer had forty tests against its own format and none against the pipeline that
/// fills it. The failure mode this covers is the one those tests cannot see: a session that
/// writes successfully and reads back describing something slightly different from what
/// happened, which is indistinguishable from a real change in the user's machine when they
/// compare two sessions a month apart.
/// </remarks>
public sealed class SessionRecorderTests : IDisposable
{
    private readonly string _storePath =
        Path.Combine(Path.GetTempPath(), $"framedoctor-{Guid.NewGuid():N}.db");

    private static ConfigRecord Config(string game) => new(
        new GameRecord($"{game}.sim", null, game),
        new MachineRecord("test-machine", "Test CPU", "Test GPU", 32768, "10.0.26100"),
        GpuDriver: "999.99",
        MonitorHz: 144.0,
        MonitorWidth: 2560,
        MonitorHeight: 1440,
        PowerScheme: null,
        PowerOverlay: null,
        GameMode: null,
        Optimizations: null);

    private static (LiveStatistics Stats, List<Diagnosis> Diagnoses) RunScenario(string id)
    {
        var scenario = ScenarioCatalog.ById(id);
        var session = new LiveSession(scenario.RefreshRateHz);
        var diagnoses = new List<Diagnosis>();
        session.EventDiagnosed += diagnoses.Add;

        var one = new TelemetrySample[1];

        foreach (var sample in scenario.Generate())
        {
            if (sample.Metric == MetricId.FrameTime)
            {
                if (sample.TryGetValue(out var ms))
                    session.AddFrame(new FramePresent(sample.Timestamp, ms, null, false, 0));
                else
                    session.AddUnreadableFrame(sample.Timestamp);
            }
            else
            {
                one[0] = sample;
                session.AddSensorSamples(one);
            }
        }

        diagnoses.AddRange(session.Complete());
        return (session.Statistics(), diagnoses);
    }

    private (Guid Id, LiveStatistics Stats, List<Diagnosis> Diagnoses) Record(
        string scenarioId, bool baselineEligible = true)
    {
        var (stats, diagnoses) = RunScenario(scenarioId);

        using var store = SessionStore.Open(_storePath);
        var recorder = new SessionRecorder(new SessionRepository(store));
        var id = recorder.Record(Config(scenarioId), new FixedClock(), stats, diagnoses, baselineEligible);

        return (id, stats, diagnoses);
    }

    [Fact]
    public void A_recorded_session_reads_back_with_the_same_frames_and_events()
    {
        var (id, stats, diagnoses) = Record("gpu-power-limit");

        using var store = SessionStore.Open(_storePath);
        var loaded = new SessionRepository(store).Load(id);

        loaded.ShouldNotBeNull();
        loaded.Session.FrameCount.ShouldBe(stats.FrameCount);
        loaded.Session.State.ShouldBe(SessionState.Finalized);
        loaded.Events.Count.ShouldBe(diagnoses.Count);
    }

    [Fact]
    public void Every_events_threshold_and_baseline_survive_the_round_trip()
    {
        // The numbers that make a stored event reproducible. Without them a reader a month
        // later cannot check the arithmetic, and the event becomes a claim rather than a
        // measurement.
        var (id, _, diagnoses) = Record("cpu-frequency-collapse");

        using var store = SessionStore.Open(_storePath);
        var loaded = new SessionRepository(store).Load(id)!;

        for (var i = 0; i < diagnoses.Count; i++)
        {
            var original = diagnoses[i].Event;
            var stored = loaded.Events[i].Event;

            stored.ThresholdMs.ShouldBe(original.ThresholdMs, 1e-9);
            stored.BaselineMedianMs.ShouldBe(original.BaselineMedianMs, 1e-9);
            stored.BaselineScaleMs.ShouldBe(original.BaselineScaleMs, 1e-9);
            stored.PeakFrameTimeMs.ShouldBe(original.PeakFrameTimeMs, 1e-9);
            stored.FrameCount.ShouldBe(original.FrameCount);
            stored.Class.ShouldBe((int)original.Class);
        }
    }

    [Fact]
    public void The_diagnosis_survives_with_its_evidence_and_its_rejections()
    {
        var (id, _, diagnoses) = Record("gpu-power-limit");

        using var store = SessionStore.Open(_storePath);
        var loaded = new SessionRepository(store).Load(id)!;

        var original = diagnoses[0];
        var stored = loaded.Events[0].Diagnosis;

        stored.ShouldNotBeNull();
        stored.RuleId.ShouldBe(original.RuleId);
        stored.Confidence.ShouldBe(original.Confidence.Value, 1e-9);
        stored.BindingCap.ShouldBe((int)original.Confidence.BindingCap);
        stored.Evidence.Count.ShouldBe(original.Evidence.Count);

        // Ruled-out hypotheses are stored, not recomputed on read. What was excluded depends on
        // which sensors existed at the time, and a session read back after a driver install must
        // not claim a hypothesis was excluded using evidence that did not exist yet.
        stored.RuledOut.Count.ShouldBe(original.RuledOut.Count);
        stored.RuledOut.Count(r => !r.WasCheckable)
            .ShouldBe(original.RuledOut.Count(r => !r.WasCheckable));
    }

    [Fact]
    public void An_unexplained_event_is_stored_as_unexplained_rather_than_as_a_weak_guess()
    {
        var (id, _, diagnoses) = Record("unexplained-hitch");

        diagnoses.ShouldNotBeEmpty();
        diagnoses[0].IsExplained.ShouldBeFalse();

        using var store = SessionStore.Open(_storePath);
        var loaded = new SessionRepository(store).Load(id)!;

        loaded.Events[0].Diagnosis!.RuleId.ShouldBeNull();

        // The value of an unexplained event is the list of things that were checked and
        // excluded. Losing it on the way to disk would turn a useful finding into a shrug.
        loaded.Events[0].Diagnosis!.RuledOut.ShouldNotBeEmpty();
    }

    [Fact]
    public void A_session_listing_reports_only_the_events_a_user_would_call_stutters()
    {
        // Warm-up events and regime changes are real observations and are stored, but they are
        // not what someone means by "my game stuttered". Counting them would inflate the number
        // that matters most on this screen.
        var (_, stats, _) = Record("gpu-thermal-throttle");

        using var store = SessionStore.Open(_storePath);
        var listed = new SessionRepository(store).ListAll();

        listed.Count.ShouldBe(1);
        listed[0].StutterCount.ShouldBe(stats.StutterCount);
        listed[0].GameName.ShouldBe("gpu-thermal-throttle");
    }

    [Fact]
    public void Sessions_are_listed_newest_first()
    {
        Record("healthy");
        Record("gpu-power-limit");

        using var store = SessionStore.Open(_storePath);
        var listed = new SessionRepository(store).ListAll();

        listed.Count.ShouldBe(2);
        listed[0].Session.EpochUtcTicks.ShouldBeGreaterThanOrEqualTo(listed[1].Session.EpochUtcTicks);
    }

    [Fact]
    public void A_session_excluded_from_baselines_records_that_it_was()
    {
        // A session with a degraded source is worth keeping and must never move a baseline:
        // comparing across it would manufacture a regression out of a measurement problem.
        var (id, _, _) = Record("healthy", baselineEligible: false);

        using var store = SessionStore.Open(_storePath);
        new SessionRepository(store).Load(id)!.Session.BaselineEligible.ShouldBeFalse();
    }

    [Fact]
    public void Dropped_frames_disqualify_a_session_from_baselines_on_their_own()
    {
        // Even when the caller says the session is eligible. A frame FrameDoctor itself failed
        // to keep up with is indistinguishable in the data from a frame the game never rendered,
        // so a session containing them cannot be a reference for anything.
        var (stats, diagnoses) = RunScenario("healthy");
        var degraded = stats with { FramesLostToBackpressure = 12 };

        using var store = SessionStore.Open(_storePath);
        var recorder = new SessionRecorder(new SessionRepository(store));
        var id = recorder.Record(Config("healthy"), new FixedClock(), degraded, diagnoses,
            baselineEligible: true);

        new SessionRepository(store).Load(id)!.Session.BaselineEligible.ShouldBeFalse();
    }

    [Fact]
    public void A_statistic_below_its_minimum_sample_size_is_stored_as_absent_not_as_a_number()
    {
        // Retention eventually deletes the frames these were computed from, so an unqualified
        // percentile stored today becomes an unfalsifiable one later.
        var (stats, diagnoses) = RunScenario("healthy");
        var tiny = stats with { P99FrameTimeMs = double.NaN };

        using var store = SessionStore.Open(_storePath);
        var recorder = new SessionRecorder(new SessionRepository(store));
        var id = recorder.Record(Config("healthy"), new FixedClock(), tiny, diagnoses);

        var loaded = new SessionRepository(store).Load(id)!;
        var p99 = loaded.Stats.First(s => s.Metric == (int)MetricId.FrameTimeP99);

        p99.Availability.ShouldBe((int)Availability.Unavailable);
        p99.P99.ShouldBeNull();
    }

    public void Dispose()
    {
        if (File.Exists(_storePath)) File.Delete(_storePath);
        foreach (var suffix in new[] { "-wal", "-shm" })
        {
            var path = _storePath + suffix;
            if (File.Exists(path)) File.Delete(path);
        }
    }

    /// <summary>A clock with a fixed epoch, so a recorded session is reproducible.</summary>
    private sealed class FixedClock : IMonotonicClock
    {
        private static readonly DateTimeOffset Epoch = new(2026, 8, 23, 12, 0, 0, TimeSpan.Zero);

        public MonotonicTimestamp Now => MonotonicTimestamp.Zero;
        public DateTimeOffset EpochUtc => Epoch;
        public DateTimeOffset ToUtc(MonotonicTimestamp timestamp) => Epoch + timestamp.SinceEpoch;
    }
}
