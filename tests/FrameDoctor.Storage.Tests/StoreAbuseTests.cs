using Xunit;
using FrameDoctor.Storage.Catalog;
using Microsoft.Data.Sqlite;
using Shouldly;

namespace FrameDoctor.Storage.Tests;

/// <summary>
/// Adversarial: what a store does when the machine, the disk, or another process misbehaves.
/// </summary>
public sealed class StoreAbuseTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), $"framedoctor-store-abuse-{Guid.NewGuid():N}");

    public StoreAbuseTests() => Directory.CreateDirectory(_directory);

    private string Path_(string name) => Path.Combine(_directory, name);

    /// <summary>
    /// A store damaged by power loss is an unhandled exception, not a defined outcome.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A store written by a <i>newer</i> build is handled with care: the file is left
    /// byte-for-byte alone and a fresh store is started beside it. A store damaged by a power cut
    /// — the far more likely event, and the one the WAL settings exist to bound — has no such
    /// path. <c>PRAGMA application_id</c> throws a raw <c>SqliteException</c> out of
    /// <c>SessionStore.Open</c>.
    /// </para>
    /// <para>
    /// Every caller opens the store during start-up, so the user's product stops launching, and
    /// the message they get names an SQLite error rather than telling them their history is at
    /// <c>sessions.db</c> and that FrameDoctor can start a new one beside it.
    /// </para>
    /// </remarks>
    [Fact]
    public void A_corrupt_store_file_is_a_defined_outcome_rather_than_a_crash()
    {
        var path = Path_("sessions.db");

        // A header that is a valid SQLite file, with the pages after it torn.
        using (var store = SessionStore.Open(path, "test")) { }

        var bytes = File.ReadAllBytes(path);
        for (var i = 100; i < bytes.Length; i++) bytes[i] = 0xEE;
        File.WriteAllBytes(path, bytes);

        var open = Record.Exception(() =>
        {
            using var store = SessionStore.Open(path, "test");
        });

        open.ShouldBeNull("a damaged store stops FrameDoctor from starting at all");
    }

    /// <summary>
    /// Retention deletes a user's frame data before the database agrees that it is gone.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>PurgeHighResolution</c> calls <c>File.Delete</c> and only then runs the <c>UPDATE</c>
    /// that clears the reference, inside a transaction that has not yet committed. The doc
    /// comment above it claims the result is "an orphaned file but never a row pointing at a file
    /// that is gone". The ordering produces exactly the opposite.
    /// </para>
    /// <para>
    /// Anything that makes the commit fail — another process holding the write lock, a full disk,
    /// power loss — destroys the frame series while the session row still advertises it. The
    /// summary survives, so the user is told the session has high-resolution data, and opening it
    /// finds nothing. Retention is the one area where a bug is irreversible.
    /// </para>
    /// </remarks>
    [Fact]
    public void A_failed_purge_destroys_the_segment_file_it_did_not_manage_to_unlink()
    {
        var path = Path_("sessions.db");
        var segment = Path_("session-1.fdseg");
        File.WriteAllBytes(segment, new byte[4096]);

        Guid sessionId;

        using (var store = SessionStore.Open(path, "test"))
        {
            var repository = new SessionRepository(store);
            sessionId = Guid.NewGuid();
            repository.Save(
                new SessionRecord(sessionId, DateTimeOffset.UtcNow.UtcTicks, 10_000_000,
                    TimeSpan.FromMinutes(43).Ticks, 372_000, SessionState.Finalized, 0, 3.5,
                    segment, 4096, true),
                new ConfigRecord(
                    new GameRecord("Cyberpunk2077.exe", "abc123", "Cyberpunk 2077"),
                    new MachineRecord("machine-1", "Ryzen 9 7950X", "RTX 4080", 32768, "10.0.26100"),
                    "566.14", 144.0, 2560, 1440, "Balanced", "BestPerformance", true, null),
                [],
                []);
        }

        using var opened = SessionStore.Open(path, "test");

        // Another process holds the write lock: the engine finalizing a session while the CLI
        // runs retention, which is a supported combination — both open this same file.
        using var blocker = new SqliteConnection(
            new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        blocker.Open();

        using (var begin = blocker.CreateCommand())
        {
            begin.CommandText = "BEGIN IMMEDIATE;";
            begin.ExecuteNonQuery();
        }

        var repo = new SessionRepository(opened);
        var ex = Record.Exception(() => repo.PurgeHighResolution(sessionId));
        ex.ShouldBeNull("DEBUG probe");

        File.Exists(segment).ShouldBeTrue(
            "the purge deleted the user's frame data and then failed to record that it had");
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
