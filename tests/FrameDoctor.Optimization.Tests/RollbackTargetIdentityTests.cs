using Xunit;
using FrameDoctor.Optimization;
using Shouldly;

namespace FrameDoctor.Optimization.Tests;

/// <summary>
/// Adversarial: the journal must record <b>what was changed</b>, not <b>what it was called</b>.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="ChangeApplier.Apply"/> takes a <c>target</c> (the machine-readable identity that
/// <see cref="IReversibleChange.Write"/> acts on) and a <c>description</c> (a sentence for the
/// user). It writes the <i>description</i> into <see cref="JournalEntry.Target"/>, and
/// <see cref="ChangeApplier.Reconcile"/> then calls <c>Read</c>/<c>Write</c> with
/// <c>entry.Target</c>.
/// </para>
/// <para>
/// So the only durable record of a mutation identifies it by a display string. Every rollback
/// path — engine start, logon, uninstall, the user asking — goes through that string. What the
/// user gets is either a change that is never undone (their game stays throttled) or, if a
/// description happens to be parseable as a target, a write onto a process nobody asked to touch.
/// </para>
/// <para>
/// The existing suite cannot see this because its fake ignores the <c>target</c> argument
/// entirely and its description is a different string that is never used for anything. The fakes
/// here are keyed by target, which is what the real platform implementation is.
/// </para>
/// </remarks>
public sealed class RollbackTargetIdentityTests : IDisposable
{
    private readonly string _directory =
        Path.Combine(Path.GetTempPath(), $"framedoctor-identity-{Guid.NewGuid():N}");

    private ChangeJournal Journal => new(_directory);

    /// <summary>A setting that actually keys off its target, as the real Windows one does.</summary>
    private sealed class TargetKeyedSetting : IReversibleChange
    {
        public string ChangeKind => "test-setting";
        public string RestrainedValue => "eco";

        /// <summary>The machine. Targets not in here do not exist.</summary>
        public Dictionary<string, string> Values { get; } = [];

        public List<string> TargetsWritten { get; } = [];

        public CurrentValue Read(string target) =>
            Values.TryGetValue(target, out var v) ? CurrentValue.Read(v) : CurrentValue.Gone;

        public bool Write(string target, string value)
        {
            TargetsWritten.Add(target);
            if (!Values.ContainsKey(target)) return false;

            Values[target] = value;
            return true;
        }
    }

    /// <summary>
    /// The journal records the display name where the identity belongs.
    /// </summary>
    /// <remarks>
    /// This is the root defect. Everything else in this file is a consequence of it.
    /// </remarks>
    [Fact]
    public void The_journal_records_the_display_name_where_the_target_belongs()
    {
        var setting = new TargetKeyedSetting();
        setting.Values["pid:4812|started:638000000000000000"] = "system-managed";

        new ChangeApplier(Journal, "test").Apply(
            setting,
            entryId: "entry-1",
            target: "pid:4812|started:638000000000000000",
            description: "Discord (background)");

        var entry = Journal.ReadAll().Entries.ShouldHaveSingleItem();

        // What must be there for a later reconcile to act on the right thing.
        entry.Target.ShouldBe("pid:4812|started:638000000000000000");
    }

    /// <summary>
    /// Reconciliation deletes the rollback record while the machine is still modified.
    /// </summary>
    /// <remarks>
    /// The description does not name anything the platform knows, so the read reports the target
    /// as gone, the compare-and-restore table settles the entry as "nothing to restore", and the
    /// only record of the change is deleted. The process is still throttled and now nothing on
    /// the machine remembers that FrameDoctor did it. This is the unrecoverable case: an
    /// uninstall runs this exact code path.
    /// </remarks>
    [Fact]
    public void Reconcile_deletes_the_record_while_the_change_is_still_applied()
    {
        const string target = "pid:4812|started:638000000000000000";

        var setting = new TargetKeyedSetting();
        setting.Values[target] = "system-managed";

        var applier = new ChangeApplier(Journal, "test");
        applier.Apply(setting, "entry-1", target, "Discord (background)");
        setting.Values[target].ShouldBe("eco");

        var result = applier.Reconcile(setting, Journal.ReadAll().Entries[0]);

        // What must happen: the captured value goes back onto the process that was changed.
        setting.Values[target].ShouldBe(
            "system-managed",
            "the process FrameDoctor throttled is still throttled after a full reconcile");

        result.Restored.ShouldBeTrue();
        Journal.ReadAll().Entries.ShouldBeEmpty();
    }

    /// <summary>
    /// A description that reads like a target sends the restore onto an innocent process.
    /// </summary>
    /// <remarks>
    /// The window title or command line of a game can contain anything. Because the description
    /// is what reconcile parses, a description containing another target's identity makes
    /// FrameDoctor write a captured value onto a process it never touched — the exact mutation of
    /// an innocent target that <c>EcoQosState.TargetFor</c> was written to make impossible.
    /// </remarks>
    [Fact]
    public void A_description_that_parses_as_a_target_moves_the_restore_onto_an_innocent_process()
    {
        const string throttled = "pid:4812|started:1";
        const string innocent = "pid:9001|started:2";

        var setting = new TargetKeyedSetting();
        setting.Values[throttled] = "system-managed";
        setting.Values[innocent] = "eco";      // the user chose this for their own reasons

        var applier = new ChangeApplier(Journal, "test");

        // A description is free text. This one names another live target.
        applier.Apply(setting, "entry-1", throttled, innocent);
        applier.Reconcile(setting, Journal.ReadAll().Entries[0]);

        setting.TargetsWritten.ShouldNotContain(
            innocent,
            "reconcile wrote to a process that FrameDoctor never changed");
    }

    /// <summary>
    /// A change whose target is not recognisable accumulates a journal file that never clears.
    /// </summary>
    /// <remarks>
    /// When the platform reports "cannot read" rather than "gone" — which is what the real
    /// <c>EcoQosChange</c> does for a target string it cannot parse — the entry is kept by
    /// design, forever, and <c>framedoctor reconcile</c> exits non-zero for the rest of the
    /// install's life. Every optimization the user ever applies adds one more permanent file and
    /// one more permanent "left for you to decide about" line.
    /// </remarks>
    [Fact]
    public void Entries_the_platform_cannot_identify_accumulate_forever()
    {
        var setting = new UnparseableTargetSetting();
        var applier = new ChangeApplier(Journal, "test");

        for (var i = 0; i < 25; i++)
        {
            var target = $"pid:{1000 + i}|started:1";
            setting.Values[target] = "system-managed";
            applier.Apply(setting, $"entry-{i}", target, $"Game {i}");
        }

        // Reconcile every entry, repeatedly, as engine start / logon / uninstall all would.
        for (var pass = 0; pass < 3; pass++)
            foreach (var entry in Journal.ReadAll().Entries)
                applier.Reconcile(setting, entry);

        Journal.ReadAll().Entries.ShouldBeEmpty(
            "the rollback journal grows by one permanent file per optimization ever applied");
    }

    /// <summary>Reports "cannot read" for an unrecognised target, like the real EcoQoS change.</summary>
    private sealed class UnparseableTargetSetting : IReversibleChange
    {
        public string ChangeKind => "test-setting";
        public string RestrainedValue => "eco";
        public Dictionary<string, string> Values { get; } = [];

        public CurrentValue Read(string target) =>
            Values.TryGetValue(target, out var v) ? CurrentValue.Read(v) : CurrentValue.Unreadable;

        public bool Write(string target, string value)
        {
            if (!Values.ContainsKey(target)) return false;
            Values[target] = value;
            return true;
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_directory)) Directory.Delete(_directory, recursive: true);
    }
}
