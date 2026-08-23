namespace FrameDoctor.Storage.Catalog;

/// <summary>
/// The catalog schema.
/// </summary>
/// <remarks>
/// <para>
/// This holds metadata, events, diagnoses and aggregates — never the frame series, which live
/// in segment files. Two consequences follow, and both are the reason for the split:
/// </para>
/// <list type="bullet">
///   <item>Purging a session's raw data is a file delete, costing <b>zero bytes written</b>.
///   Inside SQLite it would rewrite pages plus freelist.</item>
///   <item>If this database is unrecoverable, the bulk data is not inside it. Summary rows can
///   be rebuilt by scanning the self-describing segment files, so the user's history survives a
///   corrupted catalog.</item>
/// </list>
/// </remarks>
internal static class StoreSchema
{
    /// <summary>
    /// Settings applied on every connection.
    /// </summary>
    /// <remarks>
    /// <c>synchronous=NORMAL</c> and a 16 KB page size are measured choices from ADR 0006:
    /// SQLite issues one write per dirty page, so page size drives the syscall count directly,
    /// and 16 KB was the knee — 124 writes for a realistic finalize versus 454 at 4 KB, for an
    /// 8.7 % space cost. <c>mmap_size=0</c> because memory-mapped I/O turns page faults into
    /// unpredictable stalls, which is a bad trade for a tool whose premise is not causing them.
    /// </remarks>
    public static readonly string[] Pragmas =
    [
        "PRAGMA journal_mode = WAL;",
        "PRAGMA synchronous = NORMAL;",
        "PRAGMA foreign_keys = ON;",
        "PRAGMA busy_timeout = 5000;",
        "PRAGMA cache_size = -8000;",
        "PRAGMA temp_store = MEMORY;",
        "PRAGMA mmap_size = 0;",
        "PRAGMA wal_autocheckpoint = 0;",
        "PRAGMA journal_size_limit = 8388608;",
    ];

    /// <summary>Applied only when the database is first created.</summary>
    public static readonly string[] CreationPragmas =
    [
        "PRAGMA page_size = 16384;",
        "PRAGMA auto_vacuum = INCREMENTAL;",
        $"PRAGMA application_id = {StoreVersion.ApplicationId};",
    ];

    public const string Ddl = """
        CREATE TABLE meta(
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE machine(
            id             INTEGER PRIMARY KEY,
            fingerprint    TEXT NOT NULL UNIQUE,
            cpu_model      TEXT,
            gpu_model      TEXT,
            ram_mb         INTEGER,
            os_build       TEXT,
            first_seen_utc INTEGER NOT NULL,
            last_seen_utc  INTEGER NOT NULL
        );

        CREATE TABLE game(
            id             INTEGER PRIMARY KEY,
            exe_name       TEXT NOT NULL,
            exe_hash       TEXT,
            display_name   TEXT,
            first_seen_utc INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX ux_game ON game(exe_name, IFNULL(exe_hash, ''));

        -- Two sessions are comparable only when key_hash matches. Any change to the game
        -- build, the machine, the driver, the display mode, the power configuration, or our
        -- own applied optimizations forks the baseline rather than silently polluting it.
        CREATE TABLE config(
            id               INTEGER PRIMARY KEY,
            game_id          INTEGER NOT NULL REFERENCES game(id)    ON DELETE CASCADE,
            machine_id       INTEGER NOT NULL REFERENCES machine(id) ON DELETE CASCADE,
            gpu_driver       TEXT,
            monitor_hz       REAL,
            monitor_width    INTEGER,
            monitor_height   INTEGER,
            power_scheme     TEXT,
            power_overlay    TEXT,
            game_mode        INTEGER,
            optimizations    TEXT,
            key_hash         TEXT NOT NULL UNIQUE
        );

        CREATE TABLE session(
            id                  INTEGER PRIMARY KEY,
            uuid                BLOB NOT NULL UNIQUE,
            config_id           INTEGER NOT NULL REFERENCES config(id) ON DELETE CASCADE,
            epoch_utc           INTEGER NOT NULL,
            tick_frequency      INTEGER NOT NULL,
            duration_ticks      INTEGER,
            frame_count         INTEGER,
            state               INTEGER NOT NULL,
            degraded_mask       INTEGER NOT NULL DEFAULT 0,
            discontinuity_count INTEGER NOT NULL DEFAULT 0,
            sensitivity_floor_ms REAL,
            segment_path        TEXT,
            segment_bytes       INTEGER,
            baseline_eligible   INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX ix_session_config ON session(config_id, epoch_utc DESC);

        CREATE TABLE discontinuity(
            session_id INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
            at_ticks   INTEGER NOT NULL,
            kind       INTEGER NOT NULL,
            gap_ticks  INTEGER NOT NULL,
            PRIMARY KEY(session_id, at_ticks)
        ) WITHOUT ROWID;

        -- One row per (session, metric, instance). The whole analytical query surface.
        CREATE TABLE session_stat(
            session_id   INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
            metric       INTEGER NOT NULL,
            instance     INTEGER NOT NULL DEFAULT -1,
            n            INTEGER NOT NULL,
            availability INTEGER NOT NULL,
            quality      INTEGER NOT NULL,
            v_min        REAL,
            v_p50        REAL,
            v_p95        REAL,
            v_p99        REAL,
            v_p999       REAL,
            v_max        REAL,
            v_sum        REAL,
            histogram    BLOB,
            PRIMARY KEY(session_id, metric, instance)
        ) WITHOUT ROWID;

        CREATE TABLE event(
            id                  INTEGER PRIMARY KEY,
            session_id          INTEGER NOT NULL REFERENCES session(id) ON DELETE CASCADE,
            start_ticks         INTEGER NOT NULL,
            end_ticks           INTEGER NOT NULL,
            class               INTEGER NOT NULL,
            peak_frame_time_ms  REAL NOT NULL,
            excess_ms           REAL NOT NULL,
            threshold_ms        REAL NOT NULL,
            baseline_median_ms  REAL NOT NULL,
            baseline_scale_ms   REAL NOT NULL,
            frame_count         INTEGER NOT NULL,
            merged_count        INTEGER NOT NULL,
            during_warmup       INTEGER NOT NULL,
            force_closed        INTEGER NOT NULL,
            counts_toward_tally INTEGER NOT NULL
        );
        CREATE INDEX ix_event_session ON event(session_id, start_ticks);

        CREATE TABLE diagnosis(
            id            INTEGER PRIMARY KEY,
            event_id      INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
            rule_id       TEXT,
            title         TEXT NOT NULL,
            confidence    REAL NOT NULL,
            raw_confidence REAL NOT NULL,
            log_odds      REAL NOT NULL,
            binding_cap   INTEGER NOT NULL,
            what_happened TEXT NOT NULL,
            mechanism     TEXT,
            recommended   TEXT,
            -- The ceiling is enforced by the schema as well as the scorer. A confidence of 1.0
            -- reaching disk would mean the product claimed certainty about a correlation.
            CHECK (confidence >= 0.0 AND confidence <= 0.97)
        );
        CREATE UNIQUE INDEX ux_diagnosis_event ON diagnosis(event_id);

        -- The explainability ledger. Every number a user is shown traces to a row here.
        CREATE TABLE evidence(
            diagnosis_id     INTEGER NOT NULL REFERENCES diagnosis(id) ON DELETE CASCADE,
            ordinal          INTEGER NOT NULL,
            metric           INTEGER NOT NULL,
            instance         INTEGER NOT NULL DEFAULT -1,
            statement        TEXT NOT NULL,
            likelihood_ratio REAL NOT NULL,
            evidence_class   INTEGER NOT NULL,
            role             INTEGER NOT NULL,
            sample_count     INTEGER NOT NULL,
            native_rate_hz   REAL,
            can_order        INTEGER NOT NULL,
            quality          INTEGER NOT NULL,
            PRIMARY KEY(diagnosis_id, ordinal)
        ) WITHOUT ROWID;

        CREATE TABLE ruled_out(
            diagnosis_id INTEGER NOT NULL REFERENCES diagnosis(id) ON DELETE CASCADE,
            ordinal      INTEGER NOT NULL,
            rule_id      TEXT NOT NULL,
            title        TEXT NOT NULL,
            reason       TEXT NOT NULL,
            was_checkable INTEGER NOT NULL,
            PRIMARY KEY(diagnosis_id, ordinal)
        ) WITHOUT ROWID;

        CREATE TABLE baseline(
            config_id   INTEGER NOT NULL REFERENCES config(id) ON DELETE CASCADE,
            metric      INTEGER NOT NULL,
            n_sessions  INTEGER NOT NULL,
            median      REAL,
            scale       REAL,
            s_min       REAL,
            s_max       REAL,
            session_ids BLOB NOT NULL,
            updated_utc INTEGER NOT NULL,
            trust       INTEGER NOT NULL,
            PRIMARY KEY(config_id, metric)
        ) WITHOUT ROWID;

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
        """;
}
