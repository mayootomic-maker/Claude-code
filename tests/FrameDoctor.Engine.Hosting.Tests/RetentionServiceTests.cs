using FrameDoctor.Abstractions.Telemetry;
using FrameDoctor.Engine.Hosting;
using FrameDoctor.Storage.Catalog;
using FrameDoctor.Storage.Segments;
using Shouldly;
using Xunit;

namespace FrameDoctor.Engine.Hosting.Tests;

/// <summary>
/// Reclaiming frame series once they are older than the user asked to keep them.
/// </summary>
/// <remarks>
/// The most dangerous code in the product: it is the only part that deletes a user's data on its
/// own initiative, and a mistake here is irreversible. Every test is therefore about what it must
/// <i>not</i> delete — summaries, live segments, files it cannot identify — with the reclaiming
/// itself asserted almost as an afterthought.
/// </remarks>
public sealed class RetentionServiceTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-retention-").FullName;
    private readonly SessionStore _store;
    private readonly SessionRepository _repository;
    private readonly FixedTime _time = new(new DateTimeOffset(2026, 8, 24, 12, 0, 0, TimeSpan.Zero));

    public RetentionServiceTests()
    {
        _store = SessionStore.Open(Path.Combine(_dir, "sessions.db"));
        _repository = new SessionRepository(_store);
        Directory.CreateDirectory(Segments);
    }

    public void Dispose()
    {
        _store.Dispose();
        Directory.Delete(_dir, recursive: true);
    }

    private string Segments => Path.Combine(_dir, "segments");

    private RetentionService Service() => new(_repository, _time);

    private static ConfigRecord Config => new(
        new GameRecord("Cyberpunk2077.exe", "abc123", "Cyberpunk 2077"),
        new MachineRecord("machine-1", "Ryzen", "RTX", 32768, "10.0.26100"),
        "566.14", 144.0, 2560, 1440, null, null, null, null);

    /// <summary>Records a session with a real segment file on disk.</summary>
    private (Guid Id, string Path) WriteSession(int daysAgo, int payloadBytes = 4096)
    {
        var id = Guid.NewGuid();
        var started = _time.GetUtcNow().AddDays(-daysAgo);
        var path = Path.Combine(Segments, $"{id:N}.fdseg");

        using (var writer = SegmentWriter.Create(path, id, TimeSpan.TicksPerSecond, started))
        {
            writer.WriteChunk(ChunkKind.FrameTimeline, 0, 1, new byte[payloadBytes]);
        }

        _repository.Save(
            new SessionRecord(id, started.UtcTicks, TimeSpan.TicksPerSecond,
                TimeSpan.FromMinutes(43).Ticks, 372_000, SessionState.Finalized, 0, 3.5,
                path, new FileInfo(path).Length, true),
            Config,
            [(new EventRecord(1, 2, 3, 142, 135, 3.5, 6.9, 0.6, 40, 0, false, false, true), null)],
            [new SessionStatRecord((int)MetricId.FrameTimeMedian, TelemetrySample.NoInstance,
                372_000, (int)Availability.Available, (int)Quality.Derived,
                null, 6.9, null, null, null, null, null)]);

        // The sweep only considers files older than its grace period.
        File.SetLastWriteTimeUtc(path, started.UtcDateTime);

        return (id, path);
    }

    [Fact]
    public void A_session_inside_the_window_keeps_its_frames()
    {
        var (id, path) = WriteSession(daysAgo: 3);

        var report = Service().Run(retentionDays: 14, Segments);

        report.SessionsPurged.ShouldBe(0);
        File.Exists(path).ShouldBeTrue();
        _repository.Load(id).ShouldNotBeNull().Session.SegmentPath.ShouldBe(path);
    }

    [Fact]
    public void A_session_past_the_window_loses_its_frames_and_keeps_everything_else()
    {
        // The whole design in one assertion. Reclaiming space by dropping the session index
        // would destroy the regression history, which is the feature the history exists for.
        var (id, path) = WriteSession(daysAgo: 40);

        var report = Service().Run(retentionDays: 14, Segments);

        report.SessionsPurged.ShouldBe(1);
        report.BytesFreed.ShouldBeGreaterThan(0);
        File.Exists(path).ShouldBeFalse();

        var stored = _repository.Load(id).ShouldNotBeNull();
        stored.Session.SegmentPath.ShouldBeNull();
        stored.Session.FrameCount.ShouldBe(372_000);
        stored.Events.Count.ShouldBe(1);
        stored.Stats.Count.ShouldBe(1);
    }

    [Fact]
    public void The_boundary_is_the_retention_window_the_user_set()
    {
        WriteSession(daysAgo: 8);
        WriteSession(daysAgo: 20);

        Service().Run(retentionDays: 14, Segments).SessionsPurged.ShouldBe(1);
        Service().Run(retentionDays: 7, Segments).SessionsPurged.ShouldBe(1);
        Service().Run(retentionDays: 7, Segments).SessionsPurged.ShouldBe(0);
    }

    [Fact]
    public void A_zero_or_negative_window_is_refused_rather_than_read_as_keep_nothing()
    {
        // The value arrives from a settings file a user can edit by hand. Interpreting zero as
        // "delete everything immediately" would make a typo destroy their history.
        Should.Throw<ArgumentOutOfRangeException>(() => Service().Run(0, Segments));
        Should.Throw<ArgumentOutOfRangeException>(() => Service().Run(-1, Segments));
    }

    [Fact]
    public void An_already_purged_session_is_not_purged_again()
    {
        WriteSession(daysAgo: 40);

        Service().Run(retentionDays: 14, Segments).SessionsPurged.ShouldBe(1);

        // A second pass reporting work it did not do would make every launch look busy.
        Service().Run(retentionDays: 14, Segments).DidAnything.ShouldBeFalse();
    }

    [Fact]
    public void One_pass_is_bounded()
    {
        for (var i = 0; i < 5; i++) WriteSession(daysAgo: 40 + i);

        Service().Run(retentionDays: 14, Segments, limit: 2).SessionsPurged.ShouldBe(2);
        Service().Run(retentionDays: 14, Segments, limit: 2).SessionsPurged.ShouldBe(2);
        Service().Run(retentionDays: 14, Segments, limit: 2).SessionsPurged.ShouldBe(1);
    }

    [Fact]
    public void The_oldest_sessions_go_first()
    {
        var oldest = WriteSession(daysAgo: 90);
        var newer = WriteSession(daysAgo: 20);

        Service().Run(retentionDays: 14, Segments, limit: 1);

        File.Exists(oldest.Path).ShouldBeFalse();
        File.Exists(newer.Path).ShouldBeTrue();
    }

    // ---- The orphan sweep, which is the part that can destroy something -------------------

    [Fact]
    public void A_file_no_session_references_is_reclaimed()
    {
        // What an interrupted purge leaves behind: the row committed its cleared reference and
        // the unlink never happened.
        var (id, path) = WriteSession(daysAgo: 40);
        _repository.PurgeHighResolution(id);

        // Put it back, as a crash between the commit and the unlink would have.
        using (var writer = SegmentWriter.Create(path, id, TimeSpan.TicksPerSecond, _time.GetUtcNow()))
        {
            writer.WriteChunk(ChunkKind.FrameTimeline, 0, 1, new byte[2048]);
        }
        File.SetLastWriteTimeUtc(path, _time.GetUtcNow().AddDays(-2).UtcDateTime);

        var report = Service().Run(retentionDays: 14, Segments);

        report.OrphansRemoved.ShouldBe(1);
        File.Exists(path).ShouldBeFalse();
    }

    [Fact]
    public void A_live_session_s_segment_is_never_mistaken_for_an_orphan()
    {
        // A session in progress has a file and no committed row pointing at it, so it looks
        // exactly like an orphan. This is the test that stands between the sweep and a user's
        // session in progress.
        var id = Guid.NewGuid();
        var path = Path.Combine(Segments, $"{id:N}.fdseg");

        using (var writer = SegmentWriter.Create(path, id, TimeSpan.TicksPerSecond, _time.GetUtcNow()))
        {
            writer.WriteChunk(ChunkKind.FrameTimeline, 0, 1, new byte[1024]);
        }

        var report = Service().Run(retentionDays: 14, Segments);

        report.OrphansRemoved.ShouldBe(0);
        File.Exists(path).ShouldBeTrue();
    }

    [Fact]
    public void A_file_that_is_not_a_segment_is_left_alone_and_counted()
    {
        // Deleting on a filename pattern would take this with it. The sweep asks the file which
        // session it belongs to, and a file that cannot answer keeps its place on the disk.
        var stranger = Path.Combine(Segments, "important.fdseg");
        File.WriteAllText(stranger, "this is not a segment file");
        File.SetLastWriteTimeUtc(stranger, _time.GetUtcNow().AddDays(-30).UtcDateTime);

        var report = Service().Run(retentionDays: 14, Segments);

        File.Exists(stranger).ShouldBeTrue();
        report.OrphansRemoved.ShouldBe(0);
        report.Skipped.ShouldBe(1);
    }

    [Fact]
    public void A_segment_with_a_corrupt_header_is_left_alone()
    {
        // An unreadable header is a reason to leave a file alone, not a licence to reclaim it.
        var (_, path) = WriteSession(daysAgo: 3);
        var bytes = File.ReadAllBytes(path);
        bytes[10] ^= 0xFF;
        File.WriteAllBytes(path, bytes);
        File.SetLastWriteTimeUtc(path, _time.GetUtcNow().AddDays(-3).UtcDateTime);

        var report = Service().Run(retentionDays: 14, Segments);

        File.Exists(path).ShouldBeTrue();
        report.Skipped.ShouldBe(1);
    }

    [Fact]
    public void A_referenced_segment_is_never_swept_even_when_it_is_old()
    {
        // Belt and braces against the sweep and the purge disagreeing: this file is old enough
        // for the sweep but its session is inside the retention window.
        var (_, path) = WriteSession(daysAgo: 5);

        Service().Run(retentionDays: 90, Segments).OrphansRemoved.ShouldBe(0);
        File.Exists(path).ShouldBeTrue();
    }

    [Fact]
    public void An_unknown_segment_directory_skips_the_sweep_rather_than_guessing()
    {
        WriteSession(daysAgo: 40);

        foreach (var directory in new[] { null, "", Path.Combine(_dir, "nowhere") })
        {
            var report = Service().Run(retentionDays: 14, directory);
            report.OrphansRemoved.ShouldBe(0);
            report.Skipped.ShouldBe(0);
        }
    }

    // ---- What it says afterwards ----------------------------------------------------------

    [Fact]
    public void A_pass_that_found_nothing_says_nothing()
    {
        // The common case. A line every launch saying "nothing to do" trains a reader to skip
        // the line that matters.
        Service().Run(retentionDays: 14, Segments).Describe().ShouldBeNull();
    }

    [Fact]
    public void A_pass_that_did_something_says_what()
    {
        WriteSession(daysAgo: 40);

        var line = Service().Run(retentionDays: 14, Segments).Describe().ShouldNotBeNull();

        line.ShouldContain("1 session past the retention window");
        line.ShouldContain("MB reclaimed");
        line.ShouldNotContain("NaN");
    }

    [Fact]
    public void Files_it_declined_to_identify_are_reported_rather_than_swallowed()
    {
        // A growing number here means the sweep is failing to reclaim space, and silence would
        // look identical to a clean disk.
        var stranger = Path.Combine(Segments, "stranger.fdseg");
        File.WriteAllText(stranger, "not a segment");
        File.SetLastWriteTimeUtc(stranger, _time.GetUtcNow().AddDays(-30).UtcDateTime);

        Service().Run(retentionDays: 14, Segments).Describe()
            .ShouldNotBeNull().ShouldContain("could not be identified");
    }

    [Fact]
    public void The_service_refuses_to_be_built_without_a_repository()
    {
        Should.Throw<ArgumentNullException>(() => new RetentionService(null!));
    }

    /// <summary>A clock that does not move, so a retention window is exact rather than nearly.</summary>
    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
