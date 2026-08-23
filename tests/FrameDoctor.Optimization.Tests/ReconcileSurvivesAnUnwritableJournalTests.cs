using Xunit;
using FrameDoctor.Optimization;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// Adversarial: reconciliation now writes to the journal, and writing can fail.
/// </summary>
/// <remarks>
/// <para>
/// The attempt counter that stops entries accumulating forever is persisted by
/// <c>ChangeApplier.Unresolved</c>, which calls <c>ChangeJournal.Write</c> on any pass that does
/// not resolve. That turned reconciliation from a read-and-delete operation into one that writes,
/// and it inherited every way a write fails: a full disk, a directory an anti-virus product has
/// locked, a roaming profile that is not there yet at logon, a path where a file now sits.
/// </para>
/// <para>
/// Reconciliation is the code that runs at every engine start, at every logon, and from the
/// uninstaller. Throwing out of it means the uninstaller's rollback pass dies before it reaches
/// the remaining entries — so one unwritable journal turns a partial rollback into no rollback at
/// all, and the user's machine keeps every change FrameDoctor made after the first failure.
/// </para>
/// </remarks>
public sealed class ReconcileSurvivesAnUnwritableJournalTests : IDisposable
{
    private readonly string _root =
        Path.Combine(Path.GetTempPath(), $"framedoctor-unwritable-{Guid.NewGuid():N}");

    public ReconcileSurvivesAnUnwritableJournalTests() => Directory.CreateDirectory(_root);

    /// <summary>A setting whose current value cannot be read, which is the "keep the entry" case.</summary>
    private sealed class UnreadableSetting : IReversibleChange
    {
        public string ChangeKind => "test-setting";
        public string RestrainedValue => "eco";
        public CurrentValue Read(string target) => CurrentValue.Unreadable;
        public bool Write(string target, string value) => false;
    }

    [Fact]
    public void A_journal_that_cannot_be_written_does_not_abort_the_rollback_pass()
    {
        // A file where the journal directory should be: what a half-restored profile, a
        // synchronisation conflict, or a stray file with the right name leaves behind.
        var journalPath = Path.Combine(_root, "rollback");
        File.WriteAllText(journalPath, "not a directory");

        var journal = new ChangeJournal(journalPath);
        var applier = new ChangeApplier(journal, "test");

        var entry = new JournalEntry(
            "entry-1",
            "test-setting",
            "pid:4812|started:1",
            "Discord (background)",
            "system-managed",
            "eco",
            DateTimeOffset.UtcNow,
            "test");

        var failure = Record.Exception(() => applier.Reconcile(new UnreadableSetting(), entry));

        failure.ShouldBeNull(
            "one unwritable journal aborts the whole rollback pass, including entries that " +
            "could have been restored");
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }
}
