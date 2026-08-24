using System.Globalization;
using Microsoft.Data.Sqlite;

namespace FrameDoctor.Storage.Catalog;

/// <summary>Outcome of opening a store.</summary>
/// <param name="Access">How this build may use it.</param>
/// <param name="SchemaVersion">The schema version found on disk.</param>
/// <param name="WrittenByBuild">Which build last wrote it, if recorded.</param>
/// <param name="AlternatePath">
/// When <see cref="StoreAccess.StartedNewStore"/>, where a usable store was started instead. The
/// original is untouched.
/// </param>
public readonly record struct StoreOpenResult(
    StoreAccess Access,
    int SchemaVersion,
    string? WrittenByBuild,
    string? AlternatePath);

/// <summary>
/// The session catalog: a SQLite database holding metadata, events, diagnoses and aggregates.
/// </summary>
/// <remarks>
/// <para>
/// Written in <b>one transaction at session finalize</b>, never during play. SQLite issues one
/// write per dirty page in portable code above its VFS, so its syscall cost scales with bytes
/// divided by page size — which is fine once per session and unaffordable every few seconds.
/// The frame series live in segment files for exactly that reason.
/// </para>
/// <para>
/// The migration policy is designed around one promise: <b>never migrate downward, never
/// delete.</b> A user who reverts to an older build finds their history intact even if that
/// build must start a new store beside it.
/// </para>
/// </remarks>
public sealed class SessionStore : IDisposable
{
    private readonly SqliteConnection _connection;

    private SessionStore(SqliteConnection connection, StoreOpenResult result)
    {
        _connection = connection;
        OpenResult = result;
    }

    /// <summary>How this build may use the store it opened.</summary>
    public StoreOpenResult OpenResult { get; }

    /// <summary>
    /// Whether writes are permitted on the store this instance actually opened.
    /// </summary>
    /// <remarks>
    /// True for <see cref="StoreAccess.StartedNewStore"/> as well: in that case the original
    /// file was left alone and a fresh, writable store was created beside it.
    /// </remarks>
    public bool IsWritable =>
        OpenResult.Access is StoreAccess.ReadWrite or StoreAccess.StartedNewStore;

    internal SqliteConnection Connection => _connection;

    /// <summary>
    /// Opens or creates a store.
    /// </summary>
    /// <param name="path">Database path.</param>
    /// <param name="buildId">Identifier for the current build, recorded in the store.</param>
    /// <remarks>
    /// Never throws for a store written by a newer build. That case is a normal outcome with a
    /// defined behaviour, not an error.
    /// </remarks>
    public static SessionStore Open(string path, string buildId = "dev")
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        var isNew = !File.Exists(path);
        var connection = Connect(path);

        if (isNew)
        {
            Create(connection, buildId);
            return new SessionStore(connection,
                new StoreOpenResult(StoreAccess.ReadWrite, StoreVersion.Schema, buildId, null));
        }

        // Everything that reads an existing store is inside one guard.
        //
        // A file torn by power loss can fail at any of these steps, not only the first: the
        // header pragma may read cleanly and a table query fail immediately after. This used to
        // throw a raw SQLite error out of Open, killing `sessions` and `simulate --save` with a
        // stack trace — on a product whose whole subject is what to do when a measurement is not
        // available.
        //
        // Damage is treated exactly like a destructive migration: the file is left byte for
        // byte, a fresh store is started beside it, and the caller is told where the old one is.
        // Deleting it would be destroying the user's history to make an error message go away.
        try
        {
            return OpenExisting(connection, path, buildId);
        }
        catch (SqliteException e) when (e.SqliteErrorCode == SqliteCorrupt)
        {
            connection.Dispose();
            return StartFreshBeside(path, buildId, schema: 0, writtenBy: null);
        }
    }

    /// <summary>SQLITE_CORRUPT: this was a database and its pages no longer make sense.</summary>
    /// <remarks>
    /// Deliberately not SQLITE_NOTADB. A file that was never a database is something the caller
    /// pointed us at by mistake — very possibly one of the user's own documents — and quietly
    /// starting a store beside it would be acting on a mistake instead of reporting it. A file
    /// that <i>was</i> a database and is now damaged is ours, and recovering from it is the whole
    /// point.
    /// </remarks>
    private const int SqliteCorrupt = 11;

    /// <summary>
    /// Starts a new store next to one that cannot be used, leaving the original untouched.
    /// </summary>
    /// <remarks>
    /// Shared by the two cases that reach it — a store written by a build too new to read, and a
    /// store damaged by power loss — because the correct response to both is the same: keep the
    /// file, keep measuring, and tell the caller where the old one went. Deleting it would be
    /// destroying a user's history to make an error message go away.
    /// </remarks>
    private static SessionStore StartFreshBeside(
        string path, string buildId, int schema, string? writtenBy)
    {
        var alternate = AlternatePathFor(path);
        var fresh = Connect(alternate);
        Create(fresh, buildId);

        return new SessionStore(fresh,
            new StoreOpenResult(StoreAccess.StartedNewStore, schema, writtenBy, alternate));
    }

    private static SessionStore OpenExisting(SqliteConnection connection, string path, string buildId)
    {
        var applicationId = ScalarInt(connection, "PRAGMA application_id;");

        if (applicationId != StoreVersion.ApplicationId)
        {
            connection.Dispose();
            throw new InvalidDataException(
                $"'{path}' is not a FrameDoctor store (application_id 0x{applicationId:X8}).");
        }

        var schema = ReadMetaInt(connection, MetaKeys.SchemaVersion, fallback: 0);
        var minReader = ReadMetaInt(connection, MetaKeys.MinReaderVersion, fallback: schema);
        var writtenBy = ReadMeta(connection, MetaKeys.LastWrittenByBuild);

        if (schema > StoreVersion.Schema)
        {
            if (minReader <= StoreVersion.Schema)
            {
                // Additive migration: an older build can still browse history, but must not
                // write, because it does not know what the newer columns mean.
                return new SessionStore(connection,
                    new StoreOpenResult(StoreAccess.ReadOnly, schema, writtenBy, null));
            }

            // Destructive migration. Leave the original byte-for-byte and start a new store
            // beside it, so a user who reverted a build has not lost anything.
            connection.Dispose();
            return StartFreshBeside(path, buildId, schema, writtenBy);
        }

        if (schema < StoreVersion.Schema) Migrate(connection, schema, buildId);

        WriteMeta(connection, MetaKeys.LastWrittenByBuild, buildId);
        return new SessionStore(connection,
            new StoreOpenResult(StoreAccess.ReadWrite, StoreVersion.Schema, writtenBy, null));
    }

    private static string AlternatePathFor(string path)
    {
        var dir = Path.GetDirectoryName(path) ?? ".";
        var name = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);

        for (var i = StoreVersion.Schema; ; i++)
        {
            var candidate = Path.Combine(dir, $"{name}.v{i}{ext}");
            if (!File.Exists(candidate)) return candidate;
        }
    }

    private static SqliteConnection Connect(string path)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString());

        connection.Open();
        return connection;
    }

    private static void Create(SqliteConnection connection, string buildId)
    {
        // Page size and auto_vacuum must be set before anything is written.
        foreach (var pragma in StoreSchema.CreationPragmas) Execute(connection, pragma);
        foreach (var pragma in StoreSchema.Pragmas) Execute(connection, pragma);

        using var transaction = connection.BeginTransaction();
        Execute(connection, StoreSchema.Ddl, transaction);

        WriteMeta(connection, MetaKeys.SchemaVersion, StoreVersion.Schema.ToString(CultureInfo.InvariantCulture), transaction);
        WriteMeta(connection, MetaKeys.MinReaderVersion, StoreVersion.MinReader.ToString(CultureInfo.InvariantCulture), transaction);
        WriteMeta(connection, MetaKeys.MinWriterVersion, StoreVersion.MinWriter.ToString(CultureInfo.InvariantCulture), transaction);
        WriteMeta(connection, MetaKeys.CreatedByBuild, buildId, transaction);
        WriteMeta(connection, MetaKeys.LastWrittenByBuild, buildId, transaction);
        WriteMeta(connection, MetaKeys.StoreId, Guid.NewGuid().ToString("N"), transaction);
        WriteMeta(connection, MetaKeys.CleanShutdown, "1", transaction);

        transaction.Commit();

        Execute(connection, $"PRAGMA user_version = {StoreVersion.Schema};");
    }

    /// <summary>
    /// Brings an older store up to the current schema, one version at a time.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A byte-for-byte copy is taken before the first step. Migration is the one operation that
    /// can destroy a user's history, and the copy is what makes a failed migration recoverable
    /// rather than a decision they cannot undo.
    /// </para>
    /// <para>
    /// Each step runs in its own transaction and stamps the new version inside it, so an
    /// interrupted run resumes from the last completed step rather than repeating one. If a step
    /// throws, the transaction rolls back and the store is left at its previous version — the
    /// caller sees the exception, and the backup is still on disk.
    /// </para>
    /// </remarks>
    private static void Migrate(SqliteConnection connection, int fromVersion, string buildId)
    {
        foreach (var pragma in StoreSchema.Pragmas) Execute(connection, pragma);

        BackUpBeforeMigrating(connection, fromVersion);

        for (var from = fromVersion; from < StoreVersion.Schema; from++)
        {
            // Version numbers start at 1, so the step that upgrades from v1 sits at index 0.
            var index = from - 1;
            if (index < 0 || index >= StoreSchema.Migrations.Length)
            {
                throw new InvalidOperationException(
                    $"No migration exists from schema {from} to {from + 1}.");
            }

            using var transaction = connection.BeginTransaction();
            Execute(connection, StoreSchema.Migrations[index], transaction);

            var to = (from + 1).ToString(CultureInfo.InvariantCulture);
            WriteMeta(connection, MetaKeys.SchemaVersion, to, transaction);
            WriteMeta(connection, MetaKeys.LastWrittenByBuild, buildId, transaction);
            transaction.Commit();
        }

        Execute(connection, $"PRAGMA user_version = {StoreVersion.Schema};");
    }

    /// <summary>
    /// Copies the store aside before it is migrated, best-effort.
    /// </summary>
    /// <remarks>
    /// Best-effort on purpose: a full disk must not stop a user from opening their history.
    /// The copy uses SQLite's own backup so the write-ahead log is included — copying the file
    /// with the filesystem would capture a database missing its most recent sessions.
    /// </remarks>
    private static void BackUpBeforeMigrating(SqliteConnection connection, int fromVersion)
    {
        var path = connection.DataSource;
        if (string.IsNullOrEmpty(path)) return;

        var backup = $"{path}.v{fromVersion.ToString(CultureInfo.InvariantCulture)}.backup";
        if (File.Exists(backup)) return;

        try
        {
            using var destination = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = backup,
                Mode = SqliteOpenMode.ReadWriteCreate,
                Pooling = false,
            }.ToString());

            destination.Open();
            connection.BackupDatabase(destination);
        }
        catch (SqliteException)
        {
            // No space, or a read-only directory. The migration still runs; it is the copy that
            // is optional, not the upgrade.
        }
        catch (IOException)
        {
        }
    }

    /// <summary>
    /// Runs an integrity check.
    /// </summary>
    /// <remarks>
    /// Deliberately not run on every launch: it is a full scan of the database, and the
    /// performance budget requires zero read IOPS in steady state. Run it when the previous
    /// session did not shut down cleanly.
    /// </remarks>
    public bool CheckIntegrity()
    {
        using var command = _connection.CreateCommand();
        command.CommandText = "PRAGMA integrity_check;";
        return command.ExecuteScalar() as string == "ok";
    }

    /// <summary>Marks the store as cleanly shut down, so the next launch can skip the integrity scan.</summary>
    public void MarkCleanShutdown(bool clean)
    {
        if (!IsWritable) return;
        WriteMeta(_connection, MetaKeys.CleanShutdown, clean ? "1" : "0");
    }

    /// <summary>Whether the previous run shut down cleanly.</summary>
    public bool PreviousShutdownWasClean =>
        ReadMeta(_connection, MetaKeys.CleanShutdown) != "0";

    /// <summary>Checkpoints the write-ahead log. Called at finalize and when idle, never mid-session.</summary>
    public void Checkpoint()
    {
        if (!IsWritable) return;
        Execute(_connection, "PRAGMA wal_checkpoint(TRUNCATE);");
    }

    /// <summary>Reclaims space in bounded batches. Only when idle and no game is running.</summary>
    public void IncrementalVacuum(int pages = 64)
    {
        if (!IsWritable) return;
        Execute(_connection, $"PRAGMA incremental_vacuum({pages});");
    }

    public SqliteTransaction BeginTransaction()
    {
        if (!IsWritable)
        {
            throw new InvalidOperationException(
                "This store was written by a newer build and is open read-only. " +
                $"Schema {OpenResult.SchemaVersion} was written by '{OpenResult.WrittenByBuild}'.");
        }
        return _connection.BeginTransaction();
    }

    public void Dispose()
    {
        MarkCleanShutdown(true);
        _connection.Dispose();
    }

    // ---- helpers -------------------------------------------------------------

    internal static void Execute(SqliteConnection connection, string sql, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        if (transaction is not null) command.Transaction = transaction;
        command.ExecuteNonQuery();
    }

    private static int ScalarInt(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    internal static string? ReadMeta(SqliteConnection connection, string key)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT value FROM meta WHERE key = $k;";
        command.Parameters.AddWithValue("$k", key);
        return command.ExecuteScalar() as string;
    }

    private static int ReadMetaInt(SqliteConnection connection, string key, int fallback) =>
        int.TryParse(ReadMeta(connection, key), CultureInfo.InvariantCulture, out var v) ? v : fallback;

    internal static void WriteMeta(
        SqliteConnection connection, string key, string value, SqliteTransaction? transaction = null)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            "INSERT INTO meta(key, value) VALUES($k, $v) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value;";
        command.Parameters.AddWithValue("$k", key);
        command.Parameters.AddWithValue("$v", value);
        if (transaction is not null) command.Transaction = transaction;
        command.ExecuteNonQuery();
    }
}

/// <summary>Keys used in the <c>meta</c> table.</summary>
internal static class MetaKeys
{
    public const string SchemaVersion = "schema_version";
    public const string MinReaderVersion = "min_reader_version";
    public const string MinWriterVersion = "min_writer_version";
    public const string CreatedByBuild = "created_by_build";
    public const string LastWrittenByBuild = "last_written_by_build";
    public const string StoreId = "store_id";
    public const string CleanShutdown = "clean_shutdown";
}
