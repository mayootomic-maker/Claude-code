using Xunit;
using FrameDoctor.Optimization;
using FrameDoctor.Platform.Windows.Optimization;
using Shouldly;

namespace FrameDoctor.Platform.Windows.Tests;

/// <summary>
/// Adversarial: what the real Windows change does with the target string the journal stores.
/// </summary>
/// <remarks>
/// <para>
/// <c>ChangeApplier.Apply</c> writes its <c>description</c> argument into
/// <c>JournalEntry.Target</c>, and <c>ChangeApplier.Reconcile</c> hands <c>entry.Target</c>
/// straight to <c>EcoQosChange.Read</c> and <c>Write</c>. This test takes the string that
/// actually ends up in a journal file and asks the real Windows implementation to parse it.
/// </para>
/// <para>
/// It cannot. <c>EcoQosChange.Read</c> then returns <c>CurrentValue.Unreadable</c>, the
/// compare-and-restore table decides <c>CannotRead</c>, and the entry is kept — correctly, by its
/// own rules, and forever. The process stays throttled, and <c>framedoctor reconcile</c> reports
/// "1 left for you to decide about" at every logon for the life of the install.
/// </para>
/// <para>
/// This is portable arithmetic on strings, so it runs on Linux; only the kernel32 calls behind
/// it need Windows.
/// </para>
/// </remarks>
public sealed class JournalledTargetIsUsableOnWindowsTests
{
    private sealed class Recording : IReversibleChange
    {
        public string ChangeKind => "process-eco-qos";
        public string RestrainedValue => EcoQosState.Restrained;
        public string? LastTarget { get; private set; }
        public string Value { get; private set; } = EcoQosState.SystemManaged;

        public CurrentValue Read(string target)
        {
            LastTarget = target;
            return CurrentValue.Read(Value);
        }

        public bool Write(string target, string value)
        {
            LastTarget = target;
            Value = value;
            return true;
        }
    }

    [Fact]
    public void The_target_written_to_the_journal_can_still_be_parsed_back_to_a_process_id()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"fd-journal-{Guid.NewGuid():N}");

        try
        {
            var journal = new ChangeJournal(directory);
            var target = EcoQosState.TargetFor(4812, 638_000_000_000_000_000L);

            new ChangeApplier(journal, "test").Apply(
                new Recording(), "entry-1", target, "Discord (background)");

            var entry = journal.ReadAll().Entries.ShouldHaveSingleItem();

            EcoQosState.TryParseTarget(entry.Target, out var processId).ShouldBeTrue(
                "the journalled target cannot be resolved to a process, so the throttled " +
                "process can never be put back");

            processId.ShouldBe(4812u);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }
}
