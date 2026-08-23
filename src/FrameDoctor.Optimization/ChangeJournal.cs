using System.Text.Json;
using System.Text.Json.Serialization;

namespace FrameDoctor.Optimization;

/// <summary>
/// A record that FrameDoctor changed something, and what it was before.
/// </summary>
/// <remarks>
/// <para>
/// Written <b>before</b> the change is applied, which buys the invariant that makes power loss
/// survivable: there is no reachable state in which a mutation is applied and its journal entry
/// is absent. The reverse ordering has a window in which the machine is modified and nothing
/// records it, and a change nobody remembers making is a change nobody can undo.
/// </para>
/// <para>
/// Values are strings rather than typed fields so an entry written by one version is readable by
/// the next. A journal entry that a newer build cannot parse is an unrestored mutation, and that
/// is the one failure this file exists to prevent.
/// </para>
/// </remarks>
/// <param name="Id">Stable identity of this change, for a compare-and-restore later.</param>
/// <param name="ChangeKind">What kind of setting this is, e.g. process power throttling.</param>
/// <param name="Target">
/// What was changed, identified so precisely that it cannot be confused with something else.
/// A process id alone is not enough: Windows reuses them, and restoring a captured value onto a
/// different process that happens to hold the same id would be a mutation of an innocent target.
/// </param>
/// <param name="CapturedValue">What the setting read before the change, verified by two reads.</param>
/// <param name="AppliedValue">What FrameDoctor set it to.</param>
/// <param name="AppliedAtUtc">When. For the user, not for logic.</param>
/// <param name="AppliedByBuild">Which build made the change, so a bad release is identifiable.</param>
public sealed record JournalEntry(
    string Id,
    string ChangeKind,
    string Target,
    string CapturedValue,
    string AppliedValue,
    DateTimeOffset AppliedAtUtc,
    string AppliedByBuild);

/// <summary>An entry that could not be read.</summary>
/// <param name="Path">The file.</param>
/// <param name="Reason">Why it could not be read, for the user.</param>
/// <remarks>
/// Surfaced rather than skipped. An unreadable journal entry most likely means a change that was
/// applied and can no longer be undone automatically, which is precisely the situation a user
/// must be told about rather than have quietly ignored.
/// </remarks>
public sealed record UnreadableEntry(string Path, string Reason);

/// <summary>Everything the journal holds right now.</summary>
public sealed record JournalContents(
    IReadOnlyList<JournalEntry> Entries,
    IReadOnlyList<UnreadableEntry> Unreadable);

/// <summary>
/// The durable record of every system change FrameDoctor has made and not yet undone.
/// </summary>
/// <remarks>
/// <para>
/// One plain file per entry, in a directory of its own, and deliberately <b>not</b> inside the
/// session database. The rollback doctrine requires restoration to survive database corruption,
/// which is unsatisfiable if the rollback state lives in the database.
/// </para>
/// <para>
/// One file per entry rather than one file for all of them, for the same reason: a single
/// journal file makes every entry depend on every other entry surviving, and a torn write loses
/// the record of every outstanding change rather than one.
/// </para>
/// </remarks>
public sealed class ChangeJournal
{
    private const string Extension = ".journal.json";

    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly string _directory;

    public ChangeJournal(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        _directory = directory;
    }

    public string Directory => _directory;

    /// <summary>
    /// Writes an entry, durably, before the change it describes is applied.
    /// </summary>
    /// <remarks>
    /// Temp file, flushed to the device, then moved into place. A plain write can leave a
    /// truncated file after power loss, and a truncated journal entry is an unrestorable
    /// mutation — the flush is what makes the ordering guarantee mean anything, because without
    /// it the move can land before the content does.
    /// </remarks>
    public void Write(JournalEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        ArgumentException.ThrowIfNullOrWhiteSpace(entry.Id);

        System.IO.Directory.CreateDirectory(_directory);

        var destination = PathFor(entry.Id);
        var temporary = destination + ".tmp";

        using (var stream = new FileStream(
                   temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(stream, entry, Options);
            stream.Flush(flushToDisk: true);
        }

        File.Move(temporary, destination, overwrite: true);
    }

    /// <summary>Reads every entry, separating the ones that could not be read.</summary>
    public JournalContents ReadAll()
    {
        var entries = new List<JournalEntry>();
        var unreadable = new List<UnreadableEntry>();

        if (!System.IO.Directory.Exists(_directory))
            return new JournalContents(entries, unreadable);

        foreach (var path in System.IO.Directory.EnumerateFiles(_directory, $"*{Extension}"))
        {
            try
            {
                var entry = JsonSerializer.Deserialize<JournalEntry>(File.ReadAllText(path), Options);

                if (entry is null || string.IsNullOrWhiteSpace(entry.Id))
                {
                    unreadable.Add(new UnreadableEntry(path, "The entry is empty."));
                    continue;
                }

                entries.Add(entry);
            }
            catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
            {
                // Never skipped. An unreadable entry most likely means a change that was applied
                // and can no longer be undone automatically, and a user has to be told that.
                unreadable.Add(new UnreadableEntry(path, e.Message));
            }
        }

        entries.Sort((a, b) => a.AppliedAtUtc.CompareTo(b.AppliedAtUtc));
        return new JournalContents(entries, unreadable);
    }

    /// <summary>Removes an entry, once its change has been undone or confirmed gone.</summary>
    /// <returns>Whether an entry was there to remove.</returns>
    public bool Delete(string id)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(id);

        var path = PathFor(id);
        if (!File.Exists(path)) return false;

        File.Delete(path);
        return true;
    }

    /// <summary>Leftover temporary files from an interrupted write.</summary>
    /// <remarks>
    /// A temp file means a write that did not complete, which means the change it described was
    /// never applied — the journal is written first. They are safe to remove, and counting them
    /// is a useful signal that the machine is losing power mid-write.
    /// </remarks>
    public int CleanTemporaryFiles()
    {
        if (!System.IO.Directory.Exists(_directory)) return 0;

        var removed = 0;
        foreach (var path in System.IO.Directory.EnumerateFiles(_directory, $"*{Extension}.tmp"))
        {
            try
            {
                File.Delete(path);
                removed++;
            }
            catch (IOException)
            {
                // Another process holds it. It will be cleaned next time.
            }
        }

        return removed;
    }

    private string PathFor(string id) =>
        Path.Combine(_directory, $"{Sanitize(id)}{Extension}");

    /// <summary>
    /// Makes an identifier safe as a filename without making two identifiers collide.
    /// </summary>
    /// <remarks>
    /// The hash suffix is the part that matters. Replacing invalid characters alone would map
    /// two different targets onto one filename, and one entry would silently overwrite the
    /// other — leaving a real mutation with no record of how to undo it.
    /// </remarks>
    private static string Sanitize(string id)
    {
        var safe = new string([.. id.Select(c =>
            char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '-')]);

        if (safe.Length > 64) safe = safe[..64];

        var hash = System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(id));

        return $"{safe}-{Convert.ToHexStringLower(hash)[..12]}";
    }
}
