using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Diagnostics.Baselines;
using BaselineTrust = FrameDoctor.Diagnostics.Baselines.BaselineTrust;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Storage.Catalog;
using Shouldly;
using Xunit;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// The seam between the catalog's history and the statistics that interpret it.
/// </summary>
/// <remarks>
/// The unit suites prove the arithmetic and the query separately. What only shows up here is the
/// wiring: which sessions actually reach the builder, whether the session under test is in its
/// own baseline, and whether the verdict that gets stored is the one that was computed.
/// </remarks>
public sealed class BaselineServiceTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-standing-").FullName;
    private readonly SessionStore _store;
    private readonly SessionRepository _sessions;
    private readonly BaselineRepository _baselines;
    private readonly BaselineService _service;

    public BaselineServiceTests()
    {
        _store = SessionStore.Open(Path.Combine(_dir, "standing.db"));
        _sessions = new SessionRepository(_store);
        _baselines = new BaselineRepository(_store);
        _service = new BaselineService(_baselines);
    }

    public void Dispose()
    {
        _store.Dispose();
        Directory.Delete(_dir, recursive: true);
    }

    private static readonly ConfigRecord TheConfig = new(
        new GameRecord("Cyberpunk2077.exe", "abc123", "Cyberpunk 2077"),
        new MachineRecord("machine-1", "Ryzen 9 7950X", "RTX 4080", 32768, "10.0.26100"),
        "566.14", 144.0, 2560, 1440, "Balanced", "BestPerformance", true, null);

    private static string Key => TheConfig.KeyHash();

    private int _minutesAgo = 1000;

    /// <summary>Records one session, older than every session recorded before it.</summary>
    private Guid Record(
        double medianMs,
        int frames = 372_000,
        double? floorMs = 3.5,
        bool eligible = true)
    {
        var id = Guid.NewGuid();
        _minutesAgo -= 10;

        _sessions.Save(
            new SessionRecord(id, DateTimeOffset.UtcNow.AddMinutes(-_minutesAgo).UtcTicks,
                TimeSpan.TicksPerSecond, TimeSpan.FromMinutes(43).Ticks, frames,
                SessionState.Finalized, 0, floorMs, null, null, eligible),
            TheConfig,
            [],
            [
                Stat(MetricId.FrameTimeMedian, medianMs, frames),
                Stat(MetricId.FrameTimeP99, medianMs * 2, frames),
                Stat(MetricId.FrameLow1Pct, 1000.0 / (medianMs * 2), frames),
            ]);

        return id;
    }

    private static SessionStatRecord Stat(MetricId metric, double value, int frames) => new(
        (int)metric, TelemetrySample.NoInstance, frames,
        (int)Availability.Available, (int)Quality.Derived,
        Min: null,
        P50: metric == MetricId.FrameTimeMedian ? value : null,
        P95: null,
        P99: metric == MetricId.FrameTimeP99 ? value : null,
        P999: null,
        Max: null,
        Sum: metric == MetricId.FrameLow1Pct ? value : null);

    [Fact]
    public void A_first_session_has_no_baseline_and_says_so()
    {
        var id = Record(8.2);

        var standing = _service.Evaluate(Key, id);

        standing.Baseline.Exists.ShouldBeFalse();
        standing.Median.Verdict.ShouldBe(ComparisonVerdict.NoBaseline);
        standing.Median.Detail.ShouldContain("0 of 3");
    }

    [Fact]
    public void The_session_being_compared_is_not_part_of_its_own_baseline()
    {
        // Otherwise a bad session drags the centre it is measured against toward itself, and the
        // difference comes out smaller than it is — worst exactly when history is shortest.
        foreach (var m in new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }) Record(m);
        var subject = Record(20.0);

        var standing = _service.Evaluate(Key, subject);

        standing.Baseline.SessionCount.ShouldBe(7);
        standing.Baseline.MedianFrameTimeMs.ShouldBe(8.3, 1e-9);
        standing.Median.SessionValue.ShouldBe(20.0, 1e-9);
        standing.Median.Verdict.ShouldBe(ComparisonVerdict.Regression);
    }

    [Fact]
    public void A_quiet_session_against_a_trusted_baseline_reports_no_change()
    {
        foreach (var m in new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }) Record(m);
        var subject = Record(8.35);

        var standing = _service.Evaluate(Key, subject);

        standing.Baseline.Trust.ShouldBe(BaselineTrust.Trusted);
        standing.Median.Verdict.ShouldBe(ComparisonVerdict.WithinNoise);
    }

    [Fact]
    public void Three_sessions_of_history_can_only_be_indicative()
    {
        foreach (var m in new[] { 8.1, 8.3, 8.5 }) Record(m);
        var subject = Record(20.0);

        var standing = _service.Evaluate(Key, subject);

        standing.Baseline.Trust.ShouldBe(BaselineTrust.Provisional);
        standing.Median.Verdict.ShouldBe(ComparisonVerdict.IndicativeOnly);
    }

    [Fact]
    public void A_less_sensitive_session_is_reported_as_incomparable_not_as_a_regression()
    {
        foreach (var m in new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }) Record(m);
        var subject = Record(20.0, floorMs: 16.7);

        _service.Evaluate(Key, subject).Median.Verdict.ShouldBe(ComparisonVerdict.NotComparable);
    }

    [Fact]
    public void Short_sessions_in_the_history_do_not_reach_the_baseline()
    {
        foreach (var m in new[] { 8.0, 8.2, 8.4 }) Record(m);
        Record(40.0, frames: 500);
        Record(41.0, frames: 900);
        var subject = Record(8.3);

        var standing = _service.Evaluate(Key, subject);

        standing.Baseline.SessionCount.ShouldBe(3);
        standing.Baseline.MedianFrameTimeMs.ShouldBe(8.2, 1e-9);
    }

    [Fact]
    public void Ineligible_sessions_in_the_history_do_not_reach_the_baseline()
    {
        foreach (var m in new[] { 8.0, 8.2, 8.4 }) Record(m);
        Record(40.0, eligible: false);
        var subject = Record(8.3);

        _service.Evaluate(Key, subject).Baseline.SessionCount.ShouldBe(3);
    }

    [Fact]
    public void The_stored_baseline_names_exactly_the_sessions_it_was_built_from()
    {
        var contributors = new List<Guid>();
        foreach (var m in new[] { 8.0, 8.2, 8.4 }) contributors.Add(Record(m));

        var tooShort = Record(40.0, frames: 500);
        var subject = Record(8.3);

        _service.Evaluate(Key, subject);

        var stored = _baselines.ReadBaseline(Key, (int)MetricId.FrameTimeMedian).ShouldNotBeNull();

        stored.SessionIds.Order().ShouldBe(contributors.Order());
        stored.SessionIds.ShouldNotContain(tooShort);
        stored.SessionIds.ShouldNotContain(subject);
        stored.Minimum!.Value.ShouldBe(8.0, 1e-9);
        stored.Maximum!.Value.ShouldBe(8.4, 1e-9);
    }

    [Fact]
    public void The_verdict_that_was_computed_is_the_verdict_that_is_stored()
    {
        foreach (var m in new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }) Record(m);
        var subject = Record(20.0);

        var computed = _service.Evaluate(Key, subject).Median;
        var stored = _service.RecordedStanding(subject).ShouldNotBeNull();

        stored.Verdict.ShouldBe((int)computed.Verdict);
        stored.BaselineValue!.Value.ShouldBe(computed.BaselineValue, 1e-9);
        stored.SessionValue!.Value.ShouldBe(computed.SessionValue, 1e-9);
        stored.DifferenceMs!.Value.ShouldBe(computed.DifferenceMs, 1e-9);
        stored.NoiseMs!.Value.ShouldBe(computed.NoiseMs, 1e-9);
        stored.Detail.ShouldBe(computed.Detail);
    }

    [Fact]
    public void A_no_change_verdict_is_recorded_too()
    {
        // A history that kept only the alarms could not tell a quiet month from a detector that
        // stopped looking, and the quiet months are what give a later alarm its weight.
        foreach (var m in new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }) Record(m);
        var subject = Record(8.35);

        _service.Evaluate(Key, subject);

        _service.RecordedStanding(subject).ShouldNotBeNull()
            .Verdict.ShouldBe((int)ComparisonVerdict.WithinNoise);
    }

    [Fact]
    public void A_recorded_standing_does_not_move_when_more_sessions_arrive()
    {
        // The number shown next to a session in the list must be the comparison that was
        // actually made. Re-deriving it would make it change every time the user plays again.
        foreach (var m in new[] { 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6 }) Record(m);
        var subject = Record(20.0);

        _service.Evaluate(Key, subject);
        var atTheTime = _service.RecordedStanding(subject).ShouldNotBeNull();

        for (var i = 0; i < 5; i++)
        {
            var later = Record(19.0 + (i * 0.1));
            _service.Evaluate(Key, later);
        }

        var stillTheSame = _service.RecordedStanding(subject).ShouldNotBeNull();

        stillTheSame.BaselineValue.ShouldBe(atTheTime.BaselineValue);
        stillTheSame.Verdict.ShouldBe(atTheTime.Verdict);
        stillTheSame.Detail.ShouldBe(atTheTime.Detail);
    }

    [Fact]
    public void A_session_that_is_not_in_the_catalog_is_a_no_op_rather_than_a_throw()
    {
        // Evaluation runs after recording. A recording that failed has already reported itself,
        // and a second exception here would obscure the first.
        foreach (var m in new[] { 8.0, 8.2, 8.4 }) Record(m);

        var standing = _service.Evaluate(Key, Guid.NewGuid());

        standing.Baseline.SessionCount.ShouldBe(3);
        standing.Median.Verdict.ShouldBe(ComparisonVerdict.NoBaseline);
    }

    [Fact]
    public void An_unknown_configuration_yields_no_baseline_rather_than_a_throw()
    {
        var standing = _service.Evaluate("not-a-config", Guid.NewGuid());

        standing.Baseline.Exists.ShouldBeFalse();
        standing.Median.Verdict.ShouldBe(ComparisonVerdict.NoBaseline);
    }

    [Fact]
    public void A_session_with_no_recorded_standing_reports_nothing_rather_than_a_default()
    {
        var id = Record(8.2);

        _service.RecordedStanding(id).ShouldBeNull();
    }

    [Fact]
    public void Evaluating_the_same_session_twice_replaces_the_standing_rather_than_failing()
    {
        // A session's uniqueness constraint is enforced in the catalog. What matters here is
        // that a second pass — a retry, or a rebuild after the history changed — updates the
        // standing instead of throwing on the row already there.
        foreach (var m in new[] { 8.0, 8.2, 8.4 }) Record(m);
        var subject = Record(8.3);

        _service.Evaluate(Key, subject);
        Record(8.25);
        var second = _service.Evaluate(Key, subject).Median;

        _service.RecordedStanding(subject).ShouldNotBeNull().Detail.ShouldBe(second.Detail);
    }

    [Fact]
    public void Evaluate_rejects_an_empty_configuration_key()
    {
        Should.Throw<ArgumentException>(() => _service.Evaluate("", Guid.NewGuid()));
    }
}
