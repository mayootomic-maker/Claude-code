using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Storage.Catalog;
using Shouldly;
using Xunit;

namespace FrameDoctor.Storage.Tests;

/// <summary>
/// What the catalog gives a baseline to work with, and what it records afterwards.
/// </summary>
/// <remarks>
/// The failure this suite exists to catch is the quiet one: a query that silently returns zero
/// where a session stored nothing. A baseline built on that would be a claim about a machine
/// assembled out of missing data, and it would look entirely plausible.
/// </remarks>
public sealed class BaselineRepositoryTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-baseline-").FullName;

    private string Path(string name) => System.IO.Path.Combine(_dir, name);

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static ConfigRecord Config(string exe = "Cyberpunk2077.exe", string? driver = "566.14") =>
        new(new GameRecord(exe, "abc123", "Cyberpunk 2077"),
            new MachineRecord("machine-1", "Ryzen 9 7950X", "RTX 4080", 32768, "10.0.26100"),
            driver, 144.0, 2560, 1440, "Balanced", "BestPerformance", true, null);

    private static SessionRecord Session(
        Guid id,
        long epochTicks,
        int frames = 372_000,
        double? floorMs = 3.5,
        bool eligible = true,
        SessionState state = SessionState.Finalized,
        TimeSpan? duration = null) =>
        new(id, epochTicks, TimeSpan.TicksPerSecond,
            (duration ?? TimeSpan.FromMinutes(43)).Ticks,
            frames, state, 0, floorMs, null, null, eligible);

    private static List<SessionStatRecord> Stats(
        double? medianMs, double? p99Ms = 16.0, double? low1Fps = 61.0, int frames = 372_000)
    {
        var stats = new List<SessionStatRecord>();
        Add(MetricId.FrameTimeMedian, medianMs);
        Add(MetricId.FrameTimeP99, p99Ms);
        Add(MetricId.FrameLow1Pct, low1Fps);
        return stats;

        void Add(MetricId metric, double? value) => stats.Add(new SessionStatRecord(
            (int)metric, TelemetrySample.NoInstance, frames,
            (int)(value is null ? Availability.Unavailable : Availability.Available),
            (int)Quality.Derived,
            Min: null,
            P50: metric == MetricId.FrameTimeMedian ? value : null,
            P95: null,
            P99: metric == MetricId.FrameTimeP99 ? value : null,
            P999: null,
            Max: null,
            Sum: metric == MetricId.FrameLow1Pct ? value : null));
    }

    private static Guid Write(
        SessionRepository sessions,
        ConfigRecord config,
        double? medianMs,
        int minutesAgo,
        int frames = 372_000,
        double? floorMs = 3.5,
        bool eligible = true,
        SessionState state = SessionState.Finalized,
        int stutters = 0,
        TimeSpan? duration = null)
    {
        var id = Guid.NewGuid();
        var epoch = DateTimeOffset.UtcNow.AddMinutes(-minutesAgo).UtcTicks;

        var events = new List<(EventRecord, DiagnosisRecord?)>();
        for (var i = 0; i < stutters; i++)
        {
            events.Add((new EventRecord(
                1000 + i, 2000 + i, 3, 142.0, 135.1, 3.5, 6.9, 0.6, 40, 0,
                DuringWarmUp: false, ForceClosed: false, CountsTowardTally: true), null));
        }

        sessions.Save(
            Session(id, epoch, frames, floorMs, eligible, state, duration),
            config,
            events,
            Stats(medianMs, frames: frames));

        return id;
    }

    [Fact]
    public void The_restated_metric_identifiers_match_the_enum()
    {
        // The queries name metric numbers directly so a SQL query reads as one. This is the
        // assertion that stops a renumbering from silently rewiring which column a baseline
        // reads.
        MetricIds.FrameTimeMedian.ShouldBe((int)MetricId.FrameTimeMedian);
        MetricIds.FrameTimeP99.ShouldBe((int)MetricId.FrameTimeP99);
        MetricIds.FrameLow1Pct.ShouldBe((int)MetricId.FrameLow1Pct);
    }

    [Fact]
    public void History_comes_back_newest_first_with_every_statistic_intact()
    {
        using var store = SessionStore.Open(Path("history.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        Write(sessions, config, 8.0, minutesAgo: 300, stutters: 2,
            duration: TimeSpan.FromMinutes(20));
        Write(sessions, config, 8.4, minutesAgo: 100);

        var history = baselines.HistoryFor(config.KeyHash());

        history.Count.ShouldBe(2);
        history[0].MedianFrameTimeMs.ShouldBe(8.4, 1e-9);
        history[1].MedianFrameTimeMs.ShouldBe(8.0, 1e-9);
        history[1].StutterCount.ShouldBe(2);
        history[1].Duration.ShouldBe(TimeSpan.FromMinutes(20), TimeSpan.FromSeconds(1));
        history[0].P99FrameTimeMs.ShouldBe(16.0, 1e-9);
        history[0].Low1PercentFps.ShouldBe(61.0, 1e-9);
        history[0].SensitivityFloorMs.ShouldBe(3.5, 1e-9);
        history[0].FrameCount.ShouldBe(372_000);
    }

    [Fact]
    public void An_unqualified_median_comes_back_unavailable_not_zero()
    {
        // The trap. A stored NULL means "we never qualified this number". Reading it as 0.0 ms
        // would put an infinitely fast session into the baseline, and the resulting figure would
        // look like a real measurement.
        using var store = SessionStore.Open(Path("null.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        Write(sessions, config, medianMs: null, minutesAgo: 10);

        var row = baselines.HistoryFor(config.KeyHash()).ShouldHaveSingleItem();

        double.IsNaN(row.MedianFrameTimeMs).ShouldBeTrue();
        row.MedianFrameTimeMs.ShouldNotBe(0.0);
    }

    [Fact]
    public void A_missing_sensitivity_floor_comes_back_unavailable_not_zero()
    {
        using var store = SessionStore.Open(Path("nofloor.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        Write(sessions, config, 8.0, minutesAgo: 10, floorMs: null);

        double.IsNaN(baselines.HistoryFor(config.KeyHash())[0].SensitivityFloorMs).ShouldBeTrue();
    }

    [Fact]
    public void Ineligible_sessions_are_excluded()
    {
        using var store = SessionStore.Open(Path("ineligible.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        Write(sessions, config, 8.0, minutesAgo: 30);
        Write(sessions, config, 40.0, minutesAgo: 20, eligible: false);

        var history = baselines.HistoryFor(config.KeyHash());

        history.ShouldHaveSingleItem().MedianFrameTimeMs.ShouldBe(8.0, 1e-9);
    }

    [Fact]
    public void Unfinalized_sessions_are_excluded()
    {
        // A recovered session describes an interruption. Letting it move a baseline would
        // attribute the interruption to the machine.
        using var store = SessionStore.Open(Path("recovered.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        Write(sessions, config, 8.0, minutesAgo: 30);
        Write(sessions, config, 40.0, minutesAgo: 20, state: SessionState.Recovered);
        Write(sessions, config, 41.0, minutesAgo: 10, state: SessionState.Aborted);

        baselines.HistoryFor(config.KeyHash()).ShouldHaveSingleItem();
    }

    [Fact]
    public void A_different_configuration_has_a_different_history()
    {
        // The fork rule: a driver update produces genuinely different performance, and mixing
        // the two histories would manufacture a regression out of a change the user already
        // knows about.
        using var store = SessionStore.Open(Path("fork.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);

        var before = Config(driver: "566.14");
        var after = Config(driver: "572.16");

        Write(sessions, before, 8.0, minutesAgo: 30);
        Write(sessions, after, 12.0, minutesAgo: 20);

        baselines.HistoryFor(before.KeyHash()).ShouldHaveSingleItem()
            .MedianFrameTimeMs.ShouldBe(8.0, 1e-9);
        baselines.HistoryFor(after.KeyHash()).ShouldHaveSingleItem()
            .MedianFrameTimeMs.ShouldBe(12.0, 1e-9);
    }

    [Fact]
    public void The_window_is_bounded_and_keeps_the_newest()
    {
        using var store = SessionStore.Open(Path("window.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        for (var i = 0; i < 5; i++) Write(sessions, config, 8.0 + i, minutesAgo: 100 - (i * 10));

        var history = baselines.HistoryFor(config.KeyHash(), limit: 3);

        history.Count.ShouldBe(3);
        history[0].MedianFrameTimeMs.ShouldBe(12.0, 1e-9);
        history[2].MedianFrameTimeMs.ShouldBe(10.0, 1e-9);
    }

    [Fact]
    public void An_unknown_configuration_has_an_empty_history_rather_than_an_error()
    {
        using var store = SessionStore.Open(Path("unknown.db"));

        new BaselineRepository(store).HistoryFor("not-a-config").ShouldBeEmpty();
    }

    [Fact]
    public void A_baseline_round_trips_with_the_sessions_it_was_built_from()
    {
        using var store = SessionStore.Open(Path("baseline.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();

        var first = Write(sessions, config, 8.0, minutesAgo: 30);
        var second = Write(sessions, config, 8.4, minutesAgo: 20);

        var stored = new StoredBaseline(
            (int)MetricId.FrameTimeMedian, 2, Trust: 1, 8.2, 0.2, 8.0, 8.4, [first, second]);

        baselines.SaveBaseline(config.KeyHash(), stored, DateTimeOffset.UtcNow).ShouldBeTrue();

        var read = baselines.ReadBaseline(config.KeyHash(), (int)MetricId.FrameTimeMedian)
            .ShouldNotBeNull();

        read.SessionCount.ShouldBe(2);
        read.Trust.ShouldBe(1);
        read.Median.ShouldBe(8.2);
        read.Scale.ShouldBe(0.2);
        read.SessionIds.ShouldBe([first, second]);
    }

    [Fact]
    public void Recomputing_a_baseline_replaces_it_rather_than_accumulating_rows()
    {
        using var store = SessionStore.Open(Path("replace.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();
        var id = Write(sessions, config, 8.0, minutesAgo: 30);

        var key = config.KeyHash();
        baselines.SaveBaseline(key,
            new StoredBaseline((int)MetricId.FrameTimeMedian, 3, 1, 8.2, 0.2, 8.0, 8.4, [id]),
            DateTimeOffset.UtcNow);
        baselines.SaveBaseline(key,
            new StoredBaseline((int)MetricId.FrameTimeMedian, 7, 2, 8.3, 0.2, 8.0, 8.6, [id]),
            DateTimeOffset.UtcNow);

        var read = baselines.ReadBaseline(key, (int)MetricId.FrameTimeMedian).ShouldNotBeNull();

        read.SessionCount.ShouldBe(7);
        read.Trust.ShouldBe(2);
    }

    [Fact]
    public void A_baseline_that_does_not_exist_yet_stores_absent_values_not_zeroes()
    {
        using var store = SessionStore.Open(Path("absent.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();
        Write(sessions, config, 8.0, minutesAgo: 10);

        baselines.SaveBaseline(
            config.KeyHash(),
            new StoredBaseline((int)MetricId.FrameTimeMedian, 1, Trust: 0,
                double.NaN, double.NaN, null, null, []),
            DateTimeOffset.UtcNow);

        var read = baselines.ReadBaseline(config.KeyHash(), (int)MetricId.FrameTimeMedian)
            .ShouldNotBeNull();

        read.Median.ShouldBeNull();
        read.Scale.ShouldBeNull();
        read.SessionIds.ShouldBeEmpty();
    }

    [Fact]
    public void Saving_a_baseline_for_an_unknown_configuration_reports_failure()
    {
        using var store = SessionStore.Open(Path("nocfg.db"));

        new BaselineRepository(store).SaveBaseline(
            "not-a-config",
            new StoredBaseline((int)MetricId.FrameTimeMedian, 3, 2, 8.2, 0.2, 8.0, 8.4, []),
            DateTimeOffset.UtcNow).ShouldBeFalse();
    }

    [Fact]
    public void A_comparison_round_trips_including_the_sentence_shown_to_the_user()
    {
        using var store = SessionStore.Open(Path("comparison.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();
        var id = Write(sessions, config, 10.0, minutesAgo: 5);

        var comparison = new StoredComparison(
            (int)MetricId.FrameTimeMedian, Verdict: 2, BaselineSessionCount: 7, BaselineTrust: 2,
            8.3, 10.0, 1.7, 0.6, "1.70 ms slower than the usual 8.30 ms, across 7 sessions.");

        baselines.SaveComparison(id, comparison, DateTimeOffset.UtcNow).ShouldBeTrue();

        var read = baselines.ReadComparison(id, (int)MetricId.FrameTimeMedian).ShouldNotBeNull();

        read.Verdict.ShouldBe(2);
        read.BaselineValue.ShouldBe(8.3);
        read.DifferenceMs.ShouldBe(1.7);
        read.NoiseMs.ShouldBe(0.6);
        read.SessionId.ShouldBe(id);
        read.Detail.ShouldContain("across 7 sessions");
    }

    [Fact]
    public void A_session_carries_one_comparison_per_metric_not_a_growing_pile()
    {
        using var store = SessionStore.Open(Path("once.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();
        var id = Write(sessions, config, 10.0, minutesAgo: 5);

        baselines.SaveComparison(id, new StoredComparison(
            (int)MetricId.FrameTimeMedian, 1, 3, 1, 8.3, 10.0, 1.7, 0.6, "first"),
            DateTimeOffset.UtcNow);
        baselines.SaveComparison(id, new StoredComparison(
            (int)MetricId.FrameTimeMedian, 2, 7, 2, 8.3, 10.0, 1.7, 0.6, "second"),
            DateTimeOffset.UtcNow);

        baselines.ReadComparison(id, (int)MetricId.FrameTimeMedian)!.Detail.ShouldBe("second");
        CountRows(store, "comparison").ShouldBe(1);
    }

    [Fact]
    public void A_comparison_with_no_baseline_stores_absent_values_not_zeroes()
    {
        using var store = SessionStore.Open(Path("nobaseline.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();
        var id = Write(sessions, config, 10.0, minutesAgo: 5);

        baselines.SaveComparison(id, new StoredComparison(
            (int)MetricId.FrameTimeMedian, Verdict: 0, 1, 0,
            double.NaN, 10.0, double.NaN, double.NaN, "Not enough sessions yet: 1 of 3."),
            DateTimeOffset.UtcNow);

        var read = baselines.ReadComparison(id, (int)MetricId.FrameTimeMedian).ShouldNotBeNull();

        read.BaselineValue.ShouldBeNull();
        read.DifferenceMs.ShouldBeNull();
        read.NoiseMs.ShouldBeNull();
        read.SessionValue.ShouldBe(10.0);
    }

    [Fact]
    public void Saving_a_comparison_for_an_unknown_session_reports_failure()
    {
        using var store = SessionStore.Open(Path("nosession.db"));

        new BaselineRepository(store).SaveComparison(
            Guid.NewGuid(),
            new StoredComparison((int)MetricId.FrameTimeMedian, 1, 3, 1, 8.3, 8.4, 0.1, 0.6, "x"),
            DateTimeOffset.UtcNow).ShouldBeFalse();
    }

    [Fact]
    public void Deleting_a_session_takes_its_comparison_with_it()
    {
        // A comparison outliving its session would be a claim about a run the user can no longer
        // inspect.
        using var store = SessionStore.Open(Path("cascade.db"));
        var sessions = new SessionRepository(store);
        var baselines = new BaselineRepository(store);
        var config = Config();
        var id = Write(sessions, config, 10.0, minutesAgo: 5);

        baselines.SaveComparison(id, new StoredComparison(
            (int)MetricId.FrameTimeMedian, 2, 7, 2, 8.3, 10.0, 1.7, 0.6, "gone soon"),
            DateTimeOffset.UtcNow);

        using (var command = store.Connection.CreateCommand())
        {
            command.CommandText = "DELETE FROM session WHERE uuid = $u;";
            command.Parameters.AddWithValue("$u", id.ToByteArray());
            command.ExecuteNonQuery();
        }

        CountRows(store, "comparison").ShouldBe(0);
    }

    private static int CountRows(SessionStore store, string table)
    {
        using var command = store.Connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM {table};";
        return Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
    }
}
