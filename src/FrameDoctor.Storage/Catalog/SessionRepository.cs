using Microsoft.Data.Sqlite;

namespace FrameDoctor.Storage.Catalog;

/// <summary>A session together with everything learned about it.</summary>
public sealed record StoredSession(
    SessionRecord Session,
    ConfigRecord Config,
    IReadOnlyList<(EventRecord Event, DiagnosisRecord? Diagnosis)> Events,
    IReadOnlyList<SessionStatRecord> Stats);

/// <summary>
/// Reads and writes sessions in the catalog.
/// </summary>
/// <remarks>
/// A whole session is written in <b>one transaction at finalize</b>. Nothing here runs while a
/// game is being monitored: SQLite's write cost scales with dirty pages, which is affordable
/// once per session and not every few seconds. The frame series never come through here — they
/// live in segment files.
/// </remarks>
public sealed class SessionRepository(SessionStore store)
{
    private readonly SessionStore _store = store ?? throw new ArgumentNullException(nameof(store));

    /// <summary>Writes a complete session and everything derived from it.</summary>
    /// <returns>The session's row id.</returns>
    public long Save(
        SessionRecord session,
        ConfigRecord config,
        IReadOnlyList<(EventRecord Event, DiagnosisRecord? Diagnosis)> events,
        IReadOnlyList<SessionStatRecord> stats)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(config);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(stats);

        using var transaction = _store.BeginTransaction();

        var machineId = UpsertMachine(config.Machine, transaction);
        var gameId = UpsertGame(config.Game, transaction);
        var configId = UpsertConfig(config, gameId, machineId, transaction);
        var sessionId = InsertSession(session, configId, transaction);

        foreach (var (evt, diagnosis) in events)
        {
            var eventId = InsertEvent(evt, sessionId, transaction);
            if (diagnosis is not null) InsertDiagnosis(diagnosis, eventId, transaction);
        }

        foreach (var stat in stats) InsertStat(stat, sessionId, transaction);

        transaction.Commit();
        return sessionId;
    }

    /// <summary>Loads one session by its identifier, or null.</summary>
    public StoredSession? Load(Guid id)
    {
        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT s.id, s.uuid, s.epoch_utc, s.tick_frequency, s.duration_ticks, s.frame_count,
                   s.state, s.discontinuity_count, s.sensitivity_floor_ms, s.segment_path,
                   s.segment_bytes, s.baseline_eligible, s.config_id
            FROM session s WHERE s.uuid = $uuid;
            """;
        command.Parameters.AddWithValue("$uuid", id.ToByteArray());

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;

        var rowId = reader.GetInt64(0);
        var session = new SessionRecord(
            new Guid((byte[])reader["uuid"]),
            reader.GetInt64(2),
            reader.GetInt64(3),
            reader.GetInt64(4),
            reader.GetInt32(5),
            (SessionState)reader.GetInt32(6),
            reader.GetInt32(7),
            reader.IsDBNull(8) ? null : reader.GetDouble(8),
            reader.IsDBNull(9) ? null : reader.GetString(9),
            reader.IsDBNull(10) ? null : reader.GetInt64(10),
            reader.GetInt32(11) != 0) { RowId = rowId };

        var configId = reader.GetInt64(12);
        reader.Close();

        return new StoredSession(session, LoadConfig(configId), LoadEvents(rowId), LoadStats(rowId));
    }

    /// <summary>Sessions for one configuration, newest first.</summary>
    public IReadOnlyList<SessionRecord> RecentFor(string configKeyHash, int limit = 20)
    {
        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT s.id, s.uuid, s.epoch_utc, s.tick_frequency, s.duration_ticks, s.frame_count,
                   s.state, s.discontinuity_count, s.sensitivity_floor_ms, s.segment_path,
                   s.segment_bytes, s.baseline_eligible
            FROM session s
            JOIN config c ON c.id = s.config_id
            WHERE c.key_hash = $k
            ORDER BY s.epoch_utc DESC
            LIMIT $n;
            """;
        command.Parameters.AddWithValue("$k", configKeyHash);
        command.Parameters.AddWithValue("$n", limit);

        var result = new List<SessionRecord>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            result.Add(new SessionRecord(
                new Guid((byte[])reader["uuid"]),
                reader.GetInt64(2), reader.GetInt64(3), reader.GetInt64(4), reader.GetInt32(5),
                (SessionState)reader.GetInt32(6), reader.GetInt32(7),
                reader.IsDBNull(8) ? null : reader.GetDouble(8),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetInt64(10),
                reader.GetInt32(11) != 0) { RowId = reader.GetInt64(0) });
        }
        return result;
    }

    /// <summary>All sessions, newest first, for the session list.</summary>
    public IReadOnlyList<(SessionRecord Session, string GameName, int StutterCount)> ListAll(int limit = 100)
    {
        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT s.id, s.uuid, s.epoch_utc, s.tick_frequency, s.duration_ticks, s.frame_count,
                   s.state, s.discontinuity_count, s.sensitivity_floor_ms, s.segment_path,
                   s.segment_bytes, s.baseline_eligible,
                   COALESCE(g.display_name, g.exe_name) AS game_name,
                   (SELECT COUNT(*) FROM event e
                    WHERE e.session_id = s.id AND e.counts_toward_tally = 1) AS stutters
            FROM session s
            JOIN config c ON c.id = s.config_id
            JOIN game   g ON g.id = c.game_id
            ORDER BY s.epoch_utc DESC
            LIMIT $n;
            """;
        command.Parameters.AddWithValue("$n", limit);

        var result = new List<(SessionRecord, string, int)>();
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var session = new SessionRecord(
                new Guid((byte[])reader["uuid"]),
                reader.GetInt64(2), reader.GetInt64(3), reader.GetInt64(4), reader.GetInt32(5),
                (SessionState)reader.GetInt32(6), reader.GetInt32(7),
                reader.IsDBNull(8) ? null : reader.GetDouble(8),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                reader.IsDBNull(10) ? null : reader.GetInt64(10),
                reader.GetInt32(11) != 0) { RowId = reader.GetInt64(0) };

            result.Add((session, reader.GetString(12), reader.GetInt32(13)));
        }
        return result;
    }

    /// <summary>
    /// Deletes a session's high-resolution data while keeping its summary forever.
    /// </summary>
    /// <remarks>
    /// Retention removes the segment file and nulls the reference in one transaction, in that
    /// order, so a crash mid-purge can leave an orphaned file but never a row pointing at a
    /// file that is gone. Summary rows are never purged: reclaiming space by destroying the
    /// session index would silently destroy the regression history, which is the feature the
    /// history exists for.
    /// </remarks>
    public long PurgeHighResolution(Guid sessionId)
    {
        using var transaction = _store.BeginTransaction();

        string? path;
        using (var select = _store.Connection.CreateCommand())
        {
            select.Transaction = transaction;
            select.CommandText = "SELECT segment_path FROM session WHERE uuid = $u;";
            select.Parameters.AddWithValue("$u", sessionId.ToByteArray());
            path = select.ExecuteScalar() as string;
        }

        if (path is null)
        {
            transaction.Commit();
            return 0;
        }

        long freed = 0;
        if (File.Exists(path))
        {
            freed = new FileInfo(path).Length;
            File.Delete(path);
        }

        using (var update = _store.Connection.CreateCommand())
        {
            update.Transaction = transaction;
            update.CommandText =
                "UPDATE session SET segment_path = NULL, segment_bytes = NULL WHERE uuid = $u;";
            update.Parameters.AddWithValue("$u", sessionId.ToByteArray());
            update.ExecuteNonQuery();
        }

        transaction.Commit();
        return freed;
    }

    // ---- inserts -------------------------------------------------------------

    private long UpsertMachine(MachineRecord machine, SqliteTransaction transaction)
    {
        var now = DateTimeOffset.UtcNow.UtcTicks;
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO machine(fingerprint, cpu_model, gpu_model, ram_mb, os_build,
                                first_seen_utc, last_seen_utc)
            VALUES($f, $cpu, $gpu, $ram, $os, $now, $now)
            ON CONFLICT(fingerprint) DO UPDATE SET last_seen_utc = $now
            RETURNING id;
            """;
        command.Parameters.AddWithValue("$f", machine.Fingerprint);
        command.Parameters.AddWithValue("$cpu", (object?)machine.CpuModel ?? DBNull.Value);
        command.Parameters.AddWithValue("$gpu", (object?)machine.GpuModel ?? DBNull.Value);
        command.Parameters.AddWithValue("$ram", (object?)machine.RamMegabytes ?? DBNull.Value);
        command.Parameters.AddWithValue("$os", (object?)machine.OsBuild ?? DBNull.Value);
        command.Parameters.AddWithValue("$now", now);
        return (long)command.ExecuteScalar()!;
    }

    private long UpsertGame(GameRecord game, SqliteTransaction transaction)
    {
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO game(exe_name, exe_hash, display_name, first_seen_utc)
            VALUES($n, $h, $d, $now)
            ON CONFLICT(exe_name, IFNULL(exe_hash, '')) DO UPDATE
                SET display_name = COALESCE(excluded.display_name, display_name)
            RETURNING id;
            """;
        command.Parameters.AddWithValue("$n", game.ExecutableName);
        command.Parameters.AddWithValue("$h", (object?)game.ExecutableHash ?? DBNull.Value);
        command.Parameters.AddWithValue("$d", (object?)game.DisplayName ?? DBNull.Value);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.UtcTicks);
        return (long)command.ExecuteScalar()!;
    }

    private long UpsertConfig(ConfigRecord config, long gameId, long machineId, SqliteTransaction transaction)
    {
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO config(game_id, machine_id, gpu_driver, monitor_hz, monitor_width,
                               monitor_height, power_scheme, power_overlay, game_mode,
                               optimizations, key_hash)
            VALUES($g, $m, $drv, $hz, $w, $h, $ps, $po, $gm, $opt, $k)
            ON CONFLICT(key_hash) DO UPDATE SET key_hash = excluded.key_hash
            RETURNING id;
            """;
        command.Parameters.AddWithValue("$g", gameId);
        command.Parameters.AddWithValue("$m", machineId);
        command.Parameters.AddWithValue("$drv", (object?)config.GpuDriver ?? DBNull.Value);
        command.Parameters.AddWithValue("$hz", (object?)config.MonitorHz ?? DBNull.Value);
        command.Parameters.AddWithValue("$w", (object?)config.MonitorWidth ?? DBNull.Value);
        command.Parameters.AddWithValue("$h", (object?)config.MonitorHeight ?? DBNull.Value);
        command.Parameters.AddWithValue("$ps", (object?)config.PowerScheme ?? DBNull.Value);
        command.Parameters.AddWithValue("$po", (object?)config.PowerOverlay ?? DBNull.Value);
        command.Parameters.AddWithValue("$gm", config.GameMode is null ? DBNull.Value : config.GameMode.Value ? 1 : 0);
        command.Parameters.AddWithValue("$opt", (object?)config.Optimizations ?? DBNull.Value);
        command.Parameters.AddWithValue("$k", config.KeyHash());
        return (long)command.ExecuteScalar()!;
    }

    private long InsertSession(SessionRecord session, long configId, SqliteTransaction transaction)
    {
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO session(uuid, config_id, epoch_utc, tick_frequency, duration_ticks,
                                frame_count, state, discontinuity_count, sensitivity_floor_ms,
                                segment_path, segment_bytes, baseline_eligible)
            VALUES($u, $c, $e, $tf, $d, $fc, $st, $dc, $sf, $sp, $sb, $be)
            RETURNING id;
            """;
        command.Parameters.AddWithValue("$u", session.Id.ToByteArray());
        command.Parameters.AddWithValue("$c", configId);
        command.Parameters.AddWithValue("$e", session.EpochUtcTicks);
        command.Parameters.AddWithValue("$tf", session.TickFrequency);
        command.Parameters.AddWithValue("$d", session.DurationTicks);
        command.Parameters.AddWithValue("$fc", session.FrameCount);
        command.Parameters.AddWithValue("$st", (int)session.State);
        command.Parameters.AddWithValue("$dc", session.DiscontinuityCount);
        command.Parameters.AddWithValue("$sf", (object?)session.SensitivityFloorMs ?? DBNull.Value);
        command.Parameters.AddWithValue("$sp", (object?)session.SegmentPath ?? DBNull.Value);
        command.Parameters.AddWithValue("$sb", (object?)session.SegmentBytes ?? DBNull.Value);
        command.Parameters.AddWithValue("$be", session.BaselineEligible ? 1 : 0);
        return (long)command.ExecuteScalar()!;
    }

    private long InsertEvent(EventRecord evt, long sessionId, SqliteTransaction transaction)
    {
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO event(session_id, start_ticks, end_ticks, class, peak_frame_time_ms,
                              excess_ms, threshold_ms, baseline_median_ms, baseline_scale_ms,
                              frame_count, merged_count, during_warmup, force_closed,
                              counts_toward_tally)
            VALUES($s, $st, $en, $cl, $pk, $ex, $th, $bm, $bs, $fc, $mc, $wu, $fx, $ct)
            RETURNING id;
            """;
        command.Parameters.AddWithValue("$s", sessionId);
        command.Parameters.AddWithValue("$st", evt.StartTicks);
        command.Parameters.AddWithValue("$en", evt.EndTicks);
        command.Parameters.AddWithValue("$cl", evt.Class);
        command.Parameters.AddWithValue("$pk", evt.PeakFrameTimeMs);
        command.Parameters.AddWithValue("$ex", evt.ExcessMs);
        command.Parameters.AddWithValue("$th", evt.ThresholdMs);
        command.Parameters.AddWithValue("$bm", evt.BaselineMedianMs);
        command.Parameters.AddWithValue("$bs", evt.BaselineScaleMs);
        command.Parameters.AddWithValue("$fc", evt.FrameCount);
        command.Parameters.AddWithValue("$mc", evt.MergedCount);
        command.Parameters.AddWithValue("$wu", evt.DuringWarmUp ? 1 : 0);
        command.Parameters.AddWithValue("$fx", evt.ForceClosed ? 1 : 0);
        command.Parameters.AddWithValue("$ct", evt.CountsTowardTally ? 1 : 0);
        return (long)command.ExecuteScalar()!;
    }

    private void InsertDiagnosis(DiagnosisRecord diagnosis, long eventId, SqliteTransaction transaction)
    {
        long diagnosisId;
        using (var command = _store.Connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO diagnosis(event_id, rule_id, title, confidence, raw_confidence,
                                      log_odds, binding_cap, what_happened, mechanism, recommended)
                VALUES($e, $r, $t, $c, $rc, $lo, $bc, $wh, $me, $ra)
                RETURNING id;
                """;
            command.Parameters.AddWithValue("$e", eventId);
            command.Parameters.AddWithValue("$r", (object?)diagnosis.RuleId ?? DBNull.Value);
            command.Parameters.AddWithValue("$t", diagnosis.Title);
            command.Parameters.AddWithValue("$c", diagnosis.Confidence);
            command.Parameters.AddWithValue("$rc", diagnosis.RawConfidence);
            command.Parameters.AddWithValue("$lo", diagnosis.LogOdds);
            command.Parameters.AddWithValue("$bc", diagnosis.BindingCap);
            command.Parameters.AddWithValue("$wh", diagnosis.WhatHappened);
            command.Parameters.AddWithValue("$me", (object?)diagnosis.Mechanism ?? DBNull.Value);
            command.Parameters.AddWithValue("$ra", (object?)diagnosis.RecommendedAction ?? DBNull.Value);
            diagnosisId = (long)command.ExecuteScalar()!;
        }

        for (var i = 0; i < diagnosis.Evidence.Count; i++)
        {
            var e = diagnosis.Evidence[i];
            using var command = _store.Connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO evidence(diagnosis_id, ordinal, metric, instance, statement,
                                     likelihood_ratio, evidence_class, role, sample_count,
                                     native_rate_hz, can_order, quality)
                VALUES($d, $o, $m, $i, $s, $lr, $ec, $ro, $sc, $nr, $co, $q);
                """;
            command.Parameters.AddWithValue("$d", diagnosisId);
            command.Parameters.AddWithValue("$o", i);
            command.Parameters.AddWithValue("$m", e.Metric);
            command.Parameters.AddWithValue("$i", e.Instance);
            command.Parameters.AddWithValue("$s", e.Statement);
            command.Parameters.AddWithValue("$lr", e.LikelihoodRatio);
            command.Parameters.AddWithValue("$ec", e.EvidenceClass);
            command.Parameters.AddWithValue("$ro", e.Role);
            command.Parameters.AddWithValue("$sc", e.SampleCount);
            command.Parameters.AddWithValue("$nr",
                e.NativeRateHz is null || double.IsNaN(e.NativeRateHz.Value)
                    ? DBNull.Value : e.NativeRateHz.Value);
            command.Parameters.AddWithValue("$co", e.CanEstablishOrdering ? 1 : 0);
            command.Parameters.AddWithValue("$q", e.Quality);
            command.ExecuteNonQuery();
        }

        for (var i = 0; i < diagnosis.RuledOut.Count; i++)
        {
            var r = diagnosis.RuledOut[i];
            using var command = _store.Connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO ruled_out(diagnosis_id, ordinal, rule_id, title, reason, was_checkable)
                VALUES($d, $o, $r, $t, $re, $c);
                """;
            command.Parameters.AddWithValue("$d", diagnosisId);
            command.Parameters.AddWithValue("$o", i);
            command.Parameters.AddWithValue("$r", r.RuleId);
            command.Parameters.AddWithValue("$t", r.Title);
            command.Parameters.AddWithValue("$re", r.Reason);
            command.Parameters.AddWithValue("$c", r.WasCheckable ? 1 : 0);
            command.ExecuteNonQuery();
        }
    }

    private void InsertStat(SessionStatRecord stat, long sessionId, SqliteTransaction transaction)
    {
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO session_stat(session_id, metric, instance, n, availability, quality,
                                     v_min, v_p50, v_p95, v_p99, v_p999, v_max, v_sum)
            VALUES($s, $m, $i, $n, $a, $q, $mn, $p50, $p95, $p99, $p999, $mx, $sum);
            """;
        command.Parameters.AddWithValue("$s", sessionId);
        command.Parameters.AddWithValue("$m", stat.Metric);
        command.Parameters.AddWithValue("$i", stat.Instance);
        command.Parameters.AddWithValue("$n", stat.SampleCount);
        command.Parameters.AddWithValue("$a", stat.Availability);
        command.Parameters.AddWithValue("$q", stat.Quality);
        AddNullableDouble(command, "$mn", stat.Min);
        AddNullableDouble(command, "$p50", stat.P50);
        AddNullableDouble(command, "$p95", stat.P95);
        AddNullableDouble(command, "$p99", stat.P99);
        AddNullableDouble(command, "$p999", stat.P999);
        AddNullableDouble(command, "$mx", stat.Max);
        AddNullableDouble(command, "$sum", stat.Sum);
        command.ExecuteNonQuery();
    }

    /// <summary>
    /// Binds a nullable double, mapping NaN to SQL NULL.
    /// </summary>
    /// <remarks>
    /// NaN is how the pipeline says "insufficient data". Storing it as a number would let a
    /// later read treat it as a measurement; NULL keeps the distinction all the way to disk.
    /// </remarks>
    private static void AddNullableDouble(SqliteCommand command, string name, double? value) =>
        command.Parameters.AddWithValue(
            name, value is null || double.IsNaN(value.Value) ? DBNull.Value : value.Value);

    // ---- reads ---------------------------------------------------------------

    private ConfigRecord LoadConfig(long configId)
    {
        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT g.exe_name, g.exe_hash, g.display_name,
                   m.fingerprint, m.cpu_model, m.gpu_model, m.ram_mb, m.os_build,
                   c.gpu_driver, c.monitor_hz, c.monitor_width, c.monitor_height,
                   c.power_scheme, c.power_overlay, c.game_mode, c.optimizations
            FROM config c
            JOIN game g ON g.id = c.game_id
            JOIN machine m ON m.id = c.machine_id
            WHERE c.id = $id;
            """;
        command.Parameters.AddWithValue("$id", configId);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw new InvalidOperationException($"Config {configId} is missing.");

        return new ConfigRecord(
            new GameRecord(reader.GetString(0), Str(reader, 1), Str(reader, 2)),
            new MachineRecord(reader.GetString(3), Str(reader, 4), Str(reader, 5),
                reader.IsDBNull(6) ? null : reader.GetInt32(6), Str(reader, 7)),
            Str(reader, 8),
            reader.IsDBNull(9) ? null : reader.GetDouble(9),
            reader.IsDBNull(10) ? null : reader.GetInt32(10),
            reader.IsDBNull(11) ? null : reader.GetInt32(11),
            Str(reader, 12), Str(reader, 13),
            reader.IsDBNull(14) ? null : reader.GetInt32(14) != 0,
            Str(reader, 15));
    }

    private List<(EventRecord, DiagnosisRecord?)> LoadEvents(long sessionRowId)
    {
        var events = new List<(EventRecord, DiagnosisRecord?)>();

        var rows = new List<EventRecord>();
        using (var command = _store.Connection.CreateCommand())
        {
            command.CommandText = """
                SELECT id, start_ticks, end_ticks, class, peak_frame_time_ms, excess_ms,
                       threshold_ms, baseline_median_ms, baseline_scale_ms, frame_count,
                       merged_count, during_warmup, force_closed, counts_toward_tally
                FROM event WHERE session_id = $s ORDER BY start_ticks;
                """;
            command.Parameters.AddWithValue("$s", sessionRowId);

            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                rows.Add(new EventRecord(
                    reader.GetInt64(1), reader.GetInt64(2), reader.GetInt32(3),
                    reader.GetDouble(4), reader.GetDouble(5), reader.GetDouble(6),
                    reader.GetDouble(7), reader.GetDouble(8), reader.GetInt32(9),
                    reader.GetInt32(10), reader.GetInt32(11) != 0, reader.GetInt32(12) != 0,
                    reader.GetInt32(13) != 0) { RowId = reader.GetInt64(0) });
            }
        }

        foreach (var row in rows) events.Add((row, LoadDiagnosis(row.RowId)));
        return events;
    }

    private DiagnosisRecord? LoadDiagnosis(long eventRowId)
    {
        long diagnosisId;
        DiagnosisRecord shell;

        using (var command = _store.Connection.CreateCommand())
        {
            command.CommandText = """
                SELECT id, rule_id, title, confidence, raw_confidence, log_odds, binding_cap,
                       what_happened, mechanism, recommended
                FROM diagnosis WHERE event_id = $e;
                """;
            command.Parameters.AddWithValue("$e", eventRowId);

            using var reader = command.ExecuteReader();
            if (!reader.Read()) return null;

            diagnosisId = reader.GetInt64(0);
            shell = new DiagnosisRecord(
                Str(reader, 1), reader.GetString(2), reader.GetDouble(3), reader.GetDouble(4),
                reader.GetDouble(5), reader.GetInt32(6), reader.GetString(7),
                Str(reader, 8), Str(reader, 9), [], []);
        }

        var evidence = new List<EvidenceRecord>();
        using (var command = _store.Connection.CreateCommand())
        {
            command.CommandText = """
                SELECT metric, instance, statement, likelihood_ratio, evidence_class, role,
                       sample_count, native_rate_hz, can_order, quality
                FROM evidence WHERE diagnosis_id = $d ORDER BY ordinal;
                """;
            command.Parameters.AddWithValue("$d", diagnosisId);

            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                evidence.Add(new EvidenceRecord(
                    reader.GetInt32(0), reader.GetInt32(1), reader.GetString(2),
                    reader.GetDouble(3), reader.GetInt32(4), reader.GetInt32(5),
                    reader.GetInt32(6), reader.IsDBNull(7) ? null : reader.GetDouble(7),
                    reader.GetInt32(8) != 0, reader.GetInt32(9)));
            }
        }

        var ruledOut = new List<RuledOutRecord>();
        using (var command = _store.Connection.CreateCommand())
        {
            command.CommandText = """
                SELECT rule_id, title, reason, was_checkable
                FROM ruled_out WHERE diagnosis_id = $d ORDER BY ordinal;
                """;
            command.Parameters.AddWithValue("$d", diagnosisId);

            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                ruledOut.Add(new RuledOutRecord(
                    reader.GetString(0), reader.GetString(1), reader.GetString(2),
                    reader.GetInt32(3) != 0));
            }
        }

        return shell with { Evidence = evidence, RuledOut = ruledOut };
    }

    private List<SessionStatRecord> LoadStats(long sessionRowId)
    {
        var stats = new List<SessionStatRecord>();
        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT metric, instance, n, availability, quality,
                   v_min, v_p50, v_p95, v_p99, v_p999, v_max, v_sum
            FROM session_stat WHERE session_id = $s ORDER BY metric, instance;
            """;
        command.Parameters.AddWithValue("$s", sessionRowId);

        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            stats.Add(new SessionStatRecord(
                reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2),
                reader.GetInt32(3), reader.GetInt32(4),
                Dbl(reader, 5), Dbl(reader, 6), Dbl(reader, 7),
                Dbl(reader, 8), Dbl(reader, 9), Dbl(reader, 10), Dbl(reader, 11)));
        }
        return stats;
    }

    private static string? Str(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static double? Dbl(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetDouble(ordinal);
}
