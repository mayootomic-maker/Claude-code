using Microsoft.Data.Sqlite;

namespace FrameDoctor.Storage.Catalog;

/// <summary>One stored session, reduced to what a baseline needs from it.</summary>
/// <param name="SessionId">Which session this came from, so a baseline can name its inputs.</param>
/// <param name="EpochUtcTicks">When it ran, for ordering the window.</param>
/// <param name="MedianFrameTimeMs">Session median, or NaN when it was never qualified.</param>
/// <param name="P99FrameTimeMs">Session p99, or NaN.</param>
/// <param name="Low1PercentFps">Session 1 % low, or NaN.</param>
/// <param name="FrameCount">Frames, for the minimum-length rule.</param>
/// <param name="StutterCount">Events that counted toward the tally.</param>
/// <param name="SensitivityFloorMs">The smallest excess this session could resolve, or NaN.</param>
/// <param name="Duration">How long it ran, for the per-minute stutter rate.</param>
public readonly record struct BaselineHistoryRow(
    Guid SessionId,
    long EpochUtcTicks,
    double MedianFrameTimeMs,
    double P99FrameTimeMs,
    double Low1PercentFps,
    int FrameCount,
    int StutterCount,
    double SensitivityFloorMs,
    TimeSpan Duration);

/// <summary>A computed baseline, as the catalog holds it.</summary>
/// <remarks>
/// Deliberately a bag of numbers rather than the diagnostics type that produced it. Storage
/// depends on nothing but the telemetry abstractions, so what a baseline <i>means</i> stays in
/// one place — the diagnostics assembly — and the catalog only records the result.
/// </remarks>
/// <param name="Metric">Which metric this baseline is for.</param>
/// <param name="SessionCount">Sessions it was built from.</param>
/// <param name="Trust">The trust level, as <c>BaselineTrust</c>.</param>
/// <param name="Median">Centre, or null when there is no baseline yet.</param>
/// <param name="Scale">Spread, or null.</param>
/// <param name="Minimum">Smallest contributing session value, or null.</param>
/// <param name="Maximum">Largest contributing session value, or null.</param>
/// <param name="SessionIds">
/// Exactly which sessions went in. Stored because a baseline the user cannot trace back to its
/// inputs is a number they have to take on faith.
/// </param>
public sealed record StoredBaseline(
    int Metric,
    int SessionCount,
    int Trust,
    double? Median,
    double? Scale,
    double? Minimum,
    double? Maximum,
    IReadOnlyList<Guid> SessionIds)
{
    /// <summary>When the baseline was last recomputed. Set on read.</summary>
    public DateTimeOffset UpdatedUtc { get; init; }
}

/// <summary>A session compared against its baseline, whatever the verdict.</summary>
/// <param name="Metric">Which metric was compared.</param>
/// <param name="Verdict">The verdict, as <c>ComparisonVerdict</c>.</param>
/// <param name="BaselineSessionCount">How many sessions stood behind the baseline.</param>
/// <param name="BaselineTrust">How far that baseline could be used.</param>
/// <param name="BaselineValue">The baseline's figure, or null when there was none.</param>
/// <param name="SessionValue">This session's figure, or null.</param>
/// <param name="DifferenceMs">Session minus baseline, or null.</param>
/// <param name="NoiseMs">The bar the difference had to clear, or null.</param>
/// <param name="Detail">The sentence shown to the user.</param>
public sealed record StoredComparison(
    int Metric,
    int Verdict,
    int BaselineSessionCount,
    int BaselineTrust,
    double? BaselineValue,
    double? SessionValue,
    double? DifferenceMs,
    double? NoiseMs,
    string Detail)
{
    /// <summary>When the comparison was made. Set on read.</summary>
    public DateTimeOffset ComparedUtc { get; init; }

    /// <summary>Which session was compared. Set on read.</summary>
    public Guid SessionId { get; init; }
}

/// <summary>
/// Reads the history a baseline is built from, and stores what was concluded.
/// </summary>
/// <remarks>
/// <para>
/// Separate from <see cref="SessionRepository"/> because the two have different lifetimes:
/// sessions are written once at finalize and never touched again, while a baseline is
/// recomputed every time the history changes. Mixing them would put a mutable aggregate in the
/// class whose whole design rests on being append-only.
/// </para>
/// <para>
/// Nothing here computes a baseline. The statistics live in the diagnostics assembly; this
/// reads the inputs and records the answer.
/// </para>
/// </remarks>
public sealed class BaselineRepository(SessionStore store)
{
    private readonly SessionStore _store = store ?? throw new ArgumentNullException(nameof(store));

    /// <summary>
    /// How many recent sessions a baseline may draw on.
    /// </summary>
    /// <remarks>
    /// A rolling window rather than all history. A machine that genuinely got faster — a new
    /// GPU is a config fork, but a cleaned heatsink is not — must eventually be described by
    /// what it does now, and an unbounded baseline would hold it to what it did a year ago
    /// forever. Thirty sessions is roughly a month of regular play.
    /// </remarks>
    public const int DefaultWindow = 30;

    /// <summary>
    /// The baseline-eligible sessions of one configuration, newest first.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Only finalized, baseline-eligible sessions. A session recorded with a degraded sensor or
    /// a discontinuity in it is kept and excluded here: it describes an interruption, and
    /// letting it move a baseline would attribute the interruption to the machine.
    /// </para>
    /// <para>
    /// A missing statistic comes back as NaN rather than zero. Zero is a claim — a median frame
    /// time of zero means an infinitely fast machine — and the whole point of a stored null is
    /// that no such claim was ever made.
    /// </para>
    /// </remarks>
    public IReadOnlyList<BaselineHistoryRow> HistoryFor(string configKeyHash, int limit = DefaultWindow)
    {
        ArgumentException.ThrowIfNullOrEmpty(configKeyHash);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(limit);

        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT s.uuid, s.epoch_utc, s.frame_count, s.sensitivity_floor_ms,
                   s.duration_ticks, s.tick_frequency,
                   (SELECT st.v_p50 FROM session_stat st
                    WHERE st.session_id = s.id AND st.metric = $median)  AS median_ms,
                   (SELECT st.v_p99 FROM session_stat st
                    WHERE st.session_id = s.id AND st.metric = $p99)     AS p99_ms,
                   (SELECT st.v_sum FROM session_stat st
                    WHERE st.session_id = s.id AND st.metric = $low1)    AS low1_fps,
                   (SELECT COUNT(*) FROM event e
                    WHERE e.session_id = s.id AND e.counts_toward_tally = 1) AS stutters
            FROM session s
            JOIN config c ON c.id = s.config_id
            WHERE c.key_hash = $k
              AND s.baseline_eligible = 1
              AND s.state = $finalized
            ORDER BY s.epoch_utc DESC
            LIMIT $n;
            """;
        command.Parameters.AddWithValue("$k", configKeyHash);
        command.Parameters.AddWithValue("$n", limit);
        command.Parameters.AddWithValue("$median", (int)MetricIds.FrameTimeMedian);
        command.Parameters.AddWithValue("$p99", (int)MetricIds.FrameTimeP99);
        command.Parameters.AddWithValue("$low1", (int)MetricIds.FrameLow1Pct);
        command.Parameters.AddWithValue("$finalized", (int)SessionState.Finalized);

        var rows = new List<BaselineHistoryRow>(limit);
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var ticks = reader.IsDBNull(4) ? 0L : reader.GetInt64(4);
            var frequency = reader.GetInt64(5);

            rows.Add(new BaselineHistoryRow(
                new Guid((byte[])reader["uuid"]),
                reader.GetInt64(1),
                OrNaN(reader, 6),
                OrNaN(reader, 7),
                OrNaN(reader, 8),
                reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
                reader.GetInt32(9),
                OrNaN(reader, 3),
                DurationOf(ticks, frequency)));
        }
        return rows;
    }

    /// <summary>
    /// Converts a session's own tick count into wall time.
    /// </summary>
    /// <remarks>
    /// The frequency is read from the row rather than assumed, because a session recorded on a
    /// machine with a different timer is still a session, and reinterpreting its ticks with
    /// today's frequency would silently rescale its duration.
    /// </remarks>
    private static TimeSpan DurationOf(long ticks, long frequency)
    {
        if (ticks <= 0 || frequency <= 0) return TimeSpan.Zero;
        return TimeSpan.FromSeconds((double)ticks / frequency);
    }

    private static double OrNaN(SqliteDataReader reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? double.NaN : reader.GetDouble(ordinal);

    /// <summary>Stores a recomputed baseline, replacing the previous one for that metric.</summary>
    /// <returns>False when the configuration is not in the catalog, so nothing was written.</returns>
    public bool SaveBaseline(string configKeyHash, StoredBaseline baseline, DateTimeOffset updatedUtc)
    {
        ArgumentException.ThrowIfNullOrEmpty(configKeyHash);
        ArgumentNullException.ThrowIfNull(baseline);

        using var transaction = _store.BeginTransaction();

        var configId = ConfigIdFor(configKeyHash, transaction);
        if (configId is null) return false;

        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO baseline(config_id, metric, n_sessions, median, scale, s_min, s_max,
                                 session_ids, updated_utc, trust)
            VALUES($c, $m, $n, $med, $sc, $lo, $hi, $ids, $u, $t)
            ON CONFLICT(config_id, metric) DO UPDATE SET
                n_sessions  = excluded.n_sessions,
                median      = excluded.median,
                scale       = excluded.scale,
                s_min       = excluded.s_min,
                s_max       = excluded.s_max,
                session_ids = excluded.session_ids,
                updated_utc = excluded.updated_utc,
                trust       = excluded.trust;
            """;
        command.Parameters.AddWithValue("$c", configId.Value);
        command.Parameters.AddWithValue("$m", baseline.Metric);
        command.Parameters.AddWithValue("$n", baseline.SessionCount);
        command.Parameters.AddWithValue("$med", Nullable(baseline.Median));
        command.Parameters.AddWithValue("$sc", Nullable(baseline.Scale));
        command.Parameters.AddWithValue("$lo", Nullable(baseline.Minimum));
        command.Parameters.AddWithValue("$hi", Nullable(baseline.Maximum));
        command.Parameters.AddWithValue("$ids", Pack(baseline.SessionIds));
        command.Parameters.AddWithValue("$u", updatedUtc.UtcTicks);
        command.Parameters.AddWithValue("$t", baseline.Trust);
        command.ExecuteNonQuery();

        transaction.Commit();
        return true;
    }

    /// <summary>Reads the stored baseline for one metric, or null when none has been computed.</summary>
    public StoredBaseline? ReadBaseline(string configKeyHash, int metric)
    {
        ArgumentException.ThrowIfNullOrEmpty(configKeyHash);

        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT b.metric, b.n_sessions, b.trust, b.median, b.scale, b.s_min, b.s_max,
                   b.session_ids, b.updated_utc
            FROM baseline b
            JOIN config c ON c.id = b.config_id
            WHERE c.key_hash = $k AND b.metric = $m;
            """;
        command.Parameters.AddWithValue("$k", configKeyHash);
        command.Parameters.AddWithValue("$m", metric);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;

        return new StoredBaseline(
            reader.GetInt32(0),
            reader.GetInt32(1),
            reader.GetInt32(2),
            reader.IsDBNull(3) ? null : reader.GetDouble(3),
            reader.IsDBNull(4) ? null : reader.GetDouble(4),
            reader.IsDBNull(5) ? null : reader.GetDouble(5),
            reader.IsDBNull(6) ? null : reader.GetDouble(6),
            Unpack((byte[])reader["session_ids"]))
        {
            UpdatedUtc = new DateTimeOffset(reader.GetInt64(8), TimeSpan.Zero),
        };
    }

    /// <summary>
    /// Records a session's comparison against its baseline.
    /// </summary>
    /// <remarks>
    /// Every verdict is stored, including "nothing changed". A history that kept only the
    /// alarms could not tell a quiet month from a broken detector, and the quiet months are
    /// what give a later alarm its weight.
    /// </remarks>
    /// <returns>False when the session is not in the catalog, so nothing was written.</returns>
    public bool SaveComparison(Guid sessionId, StoredComparison comparison, DateTimeOffset comparedUtc)
    {
        ArgumentNullException.ThrowIfNull(comparison);

        using var transaction = _store.BeginTransaction();

        using var lookup = _store.Connection.CreateCommand();
        lookup.Transaction = transaction;
        lookup.CommandText = "SELECT id, config_id FROM session WHERE uuid = $u;";
        lookup.Parameters.AddWithValue("$u", sessionId.ToByteArray());

        long rowId, configId;
        using (var reader = lookup.ExecuteReader())
        {
            if (!reader.Read()) return false;
            rowId = reader.GetInt64(0);
            configId = reader.GetInt64(1);
        }

        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO comparison(config_id, session_id, metric, compared_utc, verdict,
                                   baseline_n, baseline_trust, baseline_median, session_value,
                                   difference_ms, noise_ms, detail)
            VALUES($c, $s, $m, $t, $v, $n, $tr, $bm, $sv, $d, $no, $detail)
            ON CONFLICT(session_id, metric) DO UPDATE SET
                compared_utc    = excluded.compared_utc,
                verdict         = excluded.verdict,
                baseline_n      = excluded.baseline_n,
                baseline_trust  = excluded.baseline_trust,
                baseline_median = excluded.baseline_median,
                session_value   = excluded.session_value,
                difference_ms   = excluded.difference_ms,
                noise_ms        = excluded.noise_ms,
                detail          = excluded.detail;
            """;
        command.Parameters.AddWithValue("$c", configId);
        command.Parameters.AddWithValue("$s", rowId);
        command.Parameters.AddWithValue("$m", comparison.Metric);
        command.Parameters.AddWithValue("$t", comparedUtc.UtcTicks);
        command.Parameters.AddWithValue("$v", comparison.Verdict);
        command.Parameters.AddWithValue("$n", comparison.BaselineSessionCount);
        command.Parameters.AddWithValue("$tr", comparison.BaselineTrust);
        command.Parameters.AddWithValue("$bm", Nullable(comparison.BaselineValue));
        command.Parameters.AddWithValue("$sv", Nullable(comparison.SessionValue));
        command.Parameters.AddWithValue("$d", Nullable(comparison.DifferenceMs));
        command.Parameters.AddWithValue("$no", Nullable(comparison.NoiseMs));
        command.Parameters.AddWithValue("$detail", comparison.Detail);
        command.ExecuteNonQuery();

        transaction.Commit();
        return true;
    }

    /// <summary>The comparison recorded for one session, or null.</summary>
    public StoredComparison? ReadComparison(Guid sessionId, int metric)
    {
        using var command = _store.Connection.CreateCommand();
        command.CommandText = """
            SELECT cm.metric, cm.verdict, cm.baseline_n, cm.baseline_trust, cm.baseline_median,
                   cm.session_value, cm.difference_ms, cm.noise_ms, cm.detail, cm.compared_utc
            FROM comparison cm
            JOIN session s ON s.id = cm.session_id
            WHERE s.uuid = $u AND cm.metric = $m;
            """;
        command.Parameters.AddWithValue("$u", sessionId.ToByteArray());
        command.Parameters.AddWithValue("$m", metric);

        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;

        return new StoredComparison(
            reader.GetInt32(0),
            reader.GetInt32(1),
            reader.GetInt32(2),
            reader.GetInt32(3),
            reader.IsDBNull(4) ? null : reader.GetDouble(4),
            reader.IsDBNull(5) ? null : reader.GetDouble(5),
            reader.IsDBNull(6) ? null : reader.GetDouble(6),
            reader.IsDBNull(7) ? null : reader.GetDouble(7),
            reader.GetString(8))
        {
            SessionId = sessionId,
            ComparedUtc = new DateTimeOffset(reader.GetInt64(9), TimeSpan.Zero),
        };
    }

    private long? ConfigIdFor(string keyHash, SqliteTransaction transaction)
    {
        using var command = _store.Connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT id FROM config WHERE key_hash = $k;";
        command.Parameters.AddWithValue("$k", keyHash);

        var result = command.ExecuteScalar();
        return result is null or DBNull ? null : Convert.ToInt64(result, System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>A non-finite value is stored as absent, never as a number.</summary>
    private static object Nullable(double? value) =>
        value is { } v && double.IsFinite(v) ? v : DBNull.Value;

    private static byte[] Pack(IReadOnlyList<Guid> ids)
    {
        var bytes = new byte[ids.Count * 16];
        for (var i = 0; i < ids.Count; i++) ids[i].TryWriteBytes(bytes.AsSpan(i * 16, 16));
        return bytes;
    }

    private static Guid[] Unpack(byte[] bytes)
    {
        var ids = new Guid[bytes.Length / 16];
        for (var i = 0; i < ids.Length; i++) ids[i] = new Guid(bytes.AsSpan(i * 16, 16));
        return ids;
    }
}

/// <summary>
/// The handful of metric identifiers the catalog itself has to name.
/// </summary>
/// <remarks>
/// The values are <c>FrameDoctor.Abstractions.Telemetry.MetricId</c>, restated rather than
/// referenced so that a SQL query reads as a query. They are asserted against the enum in the
/// storage tests, so a renumbering cannot drift past unnoticed.
/// </remarks>
internal static class MetricIds
{
    public const int FrameTimeMedian = 103;
    public const int FrameTimeP99 = 105;
    public const int FrameLow1Pct = 106;
}
