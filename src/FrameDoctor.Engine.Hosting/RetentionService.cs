using FrameDoctor.Storage.Catalog;
using FrameDoctor.Storage.Segments;

namespace FrameDoctor.Engine.Hosting;

/// <summary>What one retention pass did.</summary>
/// <param name="SessionsPurged">Sessions whose high-resolution data was reclaimed.</param>
/// <param name="OrphansRemoved">Files reclaimed that no session referenced any more.</param>
/// <param name="BytesFreed">Disk reclaimed.</param>
/// <param name="Skipped">
/// Files the sweep declined to touch because it could not establish what they were. Reported
/// rather than swallowed: a growing number here means the sweep is failing to reclaim space, and
/// silence would look identical to a clean disk.
/// </param>
/// <param name="Failures">Purges that threw. The session keeps its data and the pass continues.</param>
public readonly record struct RetentionReport(
    int SessionsPurged,
    int OrphansRemoved,
    long BytesFreed,
    int Skipped,
    int Failures)
{
    public bool DidAnything => SessionsPurged > 0 || OrphansRemoved > 0;

    /// <summary>One line, or null when there is nothing worth saying.</summary>
    /// <remarks>
    /// Null for a pass that found nothing, because the common case is nothing to do and a line
    /// every launch saying so trains a reader to skip the line that matters.
    /// </remarks>
    public string? Describe()
    {
        if (!DidAnything && Failures == 0 && Skipped == 0) return null;

        var parts = new List<string>(4);

        if (SessionsPurged > 0)
        {
            parts.Add($"{SessionsPurged} session{(SessionsPurged == 1 ? "" : "s")} " +
                      "past the retention window");
        }

        if (OrphansRemoved > 0) parts.Add($"{OrphansRemoved} orphaned file(s)");
        if (Skipped > 0) parts.Add($"{Skipped} file(s) left alone because they could not be identified");
        if (Failures > 0) parts.Add($"{Failures} could not be purged and kept their data");

        var megabytes = BytesFreed / 1024.0 / 1024.0;

        return $"Retention: {string.Join(", ", parts)}. {megabytes:F1} MB reclaimed.";
    }
}

/// <summary>
/// Reclaims high-resolution data once it is older than the user asked to keep it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Summaries are never deleted.</b> Only the frame series goes: the session, its events, its
/// diagnoses and its aggregates stay forever. Reclaiming space by dropping the session index
/// would destroy the regression history, which is the feature the history exists for.
/// </para>
/// <para>
/// Runs when the engine starts and when a session is finalized, never during one. Both are
/// moments when nothing is being measured, and deleting files while a game is running is the
/// kind of disk activity this product exists to diagnose.
/// </para>
/// </remarks>
public sealed class RetentionService(SessionRepository repository, TimeProvider? time = null)
{
    private readonly SessionRepository _repository =
        repository ?? throw new ArgumentNullException(nameof(repository));

    private readonly TimeProvider _time = time ?? TimeProvider.System;

    /// <summary>
    /// How recently a file may have been written and still be treated as an orphan.
    /// </summary>
    /// <remarks>
    /// A session in progress has a file on disk and no committed row pointing at it, so it looks
    /// exactly like an orphan. An hour is far longer than the window between a segment being
    /// created and its session being written, and the cost of waiting is a file that lingers one
    /// extra pass.
    /// </remarks>
    public static readonly TimeSpan OrphanGrace = TimeSpan.FromHours(1);

    /// <summary>
    /// Purges expired sessions, then reclaims files nothing references.
    /// </summary>
    /// <param name="retentionDays">
    /// How long to keep frame series. Clamped by the settings record before it reaches here; a
    /// value of zero or less is refused rather than interpreted as "keep nothing".
    /// </param>
    /// <param name="segmentDirectory">
    /// Where segments live. Null skips the orphan sweep, which is the correct behaviour when the
    /// directory is unknown — a sweep that does not know where to look must not guess.
    /// </param>
    /// <param name="limit">Most sessions to purge in one pass.</param>
    public RetentionReport Run(int retentionDays, string? segmentDirectory, int limit = 200)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(retentionDays);

        var now = _time.GetUtcNow();
        var cutoff = now - TimeSpan.FromDays(retentionDays);

        var purged = 0;
        var failures = 0;
        var freed = 0L;

        foreach (var (id, _, _) in _repository.ExpiredHighResolution(cutoff, limit))
        {
            try
            {
                freed += _repository.PurgeHighResolution(id);
                purged++;
            }
            catch (IOException)
            {
                // The file is locked, or the disk is gone. The row still points at it, so the
                // next pass finds it again — which is why this is counted rather than rethrown.
                failures++;
            }
            catch (UnauthorizedAccessException)
            {
                failures++;
            }
        }

        var (orphans, orphanBytes, skipped) = SweepOrphans(segmentDirectory, now);

        return new RetentionReport(purged, orphans, freed + orphanBytes, skipped, failures);
    }

    /// <summary>
    /// Removes segment files no session references any more.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A purge commits the cleared reference before unlinking the file, so a crash in between
    /// leaves a file nothing points at. That costs disk and nothing else, and this is what
    /// collects it.
    /// </para>
    /// <para>
    /// Every deletion requires a positive identification: the file must carry a valid segment
    /// header, its session must be absent from the catalog or already purged, and it must be
    /// older than the grace period. A file that fails any of those is counted as skipped and
    /// left where it is. This is the one place in the product that deletes user data on its own
    /// initiative, and it deletes only what it can name.
    /// </para>
    /// </remarks>
    private (int Removed, long Bytes, int Skipped) SweepOrphans(string? directory, DateTimeOffset now)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)) return (0, 0, 0);

        var removed = 0;
        var skipped = 0;
        var bytes = 0L;

        string[] files;
        try
        {
            files = Directory.GetFiles(directory);
        }
        catch (IOException)
        {
            return (0, 0, 0);
        }
        catch (UnauthorizedAccessException)
        {
            return (0, 0, 0);
        }

        foreach (var file in files)
        {
            try
            {
                var info = new FileInfo(file);
                if (now - info.LastWriteTimeUtc < OrphanGrace) continue;

                // Asks the file which session it belongs to rather than guessing from its name.
                // A header we cannot read is a file we must not delete.
                if (SegmentReader.TryReadHeader(file) is not { } header)
                {
                    skipped++;
                    continue;
                }

                if (_repository.HasSegment(header.SessionId)) continue;

                var size = info.Length;
                File.Delete(file);

                removed++;
                bytes += size;
            }
            catch (IOException)
            {
                skipped++;
            }
            catch (UnauthorizedAccessException)
            {
                skipped++;
            }
        }

        return (removed, bytes, skipped);
    }
}
