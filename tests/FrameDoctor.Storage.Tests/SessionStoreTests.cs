using FrameDoctor.Storage.Catalog;
using Shouldly;
using Xunit;

namespace FrameDoctor.Storage.Tests;

/// <summary>
/// Catalog behaviour, with emphasis on the migration promise: never migrate downward, never
/// delete. A user who reverts a build must find their history intact.
/// </summary>
public sealed class SessionStoreTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("fd-store-").FullName;

    private string Path(string name) => System.IO.Path.Combine(_dir, name);

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private static ConfigRecord SampleConfig(string exe = "Cyberpunk2077.exe") =>
        new(new GameRecord(exe, "abc123", "Cyberpunk 2077"),
            new MachineRecord("machine-1", "Ryzen 9 7950X", "RTX 4080", 32768, "10.0.26100"),
            "566.14", 144.0, 2560, 1440, "Balanced", "BestPerformance", true, null);

    private static SessionRecord SampleSession(Guid id) =>
        new(id, DateTimeOffset.UtcNow.UtcTicks, 10_000_000, TimeSpan.FromMinutes(43).Ticks,
            372_000, SessionState.Finalized, 0, 3.5, null, null, true);

    [Fact]
    public void A_new_store_is_created_writable_at_the_current_schema()
    {
        using var store = SessionStore.Open(Path("new.db"));

        store.OpenResult.Access.ShouldBe(StoreAccess.ReadWrite);
        store.OpenResult.SchemaVersion.ShouldBe(StoreVersion.Schema);
        store.IsWritable.ShouldBeTrue();
        store.CheckIntegrity().ShouldBeTrue();
    }

    [Fact]
    public void A_session_round_trips_with_its_events_diagnoses_and_evidence()
    {
        var path = Path("roundtrip.db");
        var id = Guid.NewGuid();

        using (var store = SessionStore.Open(path))
        {
            var repo = new SessionRepository(store);

            var evt = new EventRecord(1000, 2000, 3, 142.0, 135.1, 3.5, 6.9, 0.6, 40, 0, false, false, true);
            var diagnosis = new DiagnosisRecord(
                "background-cpu-contention", "Background CPU contention",
                0.92, 0.9998, 4.2, 1,
                "One frame took 142 ms against a 6.9 ms baseline.",
                "The render thread waited for CPU time another process was using.",
                "Close the process with id 4812 while playing.",
                [new EvidenceRecord(600, 4812, "Process 4812 rose from 2% to 85% CPU",
                    9.0, 3, 0, 24, 4.0, true, 0)],
                [new RuledOutRecord("gpu-thermal-throttle", "GPU thermal throttling",
                    "GPU peaked at 68 C with no thermal limit reported.", true)]);

            repo.Save(SampleSession(id), SampleConfig(),
                [(evt, diagnosis)],
                [new SessionStatRecord(100, -1, 372_000, 0, 0, 5.9, 6.9, 8.1, 11.4, 24.0, 142.0, null)]);
        }

        // Reopen from scratch: this is the "relaunch without losing data" requirement.
        using (var store = SessionStore.Open(path))
        {
            var loaded = new SessionRepository(store).Load(id);

            loaded.ShouldNotBeNull();
            loaded.Session.FrameCount.ShouldBe(372_000);
            loaded.Session.State.ShouldBe(SessionState.Finalized);
            loaded.Config.Game.DisplayName.ShouldBe("Cyberpunk 2077");
            loaded.Config.MonitorHz.ShouldBe(144.0);

            loaded.Events.Count.ShouldBe(1);
            var (evt, diagnosis) = loaded.Events[0];
            evt.PeakFrameTimeMs.ShouldBe(142.0);

            diagnosis.ShouldNotBeNull();
            diagnosis.RuleId.ShouldBe("background-cpu-contention");
            diagnosis.Confidence.ShouldBe(0.92);
            diagnosis.Evidence.Count.ShouldBe(1);
            diagnosis.Evidence[0].Instance.ShouldBe(4812);

            // Ruling out is part of the diagnosis, not decoration, so it must persist.
            diagnosis.RuledOut.Count.ShouldBe(1);
            diagnosis.RuledOut[0].WasCheckable.ShouldBeTrue();

            loaded.Stats.Count.ShouldBe(1);
            loaded.Stats[0].P99.ShouldBe(11.4);
        }
    }

    [Fact]
    public void Insufficient_data_survives_as_null_rather_than_becoming_a_number()
    {
        // NaN is how the pipeline says "insufficient data". If it reached disk as a value, a
        // later read would treat it as a measurement.
        var path = Path("nan.db");
        var id = Guid.NewGuid();

        using (var store = SessionStore.Open(path))
        {
            new SessionRepository(store).Save(SampleSession(id), SampleConfig(), [],
                [new SessionStatRecord(107, -1, 300, 1, 0, null, 6.9, double.NaN, double.NaN, double.NaN, 24.0, null)]);
        }

        using (var store = SessionStore.Open(path))
        {
            var stat = new SessionRepository(store).Load(id)!.Stats[0];
            stat.P95.ShouldBeNull();
            stat.P99.ShouldBeNull();
            stat.P999.ShouldBeNull();
            stat.P50.ShouldBe(6.9);
        }
    }

    [Fact]
    public void A_store_written_by_a_newer_but_additive_schema_opens_read_only()
    {
        var path = Path("newer-additive.db");
        using (var _ = SessionStore.Open(path)) { }

        // Simulate a future build that bumped the schema without breaking readers.
        BumpVersions(path, schema: StoreVersion.Schema + 5, minReader: StoreVersion.Schema);

        using var store = SessionStore.Open(path);

        store.OpenResult.Access.ShouldBe(StoreAccess.ReadOnly);
        store.IsWritable.ShouldBeFalse();
        store.OpenResult.AlternatePath.ShouldBeNull();

        // Writing must be refused rather than silently corrupting columns it does not understand.
        Should.Throw<InvalidOperationException>(() => store.BeginTransaction());
    }

    [Fact]
    public void A_store_written_by_an_incompatible_schema_is_left_untouched_and_a_new_one_started()
    {
        var path = Path("newer-destructive.db");
        using (var _ = SessionStore.Open(path)) { }

        BumpVersions(path, schema: StoreVersion.Schema + 5, minReader: StoreVersion.Schema + 5);

        var before = File.ReadAllBytes(path);

        using var store = SessionStore.Open(path);

        store.OpenResult.Access.ShouldBe(StoreAccess.StartedNewStore);
        store.OpenResult.AlternatePath.ShouldNotBeNull();
        File.Exists(store.OpenResult.AlternatePath).ShouldBeTrue();

        // The promise: the original is byte-for-byte intact. Never migrate down, never delete.
        File.ReadAllBytes(path).ShouldBe(before);

        // And the new store is usable.
        store.IsWritable.ShouldBeTrue();
    }

    [Fact]
    public void Opening_a_file_that_is_not_a_store_is_refused_cleanly()
    {
        var path = Path("random.db");
        File.WriteAllBytes(path, new byte[8192]);
        Should.Throw<Exception>(() => SessionStore.Open(path));
    }

    [Fact]
    public void A_refused_file_is_not_left_open()
    {
        // The file a refusal was about is very likely one of the user's own documents — that is
        // the whole reason SQLITE_NOTADB is refused instead of recovered from. Holding it open
        // afterwards means they cannot move, rename or delete it while FrameDoctor is running.
        //
        // The original bug was invisible on Linux, where an open file can still be unlinked, so
        // asserting deletability alone would be a test with teeth on one platform only. The
        // descriptor count below is what makes it fail on both.
        var path = Path("not-a-store.db");
        File.WriteAllBytes(path, new byte[8192]);

        Should.Throw<Exception>(() => SessionStore.Open(path));

        OpenDescriptorsFor(path).ShouldBe(0);

        // And the plain consequence, which is what a user would actually notice. This is the
        // assertion that failed on Windows, in Dispose, before the fix.
        Should.NotThrow(() => File.Delete(path));
    }

    /// <summary>
    /// How many descriptors this process still holds on a path.
    /// </summary>
    /// <remarks>
    /// Reads <c>/proc/self/fd</c>, so it answers only on Linux and returns zero elsewhere. That
    /// asymmetry is deliberate rather than a gap: on Windows a leaked handle is caught by the
    /// delete above, and on Linux nothing else would catch it at all.
    /// </remarks>
    private static int OpenDescriptorsFor(string path)
    {
        const string fdDir = "/proc/self/fd";
        if (!Directory.Exists(fdDir)) return 0;

        var target = System.IO.Path.GetFullPath(path);
        var count = 0;

        foreach (var fd in Directory.GetFiles(fdDir).Concat(Directory.GetDirectories(fdDir)))
        {
            // A descriptor can close between listing and resolving, which is not a failure —
            // it is a descriptor that is no longer open, which is what we are hoping for.
            try
            {
                if (File.ResolveLinkTarget(fd, returnFinalTarget: true)?.FullName == target) count++;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        return count;
    }

    [Fact]
    public void Purging_high_resolution_data_keeps_the_session_summary()
    {
        // Retention must never destroy the session index: that is the regression history.
        var path = Path("purge.db");
        var segment = Path("purge.fdseg");
        File.WriteAllBytes(segment, new byte[4096]);
        var id = Guid.NewGuid();

        using var store = SessionStore.Open(path);
        var repo = new SessionRepository(store);

        repo.Save(SampleSession(id) with { SegmentPath = segment, SegmentBytes = 4096 },
            SampleConfig(), [], []);

        var freed = repo.PurgeHighResolution(id);

        freed.ShouldBe(4096);
        File.Exists(segment).ShouldBeFalse();

        var loaded = repo.Load(id);
        loaded.ShouldNotBeNull();
        loaded.Session.SegmentPath.ShouldBeNull();
        loaded.Session.FrameCount.ShouldBe(372_000);   // the summary survives
    }

    [Fact]
    public void Sessions_with_different_configurations_do_not_share_a_baseline()
    {
        // A driver change must fork the baseline rather than pollute it.
        var a = SampleConfig() with { GpuDriver = "566.14" };
        var b = SampleConfig() with { GpuDriver = "572.16" };

        a.KeyHash().ShouldNotBe(b.KeyHash());

        // And an identical configuration must hash identically across runs.
        SampleConfig().KeyHash().ShouldBe(SampleConfig().KeyHash());
    }

    [Fact]
    public void The_session_list_reports_the_stutter_tally_per_session()
    {
        var path = Path("list.db");
        using var store = SessionStore.Open(path);
        var repo = new SessionRepository(store);

        var counted = new EventRecord(0, 1, 3, 142, 135, 3.5, 6.9, 0.6, 40, 0, false, false, true);
        var notCounted = new EventRecord(2, 3, 7, 21, 14, 3.5, 6.9, 0.6, 200, 0, false, true, false);

        repo.Save(SampleSession(Guid.NewGuid()), SampleConfig(),
            [(counted, null), (notCounted, null)], []);

        var list = repo.ListAll();

        list.Count.ShouldBe(1);
        list[0].GameName.ShouldBe("Cyberpunk 2077");

        // A regime change is not a stutter and must not inflate the headline number.
        list[0].StutterCount.ShouldBe(1);
    }

    [Fact]
    public void A_v1_store_is_migrated_forward_with_its_history_intact()
    {
        var path = Path("migrate.db");
        var id = Guid.NewGuid();

        using (var store = SessionStore.Open(path))
        {
            new SessionRepository(store).Save(SampleSession(id), SampleConfig(), [], []);
        }

        MakeItLookLikeV1(path);

        using (var store = SessionStore.Open(path))
        {
            store.OpenResult.Access.ShouldBe(StoreAccess.ReadWrite);
            store.OpenResult.SchemaVersion.ShouldBe(StoreVersion.Schema);

            // The point of the migration promise: the user's sessions are still there.
            new SessionRepository(store).Load(id).ShouldNotBeNull();

            TableExists(store, "comparison").ShouldBeTrue();
            TableExists(store, "regression").ShouldBeFalse();
        }
    }

    [Fact]
    public void A_migration_leaves_a_copy_of_the_store_it_upgraded()
    {
        // Migration is the one operation that can destroy a history. The copy is what makes a
        // failed one recoverable instead of a decision the user cannot undo.
        var path = Path("backup.db");

        using (var store = SessionStore.Open(path))
        {
            new SessionRepository(store).Save(SampleSession(Guid.NewGuid()), SampleConfig(), [], []);
        }

        MakeItLookLikeV1(path);
        using (var _ = SessionStore.Open(path)) { }

        File.Exists($"{path}.v1.backup").ShouldBeTrue();
    }

    [Fact]
    public void Reopening_an_already_migrated_store_does_not_migrate_again()
    {
        var path = Path("idempotent.db");
        using (var _ = SessionStore.Open(path)) { }
        MakeItLookLikeV1(path);
        using (var _ = SessionStore.Open(path)) { }

        var backup = $"{path}.v1.backup";
        var stamp = File.GetLastWriteTimeUtc(backup);

        using (var store = SessionStore.Open(path))
        {
            store.OpenResult.SchemaVersion.ShouldBe(StoreVersion.Schema);
        }

        // A second migration would overwrite the copy of the store as it was before the first.
        File.GetLastWriteTimeUtc(backup).ShouldBe(stamp);
    }

    /// <summary>Rewinds a current store to look like one written by the v1 build.</summary>
    private static void MakeItLookLikeV1(string path)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection(
            new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder
            { DataSource = path, Pooling = false }.ToString());
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText = """
            DROP INDEX IF EXISTS ux_comparison_session;
            DROP INDEX IF EXISTS ix_comparison_config;
            DROP TABLE IF EXISTS comparison;

            CREATE TABLE regression(
                id            INTEGER PRIMARY KEY,
                config_id     INTEGER NOT NULL REFERENCES config(id) ON DELETE CASCADE,
                metric        INTEGER NOT NULL,
                detected_utc  INTEGER NOT NULL,
                baseline_n    INTEGER NOT NULL,
                new_n         INTEGER NOT NULL,
                effect_pct    REAL NOT NULL,
                exact_p       REAL NOT NULL,
                changed_config TEXT
            );
            CREATE INDEX ix_regression_config ON regression(config_id, detected_utc DESC);

            UPDATE meta SET value = '1' WHERE key = 'schema_version';
            """;
        command.ExecuteNonQuery();
    }

    private static bool TableExists(SessionStore store, string table)
    {
        using var command = store.Connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=$n;";
        command.Parameters.AddWithValue("$n", table);
        return Convert.ToInt32(command.ExecuteScalar(),
            System.Globalization.CultureInfo.InvariantCulture) > 0;
    }

    private static void BumpVersions(string path, int schema, int minReader)
    {
        using var connection = new Microsoft.Data.Sqlite.SqliteConnection(
            new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder
            { DataSource = path, Pooling = false }.ToString());
        connection.Open();

        using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE meta SET value = $s WHERE key = 'schema_version';" +
            "UPDATE meta SET value = $r WHERE key = 'min_reader_version';";
        command.Parameters.AddWithValue("$s", schema.ToString());
        command.Parameters.AddWithValue("$r", minReader.ToString());
        command.ExecuteNonQuery();
    }
}
